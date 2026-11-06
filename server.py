#!/usr/bin/env python3
"""Local server for the practice tool.

Serves the app's static files, and proxies /yatta/<path> to bdon.yatta.moe while
keeping a copy of everything under data/, so songs that were opened (or downloaded
with the in-app "download all") keep working offline.
"""
import argparse
import json
import mimetypes
import os
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urljoin, urlsplit

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, 'web')     # the app itself (also bundled into the iOS app)
DATA = os.path.join(ROOT, 'data')
LOGS = os.path.join(ROOT, 'logs')     # judgement logs posted by the page
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
UPSTREAM = 'https://bdon.yatta.moe/Resources/en/'

mimetypes.add_type('audio/ogg', '.opus')
mimetypes.add_type('image/webp', '.webp')
mimetypes.add_type('text/javascript', '.js')
mimetypes.add_type('application/wasm', '.wasm')


def network_first(path):
    # metadata that changes when songs are added; everything else is immutable enough
    return path == 'MasterParsed/songs.json' or path.startswith('MasterParsed/songs/')


def upstream_url(path):
    # _static/<x> is yatta's shared Resources/static/<x> (note skin), a sibling of the en/ tree
    if path.startswith('_static/'):
        return urljoin(UPSTREAM, '../static/' + path[len('_static/'):])
    return UPSTREAM + path


def fetch_upstream(path, timeout, tries=2):
    req = urllib.request.Request(upstream_url(path), headers={'User-Agent': UA})
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError:
            raise
        except (urllib.error.URLError, OSError):
            if i == tries - 1:
                raise


def save(local, body):
    os.makedirs(os.path.dirname(local), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(local))
    with os.fdopen(fd, 'wb') as f:
        f.write(body)
    os.replace(tmp, local)


POOL = ThreadPoolExecutor(max_workers=4)
INFLIGHT = {}
INFLIGHT_LOCK = threading.Lock()


def refresh(path, local):
    """Background re-download of a cached file; one in flight per path."""
    def run():
        try:
            body = fetch_upstream(path, timeout=15, tries=1)
            save(local, body)
            return body
        finally:
            with INFLIGHT_LOCK:
                INFLIGHT.pop(path, None)
    with INFLIGHT_LOCK:
        if path not in INFLIGHT:
            INFLIGHT[path] = POOL.submit(run)
        return INFLIGHT[path]


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=WEB, **kw)

    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError):
            pass   # the browser gave up on a request (e.g. a lazy image scrolled away)

    def log_message(self, fmt, *args):
        if self.server.verbose:
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def send_bytes(self, body, ctype, code=200):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def send_json(self, obj, code=200):
        self.send_bytes(json.dumps(obj).encode(), 'application/json', code)

    def do_POST(self):
        # judgement logs from the page, one file per attempt
        if unquote(urlsplit(self.path).path) != '/api/log':
            return self.send_json({'error': 'not found'}, 404)
        n = int(self.headers.get('Content-Length') or 0)
        if not 0 < n <= 4 << 20:
            return self.send_json({'error': 'bad size'}, 400)
        body = self.rfile.read(n)
        try:
            json.loads(body)
        except ValueError:
            return self.send_json({'error': 'bad json'}, 400)
        os.makedirs(LOGS, exist_ok=True)
        name = time.strftime('%Y%m%d-%H%M%S') + '-%03d.json' % (time.time() * 1000 % 1000)
        with open(os.path.join(LOGS, name), 'wb') as f:
            f.write(body)
        self.send_json({'saved': name})

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if path.startswith('/yatta/'):
            return self.proxy(path[len('/yatta/'):])
        if path == '/api/cached':
            return self.cached()
        if path == '/api/offline':
            return self.offline()
        return super().do_GET()

    def proxy(self, path):
        parts = path.split('/')
        if not path or any(p in ('', '.', '..') for p in parts):
            return self.send_json({'error': 'bad path'}, 400)
        local = os.path.join(DATA, *parts)
        ctype = mimetypes.guess_type(local)[0] or 'application/octet-stream'
        have = os.path.isfile(local)
        if have:
            if network_first(path):
                # try to refresh, but never keep the page waiting on a bad connection
                # (urlopen's timeout does not cover DNS or a slowly trickling response)
                try:
                    return self.send_bytes(refresh(path, local).result(timeout=3), ctype)
                except Exception:
                    pass
            with open(local, 'rb') as f:
                return self.send_bytes(f.read(), ctype)
        try:
            body = fetch_upstream(path, timeout=30)
            save(local, body)
            return self.send_bytes(body, ctype)
        except (urllib.error.URLError, OSError) as e:
            # 404 from yatta passes through; anything else means we could not get it right now
            code = e.code if isinstance(e, urllib.error.HTTPError) and e.code < 500 else 504
            return self.send_json({'error': 'offline and not cached', 'detail': str(e)}, code)

    def cached(self):
        out = []
        for base, _, files in os.walk(DATA):
            for name in files:
                if not name.startswith('tmp'):
                    out.append(os.path.relpath(os.path.join(base, name), DATA).replace(os.sep, '/'))
        self.send_json(out)

    def offline(self):
        # per song: how many of its files (detail, jacket, audio, charts) are on disk
        out = {}
        songs = os.path.join(DATA, 'MasterParsed', 'songs')
        for name in os.listdir(songs) if os.path.isdir(songs) else []:
            if not name.endswith('.json'):
                continue
            try:
                with open(os.path.join(songs, name), encoding='utf-8') as f:
                    s = json.load(f)
                need = ['Assets/AddressableResources/Image/Jacket/%s.webp' % s['jacket'],
                        'Assets/AddressableResources/Cri/Sound/MusicScore/%s.opus' % s['filename']]
                need += ['Assets/AddressableResources/Live/MusicScore/%s.json' % m['filename'] for m in s['meta']]
            except (OSError, ValueError, KeyError, TypeError):
                continue
            have = sum(os.path.isfile(os.path.join(DATA, *p.split('/'))) for p in need)
            out[name[:-5]] = {'have': have + 1, 'need': len(need) + 1}
        self.send_json(out)


def main():
    global UPSTREAM
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8000)
    ap.add_argument('--bind', default='0.0.0.0')
    ap.add_argument('--upstream', default=UPSTREAM, help='for testing offline behaviour')
    ap.add_argument('-v', '--verbose', action='store_true')
    args = ap.parse_args()
    UPSTREAM = args.upstream
    ThreadingHTTPServer.request_queue_size = 128   # default backlog of 5 resets connections when a page loads many files at once
    ThreadingHTTPServer.daemon_threads = True
    srv = ThreadingHTTPServer((args.bind, args.port), Handler)
    srv.verbose = args.verbose
    print(f'serving {WEB} on http://localhost:{args.port}', flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == '__main__':
    main()
