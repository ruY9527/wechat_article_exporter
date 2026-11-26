# -*- coding: utf-8 -*-
"""用 Win32 消息给打开对话框的 Edit 控件写路径并提交（修正参数类型版）"""
import ctypes
import os
import time
from ctypes import wintypes

user32 = ctypes.WinDLL("user32", use_last_error=True)

user32.FindWindowW.restype = wintypes.HWND
user32.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
user32.FindWindowExW.restype = wintypes.HWND
user32.FindWindowExW.argtypes = [wintypes.HWND, wintypes.HWND,
                                 wintypes.LPCWSTR, wintypes.LPCWSTR]
user32.SendMessageW.restype = ctypes.c_ssize_t
user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT,
                                wintypes.WPARAM, ctypes.c_void_p]
user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]

WM_SETTEXT = 0x000C
WM_GETTEXT = 0x000D
BM_CLICK = 0x00F5

BASE = os.path.dirname(os.path.abspath(__file__))
FILES = ["01-cover.png", "02-popup.png", "03-formats.png", "04-data.png", "05-install.png"]


def enum_children(dlg, klass):
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def cb(h, _):
        buf = ctypes.create_unicode_buffer(64)
        user32.GetClassNameW(h, buf, 64)
        if buf.value == klass:
            found.append(h)
        return True

    user32.EnumChildWindows(dlg, cb, 0)
    return found


def set_text(hwnd, text):
    buf = ctypes.create_unicode_buffer(text, len(text) + 1)
    user32.SendMessageW(hwnd, WM_SETTEXT, 0, ctypes.cast(buf, ctypes.c_void_p))


def get_text(hwnd, cap=8192):
    buf = ctypes.create_unicode_buffer(cap)
    user32.SendMessageW(hwnd, WM_GETTEXT, cap, ctypes.cast(buf, ctypes.c_void_p))
    return buf.value


def run():
    dlg = user32.FindWindowW("#32770", "打开") or user32.FindWindowW("#32770", None)
    if not dlg:
        raise RuntimeError("no dialog")
    print("dialog:", dlg)

    edits = enum_children(dlg, "Edit")
    print("edits:", edits)
    target = edits[0]
    paths = [os.path.join(BASE, f) for f in FILES]
    text = " ".join('"%s"' % p for p in paths)

    set_text(target, text)
    time.sleep(0.5)
    got = get_text(target)
    print("readback chars:", len(got))
    print("readback head:", got[:90])
    if "01-cover.png" not in got:
        raise RuntimeError("text not set")

    # 点「打开」
    btns = enum_children(dlg, "Button")
    print("buttons:", len(btns))
    opened = False
    for b in btns:
        t = get_text(b, 64)
        if t in ("打开(O)", "打开", "&Open", "Open"):
            user32.SendMessageW(b, BM_CLICK, 0, None)
            print("clicked:", repr(t))
            opened = True
            break
    if not opened and btns:
        user32.SendMessageW(btns[0], BM_CLICK, 0, None)
        print("clicked first button")
    return True


if __name__ == "__main__":
    run()
    time.sleep(10)
    import uiauto as u
    u.screenshot(os.path.join(BASE, "_dlg3.png"))
    print("shot saved")
