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

function require_auth_logs(): array
{
    if (!isset($_SESSION['user'])) {
        http_response_code(401);
        echo json_encode(['error' => 'Not authenticated.']);
        exit;
    }

    return $_SESSION['user'];
}

function respond_logs(array $payload, int $statusCode = 200): void
{
    http_response_code($statusCode);
    echo json_encode($payload);
    exit;
}

function handle_get_logs(): void
{
    $user = require_auth_logs();
    $pdo  = get_pdo();

    $scope = isset($_GET['scope']) ? $_GET['scope'] : 'user';

    if ($scope === 'admin') {
        if ($user['role'] !== 'admin') {
            respond_logs(['error' => 'Forbidden.'], 403);
        }

        // Avoid joining users.email so the query works even if the column name differs;
        // display label is still shown as user_email in the UI.
        $stmt = $pdo->query(
            'SELECT al.id,
                    al.user_id,
                    CONCAT(\'User #\', al.user_id) AS user_email,
                    al.action,
                    al.details,
                    al.created_at
             FROM activity_logs al
             ORDER BY al.created_at DESC
             LIMIT 200'
        );
        $rows = $stmt->fetchAll();
        respond_logs(['logs' => $rows]);
    }

    $stmt = $pdo->prepare(
        'SELECT id, user_id, action, details, created_at
         FROM activity_logs
         WHERE user_id = :user_id
         ORDER BY created_at DESC
         LIMIT 100'
    );
    $stmt->execute([':user_id' => (int) $user['id']]);
    $rows = $stmt->fetchAll();

    respond_logs(['logs' => $rows]);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    handle_get_logs();
}

respond_logs(['error' => 'Not found.'], 404);
