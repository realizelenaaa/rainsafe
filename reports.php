<?php
declare(strict_types=1);

require_once __DIR__ . '/session_init.php';
require_once __DIR__ . '/http_headers.php';

send_json_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/csrf.php';

function json_input_reports(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }

    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function require_auth(): array
{
    if (!isset($_SESSION['user'])) {
        http_response_code(401);
        echo json_encode(['error' => 'Not authenticated.']);
        exit;
    }

    return $_SESSION['user'];
}

function respond_reports(array $payload, int $statusCode = 200): void
{
    http_response_code($statusCode);
    echo json_encode($payload);
    exit;
}

function handle_get_reports(): void
{
    $user = require_auth();
    $pdo = get_pdo();
    $hasUserSuspended = db_column_exists('users', 'is_suspended');

    $scope = isset($_GET['scope']) ? $_GET['scope'] : 'user';

    if ($scope === 'admin') {
        if ($user['role'] !== 'admin') {
            respond_reports(['error' => 'Forbidden.'], 403);
        }

        $conditions = [];
        $params     = [];

        if (!empty($_GET['severity'])) {
            $sev = (string) $_GET['severity'];
            $allowedFilter = ['Low', 'Medium', 'High'];
            if (!in_array($sev, $allowedFilter, true)) {
                respond_reports(['error' => 'Invalid severity filter.'], 400);
            }
            $conditions[]      = 'severity = :severity';
            $params['severity'] = $sev;
        }

        $sql = 'SELECT r.id, r.user_id, r.location, r.severity, r.description, r.reporter_name,
                       r.latitude, r.longitude, r.polygon_coords, r.created_at, r.is_false_report,
                       r.false_report_note, r.flagged_false_at, r.false_marked_by,
                       ' . ($hasUserSuspended ? 'u.is_suspended' : '0') . ' AS reporter_is_suspended
                FROM reports r
                LEFT JOIN users u ON u.id = r.user_id';

        if ($conditions) {
            $sql .= ' WHERE ' . implode(' AND ', $conditions);
        }

        $sql .= ' ORDER BY created_at DESC';

        $stmt = $pdo->prepare($sql);
        foreach ($params as $key => $value) {
            $stmt->bindValue(':' . $key, $value);
        }
        $stmt->execute();

        $rows = $stmt->fetchAll();

        foreach ($rows as &$row) {
            if ($row['polygon_coords']) {
                $row['polygon_coords'] = json_decode($row['polygon_coords'], true);
            }
        }

        respond_reports(['reports' => $rows]);
    }

    $stmt = $pdo->prepare(
        'SELECT id, user_id, location, severity, description, reporter_name, latitude, longitude,
                polygon_coords, created_at, is_false_report, false_report_note, flagged_false_at, false_marked_by
         FROM reports
         WHERE user_id = :user_id
         ORDER BY created_at DESC'
    );
    $stmt->execute([':user_id' => (int) $user['id']]);
    $rows = $stmt->fetchAll();

    foreach ($rows as &$row) {
        if ($row['polygon_coords']) {
            $row['polygon_coords'] = json_decode($row['polygon_coords'], true);
        }
    }

    respond_reports(['reports' => $rows]);
}

