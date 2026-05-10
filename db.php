<?php

declare(strict_types=1);

$configPath = __DIR__ . '/config.local.php';
if (!is_file($configPath)) {
    $configPath = __DIR__ . '/config.example.php';
}

$config = require $configPath;

define('DB_HOST', (string) $config['db_host']);
define('DB_NAME', (string) $config['db_name']);
define('DB_USER', (string) $config['db_user']);
define('DB_PASS', (string) $config['db_pass']);

function get_pdo(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';

    $options = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ];

    $pdo = new PDO($dsn, DB_USER, DB_PASS, $options);

    return $pdo;
}

function log_activity(int $userId, string $action, string $details = ''): bool
{
    try {
        $pdo = get_pdo();
        $stmt = $pdo->prepare(
            'INSERT INTO activity_logs (user_id, action, details, created_at)
             VALUES (:user_id, :action, :details, NOW())'
        );
        $stmt->execute([
            ':user_id' => $userId,
            ':action'  => $action,
            ':details' => $details,
        ]);

        return true;
    } catch (Throwable $e) {
        error_log('Activity log failed: ' . $e->getMessage());

        return false;
    }
}

function db_column_exists(string $tableName, string $columnName): bool
{
    static $cache = [];
    $key = strtolower($tableName . '.' . $columnName);
    if (array_key_exists($key, $cache)) {
        return $cache[$key];
    }

    try {
        $pdo = get_pdo();
        $stmt = $pdo->prepare(
            'SELECT 1
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = :table_name
               AND COLUMN_NAME = :column_name
             LIMIT 1'
        );
        $stmt->execute([
            ':table_name' => $tableName,
            ':column_name' => $columnName,
        ]);
        $cache[$key] = (bool) $stmt->fetchColumn();
        return $cache[$key];
    } catch (Throwable $e) {
        error_log('db_column_exists failed: ' . $e->getMessage());
        $cache[$key] = false;
        return false;
    }
}
