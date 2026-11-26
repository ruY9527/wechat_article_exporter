# -*- coding: utf-8 -*-
"""上传 → 用鼠标点标题文字的精确基线 → 键盘输入 → 逐字验证
关键发现：标题必须点在文字基线上，点击 y 要落在字符高度内。
"""
import ctypes
import os
import time
from ctypes import wintypes

ctypes.windll.shcore.SetProcessDpiAwareness(2)

import forcefg       # noqa: E402
import uiauto as u   # noqa: E402

user32 = ctypes.WinDLL("user32", use_last_error=True)
user32.FindWindowW.restype = wintypes.HWND
user32.SendMessageW.restype = ctypes.c_ssize_t
user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT,
                                wintypes.WPARAM, ctypes.c_void_p]
user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]

HWND = 1252932
BASE = os.path.dirname(os.path.abspath(__file__))
FILES = ["01-cover.png", "02-popup.png", "03-formats.png", "04-data.png", "05-install.png"]

UP_BTN = (537, 726)


def shot(n):
    u.screenshot(os.path.join(BASE, n))
    print("  ->", n)


def kids(dlg, klass):
    out = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def cb(h, _):
        b = ctypes.create_unicode_buffer(64)
        user32.GetClassNameW(h, b, 64)
        if b.value == klass:
            out.append(h)
        return True

    user32.EnumChildWindows(dlg, cb, 0)
    return out


def gt(h, cap=8192):
    buf = ctypes.create_unicode_buffer(cap)
    user32.SendMessageW(h, 0x000D, cap, ctypes.cast(buf, ctypes.c_void_p))
    return buf.value


def st(h, text):
    buf = ctypes.create_unicode_buffer(text, len(text) + 1)
    user32.SendMessageW(h, 0x000C, 0, ctypes.cast(buf, ctypes.c_void_p))


def upload():
    forcefg.force_foreground(HWND); time.sleep(0.7)
    u.click(*UP_BTN, wait=1.5)
    dlg = None
    for _ in range(30):
        dlg = user32.FindWindowW("#32770", "打开") or user32.FindWindowW("#32770", None)
        if dlg:
            break
        time.sleep(0.5)
    if not dlg:
        raise RuntimeError("无对话框")
    st(kids(dlg, "Edit")[0], " ".join('"%s"' % os.path.join(BASE, f) for f in FILES))
    time.sleep(0.5)
    for b in kids(dlg, "Button"):
        if "打开" in gt(b, 64):
            user32.SendMessageW(b, 0x00F5, 0, None)
            break
    time.sleep(14)
    forcefg.force_foreground(HWND); time.sleep(1.5)
    shot("_u_done.png")


if __name__ == "__main__":
    upload()
