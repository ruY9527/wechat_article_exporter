# -*- coding: utf-8 -*-
"""CDP 连接辅助：连接带 --remote-debugging-port 的 Chrome"""
import base64
import json
import time
import urllib.parse
import urllib.request

import websocket

PORT = 9222


def _req(path, method="GET"):
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}{path}", method=method)
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode("utf-8") or "{}")


def version():
    return _req("/json/version")


def targets():
    return [t for t in _req("/json") if t.get("type") == "page"]


def new_tab(url="about:blank"):
    return _req("/json/new?" + urllib.parse.quote(url, safe=""), method="PUT")


def close_tab(tid):
    try:
        _req("/json/close/" + tid, method="GET")
    except Exception:
        pass


class Tab:
    """单个标签页的 CDP 会话"""

    def __init__(self, ws_url):
        self.ws = websocket.create_connection(ws_url, timeout=60, max_size=128 * 1024 * 1024)
        self.i = 0
        self.id = None

    @classmethod
    def open(cls, url="about:blank", navigate=False):
        t = new_tab(url if navigate else "about:blank")
        tab = cls(t["webSocketDebuggerUrl"])
        tab.id = t["id"]
        tab.send("Page.enable")
        tab.send("Runtime.enable")
        if navigate:
            tab.goto(url)
        return tab

    def send(self, method, params=None, timeout=60):
        self.i += 1
        mid = self.i
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        end = time.time() + timeout
        while time.time() < end:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})
        raise TimeoutError(method)

    def js(self, expr, timeout=60):
        r = self.send("Runtime.evaluate", {
            "expression": expr, "returnByValue": True,
            "awaitPromise": True, "userGesture": True,
        }, timeout=timeout)
        if r.get("exceptionDetails"):
            raise RuntimeError(r["exceptionDetails"].get("text") or str(r["exceptionDetails"]))
        return r.get("result", {}).get("value")

    def shot(self, path, full=False):
        params = {"format": "png"}
        if full:
            params["captureBeyondViewport"] = True
        data = self.send("Page.captureScreenshot", params)["data"]
        with open(path, "wb") as f:
            f.write(base64.b64decode(data))
        return path

    def goto(self, url, wait=3.0):
        self.send("Page.navigate", {"url": url})
        time.sleep(wait)

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass
