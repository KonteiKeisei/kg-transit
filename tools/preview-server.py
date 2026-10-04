"""Serve the module at /modules/kg-transit/ (as Foundry does) for tools/preview.html.

    python tools/preview-server.py [port]
    then open http://localhost:8765/modules/kg-transit/tools/preview.html
"""
import http.server
import sys
from functools import partial
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PREFIX = "/modules/kg-transit/"


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript"}

    def end_headers(self):
        # Always fetch fresh, so edits show on reload.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        # Recordings from tools/flight-preview.html: POST /save/<name> into tools/recordings/.
        name = Path(self.path.split("?", 1)[0]).name
        if not self.path.startswith("/save/") or not name:
            self.send_error(404)
            return
        out = ROOT / "tools" / "recordings"
        out.mkdir(exist_ok=True)
        size = int(self.headers.get("Content-Length", 0))
        (out / name).write_bytes(self.rfile.read(size))
        self.send_response(200)
        self.end_headers()
        self.wfile.write(str(out / name).encode())

    def translate_path(self, path):
        path = path.split("?", 1)[0].split("#", 1)[0]
        if path.startswith(PREFIX):
            return str(ROOT / path[len(PREFIX):])
        # A neighbouring module (KG Cities, for its track data), from the folder beside this one.
        parts = path.split("/")
        if len(parts) > 3 and parts[1] == "modules" and parts[2] and ".." not in parts:
            return str(ROOT.parent / parts[2] / "/".join(parts[3:]))
        return str(ROOT / "__missing__")


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
http.server.ThreadingHTTPServer(("127.0.0.1", port), partial(Handler)).serve_forever()
