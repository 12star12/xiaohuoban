# -*- coding: utf-8 -*-
"""小伙伴 · 复习刷题台 —— 桌面启动器

无窗口运行；启动本地静态服务；用系统浏览器的 --app 模式打开独立应用窗口。
所有程序文件、浏览器 profile、日志都在本目录，不写入 C 盘。
"""
import http.server
import socket
import socketserver
import subprocess
import os
import time
import threading
import json
import urllib.request
import urllib.error

BASE = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.join(BASE, 'app')
PROFILE_DIR = os.path.join(BASE, '_profile')
LOG_PATH = os.path.join(BASE, 'launcher.log')
PORT_FILE = os.path.join(BASE, '.port')
PORT_START = 8778
PORT_END = 8827

BROWSERS = [
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
]


def log(msg):
    try:
        with open(LOG_PATH, 'a', encoding='utf-8') as f:
            f.write(time.strftime('%Y-%m-%d %H:%M:%S ') + str(msg) + '\n')
    except Exception:
        pass


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=APP_DIR, **kwargs)

    def log_message(self, fmt, *args):
        pass  # 静默，不弹控制台

    def _plain(self, text, code=200):
        data = text.encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        """大模型 API 转发：浏览器 → 本地服务 → 模型厂商（绕开浏览器跨域限制）"""
        path = self.path.split('?', 1)[0]
        if path != '/api/llm':
            self.send_error(404)
            return
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(length).decode('utf-8'))
            endpoint = body.get('endpoint', '')
            api_key = body.get('apiKey', '')
            payload = body.get('payload', {})

            if not endpoint.startswith('https://'):
                raise ValueError('endpoint 必须是 https 地址')

            # ensure_ascii=False：中文按 UTF-8 原样发送，体积约为转义写法的 1/2
            body_bytes = json.dumps(payload, ensure_ascii=False).encode('utf-8')
            req = urllib.request.Request(
                endpoint,
                data=body_bytes,
                headers={
                    'Content-Type': 'application/json; charset=utf-8',
                    'Authorization': 'Bearer ' + api_key,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                },
                method='POST'
            )
            # 本机安全软件可能在连接建立后中断请求，做两次重试
            last_err = None
            data = None
            code = 0
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(req, timeout=180) as resp:
                        data = resp.read()
                        code = resp.status
                    last_err = None
                    break
                except urllib.error.HTTPError:
                    raise
                except Exception as e:
                    last_err = e
                    log('llm proxy retry %d: %r (body %d bytes)' % (attempt + 1, e, len(body_bytes)))
                    time.sleep(0.6 * (attempt + 1))
            if last_err is not None:
                raise last_err
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(data)
            log('llm proxy ok: %s (%d bytes)' % (endpoint, len(data)))

        except urllib.error.HTTPError as e:
            # 把厂商的错误响应（401/429/404 等）原样回传，前端能显示具体原因
            data = e.read()
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(data)
            log('llm proxy HTTP error: %s' % e.code)
        except Exception as e:
            text = str(e)
            if '10053' in text or '10054' in text or 'aborted' in text.lower():
                text = ('服务商在接收请求的过程中断开了连接。最常见的原因是 API Key 无效或已过期'
                        '（服务端核对后提前关闭），也可能是请求体积过大。'
                        '请先到「设置」确认 Key 是否正确，再重试。')
            elif '10060' in text or 'timed out' in text.lower():
                text = '连接超时，请检查网络或稍后重试。'
            msg = json.dumps({'error': {'message': '模型调用失败：' + text}}, ensure_ascii=False).encode('utf-8')
            self.send_response(502)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(msg)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(msg)
            log('llm proxy error: %r' % (e,))

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/__ping':
            return self._plain('pong')
        if path == '/__proxy':
            # 前端探测：桌面版有本地转发，网页版没有
            return self._plain('proxy-ok')
        if path == '/__quit':
            self._plain('bye')
            # shutdown 必须从不同于 serve_forever 的线程调用
            threading.Thread(target=self.server.shutdown, daemon=True).start()
            return
        return super().do_GET()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def find_running():
    """若本应用已在运行，返回其端口（读标记文件，快速且准确）"""
    try:
        with open(PORT_FILE, 'r', encoding='utf-8') as f:
            port = int(f.read().strip())
        with urllib.request.urlopen('http://127.0.0.1:%d/__ping' % port, timeout=0.6) as r:
            if r.read(4) == b'pong':
                return port
    except Exception:
        pass
    return None


def pick_port():
    for p in range(PORT_START, PORT_END + 1):
        s = socket.socket()
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(('127.0.0.1', p))
            s.close()
            return p
        except OSError:
            s.close()
    return None


def open_window(url):
    exe = next((b for b in BROWSERS if os.path.exists(b)), None)
    if not exe:
        log('ERROR: no browser found')
        return
    os.makedirs(PROFILE_DIR, exist_ok=True)
    args = [
        exe,
        '--app=' + url,
        '--user-data-dir=' + PROFILE_DIR,
        '--window-size=1280,900',
        '--no-first-run',
        '--no-default-browser-check',
    ]
    subprocess.Popen(args, close_fds=True)
    log('opened window: ' + url)


def main():
    log('--- launch ---')
    os.makedirs(APP_DIR, exist_ok=True)

    existing = find_running()
    if existing:
        log('reuse existing instance on port %d' % existing)
        open_window('http://127.0.0.1:%d/index.html?desktop=1' % existing)
        return

    port = pick_port()
    if not port:
        log('ERROR: no free port')
        return

    url = 'http://127.0.0.1:%d/index.html?desktop=1' % port
    try:
        srv = Server(('127.0.0.1', port), Handler)
    except Exception as e:
        log('ERROR server: %r' % (e,))
        return

    with open(PORT_FILE, 'w', encoding='utf-8') as f:
        f.write(str(port))

    open_window(url)
    log('server listening on 127.0.0.1:%d' % port)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()
        try:
            os.remove(PORT_FILE)
        except Exception:
            pass
        log('--- exited ---')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        log('FATAL: %r' % (e,))
