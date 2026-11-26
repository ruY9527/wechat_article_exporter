# -*- coding: utf-8 -*-
"""在小红书图文上传页粘贴文件，并逐步截图验证"""
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

wf.ensure(HWND)
time.sleep(0.5)

cf.set_files(PATHS)
print("clip has files:", cf.has_files())

# 点击上传区中央（图片图标位置），保证焦点在页面上
wf.ensure(HWND)
u.move(1370, 588)
time.sleep(0.2)
wf.ensure(HWND)
u.click(1370, 588, wait=0.8)
print("clicked upload zone, fg ok:", wf.foreground() == HWND)

# 粘贴
wf.ensure(HWND)
u.set_clipboard(cf.read_files()[0] if False else "")  # no-op, keep files intact
time.sleep(0.1)
