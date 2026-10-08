"""Local dev server for OceanScope that tells the browser never to cache files,
so edits always show up on reload. Usage: python3 serve.py [port]"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    root = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(NoCacheHandler, directory=root)
    print(f"OceanScope on http://localhost:{port}")
    http.server.ThreadingHTTPServer(("", port), handler).serve_forever()
