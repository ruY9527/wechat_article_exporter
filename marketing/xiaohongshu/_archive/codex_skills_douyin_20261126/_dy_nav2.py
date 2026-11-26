# -*- coding: utf-8 -*-
import ctypes, time
import uiauto as u, forcefg
from ctypes import wintypes
ctypes.windll.shcore.SetProcessDpiAwareness(2)
user32 = ctypes.WinDLL("user32")
H = 531982

for _ in range(20):
    forcefg.force_foreground(H)
    time.sleep(0.2)
    if user32.GetForegroundWindow() == H:
        break
print("fg:", user32.GetForegroundWindow())
u.press("esc")
time.sleep(0.3)
u.hotkey("ctrl", "l")
time.sleep(0.4)
u.set_clipboard("https://creator.douyin.com/creator-micro/content/post/image")
u.hotkey("ctrl", "v")
time.sleep(0.4)
u.press("enter")
time.sleep(10)
u.screenshot("_dy_nav2.png")
print("done fg:", user32.GetForegroundWindow())
