# -*- coding: utf-8 -*-
"""稳定上传：点上传按钮 -> Win32 填文件对话框 -> 等待上传"""
import ctypes
import os
import time
from ctypes import wintypes

ctypes.windll.shcore.SetProcessDpiAwareness(2)

import forcefg       # noqa: E402
import uiauto as u   # noqa: E402

user32 = ctypes.WinDLL("user32", use_last_error=True)
user32.FindWindowW.restype = wintypes.HWND
user32.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
user32.SendMessageW.restype = ctypes.c_ssize_t
user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT,
                                wintypes.WPARAM, ctypes.c_void_p]
user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]

WM_SETTEXT, WM_GETTEXT, BM_CLICK = 0x000C, 0x000D, 0x00F5

BASE = os.path.dirname(os.path.abspath(__file__))
FILES = ["01-cover.png", "02-popup.png", "03-formats.png", "04-data.png", "05-install.png"]

UP_BTN = (537, 726)     # 「上传图片」按钮（窗口 10,10 起）


def enum_children(dlg, klass):
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def cb(h, _):
        b = ctypes.create_unicode_buffer(64)
        user32.GetClassNameW(h, b, 64)
        if b.value == klass:
            found.append(h)
        return True

    user32.EnumChildWindows(dlg, cb, 0)
    return found


def set_text(h, text):
    buf = ctypes.create_unicode_buffer(text, len(text) + 1)
    user32.SendMessageW(h, WM_SETTEXT, 0, ctypes.cast(buf, ctypes.c_void_p))


def get_text(h, cap=8192):
    buf = ctypes.create_unicode_buffer(cap)
    user32.SendMessageW(h, WM_GETTEXT, cap, ctypes.cast(buf, ctypes.c_void_p))
    return buf.value


def fill_dialog():
    dlg = None
    for _ in range(30):
        dlg = user32.FindWindowW("#32770", "打开") or user32.FindWindowW("#32770", None)
        if dlg:
            break
        time.sleep(0.5)
    if not dlg:
        raise RuntimeError("对话框未出现")
    print("dialog:", dlg)

    edits = enum_children(dlg, "Edit")
    text = " ".join('"%s"' % os.path.join(BASE, f) for f in FILES)
    set_text(edits[0], text)
    time.sleep(0.5)
    got = get_text(edits[0])
    print("len:", len(got), "| ok:", "05-install.png" in got)
    if "05-install.png" not in got:
        raise RuntimeError("路径写入失败")

    for b in enum_children(dlg, "Button"):
        t = get_text(b, 64)
        if t in ("打开(O)", "打开", "&Open", "Open"):
            user32.SendMessageW(b, BM_CLICK, 0, None)
            print("clicked", repr(t))
            return True
    return False


if __name__ == "__main__":
    HWND = 1252932
    forcefg.force_foreground(HWND)
    time.sleep(0.5)
    u.click(*UP_BTN, wait=1.5)
    print("clicked upload btn")
    fill_dialog()
    time.sleep(12)
    forcefg.force_foreground(HWND)
    time.sleep(1)
    u.screenshot(os.path.join(BASE, "_k2.png"))
    print("shot")
