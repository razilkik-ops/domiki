const endpoint = new URL('./api/content.php', document.baseURI);
endpoint.searchParams.set('admin', '1');
const loadingPanel = document.querySelector('[data-loading-panel]');
const loginPanel = document.querySelector('[data-login-panel]');
const editorPanel = document.querySelector('[data-editor-panel]');
const loginForm = document.querySelector('[data-login-form]');
const contentForm = document.querySelector('[data-content-form]');
const propertiesContainer = document.querySelector('[data-properties]');
const template = document.querySelector('#property-editor-template');
const loginMessage = document.querySelector('[data-login-message]');
const saveMessage = document.querySelector('[data-save-message]');
const logoutButton = document.querySelector('[data-logout]');

const propertyOrder = ['malta', 'valencia', 'apartments', 'bath'];
let csrfToken = '';
let currentContent = null;
let lockoutTimer = null;

function showMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('is-error', isError);
  element.hidden = !message;
}

async function request(payload) {
  const options = {
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  };
  if (payload) {
    options.method = 'POST';
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(payload);
  }

  const response = await fetch(endpoint, options);
  const result = await response.json().catch(() => ({ ok: false, message: 'Сервер вернул некорректный ответ.' }));
  if (!response.ok || !result.ok) {
    const error = new Error(result.message || 'Не удалось выполнить запрос.');
    error.status = response.status;
    error.retryAfter = Number(result.retryAfter) || 0;
    throw error;
  }
  return result;
}

function formatWait(seconds) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes >= 60 ? '1 час' : `${minutes} мин.`;
}

function applyLoginLockout(seconds) {
  if (lockoutTimer) window.clearInterval(lockoutTimer);
  const input = loginForm.elements.password;
  const button = loginForm.querySelector('button');
  let remaining = Math.max(1, Math.ceil(seconds));
  input.value = '';
  input.disabled = true;
  button.disabled = true;

  const render = () => {
    showMessage(loginMessage, `Слишком много неверных попыток. Повторите вход через ${formatWait(remaining)}.`, true);
    remaining -= 1;
    if (remaining > 0) return;
    window.clearInterval(lockoutTimer);
    lockoutTimer = null;
    input.disabled = false;
    button.disabled = false;
    showMessage(loginMessage, 'Блокировка завершена. Можно попробовать войти снова.');
  };
  render();
  lockoutTimer = window.setInterval(render, 1000);
}

function updateCounter(textarea, counter) {
  counter.textContent = String(textarea.value.length);
}

function renderProperties(content) {
  propertiesContainer.replaceChildren();
  propertyOrder.forEach((key, index) => {
    const property = content.properties[key];
    if (!property) return;

    const fragment = template.content.cloneNode(true);
    const article = fragment.querySelector('.admin-property');
    article.dataset.property = key;
    fragment.querySelector('.admin-property-number').textContent = String(index + 1).padStart(2, '0');
    fragment.querySelector('h2').textContent = property.name;

    const weekday = fragment.querySelector('[name="weekday"]');
    const weekend = fragment.querySelector('[name="weekend"]');
    const cardDescription = fragment.querySelector('[name="cardDescription"]');
    const pageDescription = fragment.querySelector('[name="pageDescription"]');
    weekday.value = property.prices.weekday;
    weekend.value = property.prices.weekend;
    cardDescription.value = property.cardDescription;
    pageDescription.value = property.pageDescription;

    if (key === 'bath') {
      const weekendLabel = fragment.querySelector('[data-weekend-label]');
      weekendLabel.hidden = true;
      weekend.required = false;
    }

    const cardCount = fragment.querySelector('[data-card-count]');
    const pageCount = fragment.querySelector('[data-page-count]');
    cardDescription.addEventListener('input', () => updateCounter(cardDescription, cardCount));
    pageDescription.addEventListener('input', () => updateCounter(pageDescription, pageCount));
    updateCounter(cardDescription, cardCount);
    updateCounter(pageDescription, pageCount);
    propertiesContainer.append(fragment);
  });
}

function showLogin() {
  loadingPanel.hidden = true;
  editorPanel.hidden = true;
  loginPanel.hidden = false;
}

function showEditor(result) {
  currentContent = result.content;
  csrfToken = result.csrfToken;
  renderProperties(currentContent);
  loadingPanel.hidden = true;
  loginPanel.hidden = true;
  editorPanel.hidden = false;
}

function collectContent() {
  const properties = {};
  propertiesContainer.querySelectorAll('[data-property]').forEach((article) => {
    const key = article.dataset.property;
    properties[key] = {
      name: currentContent.properties[key].name,
      prices: {
        weekday: article.querySelector('[name="weekday"]').value.trim(),
        weekend: article.querySelector('[name="weekend"]').value.trim(),
      },
      cardDescription: article.querySelector('[name="cardDescription"]').value.trim(),
      pageDescription: article.querySelector('[name="pageDescription"]').value.trim(),
    };
  });
  return { version: 1, properties };
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showMessage(loginMessage, '');
  const button = loginForm.querySelector('button');
  button.disabled = true;
  try {
    const result = await request({ action: 'login', password: loginForm.elements.password.value });
    loginForm.reset();
    showEditor(result);
  } catch (error) {
    if (error.retryAfter > 0) applyLoginLockout(error.retryAfter);
    else showMessage(loginMessage, error.message, true);
  } finally {
    if (!loginForm.elements.password.disabled) button.disabled = false;
  }
});

contentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showMessage(saveMessage, '');
  const button = contentForm.querySelector('.admin-save');
  button.disabled = true;
  button.textContent = 'Сохраняем…';
  try {
    const result = await request({ action: 'save', csrfToken, content: collectContent() });
    currentContent = result.content;
    csrfToken = result.csrfToken;
    showMessage(saveMessage, 'Изменения сохранены.');
  } catch (error) {
    showMessage(saveMessage, error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Сохранить изменения';
  }
});

logoutButton.addEventListener('click', async () => {
  logoutButton.disabled = true;
  try {
    await request({ action: 'logout', csrfToken });
  } catch {
    // В любом случае возвращаем форму входа и очищаем данные интерфейса.
  } finally {
    csrfToken = '';
    currentContent = null;
    propertiesContainer.replaceChildren();
    logoutButton.disabled = false;
    showLogin();
  }
});

request()
  .then((result) => {
    if (result.authenticated) showEditor(result);
    else {
      showLogin();
      if (result.retryAfter > 0) {
        applyLoginLockout(result.retryAfter);
        return;
      }
      if (!result.configured) {
        showMessage(loginMessage, 'Сначала задайте ADMIN_PASSWORD в файле .env на хостинге.', true);
      }
    }
  })
  .catch((error) => {
    showLogin();
    showMessage(loginMessage, `${error.message} Проверьте, что сайт размещён на хостинге с PHP.`, true);
  });
