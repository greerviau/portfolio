(() => {
  const script = document.currentScript;
  const base = new URL('.', script.src);
  const container = document.querySelector('[data-photo-groups]');
  const status = document.querySelector('[data-photo-status]');
  const limit = Number(container.dataset.photoLimit) || Infinity;

  const isLandscape = figure => figure.classList.contains('photo-landscape');

  function arrangePhotos(grid, figures) {
    const remaining = [...figures];
    const ordered = [];
    while (remaining.length) {
      const first = remaining.shift();
      if (isLandscape(first)) {
        ordered.push(first);
        const partner = remaining.findIndex(figure => !isLandscape(figure));
        if (partner !== -1) ordered.push(...remaining.splice(partner, 1));
      } else if (remaining.length >= 2 && remaining.slice(0, 2).every(figure => !isLandscape(figure))) {
        ordered.push(first, ...remaining.splice(0, 2));
      } else {
        const partner = remaining.findIndex(isLandscape);
        if (partner !== -1) ordered.push(...remaining.splice(partner, 1), first);
        else ordered.push(first, ...remaining.splice(0, 2));
      }
    }
    grid.replaceChildren(...ordered);
  }

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
        const selected = group.photos.slice(0, limit - count);
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
            const landscape = image.naturalWidth > image.naturalHeight;
            if (landscape !== isLandscape(figure)) {
              figure.classList.toggle('photo-landscape', landscape);
              arrangePhotos(grid, figures);
            }
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
        }
        arrangePhotos(grid, figures);
        section.append(grid);
        fragment.append(section);
        count += selected.length;
        if (count >= limit) break;
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
