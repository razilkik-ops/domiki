import seedContent from '../public/data/site-content.json';

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

interface SessionPayload {
  exp: number;
  csrf: string;
}

interface LoginState {
  failures: number;
  locked_until: number;
}

interface PropertyContent {
  name: string;
  prices: { weekday: string; weekend: string };
  cardDescription: string;
  pageDescription: string;
}

interface SiteContent {
  version: number;
  updatedAt: string | null;
  properties: Record<string, PropertyContent>;
}

const PROPERTY_KEYS = ['malta', 'valencia', 'apartments', 'bath'] as const;
const SESSION_COOKIE = 'malta_retreat_admin';
const SESSION_SECONDS = 8 * 60 * 60;
const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCK_SECONDS = 60 * 60;
const MAX_ADMIN_BODY = 64 * 1024;
const MAX_BOOKING_BODY = 32 * 1024;
const encoder = new TextEncoder();

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

function json(payload: Record<string, unknown>, status = 200, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8');
  responseHeaders.set('Cache-Control', 'no-store');
  responseHeaders.set('X-Content-Type-Options', 'nosniff');
  responseHeaders.set('Referrer-Policy', 'same-origin');
  return new Response(JSON.stringify(payload), { status, headers: responseHeaders });
}

function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    const headers = new Headers();
    if (error.status === 429 && typeof error.extra.retryAfter === 'number') {
      headers.set('Retry-After', String(error.extra.retryAfter));
    }
    return json({ ok: false, message: error.message, ...error.extra }, error.status, headers);
  }
  console.error('Unhandled API error', error);
  return json({ ok: false, message: 'Внутренняя ошибка сервера. Попробуйте позже.' }, 500);
}

function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) {
    throw new HttpError(403, 'Запрос отклонён.');
  }
}

async function readLimitedBody(request: Request, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = Number(request.headers.get('Content-Length') || 0);
  if (declaredLength > maximumBytes) throw new HttpError(413, 'Слишком большой запрос.');
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maximumBytes) {
        await reader.cancel('request body too large');
        throw new HttpError(413, 'Слишком большой запрос.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Ожидается JSON-запрос.');
  }
  const bytes = await readLimitedBody(request, MAX_ADMIN_BODY);
  try {
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Некорректный запрос.');
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmacKey(secret: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usages);
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await hmacKey(secret, ['sign']);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

async function verifySignature(value: string, signature: string, secret: string): Promise<boolean> {
  try {
    const key = await hmacKey(secret, ['verify']);
    return await crypto.subtle.verify('HMAC', key, fromBase64Url(signature), encoder.encode(value));
  } catch {
    return false;
  }
}

async function passwordEquals(candidate: string, expected: string): Promise<boolean> {
  const message = encoder.encode('malta-retreat-admin-password-check-v1');
  const expectedKey = await hmacKey(expected, ['sign']);
  const expectedMac = await crypto.subtle.sign('HMAC', expectedKey, message);
  try {
    const candidateKey = await hmacKey(candidate, ['verify']);
    return await crypto.subtle.verify('HMAC', candidateKey, expectedMac, message);
  } catch {
    return false;
  }
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get('Cookie') || '';
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

async function createSession(secret: string): Promise<{ token: string; payload: SessionPayload }> {
  const payload: SessionPayload = {
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
    csrf: toBase64Url(crypto.getRandomValues(new Uint8Array(24))),
  };
  const encoded = toBase64Url(encoder.encode(JSON.stringify(payload)));
  return { token: `${encoded}.${await sign(encoded, secret)}`, payload };
}

async function readSession(request: Request, secret: string | undefined): Promise<SessionPayload | null> {
  if (!secret) return null;
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;
  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!(await verifySignature(encoded, signature, secret))) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded))) as Partial<SessionPayload>;
    if (!Number.isInteger(parsed.exp) || (parsed.exp as number) <= Date.now() / 1000) return null;
    if (typeof parsed.csrf !== 'string' || parsed.csrf.length < 20) return null;
    return parsed as SessionPayload;
  } catch {
    return null;
  }
}

function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${SESSION_SECONDS}; Secure; HttpOnly; SameSite=Strict`;
}

function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`;
}

async function clientKey(request: Request): Promise<string> {
  const address = request.headers.get('CF-Connecting-IP') || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(address));
  return toBase64Url(new Uint8Array(digest));
}

function lockoutError(lockedUntil: number): HttpError {
  const retryAfter = Math.max(1, lockedUntil - Math.floor(Date.now() / 1000));
  return new HttpError(429, 'Слишком много неверных попыток. Вход заблокирован на 1 час.', { retryAfter });
}

