import io
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "tools" / "gallery-editor"))
import server  # noqa: E402

HEADERS = {"X-Gallery-Editor": "1"}


def size(path):
    with Image.open(path) as img:
        return img.size


def jpeg(width, height):
    buf = io.BytesIO()
    Image.new("RGB", (width, height), "gray").save(buf, "JPEG")
    return buf.getvalue()


class EditorTestCase(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.images = self.root / "photography" / "images"
        self.images.mkdir(parents=True)
        self.manifest = self.root / "photography" / "photos.json"
        httpd = server.make_server(self.root, port=0, quiet=True)
        self.port = httpd.server_address[1]
        thread = threading.Thread(target=httpd.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        thread.start()
        self.addCleanup(thread.join)
        self.addCleanup(httpd.server_close)
        self.addCleanup(httpd.shutdown)

    def add_image(self, name, width, height):
        (self.images / name).write_bytes(jpeg(width, height))

    def request(self, method, path, body=None, headers=None, host=None):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}", data=body, method=method)
        for key, value in (headers if headers is not None else HEADERS).items():
            req.add_header(key, value)
        if host:
            req.remove_header("Host")
            req.add_header("Host", host)
        try:
            with urllib.request.urlopen(req) as res:
                return res.status, res.read()
        except urllib.error.HTTPError as err:
            return err.code, err.read()

    def put(self, groups, **kwargs):
        headers = {**HEADERS, "Content-Type": "application/json"} if "headers" not in kwargs else kwargs.pop("headers")
        return self.request("PUT", "/api/gallery", json.dumps({"groups": groups}).encode(), headers, **kwargs)


class ReadGalleryTest(EditorTestCase):
    def test_returns_groups_and_lists_images_missing_from_the_manifest(self):
        self.add_image("a.jpg", 300, 200)
        self.add_image("b.jpg", 200, 300)
        groups = [{"title": "Japan", "photos": [{"file": "a.jpg", "alt": "A", "width": 300, "height": 200}]}]
        self.manifest.write_text(json.dumps(groups))
        status, body = self.request("GET", "/api/gallery")
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertEqual(data["groups"], groups)
        self.assertEqual(data["unlisted"], [{"file": "b.jpg", "width": 200, "height": 300}])

    def test_missing_manifest_reads_as_no_groups(self):
        status, body = self.request("GET", "/api/gallery")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"groups": [], "unlisted": []})

    def test_serves_images_but_not_paths_outside_the_images_folder(self):
        self.add_image("a.jpg", 30, 20)
        (self.root / "secret.txt").write_text("secret")
        status, body = self.request("GET", "/images/a.jpg")
        self.assertEqual((status, body[:2]), (200, b"\xff\xd8"))
        for path in ("/images/..%2F..%2Fsecret.txt", "/images/../../secret.txt", "/images/missing.jpg"):
            self.assertEqual(self.request("GET", path)[0], 404, path)


