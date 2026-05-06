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

        $sql = 'SELECT id, user_id, location, severity, description, reporter_name, latitude, longitude, polygon_coords, created_at
                FROM reports';

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
        'SELECT id, user_id, location, severity, description, reporter_name, latitude, longitude, polygon_coords, created_at
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

function handle_get_stats(): void
{
    $user = require_auth();

    if ($user['role'] !== 'admin') {
        respond_reports(['error' => 'Forbidden.'], 403);
    }

    $pdo = get_pdo();

    $stmt = $pdo->query('SELECT severity, COUNT(*) as count FROM reports GROUP BY severity');
    $severityStats = $stmt->fetchAll();

    $stmt = $pdo->query("SELECT DATE_FORMAT(created_at, '%Y-%m') as month, COUNT(*) as count FROM reports GROUP BY month ORDER BY month DESC LIMIT 12");
    $monthlyTrends = $stmt->fetchAll();

    $stmt = $pdo->query('SELECT location, COUNT(*) as count FROM reports GROUP BY location ORDER BY count DESC LIMIT 10');
    $topLocations = $stmt->fetchAll();

    respond_reports([
        'severity_stats' => $severityStats,
        'monthly_trends' => $monthlyTrends,
        'top_locations' => $topLocations
    ]);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (isset($_GET['stats']) && $_GET['stats'] === 'true') {
        handle_get_stats();
    } else {
        handle_get_reports();
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    handle_post_report();
}

respond_reports(['error' => 'Not found.'], 404);
