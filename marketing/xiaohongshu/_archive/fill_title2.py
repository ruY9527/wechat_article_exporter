# -*- coding: utf-8 -*-
"""正确激活方式：点正文区 → 光标进入编辑器 → Ctrl+Home 到最前（即标题行）
   小红书图文编辑器的标题是一个 contenteditable 行，位于正文之前。
"""
import ctypes
import os
import time

ctypes.windll.shcore.SetProcessDpiAwareness(2)

import forcefg       # noqa: E402
import uiauto as u   # noqa: E402

HWND = 1252932
BASE = os.path.dirname(os.path.abspath(__file__))
TITLE = "公众号好文，一键变成能存一辈子的文件"


def shot(n):
    u.screenshot(os.path.join(BASE, n))
    print("  ->", n)


if __name__ == "__main__":
    forcefg.force_foreground(HWND); time.sleep(0.6)

    # 点正文占位文字区域
    u.move(340, 245); time.sleep(0.3)
    forcefg.force_foreground(HWND); time.sleep(0.2)
    u.click(340, 245, wait=1.5)
    forcefg.force_foreground(HWND); time.sleep(0.5)
    shot("_y1_clickbody.png")

    # 到编辑器最开头
    u.hotkey("ctrl", "home"); time.sleep(0.8)
    forcefg.force_foreground(HWND); time.sleep(0.3)
    shot("_y2_home.png")

    # 粘贴标题
    u.set_clipboard(TITLE); time.sleep(0.4)
    forcefg.force_foreground(HWND); time.sleep(0.2)
    u.hotkey("ctrl", "v"); time.sleep(1.5)
    forcefg.force_foreground(HWND); time.sleep(0.5)
    shot("_y3_title.png")
    print("done")
