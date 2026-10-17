#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow>=10"]
# ///
"""Local editor for photography/photos.json.

Serves a drag-and-drop editor on 127.0.0.1. The editor reads and writes
photography/photos.json, uploads new photos into photography/images (shrinking
them like scripts/resize_photos.py), and is not part of the published site.
"""

import argparse
import io
import json
import sys
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.parse import parse_qs, unquote, urlsplit

from PIL import Image

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(REPO / "scripts"))
import resize_photos  # noqa: E402

MAX_UPLOAD_BYTES = 200 * 1024 * 1024
STATIC = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/editor.js": ("editor.js", "text/javascript; charset=utf-8"),
    "/editor.css": ("editor.css", "text/css; charset=utf-8"),
}
IMAGE_TYPES = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}


class RequestError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def displayed_size(path):
    return resize_photos.displayed_size(path)


def read_manifest(manifest):
    if not manifest.exists():
        return []
    try:
        return json.loads(manifest.read_text())
    except json.JSONDecodeError as err:
        raise RequestError(HTTPStatus.INTERNAL_SERVER_ERROR, f"photos.json is not valid JSON: {err}")


def list_unlisted(images, groups):
    listed = {photo["file"] for group in groups for photo in group["photos"]}
    result = []
    for path in sorted(images.iterdir()):
        if path.name.startswith(".") or path.suffix.lower() not in IMAGE_TYPES or path.name in listed:
            continue
        width, height = displayed_size(path)
        result.append({"file": path.name, "width": width, "height": height})
    return result


def normalize_gallery(groups, images):
    """Validate like photography/gallery.js and return groups with dimensions read from disk."""
    if not isinstance(groups, list):
        raise RequestError(HTTPStatus.BAD_REQUEST, "groups must be a list")
    seen = set()
    result = []
    for number, group in enumerate(groups, 1):
        if not isinstance(group, dict):
            raise RequestError(HTTPStatus.BAD_REQUEST, f"Section {number} must be an object")
        title = group.get("title")
        if title is not None and not isinstance(title, str):
            raise RequestError(HTTPStatus.BAD_REQUEST, f"Section {number}: title must be text")
        if not isinstance(group.get("photos"), list):
            raise RequestError(HTTPStatus.BAD_REQUEST, f"Section {number}: photos must be a list")
        photos = []
        for photo in group["photos"]:
            if not isinstance(photo, dict) or not isinstance(photo.get("file"), str):
                raise RequestError(HTTPStatus.BAD_REQUEST, f"Section {number}: each photo needs a file name")
            file = photo["file"].strip()
            if not file or file != PurePosixPath(file).name or file.startswith(".") or "\\" in file:
                raise RequestError(HTTPStatus.BAD_REQUEST, f"{file or 'A photo'}: file must be a name without directories")
            if file in seen:
                raise RequestError(HTTPStatus.BAD_REQUEST, f"{file} appears more than once")
            seen.add(file)
            if not (images / file).is_file():
                raise RequestError(HTTPStatus.BAD_REQUEST, f"{file} is not in photography/images")
            alt = photo.get("alt")
            if not isinstance(alt, str) or not alt.strip():
                raise RequestError(HTTPStatus.BAD_REQUEST, f"{file} needs alt text")
            caption = photo.get("caption")
            if caption is not None and not isinstance(caption, str):
                raise RequestError(HTTPStatus.BAD_REQUEST, f"{file}: caption must be text")
            width, height = displayed_size(images / file)
            entry = {"file": file, "alt": alt.strip()}
            if caption and caption.strip():
                entry["caption"] = caption.strip()
            entry.update(width=width, height=height)
            photos.append(entry)
        entry = {}
        if title and title.strip():
            entry["title"] = title.strip()
        entry["photos"] = photos
        result.append(entry)
    return result


def write_manifest(manifest, groups):
    tmp = manifest.with_name(manifest.name + ".tmp")
    tmp.write_text(json.dumps(groups, indent=2, ensure_ascii=False) + "\n")
    tmp.replace(manifest)


