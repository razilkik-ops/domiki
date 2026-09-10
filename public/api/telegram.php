<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

function respond(int $status, bool $ok, string $message): void
{
    http_response_code($status);
    echo json_encode(
        ['ok' => $ok, 'message' => $message],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
    );
    exit;
}

function loadDotEnv(array $paths): array
{
    $values = [];

    foreach ($paths as $path) {
        if (!is_readable($path)) {
            continue;
        }

        $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if ($lines === false) {
            continue;
        }

        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#') {
                continue;
            }

            if (strpos($line, 'export ') === 0) {
                $line = trim(substr($line, 7));
            }

            $separator = strpos($line, '=');
            if ($separator === false) {
                continue;
            }

            $key = trim(substr($line, 0, $separator));
            $value = trim(substr($line, $separator + 1));
            if (!preg_match('/^[A-Z][A-Z0-9_]*$/', $key)) {
                continue;
            }

            $length = strlen($value);
            if ($length >= 2) {
                $first = $value[0];
                $last = $value[$length - 1];
                if (($first === '"' && $last === '"') || ($first === "'" && $last === "'")) {
                    $value = substr($value, 1, -1);
                }
            }

            if (!array_key_exists($key, $values)) {
                $values[$key] = $value;
            }
        }
    }

    return $values;
}

function envValue(string $key, array $fileEnv): string
{
    $serverValue = getenv($key);
    if ($serverValue !== false && trim($serverValue) !== '') {
        return trim($serverValue);
    }

    if (isset($_ENV[$key]) && trim((string) $_ENV[$key]) !== '') {
        return trim((string) $_ENV[$key]);
    }

    return isset($fileEnv[$key]) ? trim((string) $fileEnv[$key]) : '';
}

function field(string $name, int $maxLength = 500): string
{
    $value = $_POST[$name] ?? '';
    if (is_array($value)) {
        return '';
    }

    $value = trim((string) $value);
    if (strlen($value) > $maxLength) {
        respond(422, false, 'Одно из полей заполнено некорректно.');
    }

    return $value;
}

function escapeTelegram(string $value): string
{
    return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function telegramRequest(string $url, array $payload): array
{
    if (function_exists('curl_init')) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => http_build_query($payload),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => 15,
            CURLOPT_HTTPHEADER => ['Content-Type: application/x-www-form-urlencoded'],
        ]);
        $body = curl_exec($curl);
        $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
        $error = curl_error($curl);
        curl_close($curl);

        return [$status, is_string($body) ? $body : '', $error];
    }

    $context = stream_context_create([
        'http' => [
            'method' => 'POST',
            'header' => "Content-Type: application/x-www-form-urlencoded\r\n",
            'content' => http_build_query($payload),
            'timeout' => 15,
            'ignore_errors' => true,
        ],
    ]);
    $body = @file_get_contents($url, false, $context);
    $status = 0;
    if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $matches)) {
        $status = (int) $matches[1];
    }

    return [$status, is_string($body) ? $body : '', $body === false ? 'HTTP request failed' : ''];
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Allow: POST');
    respond(405, false, 'Разрешена только отправка формы.');
}

if ((int) ($_SERVER['CONTENT_LENGTH'] ?? 0) > 32768) {
    respond(413, false, 'Слишком большой запрос.');
}

$requestHost = strtolower(preg_replace('/:\d+$/', '', (string) ($_SERVER['HTTP_HOST'] ?? '')));
$origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
if ($origin !== '' && $requestHost !== '') {
    $originHost = strtolower((string) parse_url($origin, PHP_URL_HOST));
    if ($originHost === '' || $originHost !== $requestHost) {
        respond(403, false, 'Запрос отклонён.');
    }
}

if (field('website', 200) !== '') {
    respond(200, true, 'Заявка отправлена.');
}

$fileEnv = loadDotEnv([
    dirname(__DIR__, 2) . '/.env',
    dirname(__DIR__) . '/.env',
]);
$botToken = envValue('TELEGRAM_BOT_TOKEN', $fileEnv);
$chatId = envValue('TELEGRAM_CHAT_ID', $fileEnv);