async function getLoginState(env: Env, key: string): Promise<LoginState> {
  const row = await env.DB.prepare(
    'SELECT failures, locked_until FROM admin_login_attempts WHERE client_key = ?',
  ).bind(key).first<LoginState>();
  return row || { failures: 0, locked_until: 0 };
}

async function registerFailedLogin(env: Env, key: string): Promise<LoginState> {
  const now = Math.floor(Date.now() / 1000);
  const lockedUntil = now + LOGIN_LOCK_SECONDS;
  const row = await env.DB.prepare(`
    INSERT INTO admin_login_attempts (client_key, failures, locked_until, updated_at)
    VALUES (?, 1, 0, ?)
    ON CONFLICT(client_key) DO UPDATE SET
      failures = CASE
        WHEN admin_login_attempts.locked_until > ? THEN admin_login_attempts.failures
        WHEN admin_login_attempts.locked_until > 0 THEN 1
        ELSE MIN(admin_login_attempts.failures + 1, ?)
      END,
      locked_until = CASE
        WHEN admin_login_attempts.locked_until > ? THEN admin_login_attempts.locked_until
        WHEN admin_login_attempts.locked_until > 0 THEN 0
        WHEN admin_login_attempts.failures + 1 >= ? THEN ?
        ELSE 0
      END,
      updated_at = ?
    RETURNING failures, locked_until
  `).bind(key, now, now, MAX_LOGIN_FAILURES, now, MAX_LOGIN_FAILURES, lockedUntil, now).first<LoginState>();
  if (!row) throw new HttpError(503, 'Защита входа временно недоступна.');
  return row;
}

async function resetLoginIfAllowed(env: Env, key: string): Promise<LoginState> {
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(`
    INSERT INTO admin_login_attempts (client_key, failures, locked_until, updated_at)
    VALUES (?, 0, 0, ?)
    ON CONFLICT(client_key) DO UPDATE SET
      failures = CASE WHEN admin_login_attempts.locked_until > ? THEN admin_login_attempts.failures ELSE 0 END,
      locked_until = CASE WHEN admin_login_attempts.locked_until > ? THEN admin_login_attempts.locked_until ELSE 0 END,
      updated_at = ?
    RETURNING failures, locked_until
  `).bind(key, now, now, now, now).first<LoginState>();
  if (!row) throw new HttpError(503, 'Защита входа временно недоступна.');
  return row;
}

async function readContent(env: Env): Promise<SiteContent> {
  const row = await env.DB.prepare('SELECT content_json FROM site_content WHERE id = ?')
    .bind('site').first<{ content_json: string }>();
  if (!row) return seedContent as SiteContent;
  try {
    return JSON.parse(row.content_json) as SiteContent;
  } catch {
    throw new HttpError(500, 'Сохранённые данные сайта повреждены.');
  }
}

function cleanText(value: unknown, maximumBytes: number, fieldName: string): string {
  if (typeof value !== 'string') throw new HttpError(422, `Поле «${fieldName}» заполнено некорректно.`);
  const cleaned = value.replace(/\r\n?/g, '\n').trim();
  const hasControl = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(cleaned);
  if (!cleaned || encoder.encode(cleaned).byteLength > maximumBytes || /[<>]/u.test(cleaned) || hasControl) {
    throw new HttpError(422, `Проверьте поле «${fieldName}».`);
  }
  return cleaned;
}

function cleanPrice(value: unknown, required: boolean, fieldName: string): string {
  const normalized = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  if (!required && normalized === '') return '';
  if (!/^\d{1,6}$/u.test(normalized) || Number(normalized) > 100000) {
    throw new HttpError(422, `Проверьте цену «${fieldName}».`);
  }
  return String(Number(normalized));
}

function validateContent(input: unknown, current: SiteContent): SiteContent {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(422, 'Данные для сохранения заполнены некорректно.');
  }
  const propertiesInput = (input as { properties?: unknown }).properties;
  if (!propertiesInput || typeof propertiesInput !== 'object' || Array.isArray(propertiesInput)) {
    throw new HttpError(422, 'Заполните данные всех вариантов отдыха.');
  }

  const properties: Record<string, PropertyContent> = {};
  for (const key of PROPERTY_KEYS) {
    const property = (propertiesInput as Record<string, unknown>)[key];
    if (!property || typeof property !== 'object' || Array.isArray(property)) {
      throw new HttpError(422, 'Заполните данные всех вариантов отдыха.');
    }
    const typed = property as Record<string, unknown>;
    const prices = typed.prices;
    if (!prices || typeof prices !== 'object' || Array.isArray(prices)) {
      throw new HttpError(422, 'Заполните цены всех вариантов отдыха.');
    }
    const name = current.properties[key]?.name || key;
    properties[key] = {
      name,
      prices: {
        weekday: cleanPrice((prices as Record<string, unknown>).weekday, true, name),
        weekend: cleanPrice((prices as Record<string, unknown>).weekend, key !== 'bath', name),
      },
      cardDescription: cleanText(typed.cardDescription, 1600, `Описание карточки: ${name}`),
      pageDescription: cleanText(typed.pageDescription, 8000, `Полное описание: ${name}`),
    };
  }
  return { version: 1, updatedAt: new Date().toISOString(), properties };
}