class SaveGalleryTest(EditorTestCase):
    def test_writes_normalized_manifest_with_dimensions_read_from_disk(self):
        self.add_image("a.jpg", 300, 200)
        groups = [
            {"title": "  Japan  ", "photos": [{"file": "a.jpg", "alt": "A", "caption": "Cap", "width": 1, "height": 1}]},
            {"title": "   ", "photos": []},
        ]
        status, body = self.put(groups)
        self.assertEqual(status, 200)
        expected = [
            {"title": "Japan", "photos": [{"file": "a.jpg", "alt": "A", "caption": "Cap", "width": 300, "height": 200}]},
            {"photos": []},
        ]
        self.assertEqual(json.loads(body)["groups"], expected)
        text = self.manifest.read_text()
        self.assertEqual(json.loads(text), expected)
        self.assertTrue(text.endswith("]\n"))
        self.assertIn('\n  {\n    "title": "Japan"', text)

    def test_blank_caption_is_dropped(self):
        self.add_image("a.jpg", 30, 20)
        status, body = self.put([{"photos": [{"file": "a.jpg", "alt": "A", "caption": "  "}]}])
        self.assertEqual(status, 200)
        self.assertNotIn("caption", json.loads(body)["groups"][0]["photos"][0])

    def test_rejects_invalid_galleries_without_touching_the_manifest(self):
        self.add_image("a.jpg", 30, 20)
        self.manifest.write_text("[]")
        photo = {"file": "a.jpg", "alt": "A"}
        cases = {
            "groups not a list": None,
            "group not an object": ["x"],
            "title not a string": [{"title": 3, "photos": []}],
            "photos not a list": [{"photos": "x"}],
            "blank alt": [{"photos": [{**photo, "alt": " "}]}],
            "missing alt": [{"photos": [{"file": "a.jpg"}]}],
            "caption not a string": [{"photos": [{**photo, "caption": 1}]}],
            "file missing on disk": [{"photos": [{**photo, "file": "nope.jpg"}]}],
            "path in file name": [{"photos": [{**photo, "file": "../a.jpg"}]}],
            "nested path in file name": [{"photos": [{**photo, "file": "sub/a.jpg"}]}],
            "same file twice": [{"photos": [photo, photo]}],
        }
        for name, groups in cases.items():
            with self.subTest(name):
                status, body = self.put(groups)
                self.assertEqual(status, 400)
                self.assertTrue(json.loads(body)["error"])
                self.assertEqual(self.manifest.read_text(), "[]")

    def test_rejects_requests_that_a_web_page_on_another_origin_could_send(self):
        self.add_image("a.jpg", 30, 20)
        self.manifest.write_text("[]")
        body = json.dumps({"groups": [{"photos": [{"file": "a.jpg", "alt": "A"}]}]}).encode()
        no_marker = {"Content-Type": "application/json"}
        self.assertEqual(self.request("PUT", "/api/gallery", body, no_marker)[0], 403)
        self.assertEqual(self.request("PUT", "/api/gallery", body, {**HEADERS, "Content-Type": "application/json"}, host="evil.example")[0], 403)
        self.assertEqual(self.request("GET", "/api/gallery", host="evil.example")[0], 403)
        self.assertEqual(self.manifest.read_text(), "[]")


class UploadTest(EditorTestCase):
    def upload(self, name, data, headers=None):
        return self.request("POST", f"/api/upload?name={name}", data, headers)

    def test_stores_small_image_unchanged_and_reports_its_dimensions(self):
        status, body = self.upload("new.jpg", jpeg(300, 200))
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"file": "new.jpg", "width": 300, "height": 200})
        self.assertEqual(size(self.images / "new.jpg"), (300, 200))

    def test_shrinks_oversized_image_and_keeps_the_original(self):
        status, body = self.upload("big.jpg", jpeg(3000, 1500))
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {"file": "big.jpg", "width": 2000, "height": 1000})
        self.assertEqual(size(self.images / "big.jpg"), (2000, 1000))
        self.assertEqual(size(self.root / "photography" / "originals" / "big.jpg"), (3000, 1500))

    def test_renames_instead_of_overwriting_an_existing_file(self):
        self.add_image("dup.jpg", 30, 20)
        status, body = self.upload("dup.jpg", jpeg(60, 40))
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["file"], "dup-1.jpg")
        self.assertEqual(size(self.images / "dup.jpg"), (30, 20))

    def test_strips_directories_from_the_uploaded_name(self):
        status, body = self.upload("..%2F..%2Fevil.jpg", jpeg(30, 20))
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["file"], "evil.jpg")
        self.assertTrue((self.images / "evil.jpg").exists())
        self.assertFalse((self.root / "evil.jpg").exists())

    def test_rejects_unsupported_names_and_data_that_is_not_an_image(self):
        self.assertEqual(self.upload("notes.txt", b"hello")[0], 400)
        self.assertEqual(self.upload("fake.jpg", b"not an image")[0], 400)
        self.assertEqual(self.upload("", jpeg(30, 20))[0], 400)
        self.assertEqual([p.name for p in self.images.iterdir()], [])

    def test_rejects_uploads_without_the_editor_header(self):
        self.assertEqual(self.upload("a.jpg", jpeg(30, 20), headers={})[0], 403)
        self.assertEqual(list(self.images.iterdir()), [])


class StaticFilesTest(EditorTestCase):
    def test_serves_the_editor_page(self):
        status, body = self.request("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn(b"<title>Gallery editor</title>", body)


if __name__ == "__main__":
    unittest.main()
