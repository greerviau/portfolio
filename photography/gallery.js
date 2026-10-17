(() => {
  const script = document.currentScript;
  const base = new URL('.', script.src);
  const grid = document.querySelector('[data-photo-grid]');
  const status = document.querySelector('[data-photo-status]');
  const limit = Number(grid.dataset.photoLimit) || Infinity;

  async function loadPhotos() {
    try {
      const response = await fetch(new URL('photos.json', base));
      if (!response.ok) throw new Error('Photo list request failed');
      const photos = await response.json();
      if (!Array.isArray(photos) || photos.some(photo =>
        !photo || typeof photo.file !== 'string' || !photo.file.trim() ||
        typeof photo.alt !== 'string' || !photo.alt.trim() ||
        (photo.caption !== undefined && typeof photo.caption !== 'string')
      )) throw new Error('Invalid photo list');

      const fragment = document.createDocumentFragment();
      for (const photo of photos.slice(0, limit)) {
        const figure = document.createElement('figure');
        const link = document.createElement('a');
        const image = document.createElement('img');
        const hasDimensions = Number.isInteger(photo.width) && photo.width > 0 &&
          Number.isInteger(photo.height) && photo.height > 0;
        if (hasDimensions) {
          image.width = photo.width;
          image.height = photo.height;
          figure.classList.toggle('photo-landscape', photo.width > photo.height);
        }
        image.addEventListener('load', () => {
          image.width = image.naturalWidth;
          image.height = image.naturalHeight;
          figure.classList.toggle('photo-landscape', image.naturalWidth > image.naturalHeight);
        });
        image.src = new URL(`images/${encodeURIComponent(photo.file)}`, base).href;
        image.alt = photo.alt;
        image.loading = 'lazy';
        image.decoding = 'async';
        link.href = image.src;
        link.append(image);
        figure.append(link);
        if (photo.caption) {
          const caption = document.createElement('figcaption');
          caption.textContent = photo.caption;
          figure.append(caption);
        }
        fragment.append(figure);
      }
      grid.replaceChildren(fragment);
      status.textContent = photos.length ? '' : 'Photos coming soon.';
      status.hidden = photos.length > 0;
    } catch {
      status.textContent = 'Unable to load photos. Please try again later.';
    } finally {
      status.setAttribute('aria-busy', 'false');
    }
  }

  loadPhotos();
})();
