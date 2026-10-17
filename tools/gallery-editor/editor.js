(() => {
  const TILE_HEIGHT = 112;
  const $ = id => document.getElementById(id);
  const els = {
    sections: $('sections'), tray: $('tray'), trayCount: $('tray-count'), inspector: $('inspector'),
    status: $('status'), save: $('save'), addSection: $('add-section'), fileInput: $('file-input'),
    overlay: $('drop-overlay')
  };

  let groups = [];
  let tray = [];
  let selected = null;
  let savedSnapshot = '';
  let nextId = 1;
  let drag = null; // { kind: 'photo' | 'section' | 'files', file?, id? }
  let drop = null; // { array, index, el, side } for photos and files; { index, el, side } for sections
  let busy = false;

  const imageUrl = file => `/images/${encodeURIComponent(file)}`;

  async function api(method, path, body, contentType) {
    const response = await fetch(path, {
      method,
      headers: { 'X-Gallery-Editor': '1', ...(contentType ? { 'Content-Type': contentType } : {}) },
      body
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  function load(data) {
    groups = data.groups.map(group => ({
      id: nextId++,
      title: group.title || '',
      photos: group.photos.map(photo => ({ ...photo, caption: photo.caption || '' }))
    }));
    tray = data.unlisted.map(photo => ({ ...photo, alt: '', caption: '' }));
    if (selected && !findPhoto(selected)) selected = null;
    savedSnapshot = snapshot();
  }

  const payload = () => groups.map(group => ({
    title: group.title,
    photos: group.photos.map(({ file, alt, caption }) => ({ file, alt, caption }))
  }));
  const snapshot = () => JSON.stringify(payload());
  const isDirty = () => snapshot() !== savedSnapshot;
  const placedPhotos = () => groups.flatMap(group => group.photos);
  const missingAlt = photo => !photo.alt.trim();

  function findPhoto(file) {
    for (const array of [...groups.map(group => group.photos), tray]) {
      const index = array.findIndex(photo => photo.file === file);
      if (index >= 0) return { photo: array[index], array, index };
    }
    return null;
  }

  function containerFor(key) {
    if (key === 'tray') return tray;
    return groups.find(group => String(group.id) === key.slice(2))?.photos ?? null;
  }

  function movePhoto(file, array, index) {
    const found = findPhoto(file);
    if (!found) return;
    found.array.splice(found.index, 1);
    if (found.array === array && found.index < index) index -= 1;
    array.splice(index, 0, found.photo);
  }

  function setStatus(text, isError = false) {
    els.status.textContent = text;
    els.status.classList.toggle('error', isError);
  }

  function updateChrome() {
    const dirty = isDirty();
    els.save.disabled = busy || !dirty;
    document.querySelectorAll('.tile').forEach(tile => {
      const found = findPhoto(tile.dataset.file);
      tile.classList.toggle('missing-alt', Boolean(found) && missingAlt(found.photo) && !tile.closest('.tray'));
    });
    els.trayCount.textContent = tray.length ? `(${tray.length})` : '';
    document.querySelectorAll('.section').forEach(section => {
      const group = groups.find(g => String(g.id) === section.dataset.id);
      section.querySelector('.count').textContent = `${group.photos.length} photo${group.photos.length === 1 ? '' : 's'}`;
    });
    if (!busy && !els.status.classList.contains('error')) setStatus(dirty ? 'Unsaved changes' : 'All changes saved');
  }

  function tile(photo) {
    const el = document.createElement('div');
    el.className = 'tile';
    el.draggable = true;
    el.dataset.file = photo.file;
    el.title = photo.file;
    el.style.width = `${Math.round(TILE_HEIGHT * photo.width / photo.height)}px`;
    el.classList.toggle('selected', photo.file === selected);
    const img = document.createElement('img');
    img.src = imageUrl(photo.file);
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    el.append(img);
    return el;
  }

  function sectionEl(group) {
    const el = document.createElement('div');
    el.className = 'section';
    el.dataset.id = group.id;

    const head = document.createElement('div');
    head.className = 'section-head';
    const handle = document.createElement('span');
    handle.className = 'handle';
    handle.textContent = '::';
    handle.title = 'Drag to reorder section';
    handle.draggable = true;
    const title = document.createElement('input');
    title.type = 'text';
    title.placeholder = 'Untitled section (no heading is shown)';
    title.value = group.title;
    title.addEventListener('input', () => { group.title = title.value; updateChrome(); });
    const count = document.createElement('span');
    count.className = 'count';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger';
    remove.textContent = 'Delete';
    remove.title = 'Delete section; its photos become unplaced';
    remove.addEventListener('click', () => {
      if (group.photos.length && !confirm(`Delete this section? Its ${group.photos.length} photos become unplaced.`)) return;
      tray.push(...group.photos);
      groups = groups.filter(g => g !== group);
      render();
    });
    head.append(handle, title, count, remove);

    const photos = document.createElement('div');
    photos.className = 'photos';
    photos.dataset.container = `g:${group.id}`;
    photos.append(...group.photos.map(tile));
    el.append(head, photos);
    return el;
  }

  function renderInspector() {
    const found = selected && findPhoto(selected);
    els.inspector.replaceChildren();
    const heading = document.createElement('h2');
    heading.textContent = 'Photo details';
    els.inspector.append(heading);
    if (!found) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = 'Select a photo to edit its alt text and caption.';
      els.inspector.append(hint);
      return;
    }
    const { photo } = found;
    const preview = document.createElement('img');
    preview.className = 'preview';
    preview.src = imageUrl(photo.file);
    preview.alt = '';
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = `${photo.file} - ${photo.width} x ${photo.height}`;

    const field = (label, control, required) => {
      const wrap = document.createElement('label');
      wrap.className = 'field';
      const span = document.createElement('span');
      span.textContent = label;
      span.classList.toggle('required', Boolean(required));
      wrap.append(span, control);
      return wrap;
    };
    const alt = document.createElement('textarea');
    alt.value = photo.alt;
    alt.placeholder = 'Describe the photo for screen readers';
    alt.addEventListener('input', () => { photo.alt = alt.value; updateChrome(); });
    const caption = document.createElement('input');
    caption.type = 'text';
    caption.value = photo.caption;
    caption.placeholder = 'Optional';
    caption.addEventListener('input', () => { photo.caption = caption.value; updateChrome(); });

    const where = document.createElement('select');
    where.append(new Option('Unplaced', 'tray'));
    groups.forEach((group, index) => where.append(new Option(group.title.trim() || `Section ${index + 1}`, `g:${group.id}`)));
    const current = found.array === tray ? 'tray' : `g:${groups.find(g => g.photos === found.array).id}`;
    where.value = current;
    where.addEventListener('change', () => {
      const array = containerFor(where.value);
      movePhoto(photo.file, array, array.length);
      render();
    });

    els.inspector.append(preview, meta, field('Alt text', alt, true), field('Caption', caption), field('Section', where));
  }

  function render() {
    els.sections.replaceChildren(...groups.map(sectionEl));
    els.tray.replaceChildren(...tray.map(tile));
    renderInspector();
    updateChrome();
  }

  function select(file) {
    selected = file;
    document.querySelectorAll('.tile').forEach(el => el.classList.toggle('selected', el.dataset.file === file));
    renderInspector();
  }

  // Drag and drop

  function clearIndicators() {
    document.querySelectorAll('.drop-before, .drop-after, .drop-end').forEach(el =>
      el.classList.remove('drop-before', 'drop-after', 'drop-end'));
    drop = null;
  }

  function photoTarget(event) {
    const over = event.target.closest('.tile');
    const container = event.target.closest('.photos');
    if (!container) return null;
    const array = containerFor(container.dataset.container);
    if (over) {
      const rect = over.getBoundingClientRect();
      const after = event.clientX > rect.left + rect.width / 2;
      const index = array.findIndex(photo => photo.file === over.dataset.file) + (after ? 1 : 0);
      return { array, index, el: over, side: after ? 'drop-after' : 'drop-before' };
    }
    return { array, index: array.length, el: container, side: 'drop-end' };
  }

  function sectionTarget(event) {
    const over = event.target.closest('.section');
    if (!over) return null;
    const rect = over.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    const index = groups.findIndex(group => String(group.id) === over.dataset.id) + (after ? 1 : 0);
    return { index, el: over, side: after ? 'drop-after' : 'drop-before' };
  }

  function dragKind(event) {
    if (drag) return drag.kind;
    return event.dataTransfer?.types.includes('Files') ? 'files' : null;
  }

  document.addEventListener('dragstart', event => {
    const handle = event.target.closest?.('.handle');
    const el = event.target.closest?.('.tile');
    if (handle) {
      const section = handle.closest('.section');
      drag = { kind: 'section', id: section.dataset.id };
      section.classList.add('dragging');
      event.dataTransfer.setDragImage(section, 20, 20);
    } else if (el) {
      drag = { kind: 'photo', file: el.dataset.file };
      el.classList.add('dragging');
    } else {
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', '');
  });

  document.addEventListener('dragover', event => {
    const kind = dragKind(event);
    if (!kind) return;
    event.preventDefault();
    clearIndicators();
    if (kind === 'files') els.overlay.hidden = false;
    drop = kind === 'section' ? sectionTarget(event) : photoTarget(event);
    drop?.el.classList.add(drop.side);
  });

  document.addEventListener('dragleave', event => {
    if (!event.relatedTarget) { clearIndicators(); els.overlay.hidden = true; }
  });

  function endDrag() {
    drag = null;
    els.overlay.hidden = true;
    clearIndicators();
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
  }

  document.addEventListener('dragend', endDrag);

  document.addEventListener('drop', event => {
    const kind = dragKind(event);
    if (!kind) return;
    event.preventDefault();
    const target = drop;
    const current = drag;
    endDrag();
    if (kind === 'files') {
      uploadFiles([...event.dataTransfer.files], target ?? { array: tray, index: tray.length });
      return;
    }
    if (!target) return;
    if (kind === 'photo') {
      movePhoto(current.file, target.array, target.index);
    } else {
      const from = groups.findIndex(group => String(group.id) === current.id);
      const [moved] = groups.splice(from, 1);
      groups.splice(target.index - (from < target.index ? 1 : 0), 0, moved);
    }
    render();
  });

  // Uploading

  async function uploadFiles(files, target) {
    const images = files.filter(file => file.type.startsWith('image/'));
    if (!images.length) { setStatus('No image files to upload', true); return; }
    busy = true;
    els.save.disabled = true;
    let index = target.index;
    let first = null;
    for (const [number, file] of images.entries()) {
      setStatus(`Uploading ${number + 1} of ${images.length}: ${file.name}`);
      try {
        const stored = await api('POST', `/api/upload?name=${encodeURIComponent(file.name)}`, file);
        target.array.splice(index++, 0, { ...stored, alt: '', caption: '' });
        first ??= stored.file;
      } catch (error) {
        setStatus(`${file.name}: ${error.message}`, true);
        busy = false;
        render();
        return;
      }
    }
    busy = false;
    if (first) selected = first;
    els.status.classList.remove('error');
    render();
  }

  // Saving

  async function save() {
    const lacking = placedPhotos().find(missingAlt);
    if (lacking) {
      select(lacking.file);
      setStatus(`${lacking.file} needs alt text before saving`, true);
      return;
    }
    busy = true;
    els.save.disabled = true;
    setStatus('Saving...');
    try {
      load(await api('PUT', '/api/gallery', JSON.stringify({ groups: payload() }), 'application/json'));
      busy = false;
      els.status.classList.remove('error');
      render();
    } catch (error) {
      busy = false;
      setStatus(error.message, true);
      updateChrome();
    }
  }

  // Wiring

  els.sections.addEventListener('click', event => {
    const el = event.target.closest('.tile');
    if (el) select(el.dataset.file);
  });
  els.tray.addEventListener('click', event => {
    const el = event.target.closest('.tile');
    if (el) select(el.dataset.file);
  });
  els.addSection.addEventListener('click', () => {
    groups.push({ id: nextId++, title: '', photos: [] });
    render();
    const inputs = els.sections.querySelectorAll('.section-head input');
    inputs[inputs.length - 1].focus();
    inputs[inputs.length - 1].scrollIntoView({ block: 'center' });
  });
  els.fileInput.addEventListener('change', () => {
    uploadFiles([...els.fileInput.files], { array: tray, index: tray.length });
    els.fileInput.value = '';
  });
  els.save.addEventListener('click', save);
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault();
      if (!els.save.disabled) save();
    } else if (event.key === 'Delete' && selected && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      const found = findPhoto(selected);
      if (found && found.array !== tray) { movePhoto(selected, tray, tray.length); render(); }
    }
  });
  window.addEventListener('beforeunload', event => {
    if (isDirty()) { event.preventDefault(); event.returnValue = ''; }
  });

  api('GET', '/api/gallery').then(data => { load(data); render(); }).catch(error => setStatus(error.message, true));
})();
