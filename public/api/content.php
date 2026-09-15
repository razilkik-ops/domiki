<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('X-Frame-Options: DENY');
header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");

const PROPERTY_KEYS = ['malta', 'valencia', 'apartments', 'bath'];
const SESSION_NAME = 'malta_retreat_admin';
const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCK_SECONDS = 3600;
// Актуальные диапазоны: https://www.cloudflare.com/ips/
const CLOUDFLARE_PROXY_CIDRS = [
    '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
    '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
    '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
    '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22', '2400:cb00::/32',
    '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
    '2a06:98c0::/29', '2c0f:f248::/32',
];

function respond(int $status, array $payload): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function loadDotEnv(array $paths): array
{
    $values = [];
    foreach ($paths as $path) {
        if (!is_readable($path)) continue;
        $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if ($lines === false) continue;

        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#') continue;
            if (strpos($line, 'export ') === 0) $line = trim(substr($line, 7));
            $separator = strpos($line, '=');
            if ($separator === false) continue;

            $key = trim(substr($line, 0, $separator));
            $value = trim(substr($line, $separator + 1));
            if (!preg_match('/^[A-Z][A-Z0-9_]*$/', $key)) continue;

            $length = strlen($value);
            if ($length >= 2) {
                $first = $value[0];
                $last = $value[$length - 1];
                if (($first === '"' && $last === '"') || ($first === "'" && $last === "'")) {
                    $value = substr($value, 1, -1);
                }
            }
            if (!array_key_exists($key, $values)) $values[$key] = $value;
        }
    }
    return $values;
}

function envValue(string $key, array $fileEnv): string
{
    $serverValue = getenv($key);
    if ($serverValue !== false && trim($serverValue) !== '') return trim($serverValue);
    if (isset($_ENV[$key]) && trim((string) $_ENV[$key]) !== '') return trim((string) $_ENV[$key]);
    return isset($fileEnv[$key]) ? trim((string) $fileEnv[$key]) : '';
}

function envRawValue(string $key, array $fileEnv): string
{
    $serverValue = getenv($key);
    if ($serverValue !== false) return (string) $serverValue;
    if (array_key_exists($key, $_ENV)) return (string) $_ENV[$key];
    return isset($fileEnv[$key]) ? (string) $fileEnv[$key] : '';
}

function startAdminSession(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;

    session_name(SESSION_NAME);
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off'),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    session_start();
}

function isAuthenticated(): bool
{
    return session_status() === PHP_SESSION_ACTIVE && !empty($_SESSION['admin_authenticated']);
}

function csrfToken(): string
{
    if (empty($_SESSION['csrf_token'])) $_SESSION['csrf_token'] = bin2hex(random_bytes(24));
    return (string) $_SESSION['csrf_token'];
}

function loginStatePath(): string
{
    return dirname(__DIR__) . '/data/admin-login-state.json';
}

function ipMatchesRule(string $address, string $rule): bool
{
    $rule = trim($rule);
    if ($rule === '') return false;
    if (strpos($rule, '/') === false) {
        $ruleBytes = @inet_pton($rule);
        $addressBytes = @inet_pton($address);
        return $ruleBytes !== false && $addressBytes !== false && hash_equals($ruleBytes, $addressBytes);
    }

    [$network, $prefixText] = array_pad(explode('/', $rule, 2), 2, '');
    if (filter_var($network, FILTER_VALIDATE_IP) === false || !preg_match('/^\d{1,3}$/', $prefixText)) return false;
    $addressBytes = @inet_pton($address);
    $networkBytes = @inet_pton($network);
    if ($addressBytes === false || $networkBytes === false || strlen($addressBytes) !== strlen($networkBytes)) return false;

    $prefix = (int) $prefixText;
    $maximum = strlen($addressBytes) * 8;
    if ($prefix < 0 || $prefix > $maximum) return false;
    $wholeBytes = intdiv($prefix, 8);
    $remainingBits = $prefix % 8;
    if ($wholeBytes > 0 && substr($addressBytes, 0, $wholeBytes) !== substr($networkBytes, 0, $wholeBytes)) return false;
    if ($remainingBits === 0) return true;
    $mask = (0xFF << (8 - $remainingBits)) & 0xFF;
    return (ord($addressBytes[$wholeBytes]) & $mask) === (ord($networkBytes[$wholeBytes]) & $mask);
}

