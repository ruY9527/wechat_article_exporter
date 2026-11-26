# -*- coding: utf-8 -*-
"""在小红书图文上传页粘贴文件（CF_HDROP + Ctrl+V），并截图验证"""
import ctypes
import os
import time

ctypes.windll.shcore.SetProcessDpiAwareness(2)

import clipfile as cf  # noqa: E402
import uiauto as u     # noqa: E402
import winfocus as wf  # noqa: E402

HWND = 531982
BASE = os.path.dirname(os.path.abspath(__file__))
FILES = ["01-cover.png", "02-popup.png", "03-formats.png", "04-data.png", "05-install.png"]
PATHS = [os.path.join(BASE, f) for f in FILES]

cf.set_files(PATHS)
print("clip has files:", cf.has_files())

wf.ensure(HWND)
time.sleep(0.4)

# 点击上传区（图片占位图标处）
u.move(1370, 588)
time.sleep(0.25)
wf.ensure(HWND)
u.click(1370, 588, wait=1.0)
print("fg after click:", wf.foreground() == HWND)

# Ctrl+V
wf.ensure(HWND)
u.hotkey("ctrl", "v")
time.sleep(7)
u.screenshot(os.path.join(BASE, "_paste2.png"))
print("done, shot saved")
