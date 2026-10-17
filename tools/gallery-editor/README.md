# Gallery editor

A local tool for arranging `photography/photos.json` visually. It is not part of the site: nothing on the published pages loads it, and the page does nothing without its Python server running.

Run `uv run tools/gallery-editor/server.py` from the repository root, then open `http://127.0.0.1:8770/`. `--port` changes the port and `--open` opens the browser.

## Editing

- Drag a photo to reorder it or move it to another section.
- Drag a section by its `::` handle to reorder sections.
- Select **Add section** to create a section. A section with a blank title shows no heading on the site.
- Select **Delete** on a section to remove it. Its photos move to Unplaced photos.
- Drop image files anywhere on the page, or select **Add photos**, to upload them. A file dropped on a section lands in that section. Otherwise it lands in Unplaced photos.
- Select a photo to edit its alt text, caption, and section. Press Delete to move the selected photo to Unplaced photos.
- Press Save, or Cmd/Ctrl+S, to write `photography/photos.json`.

A red dot on a photo means it has no alt text. The site rejects the whole gallery when any photo lacks alt text, so Save refuses until every placed photo has it.

Unplaced photos are files in `photography/images/` that `photos.json` does not list. Photos moved there lose their alt text and caption when you save.

## What the server does

- Uploads go to `photography/images/`. Files longer than 2000 px are shrunk, and the original is kept in `photography/originals/`, as in `scripts/resize_photos.py`. A name that is already taken gets a numeric suffix.
- Save sets `width` and `height` from the files on disk.
- The server listens on 127.0.0.1 only. It rejects requests with another `Host` header and writes only when the request carries the `X-Gallery-Editor` header, which a web page on another origin cannot send without a preflight the server does not answer.

## Tests

Run `uv run --with pillow python -m unittest tests.test_gallery_editor` from the repository root.
