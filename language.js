const SOURCE_ORIGIN = 'https://razilkik-ops.github.io';
const TRANSLATED_ORIGIN = 'https://razilkik--ops-github-io.translate.goog';
const TRANSLATED_HOST = new URL(TRANSLATED_ORIGIN).hostname;
const isTranslated = window.location.hostname === TRANSLATED_HOST;

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
