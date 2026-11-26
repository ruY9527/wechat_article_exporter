# -*- coding: utf-8 -*-
"""填标题：点标题框 → 验证光标 → 粘贴 → 立刻截图"""
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
    # 标题框：占位文字「填写标题会有更多赞哦」在 y≈130
    forcefg.force_foreground(HWND); time.sleep(0.6)
    u.move(330, 132); time.sleep(0.3)
    forcefg.force_foreground(HWND); time.sleep(0.2)
    u.click(330, 132, wait=1.2)
    forcefg.force_foreground(HWND); time.sleep(0.4)
    shot("_x1_focus.png")

    u.set_clipboard(TITLE); time.sleep(0.4)
    forcefg.force_foreground(HWND); time.sleep(0.2)
    u.hotkey("ctrl", "v"); time.sleep(1.5)
    forcefg.force_foreground(HWND); time.sleep(0.5)
    shot("_x2_title.png")
    print("title pasted")
