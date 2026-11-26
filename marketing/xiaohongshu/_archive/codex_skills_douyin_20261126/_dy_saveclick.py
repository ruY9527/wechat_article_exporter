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
# 暂存离开 (1076,1287)；发布 (957,1287) 绝不点
u.move(1076, 1287)
time.sleep(0.4)
u.click(1076, 1287, wait=6)
u.screenshot("_dy_saved.png")
print("saved")
