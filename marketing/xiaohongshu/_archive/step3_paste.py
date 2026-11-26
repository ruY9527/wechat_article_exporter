# -*- coding: utf-8 -*-
"""把 5 张图以「文件」形式粘贴进小红书上传区"""
import ctypes
import os
import time

ctypes.windll.shcore.SetProcessDpiAwareness(2)

import clipfile as cf  # noqa: E402
import safeui as S     # noqa: E402
import uiauto as u     # noqa: E402
import winfocus as wf  # noqa: E402

HWND = 531982
BASE = os.path.dirname(os.path.abspath(__file__))
FILES = ["01-cover.png", "02-popup.png", "03-formats.png", "04-data.png", "05-install.png"]
PATHS = [os.path.join(BASE, f) for f in FILES]

S.set_target(HWND)
S.guard()

# 1) 文件放进剪贴板
cf.set_files(PATHS)
print("clipboard has files:", cf.has_files())

# 2) 点上传区空白（让页面获得焦点，不触发文件对话框）
S.click(1300, 500, wait=0.8)

# 3) 直接粘贴文件
S.keys("ctrl", "v", wait=1.0)
time.sleep(6)
u.screenshot(os.path.join(BASE, "_paste1.png"))
print("pasted, screenshot saved")
