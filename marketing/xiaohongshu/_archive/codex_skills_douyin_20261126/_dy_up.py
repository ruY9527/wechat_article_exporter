# -*- coding: utf-8 -*-
import ctypes, time, os
import uiauto as u, forcefg
from ctypes import wintypes

ctypes.windll.shcore.SetProcessDpiAwareness(2)
user32 = ctypes.WinDLL("user32", use_last_error=True)
H = 531982
user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, ctypes.c_void_p]
WM_SETTEXT, WM_GETTEXT, BM_CLICK = 0x000C, 0x000D, 0x00F5

BASE = r"E:\thesis-code\gemini_env\other_action_solution\文案\codex_skills"
FILES = [
    "科研日常五项实用技能.png",
    "CCF科研技能五步指南.png",
    "研究证据链技能图鉴.png",
    "Firecrawl网页信息技能精选.png",
]
PATHS = [os.path.join(BASE, f) for f in FILES]
for p in PATHS:
    assert os.path.exists(p), p

def enum_children(parent, klass):
    out = []
    CB = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def cb(h, _):
        c = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(h, c, 256)
        if c.value == klass:
            out.append(h)
        return True
    user32.EnumChildWindows(parent, CB(cb), 0)
    return out

def get_text(h, cap=8192):
    buf = ctypes.create_unicode_buffer(cap)
    user32.SendMessageW(h, WM_GETTEXT, cap, ctypes.cast(buf, ctypes.c_void_p))
    return buf.value

def set_text(h, text):
    buf = ctypes.create_unicode_buffer(text, len(text) + 1)
    user32.SendMessageW(h, WM_SETTEXT, 0, ctypes.cast(buf, ctypes.c_void_p))

for _ in range(20):
    forcefg.force_foreground(H)
    time.sleep(0.2)
    if user32.GetForegroundWindow() == H:
        break
print("fg:", user32.GetForegroundWindow())

u.move(1732, 471)
time.sleep(0.3)
u.click(1732, 471, wait=1.5)

dlg = None
for _ in range(40):
    dlg = user32.FindWindowW("#32770", "打开") or user32.FindWindowW("#32770", None)
    if dlg:
        break
    time.sleep(0.5)
print("dlg:", dlg)
assert dlg, "no dialog"

edits = enum_children(dlg, "Edit")
set_text(edits[0], " ".join('"%s"' % p for p in PATHS))
time.sleep(0.5)
assert "Firecrawl" in get_text(edits[0]), "path fail"
for b in enum_children(dlg, "Button"):
    if "打开" in get_text(b, 64):
        user32.SendMessageW(b, BM_CLICK, 0, None)
        print("clicked open")
        break
time.sleep(16)
u.screenshot("_dy_up.png")
print("done")