function handle_post_report(): void
{
    require_csrf();
    $user = require_auth();
    $pdo  = get_pdo();

    $data = json_input_reports();

    $location      = isset($data['location']) ? trim((string) $data['location']) : '';
    $severity      = isset($data['severity']) ? trim((string) $data['severity']) : '';
    $description   = isset($data['description']) ? trim((string) $data['description']) : '';
    $reporterName  = isset($data['reporter_name']) ? trim((string) $data['reporter_name']) : '';
    $latitude      = isset($data['latitude']) ? (float) $data['latitude'] : null;
    $longitude     = isset($data['longitude']) ? (float) $data['longitude'] : null;
    $polygonCoords = isset($data['polygon_coords']) ? json_encode($data['polygon_coords']) : null;

    if ($location === '' || $severity === '') {
        respond_reports(['error' => 'Location and severity are required.'], 400);
    }

    $allowedSeverities = ['Low', 'Medium', 'High'];
    if (!in_array($severity, $allowedSeverities, true)) {
        respond_reports(['error' => 'Invalid severity value.'], 400);
    }

    if (db_column_exists('users', 'is_suspended')) {
        $activeStmt = $pdo->prepare('SELECT is_suspended FROM users WHERE id = :id LIMIT 1');
        $activeStmt->execute([':id' => (int) $user['id']]);
        $activeRow = $activeStmt->fetch();
        if ($activeRow && (int) ($activeRow['is_suspended'] ?? 0) === 1) {
            respond_reports(['error' => 'Your account is suspended. You cannot submit reports.'], 403);
        }
    }

    $stmt = $pdo->prepare(
        'INSERT INTO reports (user_id, location, severity, description, reporter_name, latitude, longitude, polygon_coords, created_at)
         VALUES (:user_id, :location, :severity, :description, :reporter_name, :latitude, :longitude, :polygon_coords, NOW())'
    );

    try {
        $stmt->execute([
            ':user_id'        => (int) $user['id'],
            ':location'       => $location,
            ':severity'       => $severity,
            ':description'    => $description,
            ':reporter_name'  => $reporterName,
            ':latitude'       => $latitude,
            ':longitude'      => $longitude,
            ':polygon_coords' => $polygonCoords,
        ]);
    } catch (PDOException $e) {
        error_log('reports INSERT failed: ' . $e->getMessage());
        respond_reports([
            'error' => 'Could not save the report. If this is a new install, run database/update_reports_table.sql in MySQL to add missing columns.',
        ], 500);
    }

    log_activity(
        (int) $user['id'],
        'submitted_report',
        sprintf('Reported "%s" at "%s".', $severity, $location)
    );

    respond_reports(['message' => 'Report submitted successfully.']);
}

function handle_mark_false_report(): void
{
    require_csrf();
    $user = require_auth();
    if (($user['role'] ?? '') !== 'admin') {
        respond_reports(['error' => 'Forbidden.'], 403);
    }

    $data = json_input_reports();
    $reportId = isset($data['report_id']) ? (int) $data['report_id'] : 0;
    $note = isset($data['note']) ? trim((string) $data['note']) : '';
    $suspendReporter = !empty($data['suspend_reporter']);
    if ($reportId <= 0) {
        respond_reports(['error' => 'Invalid report id.'], 400);
    }

    $pdo = get_pdo();
    if (
        !db_column_exists('reports', 'is_false_report') ||
        !db_column_exists('reports', 'false_report_note') ||
        !db_column_exists('reports', 'flagged_false_at') ||
        !db_column_exists('reports', 'false_marked_by')
    ) {
        respond_reports(['error' => 'Database is missing false-report columns. Run db_update.sql first.'], 500);
    }
    if ($suspendReporter && !db_column_exists('users', 'is_suspended')) {
        respond_reports(['error' => 'Database is missing users.is_suspended. Run db_update.sql first.'], 500);
    }
    $pdo->beginTransaction();
    try {
        $reportStmt = $pdo->prepare('SELECT id, user_id, is_false_report FROM reports WHERE id = :id LIMIT 1');
        $reportStmt->execute([':id' => $reportId]);
        $report = $reportStmt->fetch();
        if (!$report) {
            $pdo->rollBack();
            respond_reports(['error' => 'Report not found.'], 404);
        }

        if ((int) ($report['is_false_report'] ?? 0) === 0) {
            $flagStmt = $pdo->prepare(
                'UPDATE reports
                 SET is_false_report = 1,
                     false_report_note = :note,
                     flagged_false_at = NOW(),
                     false_marked_by = :admin_id
                 WHERE id = :id'
            );
            $flagStmt->execute([
                ':note' => $note !== '' ? $note : null,
                ':admin_id' => (int) $user['id'],
                ':id' => $reportId,
            ]);
        }

        if ($suspendReporter && (int) $report['user_id'] > 0) {
            $suspendStmt = $pdo->prepare('UPDATE users SET is_suspended = 1, suspended_at = NOW() WHERE id = :id');
            $suspendStmt->execute([':id' => (int) $report['user_id']]);
        }

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('mark false report failed: ' . $e->getMessage());
        respond_reports(['error' => 'Unable to update report.'], 500);
    }

    log_activity(
        (int) $user['id'],
        'flagged_false_report',
        sprintf('Flagged report #%d as false.%s', $reportId, $suspendReporter ? ' Reporter suspended.' : '')
    );

    respond_reports(['message' => 'Report flagged as false.']);
}

