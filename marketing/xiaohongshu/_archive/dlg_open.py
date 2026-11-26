# -*- coding: utf-8 -*-
"""只做一件事：点掉当前打开对话框的「打开」按钮"""
import ctypes
import time
from ctypes import wintypes

user32 = ctypes.WinDLL("user32", use_last_error=True)
user32.FindWindowW.restype = wintypes.HWND
user32.SendMessageW.restype = ctypes.c_ssize_t
user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT,
                                wintypes.WPARAM, ctypes.c_void_p]
user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]

BM_CLICK = 0x00F5


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


def gt(h, cap=200):
    buf = ctypes.create_unicode_buffer(cap)
    user32.SendMessageW(h, 0x000D, cap, ctypes.cast(buf, ctypes.c_void_p))
    return buf.value


if __name__ == "__main__":
    dlg = user32.FindWindowW("#32770", "打开") or user32.FindWindowW("#32770", None)
    print("dialog:", dlg)
    if not dlg:
        raise SystemExit("没有对话框")

    btns = kids(dlg, "Button")
    for b in btns:
        label = gt(b, 64)
        print("btn", b, repr(label), "id=", user32.GetDlgCtrlID(b) if hasattr(user32, "GetDlgCtrlID") else "?")

    # 优先点 label 含「打开」或 id=1 的
    target = None
    for b in btns:
        if "打开" in gt(b, 64):
            target = b
            break
    if target is None:
        for b in btns:
            if ctypes.WinDLL("user32").GetDlgCtrlID(b) == 1:
                target = b
                break
    print("target:", target)
    if target:
        user32.SendMessageW(target, BM_CLICK, 0, None)
        print("clicked")
    time.sleep(3)
    print("dlg after:", user32.FindWindowW("#32770", "打开"))
