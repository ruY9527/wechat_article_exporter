# -*- coding: utf-8 -*-
"""Win32 UI 自动化：聚焦窗口、发送按键、剪贴板、截屏定位"""
import ctypes
import time
from ctypes import wintypes

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

user32.FindWindowW.restype = wintypes.HWND
user32.FindWindowW.argtypes = [wintypes.LPCWSTR, wintypes.LPCWSTR]
user32.GetForegroundWindow.restype = wintypes.HWND
user32.SetForegroundWindow.argtypes = [wintypes.HWND]
user32.SetForegroundWindow.restype = wintypes.BOOL
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.EnumWindows.argtypes = [ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM),
                               wintypes.LPARAM]
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]

SW_RESTORE = 9
SW_MAXIMIZE = 3


def chrome_windows():
    """返回所有 Chrome 顶层窗口 (hwnd, rect)"""
    out = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def cb(hwnd, _):
        if not user32.IsWindowVisible(hwnd):
            return True
        buf = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, buf, 256)
        if buf.value == "Chrome_WidgetWin_1":
            r = wintypes.RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(r))
            if r.right - r.left > 400 and r.bottom - r.top > 300:
                out.append((hwnd, (r.left, r.top, r.right, r.bottom)))
        return True

    user32.EnumWindows(cb, 0)
    return out


def focus(hwnd):
    user32.ShowWindow(hwnd, SW_MAXIMIZE)
    time.sleep(0.3)
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.5)


def rect(hwnd):
    r = wintypes.RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    return (r.left, r.top, r.right, r.bottom)


# ---------- 按键 ----------
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004

VK = {
    "ctrl": 0x11, "shift": 0x10, "alt": 0x12, "enter": 0x0D, "esc": 0x1B,
    "tab": 0x09, "space": 0x20, "back": 0x08, "delete": 0x2E,
    "home": 0x24, "end": 0x23, "left": 0x25, "right": 0x27, "up": 0x26, "down": 0x28,
    "a": 0x41, "c": 0x43, "v": 0x56, "x": 0x58, "z": 0x5A, "f": 0x46, "l": 0x4C,
    "t": 0x54, "w": 0x57, "n": 0x4E, "r": 0x52, "p": 0x50, "plus": 0xBB,
    "minus": 0xBD, "0": 0x30, "1": 0x31, "2": 0x32, "3": 0x33, "4": 0x34,
    "5": 0x35, "6": 0x36, "7": 0x37, "8": 0x38, "9": 0x39,
    "f5": 0x74, "f12": 0x7B, "f6": 0x75,
}
_pressed = set()


def down(key):
    vk = VK[key.lower()] if isinstance(key, str) else key
    if vk not in _pressed:
        user32.keybd_event(vk, 0, 0, 0)
        _pressed.add(vk)
    time.sleep(0.02)


def up(key):
    vk = VK[key.lower()] if isinstance(key, str) else key
    if vk in _pressed:
        user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
        _pressed.discard(vk)
    time.sleep(0.02)


def release_all():
    for vk in list(_pressed):
        try:
            user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)
        except Exception:
            pass
    _pressed.clear()


def press(key, times=1, interval=0.06):
    for _ in range(times):
        down(key)
        up(key)
        time.sleep(interval)


def hotkey(*keys):
    for k in keys:
        down(k)
    time.sleep(0.05)
    for k in reversed(keys):
        up(k)
    time.sleep(0.12)


def type_text(text):
    """逐字符输入（支持中文走剪贴板路径更稳，这里保留给 ASCII）"""
    for ch in text:
        vk = ctypes.windll.user32.VkKeyScanW(ord(ch)) & 0xFF if ord(ch) < 128 else 0
        if vk:
            shift = ctypes.windll.user32.VkKeyScanW(ord(ch)) >> 8 & 1
            if shift:
                down("shift")
            down(vk)
            up(vk)
            if shift:
                up("shift")
            time.sleep(0.012)


# ---------- 剪贴板 ----------
CF_UNICODETEXT = 13
GMEM_MOVEABLE = 0x0002

user32.OpenClipboard.argtypes = [wintypes.HWND]
user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
user32.SetClipboardData.restype = wintypes.HANDLE
user32.GetClipboardData.argtypes = [wintypes.UINT]
user32.GetClipboardData.restype = wintypes.HANDLE
kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
kernel32.GlobalLock.restype = ctypes.c_void_p
kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
kernel32.GlobalFree.argtypes = [wintypes.HGLOBAL]


def set_clipboard(text):
    for _ in range(20):
        if user32.OpenClipboard(None):
            break
        time.sleep(0.1)
    else:
        raise RuntimeError("OpenClipboard failed")
    try:
        user32.EmptyClipboard()
        buf = ctypes.create_unicode_buffer(text)
        size = ctypes.sizeof(buf)
        h = kernel32.GlobalAlloc(GMEM_MOVEABLE, size)
        p = kernel32.GlobalLock(h)
        ctypes.memmove(p, buf, size)
        kernel32.GlobalUnlock(h)
        user32.SetClipboardData(CF_UNICODETEXT, h)
    finally:
        user32.CloseClipboard()


def get_clipboard():
    if not user32.OpenClipboard(None):
        return ""
    try:
        h = user32.GetClipboardData(CF_UNICODETEXT)
        if not h:
            return ""
        p = kernel32.GlobalLock(h)
        try:
            return ctypes.wstring_at(p)
        finally:
            kernel32.GlobalUnlock(h)
    finally:
        user32.CloseClipboard()


def paste_text(text, wait=0.5):
    set_clipboard(text)
    time.sleep(0.25)
    hotkey("ctrl", "v")
    time.sleep(wait)


# ---------- 鼠标 ----------
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_ABSOLUTE = 0x8000
MOUSEEVENTF_MOVE = 0x0001


def move(x, y):
    user32.SetCursorPos(int(x), int(y))
    time.sleep(0.05)


def click(x=None, y=None, wait=0.35):
    if x is not None:
        move(x, y)
        time.sleep(0.12)
    user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    time.sleep(0.06)
    user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    time.sleep(wait)


def screenshot(path):
    from PIL import ImageGrab
    img = ImageGrab.grab()
    img.save(path)
    return path
