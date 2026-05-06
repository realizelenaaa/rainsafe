<?php

declare(strict_types=1);

function send_json_cors_headers(): void
{
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Credentials: true');
    header('Access-Control-Allow-Headers: Content-Type, Cookie, Set-Cookie, X-CSRF-Token');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
}
