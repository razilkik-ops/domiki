const SOURCE_ORIGIN = 'https://razilkik-ops.github.io';
const TRANSLATED_ORIGIN = 'https://razilkik--ops-github-io.translate.goog';
const TRANSLATED_HOST = new URL(TRANSLATED_ORIGIN).hostname;
const isTranslated = window.location.hostname === TRANSLATED_HOST;
const contactUrls = {
  telegram: 'tg://resolve?phone=375293334899',
  viber: 'viber://chat?number=%2B375293334899',
  whatsapp: 'https://wa.me/375293334899',
};

function getPublicPath() {
  const { hostname, pathname } = window.location;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';

  if (!isLocal || pathname.startsWith('/domiki/')) return pathname;
  if (pathname === '/') return '/domiki/';
  return `/domiki/${pathname.replace(/^\/+/, '')}`;
}

function switchLanguage(language) {
  const publicPath = getPublicPath();
  const hash = window.location.hash;

  if (language === 'ru') {
    if (!isTranslated) return;
    window.location.assign(`${SOURCE_ORIGIN}${publicPath}${hash}`);
    return;
  }

  if (isTranslated) return;
  const translateQuery = '_x_tr_sl=ru&_x_tr_tl=zh-CN&_x_tr_hl=ru';
  window.location.assign(`${TRANSLATED_ORIGIN}${publicPath}?${translateQuery}${hash}`);
}

document.documentElement.lang = isTranslated ? 'zh-CN' : 'ru';

document.querySelectorAll('[data-language]').forEach((button) => {
  const language = button.dataset.language;
  const isActive = language === (isTranslated ? 'zh' : 'ru');
  button.setAttribute('aria-pressed', String(isActive));
  button.addEventListener('click', () => switchLanguage(language));
});

document.querySelectorAll('[data-contact-link]').forEach((link) => {
  const contactUrl = contactUrls[link.dataset.contactLink];
  if (!contactUrl) return;
  link.setAttribute('href', contactUrl);
  link.addEventListener('click', (event) => {
    if (!isTranslated) return;
    event.preventDefault();
    window.location.assign(contactUrl);
  });
});
