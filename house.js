const menuButton = document.querySelector('.menu-toggle');
const nav = document.querySelector('.nav');
const dialog = document.querySelector('.house-booking-dialog');
const form = document.querySelector('.house-booking-form');
const gallery = document.querySelector('[data-house-gallery]');
const inquiryCard = document.querySelector('.house-inquiry-card');
const inquiryForm = document.querySelector('.house-inquiry-form');

menuButton?.addEventListener('click', () => {
  const isOpen = nav.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(isOpen));
  menuButton.innerHTML = `<i class="ph ph-${isOpen ? 'x' : 'list'}"></i>`;
  document.body.classList.toggle('menu-open', isOpen);
});

nav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
  nav.classList.remove('open');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.innerHTML = '<i class="ph ph-list"></i>';
  document.body.classList.remove('menu-open');
}));

document.querySelectorAll('.js-house-book').forEach((button) => button.addEventListener('click', () => {
  if (inquiryCard) {
    inquiryCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => inquiryForm?.elements.name.focus({ preventScroll: true }), 450);
  } else if (dialog && form) {
    form.hidden = false;
    dialog.querySelector('.dialog-success').hidden = true;
    dialog.showModal();
    document.body.classList.add('dialog-open');
  }
}));

dialog?.querySelector('.dialog-close')?.addEventListener('click', () => dialog.close());
dialog?.addEventListener('click', (event) => {
  const bounds = dialog.getBoundingClientRect();
  const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
  if (outside) dialog.close();
});
dialog?.addEventListener('close', () => document.body.classList.remove('dialog-open'));

form?.addEventListener('submit', (event) => {
  event.preventDefault();
  const extras = new FormData(form).getAll('extras');
  form.hidden = true;
  const success = dialog.querySelector('.dialog-success');
  success.innerHTML = `<i class="ph ph-check-circle"></i> Заявка отправлена.${extras.length ? ` Дополнительно: ${extras.join(', ')}.` : ''} Скоро мы вам позвоним.`;
  success.hidden = false;
});

if (inquiryForm) {
  const arrival = inquiryForm.elements.arrival;
  const departure = inquiryForm.elements.departure;
  const localToday = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);

  if (arrival) {
    arrival.min = localToday;
  }

  if (departure) {
    departure.min = localToday;
    arrival?.addEventListener('change', () => {
      departure.min = arrival.value || localToday;
      if (departure.value && departure.value < departure.min) departure.value = '';
    });
  }

  inquiryForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const extras = new FormData(inquiryForm).getAll('extras');
    const success = inquiryCard.querySelector('.house-inquiry-success');
    success.querySelector('span').textContent = `Заявка отправлена.${extras.length ? ` Дополнительно: ${extras.join(', ')}.` : ''} Скоро мы вам позвоним.`;
    inquiryForm.hidden = true;
    success.hidden = false;
    success.focus?.();
  });
}

if (gallery) {
  const slides = [...gallery.querySelectorAll('[data-gallery-slide]')];
  const dots = [...gallery.querySelectorAll('[data-gallery-dot]')];
  const currentLabel = gallery.querySelector('[data-gallery-current]');
  const status = gallery.querySelector('[data-gallery-status]');
  let currentIndex = 0;
  let touchStartX = 0;

  const showSlide = (nextIndex, announce = true) => {
    currentIndex = (nextIndex + slides.length) % slides.length;

    slides.forEach((slide, index) => {
      const isActive = index === currentIndex;
      slide.classList.toggle('is-active', isActive);
      slide.setAttribute('aria-hidden', String(!isActive));
    });

    dots.forEach((dot, index) => {
      dot.setAttribute('aria-pressed', String(index === currentIndex));
    });

    currentLabel.textContent = String(currentIndex + 1);
    if (announce) status.textContent = `Фотография ${currentIndex + 1} из ${slides.length}`;
  };

  gallery.querySelector('[data-gallery-prev]').addEventListener('click', () => showSlide(currentIndex - 1));
  gallery.querySelector('[data-gallery-next]').addEventListener('click', () => showSlide(currentIndex + 1));
  dots.forEach((dot) => dot.addEventListener('click', () => showSlide(Number(dot.dataset.galleryDot))));

  gallery.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      showSlide(currentIndex - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      showSlide(currentIndex + 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      showSlide(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      showSlide(slides.length - 1);
    }
  });

  gallery.addEventListener('touchstart', (event) => {
    touchStartX = event.changedTouches[0].clientX;
  }, { passive: true });

  gallery.addEventListener('touchend', (event) => {
    const distance = event.changedTouches[0].clientX - touchStartX;
    if (Math.abs(distance) >= 45) showSlide(currentIndex + (distance < 0 ? 1 : -1));
  }, { passive: true });

  showSlide(0, false);
}
