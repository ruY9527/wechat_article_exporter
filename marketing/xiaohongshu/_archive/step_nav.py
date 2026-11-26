# -*- coding: utf-8 -*-
"""切到小红书创作标签，并通过地址栏核对 URL"""
import ctypes
import os
import time

ctypes.windll.shcore.SetProcessDpiAwareness(2)

import safeui as S   # noqa: E402
import uiauto as u   # noqa: E402
import winfocus as wf  # noqa: E402

HWND = 531982
BASE = os.path.dirname(os.path.abspath(__file__))
CREATOR = "https://creator.xiaohongshu.com/publish/publish?target=image"

S.set_target(HWND)
S.guard()

# 直接导航到创作页（比 Ctrl+N 切标签可靠）
S.keys("ctrl", "l", wait=0.5)
S.paste(CREATOR, wait=0.5)
S.press("enter", wait=1.0)
time.sleep(6)
u.screenshot(os.path.join(BASE, "_nav.png"))
print("navigated")
