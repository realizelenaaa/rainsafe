<?php

declare(strict_types=1);

function require_csrf(): void
{
    $header = isset($_SERVER['HTTP_X_CSRF_TOKEN'])
        ? (string) $_SERVER['HTTP_X_CSRF_TOKEN']
        : '';
    $sessionToken = isset($_SESSION['csrf_token'])
        ? (string) $_SESSION['csrf_token']
        : '';

    if ($header === '' || $sessionToken === '' || !hash_equals($sessionToken, $header)) {
        http_response_code(403);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Invalid or missing CSRF token.']);
        exit;
    }
}