if (!preg_match('/^\d+:[A-Za-z0-9_-]{20,}$/', $botToken) || !preg_match('/^-?\d+$/', $chatId)) {
    error_log('Telegram booking form: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not configured.');
    respond(500, false, 'Приём заявок ещё не настроен. Позвоните нам или попробуйте позже.');
}

$name = field('name', 120);
$phone = field('phone', 50);
$email = field('email', 180);
$social = field('social', 50);
$property = field('house', 160);
if ($property === '') {
    $property = field('property', 160);
}
$arrival = field('arrival', 20);
$departure = field('departure', 20);
$visitTime = field('visit_time', 20);
$guests = field('guests', 10);
$page = field('page', 500);
$privacyConsent = field('privacy_consent', 10);

if ($name === '' || $phone === '' || $property === '') {
    respond(422, false, 'Заполните имя, телефон и вариант бронирования.');
}
if (!preg_match('/^[0-9+()\-\s]{7,50}$/', $phone)) {
    respond(422, false, 'Проверьте номер телефона.');
}
if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
    respond(422, false, 'Проверьте адрес электронной почты.');
}
if ($privacyConsent !== '1') {
    respond(422, false, 'Необходимо согласие на обработку данных.');
}

$extras = $_POST['extras'] ?? [];
if (!is_array($extras)) {
    $extras = [$extras];
}
$extras = array_slice(array_values(array_filter(array_map(static function ($value): string {
    return is_scalar($value) ? trim((string) $value) : '';
}, $extras))), 0, 10);
foreach ($extras as $extra) {
    if (strlen($extra) > 300) {
        respond(422, false, 'Одна из дополнительных услуг заполнена некорректно.');
    }
}

$lines = [
    '<b>Новая заявка с сайта</b>',
    '',
    '<b>Вариант:</b> ' . escapeTelegram($property),
    '<b>Имя:</b> ' . escapeTelegram($name),
    '<b>Телефон:</b> ' . escapeTelegram($phone),
];

if ($email !== '') $lines[] = '<b>Email:</b> ' . escapeTelegram($email);
if ($social !== '') $lines[] = '<b>Связаться через:</b> ' . escapeTelegram($social);
if ($arrival !== '') $lines[] = '<b>Дата заезда/посещения:</b> ' . escapeTelegram($arrival);
if ($departure !== '') $lines[] = '<b>Дата отъезда:</b> ' . escapeTelegram($departure);
if ($visitTime !== '') $lines[] = '<b>Желаемое время:</b> ' . escapeTelegram($visitTime);
if ($guests !== '') $lines[] = '<b>Гостей:</b> ' . escapeTelegram($guests);
if ($extras !== []) {
    $lines[] = '<b>Дополнительно:</b>';
    foreach ($extras as $extra) {
        $lines[] = '• ' . escapeTelegram($extra);
    }
}
if ($page !== '' && filter_var($page, FILTER_VALIDATE_URL) !== false) {
    $lines[] = '';
    $lines[] = '<b>Страница:</b> ' . escapeTelegram($page);
}

$timezone = new DateTimeZone('Europe/Minsk');
$lines[] = '<b>Получено:</b> ' . (new DateTimeImmutable('now', $timezone))->format('d.m.Y H:i');

$telegramUrl = 'https://api.telegram.org/bot' . $botToken . '/sendMessage';
[$telegramStatus, $telegramBody, $telegramError] = telegramRequest($telegramUrl, [
    'chat_id' => $chatId,
    'text' => implode("\n", $lines),
    'parse_mode' => 'HTML',
    'disable_web_page_preview' => 'true',
]);
$telegramResponse = json_decode($telegramBody, true);

if ($telegramStatus < 200 || $telegramStatus >= 300 || !is_array($telegramResponse) || empty($telegramResponse['ok'])) {
    error_log('Telegram booking form error: HTTP ' . $telegramStatus . '; ' . $telegramError);
    respond(502, false, 'Telegram не принял заявку. Попробуйте ещё раз или свяжитесь с нами по телефону.');
}

respond(200, true, 'Заявка отправлена. Скоро мы с вами свяжемся.');
