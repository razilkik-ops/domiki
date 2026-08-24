const menuButton = document.querySelector('.menu-toggle');
const nav = document.querySelector('.nav');
const dialog = document.querySelector('#booking-dialog');
const bookingHouse = document.querySelector('#booking-house');
const bookingExtras = document.querySelector('[data-booking-extras]');
const toast = document.querySelector('.toast');

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove('show'), 3200);
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
  bookingExtras.hidden = isBathOnly;
  bookingExtras.querySelectorAll('input').forEach((input) => {
    input.disabled = isBathOnly;
    if (isBathOnly) input.checked = false;
  });
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

document.getElementById('booking-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const extras = new FormData(event.currentTarget).getAll('extras');
  event.currentTarget.hidden = true;
  const success = dialog.querySelector('.dialog-success');
  success.innerHTML = `<i class="ph ph-check-circle"></i> Заявка отправлена.${extras.length ? ` Дополнительно: ${extras.join(', ')}.` : ''} Скоро мы вам позвоним.`;
  success.hidden = false;
});
