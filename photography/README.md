# Photography

Add image files to `photography/images/`, then list them in groups in `photography/photos.json`.
Use filenames without directory paths. JPEG, PNG, WebP, and AVIF files work in modern browsers.
Run `uv run scripts/resize_photos.py` after adding photos.
It shrinks any image whose long edge exceeds 2000 pixels, copies the original to `photography/originals/` (gitignored), and sets `width` and `height` in `photos.json` from the files.
The thumbnails load the same files as the full gallery, so large files slow both pages.
`--max-edge` and `--quality` change the size limit and the JPEG and WebP quality.
`--check` writes nothing and exits 1 when an image is oversized or a dimension is stale.
Run `git config core.hooksPath .githooks` once per clone to make `git commit` resize oversized photos, restage them, and then run that check.

`tools/gallery-editor/` offers a visual editor for this file; see its README.

Each group requires a `photos` list and accepts an optional `title`.
Omit `title`, or leave it blank, to display a group without a heading.
A divider and extra spacing separate groups even when they have no titles.
Empty groups do not appear.

Each photo requires `file` and descriptive `alt` text. `caption` is optional.
For files named `mountains.jpg` and `street.jpg`, the list could be:

```json
[
  {
    "title": "Japan - January 2026",
    "photos": [
      {
        "file": "mountains.jpg",
        "alt": "Snow-covered mountains above a lake",
        "caption": "Mountains at sunrise",
        "width": 3000,
        "height": 2000
      }
    ]
  },
  {
    "photos": [
      {
        "file": "street.jpg",
        "alt": "A narrow street lit by restaurant signs",
        "width": 2000,
        "height": 3000
      }
    ]
  }
]
```

Groups appear in list order.
The homepage shows one row: the photos from the start of the first group with photos that fit on a single row, with that group's title when provided.
That is a landscape and a portrait in list order, or three portraits, and on phones one landscape or two portraits.
The gallery shows all photos and preserves their aspect ratios.
Photos appear in list order, and the layout never reorders them.
A landscape spans two portrait columns, including the gap between them, so a desktop row holds three portraits, or a landscape and a portrait in either order.
Place a landscape and a portrait next to each other in the list to share a row.
A photo that does not fit the space left in a row starts the next row, and incomplete rows are centered.
Photos from different groups never share a row.
On phones, landscape photos fill the row and portraits fit two per row.
Photos are vertically centered in each row.

Optional `width` and `height` fields specify the image dimensions in pixels.
Width greater than height identifies a landscape; other photos use a portrait tile.
These fields let the browser reserve space and size tiles before images load.
Without them, the layout updates when the image loads.
Select a photo to open its image file. Use the browser's Back button to return.
An empty list, or groups containing no photos, displays "Photos coming soon." on both pages.

Run `python3 -m http.server 8765` from the repository root to preview the site at `http://localhost:8765`.
Open `/tests/photography.html` on that server to run the browser tests.
The tests supply their own photo lists and do not require images in the collection.
