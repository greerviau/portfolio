# Photography

Add image files to `photography/images/`, then list them in `photography/photos.json`.
Use filenames without directory paths. JPEG, PNG, WebP, and AVIF files work in modern browsers.
Resize and compress photos before committing them because the thumbnails load the same files as the full gallery.

Each entry requires `file` and descriptive `alt` text. `caption` is optional.
For a file named `mountains.jpg`, an entry could be:

```json
[
  {
    "file": "mountains.jpg",
    "alt": "Snow-covered mountains above a lake",
    "caption": "Mountains at sunrise"
  }
]
```

The homepage selects the first three entries from the list.
The gallery shows all entries and preserves their aspect ratios.
Desktop rows contain a landscape and a portrait, or three portraits.
The layout may move a later portrait forward to pair it with a landscape.
Landscape photos span two portrait columns, including the gap between them.
When a partner is unavailable, the remaining photos occupy centered partial rows.
On phones, landscape photos fill the row and portraits fit two per row.
Photos are vertically centered in each row, and incomplete rows are centered horizontally.
The homepage uses the same layout without cropping photos.

Optional `width` and `height` fields specify the image dimensions in pixels.
Width greater than height identifies a landscape; other photos use a portrait tile.
These fields let the browser reserve space and arrange rows before images load.
Without them, the layout updates when the image loads.
Select a photo to open its image file. Use the browser's Back button to return.
An empty list displays "Photos coming soon." on both pages.

Run `python3 -m http.server 8765` from the repository root to preview the site at `http://localhost:8765`.
Open `/tests/photography.html` on that server to run the browser tests.
The tests supply their own photo lists and do not require images in the collection.
