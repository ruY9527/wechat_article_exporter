# -*- coding: utf-8 -*-
"""稳健的窗口聚焦 + 相对坐标点击 + 分区截图"""
import ctypes
import time
from ctypes import wintypes

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

user32.GetForegroundWindow.restype = wintypes.HWND
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.GetWindowThreadProcessId.restype = wintypes.DWORD
user32.AttachThreadInput.argtypes = [wintypes.DWORD, wintypes.DWORD, wintypes.BOOL]
user32.SetForegroundWindow.argtypes = [wintypes.HWND]
user32.BringWindowToTop.argtypes = [wintypes.HWND]
user32.SetFocus.argtypes = [wintypes.HWND]
user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
user32.IsIconic.argtypes = [wintypes.HWND]
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]

SW_RESTORE = 9


def foreground():
    return user32.GetForegroundWindow()


def rect(hwnd):
    r = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    return (r.left, r.top, r.right, r.bottom)


def focus(hwnd, tries=8):
    """尽最大努力把窗口切到前台，返回是否成功"""
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, SW_RESTORE)
        time.sleep(0.4)

    for _ in range(tries):
        if foreground() == hwnd:
            return True
        fg = foreground()
        cur_tid = kernel32.GetCurrentThreadId()
        fg_tid = user32.GetWindowThreadProcessId(fg, None)
        tgt_tid = user32.GetWindowThreadProcessId(hwnd, None)

        # ALT 抖动：绕过前台锁
        user32.keybd_event(0x12, 0, 0, 0)
        user32.keybd_event(0x12, 0, 2, 0)
        time.sleep(0.05)

        if fg_tid:
            user32.AttachThreadInput(cur_tid, fg_tid, True)
        if tgt_tid and tgt_tid != fg_tid:
            user32.AttachThreadInput(cur_tid, tgt_tid, True)

        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)
        user32.SetFocus(hwnd)

        if fg_tid:
            user32.AttachThreadInput(cur_tid, fg_tid, False)
        if tgt_tid and tgt_tid != fg_tid:
            user32.AttachThreadInput(cur_tid, tgt_tid, False)

        time.sleep(0.35)
        if foreground() == hwnd:
            return True
    return foreground() == hwnd


def ensure(hwnd):
    if not focus(hwnd):
        raise RuntimeError(f"无法聚焦窗口 {hwnd}，当前前台是 {foreground()}")
    return True
