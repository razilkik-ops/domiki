const menuButton = document.querySelector('.menu-toggle');
const nav = document.querySelector('.nav');
const dialog = document.querySelector('#booking-dialog');
const bookingHouse = document.querySelector('#booking-house');
const bookingExtras = document.querySelector('[data-booking-extras]');
const toast = document.querySelector('.toast');
const breakfastPhotoDialog = document.querySelector('#breakfast-photo-dialog');
const breakfastPhotoTrigger = document.querySelector('[data-breakfast-photo-open]');

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 3200);
}

function renderSuccess(element, message) {
  const icon = document.createElement('i');
  icon.className = 'ph ph-check-circle';
  icon.setAttribute('aria-hidden', 'true');
  element.replaceChildren(icon, document.createTextNode(` ${message}`));
}

menuButton.addEventListener('click', () => {
  const isOpen = nav.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(isOpen));
  menuButton.innerHTML = `<i class="ph ph-${isOpen ? 'x' : 'list'}"></i>`;
  document.body.classList.toggle('menu-open', isOpen);
});

nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
  nav.classList.remove('open');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.innerHTML = '<i class="ph ph-list"></i>';
  document.body.classList.remove('menu-open');
}));

function syncBookingExtras() {
  const isBathOnly = bookingHouse.value === 'Баня на дровах';
  const bathExtra = bookingExtras.querySelector('[data-bath-extra]');
  const bathInput = bathExtra?.querySelector('input');

  bookingExtras.hidden = false;
  bathExtra?.toggleAttribute('hidden', isBathOnly);
  if (bathInput) {
    bathInput.disabled = isBathOnly;
    if (isBathOnly) bathInput.checked = false;
  }
}

bookingHouse.addEventListener('change', syncBookingExtras);

function openBooking(house = 'Мальта') {
  bookingHouse.value = house;
  syncBookingExtras();
  dialog.querySelector('form').hidden = false;
  dialog.querySelector('.dialog-success').hidden = true;
  dialog.showModal();
  document.body.classList.add('dialog-open');
}

document.querySelectorAll('.js-book').forEach((button) => button.addEventListener('click', () => openBooking()));
document.querySelectorAll('.js-detail').forEach((button) => button.addEventListener('click', () => openBooking(button.dataset.house)));
dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  const bounds = dialog.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
});
dialog.addEventListener('close', () => document.body.classList.remove('dialog-open'));

breakfastPhotoTrigger?.addEventListener('click', () => {
  breakfastPhotoDialog.showModal();
  document.body.classList.add('photo-dialog-open');
  breakfastPhotoDialog.querySelector('.breakfast-photo-dialog-close').focus();
});

breakfastPhotoDialog?.querySelector('.breakfast-photo-dialog-close')?.addEventListener('click', () => breakfastPhotoDialog.close());
breakfastPhotoDialog?.addEventListener('click', (event) => {
  if (event.target === breakfastPhotoDialog) breakfastPhotoDialog.close();
});
breakfastPhotoDialog?.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    breakfastPhotoDialog.close();
  }
});
breakfastPhotoDialog?.addEventListener('close', () => document.body.classList.remove('photo-dialog-open'));

document.getElementById('booking-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const extras = new FormData(event.currentTarget).getAll('extras');
  event.currentTarget.hidden = true;
  const success = dialog.querySelector('.dialog-success');
  renderSuccess(success, `Заявка отправлена.${extras.length ? ` Дополнительно: ${extras.join(', ')}.` : ''} Скоро мы с вами свяжемся.`);
  success.hidden = false;
});

document.querySelector('#booking-form [data-js-submit]').disabled = false;
