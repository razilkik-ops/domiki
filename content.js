const endpoint = new URL('./api/content.php', document.baseURI);

function getProperty(content, key) {
  const property = content?.properties?.[key];
  return property && typeof property === 'object' ? property : null;
}

function formatPrice(value, prefix = '') {
  const normalized = String(value ?? '').trim();
  return normalized ? `${prefix}${normalized} BYN` : '';
}

function applyContent(content) {
  document.querySelectorAll('[data-content-price]').forEach((element) => {
    const [propertyKey, priceKey] = element.dataset.contentPrice.split('.');
    const property = getProperty(content, propertyKey);
    const value = property?.prices?.[priceKey];
    if (value !== undefined && String(value).trim() !== '') {
      element.textContent = formatPrice(value, element.dataset.pricePrefix || '');
    }
  });

  document.querySelectorAll('[data-content-card-description]').forEach((element) => {
    const property = getProperty(content, element.dataset.contentCardDescription);
    if (property?.cardDescription) {
      element.textContent = property.cardDescription;
    }
  });

  document.querySelectorAll('[data-content-page-description]').forEach((container) => {
    const property = getProperty(content, container.dataset.contentPageDescription);
    if (!property?.pageDescription) return;

    const paragraphs = String(property.pageDescription)
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);

    if (!paragraphs.length) return;

    container.querySelectorAll(':scope > p:not(.eyebrow)').forEach((paragraph) => paragraph.remove());
    paragraphs.forEach((text) => {
      const paragraph = document.createElement('p');
      paragraph.textContent = text;
      container.append(paragraph);
    });
  });
}

async function loadContent() {
  try {
    const response = await fetch(endpoint, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!response.ok) return;

    const result = await response.json();
    if (result?.ok && result.content) {
      applyContent(result.content);
    }
  } catch {
    // В HTML остаются исходные данные, если PHP API недоступен.
  }
}

loadContent();
