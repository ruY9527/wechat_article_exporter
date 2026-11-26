# -*- coding: utf-8 -*-
"""上传 5 张图到小红书图文编辑器"""
import ctypes
import os
import time

ctypes.windll.shcore.SetProcessDpiAwareness(2)

import safeui as S  # noqa: E402
import uiauto as u  # noqa: E402
import winfocus as wf  # noqa: E402

HWND = 531982
BASE = os.path.dirname(os.path.abspath(__file__))
FILES = ["01-cover.png", "02-popup.png", "03-formats.png", "04-data.png", "05-install.png"]

S.set_target(HWND)
S.guard()

# 点「上传图片」
S.click(1112, 655)
time.sleep(3.0)
u.screenshot(os.path.join(BASE, "_up1.png"))
print("dialog shot saved")

paths = " ".join('"%s"' % os.path.join(BASE, f) for f in FILES)
# 文件名框
S.guard()
u.click(600, 630)
time.sleep(0.6)
u.set_clipboard(paths)
time.sleep(0.5)
S.keys("ctrl", "v", wait=0.5)
time.sleep(0.6)
S.press("enter", wait=1.0)
time.sleep(10)
u.screenshot(os.path.join(BASE, "_up2.png"))
print("after submit shot saved")