async function adminApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const configured = Boolean(env.ADMIN_PASSWORD && env.ADMIN_SESSION_SECRET);
  const session = await readSession(request, env.ADMIN_SESSION_SECRET);

  if (request.method === 'GET') {
    const response: Record<string, unknown> = {
      ok: true,
      configured,
      authenticated: Boolean(session),
      content: await readContent(env),
    };
    if (session) response.csrfToken = session.csrf;
    if (!session && new URL(request.url).searchParams.has('admin')) {
      const state = await getLoginState(env, await clientKey(request));
      if (state.locked_until > Date.now() / 1000) {
        response.retryAfter = Math.ceil(state.locked_until - Date.now() / 1000);
      }
    }
    return json(response);
  }

  if (request.method !== 'POST') {
    return json({ ok: false, message: 'Метод не поддерживается.' }, 405, { Allow: 'GET, POST' });
  }
  assertSameOrigin(request);
  const body = await readJson(request);
  const action = typeof body.action === 'string' ? body.action : '';

  if (action === 'login') {
    if (!configured) throw new HttpError(503, 'Пароль администратора ещё не настроен.');
    const key = await clientKey(request);
    const state = await getLoginState(env, key);
    if (state.locked_until > Date.now() / 1000) throw lockoutError(state.locked_until);

    const password = typeof body.password === 'string' ? body.password : '';
    const malformed = !password || encoder.encode(password).byteLength > 1024 || /[\u0000-\u001f\u007f]/u.test(password);
    const valid = !malformed && await passwordEquals(password, env.ADMIN_PASSWORD!);
    if (!valid) {
      const failed = await registerFailedLogin(env, key);
      if (failed.locked_until > Date.now() / 1000) throw lockoutError(failed.locked_until);
      throw new HttpError(401, `Неверный пароль. Осталось попыток: ${MAX_LOGIN_FAILURES - failed.failures}.`);
    }

    const reset = await resetLoginIfAllowed(env, key);
    if (reset.locked_until > Date.now() / 1000) throw lockoutError(reset.locked_until);
    const created = await createSession(env.ADMIN_SESSION_SECRET!);
    ctx.waitUntil(env.DB.prepare(
      'DELETE FROM admin_login_attempts WHERE updated_at < ? AND locked_until <= ?',
    ).bind(Math.floor(Date.now() / 1000) - 86400, Math.floor(Date.now() / 1000)).run());
    return json({
      ok: true,
      authenticated: true,
      csrfToken: created.payload.csrf,
      content: await readContent(env),
    }, 200, { 'Set-Cookie': sessionCookie(created.token) });
  }

  if (!session) throw new HttpError(401, 'Сессия завершена. Войдите снова.');
  if (typeof body.csrfToken !== 'string' || body.csrfToken !== session.csrf) {
    throw new HttpError(403, 'Защитный токен устарел. Обновите страницу.');
  }
  if (action === 'logout') {
    return json({ ok: true, authenticated: false }, 200, { 'Set-Cookie': clearSessionCookie() });
  }
  if (action === 'save') {
    const current = await readContent(env);
    const content = validateContent(body.content, current);
    await env.DB.prepare(`
      INSERT INTO site_content (id, content_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET content_json = excluded.content_json, updated_at = excluded.updated_at
    `).bind('site', JSON.stringify(content), Math.floor(Date.now() / 1000)).run();
    return json({ ok: true, authenticated: true, csrfToken: session.csrf, content });
  }
  throw new HttpError(400, 'Неизвестное действие.');
}

function formField(form: FormData, name: string, maximumBytes: number): string {
  const raw = form.get(name);
  if (raw === null) return '';
  if (typeof raw !== 'string') throw new HttpError(422, 'Одно из полей заполнено некорректно.');
  const value = raw.trim();
  if (encoder.encode(value).byteLength > maximumBytes) {
    throw new HttpError(422, 'Одно из полей заполнено некорректно.');
  }
  return value;
}

function escapeTelegram(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function minskTimestamp(): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Minsk', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date()).replace(',', '');
}

