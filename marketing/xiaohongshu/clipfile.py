# -*- coding: utf-8 -*-
"""
用 CF_HDROP 把文件放进剪贴板（等价于在资源管理器里 Ctrl+C 选中的文件）。
之后在网页上传区直接 Ctrl+V，浏览器会收到文件粘贴事件。

依赖 win32 结构：DROPFILES + 双 null 结尾的 UTF-16 路径列表。
"""
import ctypes
import os
import struct
import time
from ctypes import wintypes

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

CF_HDROP = 15
GMEM_MOVEABLE = 0x0002
DROPFILES_SIZE = 20


class DROPFILES(ctypes.Structure):
    _fields_ = [
        ("pFiles", wintypes.DWORD),
        ("pt_x", wintypes.LONG),
        ("pt_y", wintypes.LONG),
        ("fNC", wintypes.BOOL),
        ("fWide", wintypes.BOOL),
    ]


user32.OpenClipboard.argtypes = [wintypes.HWND]
user32.OpenClipboard.restype = wintypes.BOOL
user32.EmptyClipboard.restype = wintypes.BOOL
user32.CloseClipboard.restype = wintypes.BOOL
user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HANDLE]
user32.SetClipboardData.restype = wintypes.HANDLE
user32.GetClipboardData.argtypes = [wintypes.UINT]
user32.GetClipboardData.restype = wintypes.HANDLE

kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
kernel32.GlobalLock.restype = ctypes.c_void_p
kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
kernel32.GlobalUnlock.restype = wintypes.BOOL


def _open(retries=30):
    for _ in range(retries):
        if user32.OpenClipboard(None):
            return True
        time.sleep(0.1)
    return False


def set_files(paths):
    """把若干文件路径写入剪贴板为 CF_HDROP"""
    paths = [os.path.abspath(p) for p in paths]
    for p in paths:
        if not os.path.isfile(p):
            raise FileNotFoundError(p)

    # DROPFILES 头 + 路径列表（UTF-16LE，双 \0 结尾）
    path_bytes = b""
    for p in paths:
        path_bytes += p.encode("utf-16-le") + b"\x00\x00"
    path_bytes += b"\x00\x00"          # 列表结束

    header = DROPFILES()
    header.pFiles = DROPFILES_SIZE
    header.pt_x = 0
    header.pt_y = 0
    header.fNC = False
    header.fWide = True               # UTF-16
    header_bytes = bytes(header)

    blob = header_bytes + path_bytes
    # 对齐
    if len(blob) % 4:
        blob += b"\x00" * (4 - len(blob) % 4)

    if not _open():
        raise RuntimeError("OpenClipboard failed")
    try:
        user32.EmptyClipboard()
        h = kernel32.GlobalAlloc(GMEM_MOVEABLE, len(blob))
        if not h:
            raise RuntimeError("GlobalAlloc failed")
        p = kernel32.GlobalLock(h)
        if not p:
            raise RuntimeError("GlobalLock failed")
        ctypes.memmove(p, blob, len(blob))
        kernel32.GlobalUnlock(h)

        if not user32.SetClipboardData(CF_HDROP, h):
            raise RuntimeError("SetClipboardData(CF_HDROP) failed")
    finally:
        user32.CloseClipboard()
    return paths


def has_files():
    """检查剪贴板里是否有 CF_HDROP"""
    if not _open(5):
        return False
    try:
        return bool(user32.IsClipboardFormatAvailable(CF_HDROP))
    finally:
        user32.CloseClipboard()


def read_files(count=64):
    """读回剪贴板里的文件列表，用于自检"""
    if not _open(5):
        return []
    try:
        h = user32.GetClipboardData(CF_HDROP)
        if not h:
            return []
        p = kernel32.GlobalLock(h)
        if not p:
            return []
        try:
            hdr = DROPFILES.from_address(p)
            base = ctypes.cast(p, ctypes.POINTER(ctypes.c_byte))
            data_ptr = ctypes.addressof(base.contents) + hdr.pFiles
            if hdr.fWide:
                s = ctypes.wstring_at(data_ptr, 4096)
            else:
                s = ctypes.string_at(data_ptr, 4096).decode("mbcs")
            return [x for x in s.split("\x00") if x]
        finally:
            kernel32.GlobalUnlock(h)
    finally:
        user32.CloseClipboard()


if __name__ == "__main__":
    import sys
    files = sys.argv[1:]
    print("set:", set_files(files))
    print("has CF_HDROP:", has_files())
    print("readback:", read_files())
