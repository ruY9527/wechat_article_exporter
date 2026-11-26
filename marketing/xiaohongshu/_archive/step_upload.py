# -*- coding: utf-8 -*-
"""向文件选择框填写图片路径并提交"""
import ctypes
import os
import sys
import time

ctypes.windll.shcore.SetProcessDpiAwareness(2)

import uiauto as u  # noqa: E402

BASE = os.path.dirname(os.path.abspath(__file__))
FILES = ["01-cover.png", "02-popup.png", "03-formats.png", "04-data.png", "05-install.png"]

paths = " ".join('"%s"' % os.path.join(BASE, f) for f in FILES)

# 文件名输入框
u.click(600, 630)
time.sleep(0.5)
u.paste_text(paths, wait=0.5)
time.sleep(0.8)
u.press("enter")
time.sleep(9)
print("submitted:", paths)