def store_upload(name, data, images, originals):
    name = PurePosixPath(name.replace("\\", "/")).name
    path = Path(name)
    if not path.stem or name.startswith(".") or path.suffix.lower() not in IMAGE_TYPES:
        raise RequestError(HTTPStatus.BAD_REQUEST, "Use a JPEG, PNG, or WebP file with a name")
    try:
        with Image.open(io.BytesIO(data)) as img:
            img.verify()
    except Exception:
        raise RequestError(HTTPStatus.BAD_REQUEST, f"{name} is not a readable image")
    target = images / name
    counter = 0
    while target.exists():
        counter += 1
        target = images / f"{path.stem}-{counter}{path.suffix}"
    target.write_bytes(data)
    width, height = displayed_size(target)
    if max(width, height) > resize_photos.MAX_EDGE:
        resize_photos.resize(target, originals=originals)
        width, height = displayed_size(target)
    return {"file": target.name, "width": width, "height": height}


def make_server(root, port=8770, quiet=False):
    root = Path(root)
    images = root / "photography" / "images"
    originals = root / "photography" / "originals"
    manifest = root / "photography" / "photos.json"

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            if not quiet and (self.command != "GET" or self.path.startswith("/api/")):
                super().log_message(fmt, *args)

        def send_bytes(self, status, body, content_type, cache="no-store"):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", cache)
            self.end_headers()
            self.wfile.write(body)

        def send_json(self, status, payload):
            self.send_bytes(status, json.dumps(payload).encode(), "application/json")

        def check_local(self, mutating):
            host = self.headers.get("Host", "")
            name, _, host_port = host.rpartition(":")
            if name not in ("127.0.0.1", "localhost") or host_port != str(self.server.server_address[1]):
                raise RequestError(HTTPStatus.FORBIDDEN, "Unexpected Host header")
            if mutating and self.headers.get("X-Gallery-Editor") != "1":
                raise RequestError(HTTPStatus.FORBIDDEN, "Missing X-Gallery-Editor header")

        def read_body(self):
            try:
                length = int(self.headers.get("Content-Length", ""))
            except ValueError:
                raise RequestError(HTTPStatus.LENGTH_REQUIRED, "Content-Length required")
            if length > MAX_UPLOAD_BYTES:
                raise RequestError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Upload is too large")
            return self.rfile.read(length)

        def handle_request(self):
            try:
                url = urlsplit(self.path)
                mutating = self.command != "GET"
                self.check_local(mutating)
                route = (self.command, url.path)
                if route == ("GET", "/api/gallery"):
                    groups = read_manifest(manifest)
                    self.send_json(200, {"groups": groups, "unlisted": list_unlisted(images, groups)})
                elif route == ("PUT", "/api/gallery"):
                    try:
                        groups = json.loads(self.read_body())["groups"]
                    except (json.JSONDecodeError, KeyError, TypeError):
                        raise RequestError(HTTPStatus.BAD_REQUEST, 'Body must be {"groups": [...]}')
                    groups = normalize_gallery(groups, images)
                    write_manifest(manifest, groups)
                    self.send_json(200, {"groups": groups, "unlisted": list_unlisted(images, groups)})
                elif route == ("POST", "/api/upload"):
                    name = parse_qs(url.query).get("name", [""])[0]
                    images.mkdir(parents=True, exist_ok=True)
                    self.send_json(200, store_upload(name, self.read_body(), images, originals))
                elif self.command == "GET" and url.path in STATIC:
                    filename, content_type = STATIC[url.path]
                    self.send_bytes(200, (HERE / filename).read_bytes(), content_type)
                elif self.command == "GET" and url.path.startswith("/images/"):
                    name = unquote(url.path[len("/images/"):])
                    path = images / name
                    if name != PurePosixPath(name).name or not path.is_file():
                        raise RequestError(HTTPStatus.NOT_FOUND, "Not found")
                    content_type = IMAGE_TYPES.get(path.suffix.lower(), "application/octet-stream")
                    self.send_bytes(200, path.read_bytes(), content_type, cache="no-cache")
                else:
                    raise RequestError(HTTPStatus.NOT_FOUND, "Not found")
            except RequestError as err:
                self.send_json(err.status, {"error": str(err)})

        do_GET = do_PUT = do_POST = handle_request

    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--port", type=int, default=8770)
    parser.add_argument("--open", action="store_true", help="open the editor in the default browser")
    args = parser.parse_args()
    httpd = make_server(REPO, args.port)
    url = f"http://127.0.0.1:{httpd.server_address[1]}/"
    print(f"Gallery editor running at {url} (Ctrl+C to stop)")
    if args.open:
        webbrowser.open(url)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
