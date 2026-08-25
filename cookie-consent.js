const CONSENT_STORAGE_KEY = 'malta-retreat-cookie-consent';
const CONSENT_LIFETIME = 180 * 24 * 60 * 60 * 1000;

const copy = document.documentElement.lang === 'zh-CN'
  ? {
      title: 'Cookie 设置',
      text: '我们使用网站运行所必需的技术。经您同意后，我们会加载可能使用 Cookie 的 Yandex 地图。',
      details: '了解更多',
      necessary: '仅必要项',
      accept: '全部接受',
      mapTitle: '地图已关闭',
      mapText: '只有在您同意使用 Yandex 地图 Cookie 后，地图才会加载。',
      mapButton: '显示地图',
    }
  : {
      title: 'Настройки cookie',
      text: 'Мы используем необходимые технологии для работы сайта. С вашего согласия загружаются Яндекс Карты, которые могут использовать cookie.',
      details: 'Подробнее',
      necessary: 'Только необходимые',
      accept: 'Принять все',
      mapTitle: 'Карта отключена',
      mapText: 'Карта загрузится только после согласия на использование cookie Яндекс Карт.',
      mapButton: 'Показать карту',
    };

function readConsent() {
  try {
    const consent = JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY));
    if (!consent?.level || Date.now() - consent.savedAt > CONSENT_LIFETIME) {
      localStorage.removeItem(CONSENT_STORAGE_KEY);
      return null;
    }
    return consent.level;
  } catch {
    return null;
  }
}

function saveConsent(level) {
  try {
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ level, savedAt: Date.now() }));
  } catch {
    // The choice still applies for the current page if storage is unavailable.
  }
}

function createMapPlaceholder(frame) {
  if (frame.parentElement.querySelector('[data-map-placeholder]')) return;

  const placeholder = document.createElement('div');
  placeholder.className = 'map-consent-placeholder';
  placeholder.dataset.mapPlaceholder = '';
  placeholder.innerHTML = `
    <i class="ph ph-map-pin" aria-hidden="true"></i>
    <strong>${copy.mapTitle}</strong>
    <p>${copy.mapText}</p>
    <button class="button button-secondary" type="button" data-enable-maps>${copy.mapButton}</button>
  `;
  frame.before(placeholder);
  frame.parentElement.classList.add('maps-blocked');
}

function loadMaps() {
  document.querySelectorAll('iframe[data-cookie-src]').forEach((frame) => {
    if (!frame.hasAttribute('src')) frame.setAttribute('src', frame.dataset.cookieSrc);
    frame.parentElement.classList.remove('maps-blocked');
    frame.parentElement.querySelector('[data-map-placeholder]')?.remove();
  });
}

function blockMaps() {
  document.querySelectorAll('iframe[data-cookie-src]').forEach((frame) => {
    frame.removeAttribute('src');
    createMapPlaceholder(frame);
  });
}

function applyConsent(level) {
  saveConsent(level);
  if (level === 'all') loadMaps();
  else blockMaps();
  document.querySelector('[data-cookie-banner]')?.remove();
  window.dispatchEvent(new CustomEvent('cookieconsentchange', { detail: { level } }));
}

function showBanner() {
  document.querySelector('[data-cookie-banner]')?.remove();

  const banner = document.createElement('section');
  banner.className = 'cookie-banner';
  banner.dataset.cookieBanner = '';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-labelledby', 'cookie-banner-title');
  banner.innerHTML = `
    <div class="cookie-banner-copy">
      <i class="ph ph-cookie" aria-hidden="true"></i>
      <div>
        <h2 id="cookie-banner-title">${copy.title}</h2>
        <p>${copy.text} <a href="./cookies.html">${copy.details}</a></p>
      </div>
    </div>
    <div class="cookie-banner-actions">
      <button class="button button-secondary" type="button" data-cookie-necessary>${copy.necessary}</button>
      <button class="button button-primary" type="button" data-cookie-accept>${copy.accept}</button>
    </div>
  `;

  banner.querySelector('[data-cookie-necessary]').addEventListener('click', () => applyConsent('necessary'));
  banner.querySelector('[data-cookie-accept]').addEventListener('click', () => applyConsent('all'));
  document.body.append(banner);
}

document.addEventListener('click', (event) => {
  if (event.target.closest('[data-cookie-settings]')) {
    event.preventDefault();
    showBanner();
  }

  if (event.target.closest('[data-enable-maps]')) {
    applyConsent('all');
  }
});

const savedConsent = readConsent();
if (savedConsent === 'all') loadMaps();
else {
  blockMaps();
  if (!savedConsent) showBanner();
}
