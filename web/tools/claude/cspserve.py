# python3 cspserve.py <site-dir> <port>: serves the preview copy as the artifact host would, roughly:
# the page file wrapped in a skeleton at /, and a CSP like the host's (no WebAssembly, fetch only 'self').
import http.server, sys, os, functools
site, port = sys.argv[1], int(sys.argv[2])
CSP = ("default-src 'none'; script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; "
       "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; "
       "img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; frame-src 'none'")
SKELETON = ('<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">'
            '<style>body{margin:0}</style></head><body>\n{}\n</body></html>')
class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Content-Security-Policy', CSP)
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
    def do_GET(self):
        if self.path.split('?')[0] in ('/', '/index.html'):
            body = SKELETON.replace('{}', open(os.path.join(site, 'page.html')).read()).encode()
            self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body); return
        return super().do_GET()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Handler, directory=site)).serve_forever()
