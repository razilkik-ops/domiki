const SUBMIT_ENDPOINT = new URL('./api/telegram.php', window.location.href);

function getErrorMessage(payload, response) {
  if (payload?.message) return payload.message;
  if (response.status === 429) return 'Слишком много попыток. Подождите немного и попробуйте ещё раз.';
  return 'Не удалось отправить заявку. Попробуйте ещё раз или свяжитесь с нами по телефону.';
}

export async function submitBookingForm(form) {
  const submitButton = form.querySelector('[data-js-submit]');
  const originalLabel = submitButton?.textContent;
  const formData = new FormData(form);

  formData.set('page', window.location.href);
  formData.set('privacy_consent', formData.has('privacy_consent') ? '1' : '0');

  form.querySelector('[data-booking-error]')?.remove();
  form.setAttribute('aria-busy', 'true');
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.textContent = 'Отправляем…';
  }

  try {
    const response = await fetch(SUBMIT_ENDPOINT, {
      method: 'POST',
      headers: { Accept: 'application/json' },
      body: formData,
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.ok) {
      throw new Error(getErrorMessage(payload, response));
    }

    return payload;
  } finally {
    form.removeAttribute('aria-busy');
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalLabel;
    }
  }
}

export function showBookingError(form, error) {
  const message = error instanceof Error
    ? error.message
    : 'Не удалось отправить заявку. Попробуйте ещё раз.';
  const errorElement = document.createElement('p');

  errorElement.className = 'booking-form-error';
  errorElement.dataset.bookingError = '';
  errorElement.setAttribute('role', 'alert');
  errorElement.tabIndex = -1;
  errorElement.textContent = message;
  form.querySelector('[data-js-submit]')?.before(errorElement);
  errorElement.focus?.();
}
