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
# 点空白让页面可滚动，按两次 End 到底
u.click(700, 900, wait=1.0)
u.press("end")
time.sleep(1.0)
u.press("end")
time.sleep(1.5)
u.screenshot("_dy_bottom.png")
print("bottom shot")
