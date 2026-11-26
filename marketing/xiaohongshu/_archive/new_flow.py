# -*- coding: utf-8 -*-
"""
小红书草稿重做（一次性流程，减少焦点打断）
关键修正：
- 只在开始时聚焦一次
- 点击后不调用任何 SetWindowPos / BringWindowToTop
- 标题用「点正文 → Shift+Tab 到标题」并配合逐字 Unicode 输入验证
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

HWND = 531982
BASE = os.path.dirname(os.path.abspath(__file__))
FILES = ["01-cover.png", "02-popup.png", "03-formats.png", "04-data.png", "05-install.png"]

# 最大化窗口下的坐标（1920 宽视口偏移到 x≈16?? 实际用截图量）
PUPLOAD_TAB = "?"   # 待定


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


if __name__ == "__main__":
    forcefg.force_foreground(HWND)
    time.sleep(1.0)
    # 点「上传图文」标签
    u.click(250, 100, wait=4.0)
    shot("_p1_upload_tab.png")
