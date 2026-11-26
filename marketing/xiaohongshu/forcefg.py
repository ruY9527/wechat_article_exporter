# -*- coding: utf-8 -*-
"""强制把目标窗口提到前台并保持，返回是否成功"""
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
user32.SetWindowPos.argtypes = [wintypes.HWND, wintypes.HWND,
                                ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                ctypes.c_int, wintypes.UINT]

HWND_TOPMOST = wintypes.HWND(-1)
HWND_NOTOPMOST = wintypes.HWND(-2)
SWP_NOMOVE = 0x0002
SWP_NOSIZE = 0x0001
SWP_SHOWWINDOW = 0x0040


def fg():
    return user32.GetForegroundWindow()


def force_foreground(hwnd, tries=15):
    cur = kernel32.GetCurrentThreadId()
    for i in range(tries):
        if fg() == hwnd:
            return True

        # 置顶再取消置顶，强制 z-order 到最上
        user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0,
                            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW)
        user32.SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0,
                            SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW)

        f = fg()
        ft = user32.GetWindowThreadProcessId(f, None) if f else 0
        tt = user32.GetWindowThreadProcessId(hwnd, None)

        attached = []
        if ft and ft != cur:
            user32.AttachThreadInput(cur, ft, True); attached.append(ft)
        if tt and tt not in attached and tt != cur:
            user32.AttachThreadInput(cur, tt, True); attached.append(tt)

        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)

        for t in attached:
            user32.AttachThreadInput(cur, t, False)

        time.sleep(0.25)
    return fg() == hwnd
