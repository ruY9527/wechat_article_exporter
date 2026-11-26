# -*- coding: utf-8 -*-
import ctypes, time
import uiauto as u, forcefg
ctypes.windll.shcore.SetProcessDpiAwareness(2)
H = 531982
forcefg.force_foreground(H)
time.sleep(0.5)
u.hotkey("ctrl", "l")
time.sleep(0.4)
u.set_clipboard("https://creator.xiaohongshu.com/publish/publish?target=image")
u.hotkey("ctrl", "v")
time.sleep(0.4)
u.press("enter")
time.sleep(8)
u.screenshot("_nav_probe.png")
print("done")