function handle_unmark_false_report(): void
{
    require_csrf();
    $user = require_auth();
    if (($user['role'] ?? '') !== 'admin') {
        respond_reports(['error' => 'Forbidden.'], 403);
    }
    if (
        !db_column_exists('reports', 'is_false_report') ||
        !db_column_exists('reports', 'false_report_note') ||
        !db_column_exists('reports', 'flagged_false_at') ||
        !db_column_exists('reports', 'false_marked_by')
    ) {
        respond_reports(['error' => 'Database is missing false-report columns. Run db_update.sql first.'], 500);
    }

    $data = json_input_reports();
    $reportId = isset($data['report_id']) ? (int) $data['report_id'] : 0;
    if ($reportId <= 0) {
        respond_reports(['error' => 'Invalid report id.'], 400);
    }

    $pdo = get_pdo();
    $stmt = $pdo->prepare(
        'UPDATE reports
         SET is_false_report = 0,
             false_report_note = NULL,
             flagged_false_at = NULL,
             false_marked_by = NULL
         WHERE id = :id'
    );
    $stmt->execute([':id' => $reportId]);
    if ((int) $stmt->rowCount() === 0) {
        respond_reports(['error' => 'Report not found or no change applied.'], 404);
    }

    log_activity(
        (int) $user['id'],
        'unmarked_false_report',
        sprintf('Restored report #%d from false-report list.', $reportId)
    );

    respond_reports(['message' => 'Report restored to active reports.']);
}

function handle_update_report(): void
{
    require_csrf();
    $user = require_auth();
    if (($user['role'] ?? '') !== 'admin') {
        respond_reports(['error' => 'Forbidden.'], 403);
    }

    $data = json_input_reports();
    $reportId = isset($data['report_id']) ? (int) $data['report_id'] : 0;
    $location = isset($data['location']) ? trim((string) $data['location']) : '';
    $severity = isset($data['severity']) ? trim((string) $data['severity']) : '';
    $description = isset($data['description']) ? trim((string) $data['description']) : '';
    if ($reportId <= 0) {
        respond_reports(['error' => 'Invalid report id.'], 400);
    }
    if ($location === '' || $severity === '') {
        respond_reports(['error' => 'Location and severity are required.'], 400);
    }
    $allowedSeverities = ['Low', 'Medium', 'High'];
    if (!in_array($severity, $allowedSeverities, true)) {
        respond_reports(['error' => 'Invalid severity value.'], 400);
    }

    $pdo = get_pdo();
    $sql = 'UPDATE reports
            SET location = :location,
                severity = :severity,
                description = :description
            WHERE id = :id';
    if (db_column_exists('reports', 'is_false_report')) {
        $sql .= ' AND is_false_report = 0';
    }
    $stmt = $pdo->prepare($sql);
    $stmt->execute([
        ':location' => $location,
        ':severity' => $severity,
        ':description' => $description,
        ':id' => $reportId,
    ]);
    if ((int) $stmt->rowCount() === 0) {
        respond_reports(['error' => 'Report not found, unchanged, or not editable.'], 404);
    }

    log_activity(
        (int) $user['id'],
        'updated_report',
        sprintf('Updated report #%d details.', $reportId)
    );

    respond_reports(['message' => 'Report updated successfully.']);
}

