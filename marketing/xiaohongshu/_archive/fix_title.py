# -*- coding: utf-8 -*-
"""用修正后的坐标填标题（y≈405）与正文（y≈448），最后保存草稿"""
import ctypes
import os
import time

ctypes.windll.shcore.SetProcessDpiAwareness(2)

import forcefg       # noqa: E402
import uiauto as u   # noqa: E402

HWND = 531982
BASE = os.path.dirname(os.path.abspath(__file__))

TITLE_POS = (900, 405)
BODY_POS = (900, 448)

TITLE = "公众号好文，一键变成能存一辈子的文件"


def shot(n):
    u.screenshot(os.path.join(BASE, n))
    print("  ->", n)


if __name__ == "__main__":
    forcefg.force_foreground(HWND); time.sleep(1.0)

    # 标题
    u.move(*TITLE_POS); time.sleep(0.3)
    u.click(*TITLE_POS, wait=1.3)
    time.sleep(0.5)
    shot("_g1_tclick.png")

    u.set_clipboard(TITLE); time.sleep(0.4)
    u.hotkey("ctrl", "v"); time.sleep(1.6)
    shot("_g2_title.png")
    print("title pasted")
