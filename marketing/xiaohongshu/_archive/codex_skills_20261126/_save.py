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
# 暂存离开 (1040,1337)；发布 (1197,1337) 绝不点击
u.move(1040, 1337)
time.sleep(0.4)
u.click(1040, 1337, wait=5)
u.screenshot("_saved.png")
print("saved")