function handle_suspend_user(): void
{
    require_csrf();
    $user = require_auth();
    if (($user['role'] ?? '') !== 'admin') {
        respond_reports(['error' => 'Forbidden.'], 403);
    }

    $data = json_input_reports();
    $targetUserId = isset($data['user_id']) ? (int) $data['user_id'] : 0;
    $suspend = !isset($data['suspend']) || (bool) $data['suspend'];
    if ($targetUserId <= 0) {
        respond_reports(['error' => 'Invalid user id.'], 400);
    }
    if (!db_column_exists('users', 'is_suspended')) {
        respond_reports(['error' => 'Database is missing users.is_suspended. Run db_update.sql first.'], 500);
    }

    $pdo = get_pdo();
    $suspendedAt = $suspend ? date('Y-m-d H:i:s') : null;
    $stmt = $pdo->prepare('UPDATE users SET is_suspended = :suspend, suspended_at = :suspended_at WHERE id = :id');
    $stmt->execute([
        ':suspend' => $suspend ? 1 : 0,
        ':suspended_at' => $suspendedAt,
        ':id' => $targetUserId,
    ]);
    if ((int) $stmt->rowCount() === 0) {
        respond_reports(['error' => 'User not found or no change applied.'], 404);
    }

    log_activity(
        (int) $user['id'],
        $suspend ? 'suspended_user' : 'unsuspended_user',
        sprintf('%s user id #%d.', $suspend ? 'Suspended' : 'Unsuspended', $targetUserId)
    );

    respond_reports(['message' => $suspend ? 'User suspended.' : 'User unsuspended.']);
}

function handle_get_stats(): void
{
    $user = require_auth();

    if ($user['role'] !== 'admin') {
        respond_reports(['error' => 'Forbidden.'], 403);
    }

    $pdo = get_pdo();

    $stmt = $pdo->query('SELECT severity, COUNT(*) as count FROM reports WHERE is_false_report = 0 GROUP BY severity');
    $severityStats = $stmt->fetchAll();

    $stmt = $pdo->query("SELECT DATE_FORMAT(created_at, '%Y-%m') as month, COUNT(*) as count FROM reports WHERE is_false_report = 0 GROUP BY month ORDER BY month DESC LIMIT 12");
    $monthlyTrends = $stmt->fetchAll();

    $stmt = $pdo->query('SELECT location, COUNT(*) as count FROM reports WHERE is_false_report = 0 GROUP BY location ORDER BY count DESC LIMIT 10');
    $topLocations = $stmt->fetchAll();

    respond_reports([
        'severity_stats' => $severityStats,
        'monthly_trends' => $monthlyTrends,
        'top_locations' => $topLocations
    ]);
}

function handle_get_suspended_accounts(): void
{
    $user = require_auth();
    if (($user['role'] ?? '') !== 'admin') {
        respond_reports(['error' => 'Forbidden.'], 403);
    }

    if (!db_column_exists('users', 'is_suspended')) {
        respond_reports(['accounts' => []]);
    }

    $pdo = get_pdo();
    $stmt = $pdo->query(
        'SELECT id, email, role, created_at, suspended_at
         FROM users
         WHERE is_suspended = 1
         ORDER BY suspended_at DESC, id DESC'
    );
    $rows = $stmt->fetchAll();
    respond_reports(['accounts' => $rows]);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = isset($_GET['action']) ? (string) $_GET['action'] : '';
    if ($action === 'suspended_accounts') {
        handle_get_suspended_accounts();
    }
    if (isset($_GET['stats']) && $_GET['stats'] === 'true') {
        handle_get_stats();
    } else {
        handle_get_reports();
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = isset($_GET['action']) ? (string) $_GET['action'] : '';
    if ($action === 'mark_false') {
        handle_mark_false_report();
    }
    if ($action === 'unmark_false') {
        handle_unmark_false_report();
    }
    if ($action === 'update_report') {
        handle_update_report();
    }
    if ($action === 'suspend_user') {
        handle_suspend_user();
    }
    handle_post_report();
}

respond_reports(['error' => 'Not found.'], 404);
