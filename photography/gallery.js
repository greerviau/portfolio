(() => {
  const script = document.currentScript;
  const base = new URL('.', script.src);
  const container = document.querySelector('[data-photo-groups]');
  const status = document.querySelector('[data-photo-status]');
  const singleRow = container.hasAttribute('data-photo-row');
  const phone = window.matchMedia('(max-width: 600px)');
  const rowTrimmers = [];

  const isLandscape = figure => figure.classList.contains('photo-landscape');

  // A row is three portrait columns wide (two on phones) and a landscape takes two,
  // so keep the photos that flex-wrap places on the first row and hide the rest.
  function trimToFirstRow(figures) {
    const columns = phone.matches ? 2 : 3;
    let used = 0;
    for (const figure of figures) {
      used += isLandscape(figure) ? 2 : 1;
      figure.hidden = used > columns;
    }
  }
  phone.addEventListener('change', () => rowTrimmers.forEach(trim => trim()));

  const icon = path => `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path d="${path}"/></svg>`;
  const lightbox = document.createElement('dialog');
  lightbox.className = 'lightbox';
  lightbox.dataset.lightbox = '';
  lightbox.setAttribute('aria-label', 'Photo viewer');
  lightbox.innerHTML = `
    <figure><img alt=""><figcaption hidden></figcaption></figure>
    <button type="button" class="lightbox-close" data-lightbox-close aria-label="Close">${icon('M5 5l14 14M19 5L5 19')}</button>
    <button type="button" class="lightbox-prev" data-lightbox-prev aria-label="Previous photo">${icon('M15 4l-8 8 8 8')}</button>
    <button type="button" class="lightbox-next" data-lightbox-next aria-label="Next photo">${icon('M9 4l8 8-8 8')}</button>`;
  const lightboxFigure = lightbox.querySelector('figure');
  const lightboxImage = lightbox.querySelector('img');
  const lightboxCaption = lightbox.querySelector('figcaption');
  const prevButton = lightbox.querySelector('[data-lightbox-prev]');
  const nextButton = lightbox.querySelector('[data-lightbox-next]');
  let lightboxLinks = [];
  let lightboxIndex = 0;
  document.body.append(lightbox);

  function showPhoto(index) {
    lightboxIndex = (index + lightboxLinks.length) % lightboxLinks.length;
    const link = lightboxLinks[lightboxIndex];
    const thumbnail = link.querySelector('img');
    lightboxImage.width = thumbnail.width;
    lightboxImage.height = thumbnail.height;
    lightboxImage.src = link.href;
    lightboxImage.alt = thumbnail.alt;
    const caption = link.closest('figure').querySelector('figcaption')?.textContent ?? '';
    lightboxCaption.textContent = caption;
    lightboxCaption.hidden = !caption;
  }

  container.addEventListener('click', event => {
    const link = event.target.closest('a');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    lightboxLinks = [...container.querySelectorAll('figure:not([hidden]) a')];
    const single = lightboxLinks.length < 2;
    prevButton.hidden = single;
    nextButton.hidden = single;
    showPhoto(lightboxLinks.indexOf(link));
    lightbox.showModal();
  });
  lightbox.addEventListener('click', event => {
    if (event.target === lightbox || event.target === lightboxFigure) lightbox.close();
    else if (event.target.closest('[data-lightbox-close]')) lightbox.close();
    else if (event.target.closest('[data-lightbox-prev]')) showPhoto(lightboxIndex - 1);
    else if (event.target.closest('[data-lightbox-next]')) showPhoto(lightboxIndex + 1);
  });
  lightbox.addEventListener('keydown', event => {
    if (lightboxLinks.length < 2) return;
    if (event.key === 'ArrowLeft') showPhoto(lightboxIndex - 1);
    else if (event.key === 'ArrowRight') showPhoto(lightboxIndex + 1);
    else return;
    event.preventDefault();
  });

  async function loadPhotos() {
    try {
      const response = await fetch(new URL('photos.json', base));
      if (!response.ok) throw new Error('Photo list request failed');
      const groups = await response.json();
      if (!Array.isArray(groups) || groups.some(group =>
        !group || (group.title !== undefined && typeof group.title !== 'string') ||
        !Array.isArray(group.photos) || group.photos.some(photo =>
          !photo || typeof photo.file !== 'string' || !photo.file.trim() ||
          typeof photo.alt !== 'string' || !photo.alt.trim() ||
          (photo.caption !== undefined && typeof photo.caption !== 'string')
        )
      )) throw new Error('Invalid photo groups');

      const fragment = document.createDocumentFragment();
      let count = 0;
      for (const [index, group] of groups.entries()) {
        const selected = singleRow ? group.photos.slice(0, 3) : group.photos;
        if (!selected.length) continue;
        const title = group.title?.trim();
        const section = document.createElement(title ? 'section' : 'div');
        section.className = 'photo-group';
        if (title) {
          const heading = document.createElement(container.dataset.photoHeading === '3' ? 'h3' : 'h2');
          heading.className = 'photo-group-title';
          heading.id = `photo-group-${index}`;
          heading.textContent = title;
          section.setAttribute('aria-labelledby', heading.id);
          section.append(heading);
        }
        const grid = document.createElement('div');
        grid.className = 'photo-grid';
        grid.dataset.photoGrid = '';
        const figures = [];
        const trim = () => trimToFirstRow(figures);
        for (const photo of selected) {
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
            if (singleRow) trim();
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
          figures.push(figure);
          grid.append(figure);
        }
        if (singleRow) {
          rowTrimmers.push(trim);
          trim();
        }
        section.append(grid);
        fragment.append(section);
        count += selected.length;
        if (singleRow) break;
      }
      container.replaceChildren(fragment);
      status.textContent = count ? '' : 'Photos coming soon.';
      status.hidden = count > 0;
    } catch {
      status.textContent = 'Unable to load photos. Please try again later.';
    } finally {
      status.setAttribute('aria-busy', 'false');
    }
  }

  loadPhotos();
})();
