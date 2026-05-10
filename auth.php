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

function json_input(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }

    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function current_user(): ?array
{
    if (!isset($_SESSION['user'])) {
        return null;
    }
    return $_SESSION['user'];
}

function respond(array $payload, int $statusCode = 200): void
{
    http_response_code($statusCode);
    echo json_encode($payload);
    exit;
}

function handle_signup(): void
{
    // Login/signup intentionally omit CSRF: the session may not have a token yet
    // (e.g. user submits before the session GET finishes). Other actions use CSRF.
    $data = json_input();
    $email = isset($data['email']) ? trim((string) $data['email']) : '';
    $password = isset($data['password']) ? (string) $data['password'] : '';

    if ($email === '' || $password === '') {
        respond(['error' => 'Email and password are required.'], 400);
    }

    if (strlen($password) < 6) {
        respond(['error' => 'Password must be at least 6 characters.'], 400);
    }

    $pdo = get_pdo();

    $stmt = $pdo->prepare('SELECT id FROM users WHERE email = ? LIMIT 1');
    $stmt->execute([$email]);
    if ($stmt->fetch()) {
        respond(['error' => 'Email is already registered.'], 409);
    }

    $hash = password_hash($password, PASSWORD_DEFAULT);
    $role = 'user';

    $stmt = $pdo->prepare(
        'INSERT INTO users (email, password_hash, role, created_at)
         VALUES (:email, :password_hash, :role, NOW())'
    );

    $stmt->execute([
        ':email'         => $email,
        ':password_hash' => $hash,
        ':role'          => $role,
    ]);

    $userId = (int) $pdo->lastInsertId();
    log_activity(
        $userId,
        'signup',
        sprintf('Created account: %s', $email)
    );

    respond(['message' => 'Account created. You can now sign in.']);
}

function handle_login(): void
{
    $data = json_input();
    $email = isset($data['email']) ? trim((string) $data['email']) : '';
    $password = isset($data['password']) ? (string) $data['password'] : '';

    if ($email === '' || $password === '') {
        respond(['error' => 'Email and password are required.'], 400);
    }

    $pdo = get_pdo();

    $hasSuspendedColumn = db_column_exists('users', 'is_suspended');
    $loginSql = $hasSuspendedColumn
        ? 'SELECT id, email, password_hash, role, created_at, is_suspended
           FROM users
           WHERE email = ?
           LIMIT 1'
        : 'SELECT id, email, password_hash, role, created_at
           FROM users
           WHERE email = ?
           LIMIT 1';
    $stmt = $pdo->prepare($loginSql);
    $stmt->execute([$email]);
    $row = $stmt->fetch();

    if (!$row || !password_verify($password, $row['password_hash'])) {
        respond(['error' => 'Invalid email or password.'], 401);
    }
    if ($hasSuspendedColumn && (int) ($row['is_suspended'] ?? 0) === 1) {
        respond(['error' => 'Your account is suspended. Please contact admin.'], 403);
    }

    $user = [
        'id'         => (int) $row['id'],
        'email'      => $row['email'],
        'role'       => $row['role'],
        'created_at' => $row['created_at'],
    ];

    $_SESSION['user'] = $user;

    log_activity(
        $user['id'],
        'login',
        sprintf('User %s (%s) signed in.', $user['email'], $user['role'])
    );

    respond(['user' => $user]);
}

function handle_logout(): void
{
    require_csrf();
    $user = current_user();

    if ($user) {
        log_activity(
            (int) $user['id'],
            'logout',
            sprintf('User %s (%s) signed out.', $user['email'], $user['role'] ?? '')
        );
    }

    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(
            session_name(),
            '',
            time() - 42000,
            $params['path'],
            $params['domain'],
            $params['secure'],
            $params['httponly']
        );
    }
    session_destroy();

    respond(['message' => 'Logged out.']);
}

function handle_session(): void
{
    $user = current_user();
    if ($user && db_column_exists('users', 'is_suspended')) {
        $pdo = get_pdo();
        $stmt = $pdo->prepare('SELECT is_suspended FROM users WHERE id = :id LIMIT 1');
        $stmt->execute([':id' => (int) $user['id']]);
        $row = $stmt->fetch();
        if ($row && (int) ($row['is_suspended'] ?? 0) === 1) {
            $_SESSION = [];
            if (ini_get('session.use_cookies')) {
                $params = session_get_cookie_params();
                setcookie(
                    session_name(),
                    '',
                    time() - 42000,
                    $params['path'],
                    $params['domain'],
                    $params['secure'],
                    $params['httponly']
                );
            }
            session_destroy();
            $user = null;
        }
    }
    $payload = ['user' => $user];
    if (isset($_SESSION['csrf_token'])) {
        $payload['csrf_token'] = $_SESSION['csrf_token'];
    }

    respond($payload);
}

$action = isset($_GET['action']) ? $_GET['action'] : '';

if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'session') {
    handle_session();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'signup') {
    handle_signup();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'login') {
    handle_login();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'logout') {
    handle_logout();
}

respond(['error' => 'Not found.'], 404);
