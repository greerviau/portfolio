#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10"]
# ///
"""Resize photos in photography/images and sync their dimensions into photos.json.

Images whose long edge exceeds --max-edge are shrunk in place. The original is
copied to photography/originals/ first (gitignored), and an existing backup is
never overwritten. EXIF orientation is applied to the pixels so that the stored
width and height match what browsers display.

Every photo listed in photos.json then gets its width and height set from the
file on disk. With --check nothing is written; the exit code is 1 when any image
is oversized or any dimension is stale.
"""

import argparse
import json
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
IMAGES = ROOT / "photography" / "images"
ORIGINALS = ROOT / "photography" / "originals"
MANIFEST = ROOT / "photography" / "photos.json"
SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


def displayed_size(path: Path) -> tuple[int, int]:
    with Image.open(path) as img:
        return ImageOps.exif_transpose(img).size


def resize(path: Path, max_edge: int, quality: int) -> None:
    ORIGINALS.mkdir(exist_ok=True)
    backup = ORIGINALS / path.name
    if not backup.exists():
        shutil.copy2(path, backup)
    with Image.open(path) as img:
        icc = img.info.get("icc_profile")
        out = ImageOps.exif_transpose(img)
        out.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        options = {"icc_profile": icc} if icc else {}
        if path.suffix.lower() in {".jpg", ".jpeg", ".webp"}:
            options.update(quality=quality)
        if path.suffix.lower() in {".jpg", ".jpeg"}:
            options.update(optimize=True, progressive=True)
        out.save(path, **options)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--max-edge", type=int, default=2000, help="longest side in pixels (default 2000)")
    parser.add_argument("--quality", type=int, default=85, help="JPEG and WebP quality (default 85)")
    parser.add_argument("--check", action="store_true", help="report problems and exit 1 without writing")
    args = parser.parse_args()

    findings = []  # fixable by a normal run
    errors = []  # need manual action
    for path in sorted(IMAGES.iterdir()):
        if path.name.startswith("."):
            continue
        if path.suffix.lower() not in SUFFIXES:
            print(f"skip {path.name}: unsupported format")
            continue
        width, height = displayed_size(path)
        if max(width, height) <= args.max_edge:
            continue
        findings.append(f"{path.name}: {width}x{height} exceeds {args.max_edge}px")
        if not args.check:
            resize(path, args.max_edge, args.quality)
            print(f"resized {path.name}: {width}x{height} -> {'x'.join(map(str, displayed_size(path)))}")

    manifest = json.loads(MANIFEST.read_text())
    stale = False
    for group in manifest:
        for photo in group["photos"]:
            path = IMAGES / photo["file"]
            if not path.exists():
                errors.append(f"{photo['file']}: listed in photos.json but missing from images/")
                continue
            width, height = displayed_size(path)
            if (photo.get("width"), photo.get("height")) != (width, height):
                findings.append(f"{photo['file']}: photos.json has {photo.get('width')}x{photo.get('height')}, file is {width}x{height}")
                photo["width"], photo["height"] = width, height
                stale = True
    if stale and not args.check:
        MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
        print("updated photos.json dimensions")

    for line in errors:
        print(line)
    if args.check:
        for line in findings:
            print(line)
        if findings:
            print("run scripts/resize_photos.py to fix")
        return 1 if findings or errors else 0
    if not findings:
        print("nothing to do")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
