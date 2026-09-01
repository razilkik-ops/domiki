const menuButton = document.querySelector('.menu-toggle');
const nav = document.querySelector('.nav');
const dialog = document.querySelector('.house-booking-dialog');
const form = document.querySelector('.house-booking-form');
const gallery = document.querySelector('[data-house-gallery]');
const inquiryCard = document.querySelector('.house-inquiry-card');
const inquiryForm = document.querySelector('.house-inquiry-form');

function renderSuccess(element, message) {
  const icon = document.createElement('i');
  icon.className = 'ph ph-check-circle';
  icon.setAttribute('aria-hidden', 'true');
  element.replaceChildren(icon, document.createTextNode(` ${message}`));
}

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
  renderSuccess(success, `Заявка отправлена.${extras.length ? ` Дополнительно: ${extras.join(', ')}.` : ''} Скоро мы с вами свяжемся.`);
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
    success.querySelector('span').textContent = `Заявка отправлена.${extras.length ? ` Дополнительно: ${extras.join(', ')}.` : ''} Скоро мы с вами свяжемся.`;
    inquiryForm.hidden = true;
    success.hidden = false;
    success.focus?.();
  });

  inquiryForm.querySelector('[data-js-submit]').disabled = false;
}

if (gallery) {
  const slides = [...gallery.querySelectorAll('[data-gallery-slide]')];
  const dots = [...gallery.querySelectorAll('[data-gallery-dot]')];
  const currentLabel = gallery.querySelector('[data-gallery-current]');
  const status = gallery.querySelector('[data-gallery-status]');
  let currentIndex = 0;
  let touchStartX = 0;

  const lightbox = document.createElement('dialog');
  lightbox.className = 'gallery-lightbox';
  lightbox.setAttribute('aria-label', 'Просмотр фотографии без обрезки');
  lightbox.innerHTML = `
    <div class="gallery-lightbox-frame">
      <button class="gallery-lightbox-close" type="button" aria-label="Закрыть просмотр"><i class="ph ph-x" aria-hidden="true"></i></button>
      <button class="gallery-lightbox-arrow gallery-lightbox-prev" type="button" aria-label="Предыдущая фотография"><i class="ph ph-caret-left" aria-hidden="true"></i></button>
      <img alt="" />
      <button class="gallery-lightbox-arrow gallery-lightbox-next" type="button" aria-label="Следующая фотография"><i class="ph ph-caret-right" aria-hidden="true"></i></button>
      <p class="gallery-lightbox-counter" aria-live="polite"></p>
    </div>`;
  document.body.append(lightbox);

  const lightboxImage = lightbox.querySelector('img');
  const lightboxCounter = lightbox.querySelector('.gallery-lightbox-counter');

  const updateLightbox = () => {
    const image = slides[currentIndex].querySelector('img');
    lightboxImage.src = image.currentSrc || image.src;
    lightboxImage.alt = image.alt;
    lightboxCounter.textContent = `${currentIndex + 1} / ${slides.length}`;
  };

  const openLightbox = (index) => {
    currentIndex = index;
    updateLightbox();
    lightbox.showModal();
    document.body.classList.add('lightbox-open');
    lightbox.querySelector('.gallery-lightbox-close').focus();
  };

  const closeLightbox = () => lightbox.close();

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
    if (lightbox.open) updateLightbox();
  };

  gallery.querySelector('[data-gallery-prev]').addEventListener('click', () => showSlide(currentIndex - 1));
  gallery.querySelector('[data-gallery-next]').addEventListener('click', () => showSlide(currentIndex + 1));
  dots.forEach((dot) => dot.addEventListener('click', () => showSlide(Number(dot.dataset.galleryDot))));
  slides.forEach((slide, index) => {
    const image = slide.querySelector('img');
    image.tabIndex = 0;
    image.setAttribute('role', 'button');
    image.setAttribute('aria-label', `${image.alt}. Открыть фотографию целиком`);
    image.addEventListener('click', () => openLightbox(index));
    image.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openLightbox(index);
      }
    });
  });

  lightbox.querySelector('.gallery-lightbox-close').addEventListener('click', closeLightbox);
  lightbox.querySelector('.gallery-lightbox-prev').addEventListener('click', () => showSlide(currentIndex - 1));
  lightbox.querySelector('.gallery-lightbox-next').addEventListener('click', () => showSlide(currentIndex + 1));
  lightbox.addEventListener('click', (event) => {
    if (event.target === lightbox) closeLightbox();
  });
  lightbox.addEventListener('close', () => {
    document.body.classList.remove('lightbox-open');
    lightboxImage.removeAttribute('src');
    gallery.focus({ preventScroll: true });
  });
  lightbox.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      showSlide(currentIndex - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      showSlide(currentIndex + 1);
    }
  });

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
