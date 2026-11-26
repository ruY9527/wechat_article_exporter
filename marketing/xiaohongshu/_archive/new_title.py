# -*- coding: utf-8 -*-
"""填标题：先点正文（已验证可聚焦）→ Shift+Tab 回到标题 → 粘贴"""
import ctypes
import os
import time

ctypes.windll.shcore.SetProcessDpiAwareness(2)

import forcefg       # noqa: E402
import uiauto as u   # noqa: E402

HWND = 531982
BASE = os.path.dirname(os.path.abspath(__file__))

BODY_POS = (900, 302)
TITLE = "公众号好文，一键变成能存一辈子的文件"


def shot(n):
    u.screenshot(os.path.join(BASE, n))
    print("  ->", n)


if __name__ == "__main__":
    forcefg.force_foreground(HWND); time.sleep(0.8)

    # 点正文占位区
    u.move(*BODY_POS); time.sleep(0.3)
    u.click(*BODY_POS, wait=1.2)
    time.sleep(0.5)
    shot("_t1_bodyfocus.png")

    # Shift+Tab 反向切到标题
    u.hotkey("shift", "tab"); time.sleep(0.8)
    shot("_t2_aftertab.png")

    # 粘贴标题
    u.set_clipboard(TITLE); time.sleep(0.4)
    u.hotkey("ctrl", "v"); time.sleep(1.6)
    shot("_t3_title.png")
    print("done")
