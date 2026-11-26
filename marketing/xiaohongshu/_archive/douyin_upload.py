# -*- coding: utf-8 -*-
"""抖音图文：上传 5 张图（文件对话框 + Win32 直写路径）"""
import ctypes
import os
import time
from ctypes import wintypes

import douyin_config as C

import uiauto as u      # noqa: E402
import forcefg           # noqa: E402
import winlist           # noqa: E402

user32 = ctypes.WinDLL("user32", use_last_error=True)
user32.FindWindowW.restype = wintypes.HWND
user32.SendMessageW.restype = ctypes.c_ssize_t
user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT,
                                wintypes.WPARAM, ctypes.c_void_p]
user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]

WM_SETTEXT, WM_GETTEXT, BM_CLICK = 0x000C, 0x000D, 0x00F5
BASE = os.path.dirname(os.path.abspath(__file__))


def find_window():
    for h, t, r in winlist.list_chrome():
        if C.WINDOW_KEYWORD in t:
            return h
    raise RuntimeError("找不到抖音窗口")


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
    user32.SendMessageW(h, WM_GETTEXT, cap, ctypes.cast(buf, ctypes.c_void_p))
    return buf.value


def st(h, text):
    buf = ctypes.create_unicode_buffer(text, len(text) + 1)
    user32.SendMessageW(h, WM_SETTEXT, 0, ctypes.cast(buf, ctypes.c_void_p))


def cancel_dialog():
    dlg = user32.FindWindowW("#32770", "打开") or user32.FindWindowW("#32770", None)
    if not dlg:
        return
    for b in kids(dlg, "Button"):
        if "取消" in gt(b, 64):
            user32.SendMessageW(b, BM_CLICK, 0, None)
            time.sleep(1.2)
            return


if __name__ == "__main__":
    C.HWND = find_window()
    print("window:", C.HWND)
    cancel_dialog()

    paths = [os.path.join(BASE, f) for f in C.IMAGES]
    for p in paths:
        if not os.path.isfile(p):
            raise FileNotFoundError(p)

    forcefg.force_foreground(C.HWND)
    time.sleep(0.8)

    u.move(*C.UPLOAD_ZONE)
    time.sleep(0.3)
    u.click(*C.UPLOAD_ZONE, wait=2.0)
    print("clicked upload zone")

    dlg = None
    for _ in range(int(C.T_DIALOG / 0.5)):
        dlg = user32.FindWindowW("#32770", "打开") or user32.FindWindowW("#32770", None)
        if dlg:
            break
        time.sleep(0.5)
    if not dlg:
        raise RuntimeError("文件对话框未出现 —— 上传区坐标可能偏了")
    print("dialog:", dlg)

    edits = kids(dlg, "Edit")
    st(edits[0], " ".join(f'"{p}"' for p in paths))
    time.sleep(0.6)
    if C.IMAGES[-1] not in gt(edits[0]):
        raise RuntimeError("路径写入失败")
    print("path ok")

    for b in kids(dlg, "Button"):
        if "打开" in gt(b, 64):
            user32.SendMessageW(b, BM_CLICK, 0, None)
            print("clicked open")
            break

    time.sleep(C.T_UPLOAD)
    forcefg.force_foreground(C.HWND)
    time.sleep(1.5)
    u.screenshot(os.path.join(BASE, "_dy1_uploaded.png"))
    print("uploaded")
