# -*- coding: utf-8 -*-
"""新开独立 Chrome 窗口操作小红书，避免与 DSH 标签抢焦点"""
import ctypes
import time
from ctypes import wintypes

ctypes.windll.shcore.SetProcessDpiAwareness(2)

import uiauto as u      # noqa: E402
import winfocus as wf   # noqa: E402

user32 = ctypes.WinDLL("user32", use_last_error=True)
user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]


def list_chrome():
    out = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def cb(h, _):
        if not user32.IsWindowVisible(h):
            return True
        c = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(h, c, 256)
        if c.value != "Chrome_WidgetWin_1":
            return True
        r = wintypes.RECT()
        user32.GetWindowRect(h, ctypes.byref(r))
        if r.right - r.left < 400 or r.bottom - r.top < 300:
            return True
        t = ctypes.create_unicode_buffer(512)
        user32.GetWindowTextW(h, t, 512)
        out.append((h, t.value, (r.left, r.top, r.right, r.bottom)))
        return True

    user32.EnumWindows(cb, 0)
    return out


if __name__ == "__main__":
    for h, t, r in list_chrome():
        print(h, r, repr(t[:70]))
