# -*- coding: utf-8 -*-
"""在正文末尾追加标签（正文 960/1000，需先精简腾出空间）"""
import ctypes
import os
import time

ctypes.windll.shcore.SetProcessDpiAwareness(2)

import forcefg       # noqa: E402
import uiauto as u   # noqa: E402

HWND = 1252932
BASE = os.path.dirname(os.path.abspath(__file__))


def shot(n):
    u.screenshot(os.path.join(BASE, n))


def main():
    forcefg.force_foreground(HWND); time.sleep(0.6)
    # 点正文末尾
    u.click(400, 141, wait=1.0)
    forcefg.force_foreground(HWND); time.sleep(0.4)
    u.hotkey("ctrl", "end")
    time.sleep(0.6)
    shot("_q0.png")
    print("at end of body")


if __name__ == "__main__":
    main()