async function bookingApi(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ ok: false, message: 'Разрешена только отправка формы.' }, 405, { Allow: 'POST' });
  }
  assertSameOrigin(request);
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data') &&
      !contentType.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    throw new HttpError(415, 'Некорректный формат формы.');
  }
  const bytes = await readLimitedBody(request, MAX_BOOKING_BODY);
  let form: FormData;
  try {
    form = await new Request('https://local.invalid/', {
      method: 'POST', headers: { 'Content-Type': contentType }, body: bytes,
    }).formData();
  } catch {
    throw new HttpError(400, 'Некорректная форма.');
  }

  if (formField(form, 'website', 200)) return json({ ok: true, message: 'Заявка отправлена.' });
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    throw new HttpError(503, 'Приём заявок ещё не настроен. Позвоните нам или попробуйте позже.');
  }

  const name = formField(form, 'name', 120);
  const phone = formField(form, 'phone', 50);
  const email = formField(form, 'email', 180);
  const social = formField(form, 'social', 50);
  const property = formField(form, 'house', 160) || formField(form, 'property', 160);
  const arrival = formField(form, 'arrival', 20);
  const departure = formField(form, 'departure', 20);
  const visitTime = formField(form, 'visit_time', 20);
  const guests = formField(form, 'guests', 10);
  const page = formField(form, 'page', 500);
  const consent = formField(form, 'privacy_consent', 10);

  if (!name || !phone || !property) throw new HttpError(422, 'Заполните имя, телефон и вариант бронирования.');
  if (!/^[0-9+()\-\s]{7,50}$/u.test(phone)) throw new HttpError(422, 'Проверьте номер телефона.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new HttpError(422, 'Проверьте адрес электронной почты.');
  if (consent !== '1') throw new HttpError(422, 'Необходимо согласие на обработку данных.');

  const extras = form.getAll('extras').slice(0, 10).map((value) => {
    if (typeof value !== 'string' || encoder.encode(value.trim()).byteLength > 300) {
      throw new HttpError(422, 'Одна из дополнительных услуг заполнена некорректно.');
    }
    return value.trim();
  }).filter(Boolean);

  const lines = [
    '<b>Новая заявка с сайта</b>', '',
    `<b>Вариант:</b> ${escapeTelegram(property)}`,
    `<b>Имя:</b> ${escapeTelegram(name)}`,
    `<b>Телефон:</b> ${escapeTelegram(phone)}`,
  ];
  if (email) lines.push(`<b>Email:</b> ${escapeTelegram(email)}`);
  if (social) lines.push(`<b>Связаться через:</b> ${escapeTelegram(social)}`);
  if (arrival) lines.push(`<b>Дата заезда/посещения:</b> ${escapeTelegram(arrival)}`);
  if (departure) lines.push(`<b>Дата отъезда:</b> ${escapeTelegram(departure)}`);
  if (visitTime) lines.push(`<b>Желаемое время:</b> ${escapeTelegram(visitTime)}`);
  if (guests) lines.push(`<b>Гостей:</b> ${escapeTelegram(guests)}`);
  if (extras.length) {
    lines.push('<b>Дополнительно:</b>');
    for (const extra of extras) lines.push(`• ${escapeTelegram(extra)}`);
  }
  if (page) {
    try {
      const pageUrl = new URL(page);
      if (pageUrl.protocol === 'https:' || pageUrl.protocol === 'http:') {
        lines.push('', `<b>Страница:</b> ${escapeTelegram(pageUrl.href)}`);
      }
    } catch {
      // Некорректный необязательный URL не добавляем в сообщение.
    }
  }
  lines.push(`<b>Получено:</b> ${minskTimestamp()}`);

  const telegramBody = new URLSearchParams({
    chat_id: env.TELEGRAM_CHAT_ID,
    text: lines.join('\n'),
    parse_mode: 'HTML',
    link_preview_options: JSON.stringify({ is_disabled: true }),
  });
  const telegram = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: telegramBody,
  });
  const result = await telegram.json().catch(() => null) as { ok?: boolean } | null;
  if (!telegram.ok || !result?.ok) {
    console.error('Telegram booking error', { status: telegram.status });
    throw new HttpError(502, 'Telegram не принял заявку. Попробуйте ещё раз или свяжитесь с нами по телефону.');
  }
  return json({ ok: true, message: 'Заявка отправлена. Скоро мы с вами свяжемся.' });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    try {
      if (path === '/api/content.php') return await adminApi(request, env, ctx);
      if (path === '/api/telegram.php') return await bookingApi(request, env);
      if (path.startsWith('/api/')) return json({ ok: false, message: 'API-метод не найден.' }, 404);
      return await env.ASSETS.fetch(request);
    } catch (error) {
      return errorResponse(error);
    }
  },
} satisfies ExportedHandler<Env>;
