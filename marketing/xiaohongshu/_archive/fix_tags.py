# -*- coding: utf-8 -*-
"""追加标签 + 保存草稿"""
import ctypes
import os
import time

ctypes.windll.shcore.SetProcessDpiAwareness(2)

import forcefg       # noqa: E402
import uiauto as u   # noqa: E402

HWND = 531982
BASE = os.path.dirname(os.path.abspath(__file__))
TAGS = ["公众号文章导出", "效率工具", "开源项目", "知识管理"]


def shot(n):
    u.screenshot(os.path.join(BASE, n))
    print("  ->", n)


if __name__ == "__main__":
    forcefg.force_foreground(HWND); time.sleep(0.8)

    # 光标到文末
    u.click(900, 500, wait=2.0)
    time.sleep(0.5)
    u.hotkey("ctrl", "end"); time.sleep(1.0)
    shot("_j0_end.png")

    u.press("enter"); time.sleep(0.4)

    for tag in TAGS:
        u.set_clipboard("#" + tag); time.sleep(0.4)
        forcefg.force_foreground(HWND); time.sleep(0.2)
        u.hotkey("ctrl", "v"); time.sleep(1.4)
        forcefg.force_foreground(HWND); time.sleep(0.3)
        u.press("enter"); time.sleep(0.8)
        print("tag:", tag)

    shot("_j1_tags.png")
    print("tags done")
