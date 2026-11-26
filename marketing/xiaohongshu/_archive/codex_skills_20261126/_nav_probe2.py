# -*- coding: utf-8 -*-
import ctypes, time
import uiauto as u, forcefg
from ctypes import wintypes
ctypes.windll.shcore.SetProcessDpiAwareness(2)
user32 = ctypes.WinDLL("user32")
H = 531982

forcefg.force_foreground(H)
time.sleep(0.5)
fg = user32.GetForegroundWindow()
print("foreground:", fg)
# 关闭书签栏下拉 / 弹窗
u.press("esc")
time.sleep(0.3)
u.press("esc")
time.sleep(0.3)
forcefg.force_foreground(H)
time.sleep(0.4)
# 用 Ctrl+L 后直接 type_text（不走剪贴板）
u.hotkey("ctrl", "l")
time.sleep(0.5)
u.type_text("https://creator.xiaohongshu.com/publish/publish?target=image")
time.sleep(0.5)
u.press("enter")
time.sleep(10)
u.screenshot("_nav_probe2.png")
print("done, fg after:", user32.GetForegroundWindow())