function loginClientKey(array $fileEnv): string
{
    $remoteAddress = trim((string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
    if (filter_var($remoteAddress, FILTER_VALIDATE_IP) === false) $remoteAddress = 'unknown';

    $configuredRules = preg_split('/[\s,]+/', envValue('ADMIN_TRUSTED_PROXY_CIDRS', $fileEnv), -1, PREG_SPLIT_NO_EMPTY);
    if (!is_array($configuredRules)) $configuredRules = [];
    $isCloudflareProxy = false;
    $isConfiguredProxy = false;
    if ($remoteAddress !== 'unknown') {
        foreach (CLOUDFLARE_PROXY_CIDRS as $rule) {
            if (ipMatchesRule($remoteAddress, $rule)) {
                $isCloudflareProxy = true;
                break;
            }
        }
        foreach ($configuredRules as $rule) {
            if (ipMatchesRule($remoteAddress, $rule)) {
                $isConfiguredProxy = true;
                break;
            }
        }
    }

    $clientAddress = $remoteAddress;
    if ($isCloudflareProxy || $isConfiguredProxy) {
        $header = strtoupper(str_replace('-', '_', envValue('ADMIN_CLIENT_IP_HEADER', $fileEnv)));
        $allowedHeaders = ['CF_CONNECTING_IP', 'X_REAL_IP'];
        if (!in_array($header, $allowedHeaders, true)) $header = 'CF_CONNECTING_IP';
        if ($isCloudflareProxy) $header = 'CF_CONNECTING_IP';
        $forwardedAddress = trim((string) ($_SERVER['HTTP_' . $header] ?? ''));
        if (filter_var($forwardedAddress, FILTER_VALIDATE_IP) !== false) $clientAddress = $forwardedAddress;
    }

    $address = $clientAddress;
    return hash('sha256', $address);
}

function mutateLoginState(string $clientKey, callable $mutator): array
{
    $path = loginStatePath();
    $directory = dirname($path);
    if (!is_dir($directory) && !mkdir($directory, 0755, true)) {
        respond(503, ['ok' => false, 'message' => 'Защита входа временно недоступна.']);
    }

    $handle = fopen($path, 'c+');
    if ($handle === false || !flock($handle, LOCK_EX)) {
        if (is_resource($handle)) fclose($handle);
        respond(503, ['ok' => false, 'message' => 'Защита входа временно недоступна.']);
    }

    rewind($handle);
    $raw = stream_get_contents($handle);
    $decoded = is_string($raw) && $raw !== '' ? json_decode($raw, true) : null;
    $now = time();
    $clients = is_array($decoded) && isset($decoded['clients']) && is_array($decoded['clients'])
        ? $decoded['clients']
        : [];
    foreach ($clients as $key => $entry) {
        $updatedAt = is_array($entry) ? (int) ($entry['updatedAt'] ?? 0) : 0;
        $lockedUntil = is_array($entry) ? (int) ($entry['lockedUntil'] ?? 0) : 0;
        if ($updatedAt < $now - 86400 && $lockedUntil <= $now) unset($clients[$key]);
    }

    $entry = is_array($clients[$clientKey] ?? null) ? $clients[$clientKey] : [];
    $clientState = [
        'failures' => max(0, (int) ($entry['failures'] ?? 0)),
        'lockedUntil' => max(0, (int) ($entry['lockedUntil'] ?? 0)),
        'updatedAt' => max(0, (int) ($entry['updatedAt'] ?? 0)),
    ];
    if ($clientState['lockedUntil'] > 0 && $clientState['lockedUntil'] <= $now) {
        $clientState = ['failures' => 0, 'lockedUntil' => 0, 'updatedAt' => $now];
    }

    $updated = $mutator($clientState);
    if (!is_array($updated)) $updated = $clientState;
    $updated['failures'] = max(0, (int) ($updated['failures'] ?? 0));
    $updated['lockedUntil'] = max(0, (int) ($updated['lockedUntil'] ?? 0));
    $updated['updatedAt'] = $now;
    $clients[$clientKey] = $updated;

    if (count($clients) > 500) {
        uasort($clients, static function (array $left, array $right): int {
            return (int) ($left['updatedAt'] ?? 0) <=> (int) ($right['updatedAt'] ?? 0);
        });
        $clients = array_slice($clients, -500, null, true);
    }

    $json = json_encode(['clients' => $clients], JSON_UNESCAPED_SLASHES);
    rewind($handle);
    $saved = ftruncate($handle, 0)
        && is_string($json)
        && fwrite($handle, $json . "\n") !== false
        && fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);
    if (!$saved) respond(503, ['ok' => false, 'message' => 'Защита входа временно недоступна.']);
    return $updated;
}

function loginLockStatus(string $clientKey): array
{
    return mutateLoginState($clientKey, static function (array $state): array {
        return $state;
    });
}

function registerFailedLogin(string $clientKey): array
{
    return mutateLoginState($clientKey, static function (array $state): array {
        if ($state['lockedUntil'] > time()) return $state;
        $state['failures']++;
        if ($state['failures'] >= MAX_LOGIN_FAILURES) {
            $state['failures'] = MAX_LOGIN_FAILURES;
            $state['lockedUntil'] = time() + LOGIN_LOCK_SECONDS;
        }
        return $state;
    });
}

function resetLoginFailuresIfAllowed(string $clientKey): array
{
    $allowed = false;
    $state = mutateLoginState($clientKey, static function (array $state) use (&$allowed): array {
        if ($state['lockedUntil'] > time()) return $state;
        $allowed = true;
        return ['failures' => 0, 'lockedUntil' => 0, 'updatedAt' => time()];
    });
    return [$allowed, $state];
}

function respondLoginBlocked(array $state): void
{
    $retryAfter = max(1, (int) $state['lockedUntil'] - time());
    header('Retry-After: ' . $retryAfter);
    respond(429, [
        'ok' => false,
        'message' => 'Слишком много неверных попыток. Вход заблокирован на 1 час.',
        'retryAfter' => $retryAfter,
    ]);
}

function contentPath(): string
{
    return dirname(__DIR__) . '/data/site-content.local.json';
}

function seedContentPath(): string
{
    return dirname(__DIR__) . '/data/site-content.json';
}

function readContent(): array
{
    $path = contentPath();
    if (!is_readable($path)) $path = seedContentPath();
    if (!is_readable($path)) {
        respond(500, ['ok' => false, 'message' => 'Файл данных сайта не найден.']);
    }

    $raw = file_get_contents($path);
    $content = is_string($raw) ? json_decode($raw, true) : null;
    if (!is_array($content) || !isset($content['properties']) || !is_array($content['properties'])) {
        respond(500, ['ok' => false, 'message' => 'Файл данных сайта повреждён.']);
    }
    return $content;
}

function cleanText($value, int $maxBytes, string $fieldName): string
{
    if (!is_string($value)) respond(422, ['ok' => false, 'message' => "Поле «{$fieldName}» заполнено некорректно."]);
    $value = trim((string) preg_replace('/\r\n?/', "\n", $value));
    $validUtf8 = preg_match('//u', $value) === 1;
    $containsMarkup = strpos($value, '<') !== false || strpos($value, '>') !== false;
    if ($value === '' || strlen($value) > $maxBytes || !$validUtf8 || $containsMarkup || preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', $value)) {
        respond(422, ['ok' => false, 'message' => "Проверьте поле «{$fieldName}»."]);
    }
    return $value;
}

function cleanPrice($value, bool $required, string $fieldName): string
{
    if (is_int($value) || is_float($value)) $value = (string) $value;
    if (!is_string($value)) respond(422, ['ok' => false, 'message' => "Проверьте цену «{$fieldName}»."]);
    $value = trim($value);
    if (!$required && $value === '') return '';
    if (!preg_match('/^\d{1,6}$/', $value) || (int) $value > 100000) {
        respond(422, ['ok' => false, 'message' => "Проверьте цену «{$fieldName}»."]);
    }
    return (string) ((int) $value);
}

function validateContent($input, array $current): array
{
    if (!is_array($input) || !isset($input['properties']) || !is_array($input['properties'])) {
        respond(422, ['ok' => false, 'message' => 'Данные для сохранения заполнены некорректно.']);
    }

    $properties = [];
    foreach (PROPERTY_KEYS as $key) {
        $property = $input['properties'][$key] ?? null;
        if (!is_array($property) || !isset($property['prices']) || !is_array($property['prices'])) {
            respond(422, ['ok' => false, 'message' => 'Заполните данные всех вариантов отдыха.']);
        }
        $name = (string) ($current['properties'][$key]['name'] ?? $key);
        $properties[$key] = [
            'name' => $name,
            'prices' => [
                'weekday' => cleanPrice($property['prices']['weekday'] ?? '', true, $name),
                'weekend' => cleanPrice($property['prices']['weekend'] ?? '', $key !== 'bath', $name),
            ],
            'cardDescription' => cleanText($property['cardDescription'] ?? '', 1600, "Описание карточки: {$name}"),
            'pageDescription' => cleanText($property['pageDescription'] ?? '', 8000, "Полное описание: {$name}"),
        ];
    }

    return [
        'version' => 1,
        'updatedAt' => (new DateTimeImmutable('now', new DateTimeZone('Europe/Minsk')))->format(DATE_ATOM),
        'properties' => $properties,
    ];
}

function writeContent(array $content): void
{
    $path = contentPath();
    $directory = dirname($path);
    if (!is_dir($directory) && !mkdir($directory, 0755, true)) {
        respond(500, ['ok' => false, 'message' => 'Не удалось создать папку для данных.']);
    }

    $lock = fopen($path . '.lock', 'c');
    if ($lock === false || !flock($lock, LOCK_EX)) {
        if (is_resource($lock)) fclose($lock);
        respond(500, ['ok' => false, 'message' => 'Не удалось заблокировать файл данных.']);
    }

    $temporary = tempnam($directory, 'site-content-');
    $json = json_encode($content, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    $written = $temporary !== false && is_string($json) && file_put_contents($temporary, $json . "\n", LOCK_EX) !== false;
    if ($written) {
        @chmod($temporary, 0644);
        $written = rename($temporary, $path);
    }
    if (!$written && is_string($temporary) && file_exists($temporary)) @unlink($temporary);

    flock($lock, LOCK_UN);
    fclose($lock);
    if (!$written) respond(500, ['ok' => false, 'message' => 'Не удалось сохранить данные. Проверьте права на папку data.']);
}

function verifySameOrigin(): void
{
    $requestHost = strtolower(preg_replace('/:\d+$/', '', (string) ($_SERVER['HTTP_HOST'] ?? '')));
    $origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
    if ($origin === '' || $requestHost === '') return;
    $originHost = strtolower((string) parse_url($origin, PHP_URL_HOST));
    if ($originHost === '' || $originHost !== $requestHost) {
        respond(403, ['ok' => false, 'message' => 'Запрос отклонён.']);
    }
}

$fileEnv = loadDotEnv([
    dirname(__DIR__, 2) . '/.env',
    dirname(__DIR__) . '/.env',
]);
$passwordHash = envValue('ADMIN_PASSWORD_HASH', $fileEnv);
$plainPassword = envRawValue('ADMIN_PASSWORD', $fileEnv);
$isConfigured = $passwordHash !== '' || $plainPassword !== '';
$loginClientKey = loginClientKey($fileEnv);

$method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
if ($method === 'GET') {
    if (isset($_COOKIE[SESSION_NAME])) startAdminSession();
    $authenticated = isAuthenticated();
    $response = [
        'ok' => true,
        'configured' => $isConfigured,
        'authenticated' => $authenticated,
        'content' => readContent(),
    ];
    if ($authenticated) $response['csrfToken'] = csrfToken();
    if (!$authenticated && isset($_GET['admin'])) {
        $state = loginLockStatus($loginClientKey);
        if ($state['lockedUntil'] > time()) $response['retryAfter'] = $state['lockedUntil'] - time();
    }
    respond(200, $response);
}

if ($method !== 'POST') {
    header('Allow: GET, POST');
    respond(405, ['ok' => false, 'message' => 'Метод не поддерживается.']);
}

verifySameOrigin();
if (stripos((string) ($_SERVER['CONTENT_TYPE'] ?? ''), 'application/json') !== 0) {
    respond(415, ['ok' => false, 'message' => 'Ожидается JSON-запрос.']);
}
if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 65536) {
    respond(413, ['ok' => false, 'message' => 'Слишком большой запрос.']);
}

$rawBody = file_get_contents('php://input');
$request = is_string($rawBody) ? json_decode($rawBody, true) : null;
if (!is_array($request)) respond(400, ['ok' => false, 'message' => 'Некорректный запрос.']);
$action = (string) ($request['action'] ?? '');
startAdminSession();

if ($action === 'login') {
    if (!$isConfigured) {
        respond(503, ['ok' => false, 'message' => 'Сначала задайте ADMIN_PASSWORD в файле .env.']);
    }
    $state = loginLockStatus($loginClientKey);
    if ($state['lockedUntil'] > time()) respondLoginBlocked($state);

    $password = is_string($request['password'] ?? null) ? (string) $request['password'] : '';
    if ($password === '' || strlen($password) > 1024 || preg_match('/[\x00-\x1F\x7F]/', $password)) {
        $state = registerFailedLogin($loginClientKey);
        if ($state['lockedUntil'] > time()) respondLoginBlocked($state);
        usleep(350000);
        respond(401, ['ok' => false, 'message' => 'Неверный пароль. Осталось попыток: ' . (MAX_LOGIN_FAILURES - $state['failures']) . '.']);
    }
    $valid = $passwordHash !== '' ? password_verify($password, $passwordHash) : hash_equals($plainPassword, $password);
    if (!$valid) {
        $state = registerFailedLogin($loginClientKey);
        if ($state['lockedUntil'] > time()) respondLoginBlocked($state);
        usleep(350000);
        respond(401, ['ok' => false, 'message' => 'Неверный пароль. Осталось попыток: ' . (MAX_LOGIN_FAILURES - $state['failures']) . '.']);
    }

    [$loginAllowed, $state] = resetLoginFailuresIfAllowed($loginClientKey);
    if (!$loginAllowed) respondLoginBlocked($state);
    session_regenerate_id(true);
    $_SESSION['admin_authenticated'] = true;
    $_SESSION['csrf_token'] = bin2hex(random_bytes(24));
    respond(200, [
        'ok' => true,
        'authenticated' => true,
        'csrfToken' => csrfToken(),
        'content' => readContent(),
    ]);
}

if (!isAuthenticated()) respond(401, ['ok' => false, 'message' => 'Сессия завершена. Войдите снова.']);
$requestToken = is_string($request['csrfToken'] ?? null) ? (string) $request['csrfToken'] : '';
if ($requestToken === '' || !hash_equals(csrfToken(), $requestToken)) {
    respond(403, ['ok' => false, 'message' => 'Защитный токен устарел. Обновите страницу.']);
}

if ($action === 'logout') {
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $params = session_get_cookie_params();
        setcookie(SESSION_NAME, '', time() - 42000, $params['path'], $params['domain'] ?? '', (bool) $params['secure'], (bool) $params['httponly']);
    }
    session_destroy();
    respond(200, ['ok' => true, 'authenticated' => false]);
}

if ($action === 'save') {
    $current = readContent();
    $content = validateContent($request['content'] ?? null, $current);
    writeContent($content);
    respond(200, [
        'ok' => true,
        'authenticated' => true,
        'csrfToken' => csrfToken(),
        'content' => $content,
    ]);
}

respond(400, ['ok' => false, 'message' => 'Неизвестное действие.']);
