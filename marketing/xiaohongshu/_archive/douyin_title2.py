# -*- coding: utf-8 -*-
"""抖音：点「添加作品标题」框（y≈210）填标题"""
import ctypes
import os
import time

import douyin_config as C

import uiauto as u      # noqa: E402
import forcefg           # noqa: E402
import winlist           # noqa: E402

BASE = os.path.dirname(os.path.abspath(__file__))
TITLE_BOX = (1250, 210)


def find_window():
    for h, t, r in winlist.list_chrome():
        if C.WINDOW_KEYWORD in t:
            return h
    raise RuntimeError("找不到抖音窗口")


def shot(n):
    u.screenshot(os.path.join(BASE, n))
    print("  ->", n)


if __name__ == "__main__":
    C.HWND = find_window()
    forcefg.force_foreground(C.HWND)
    time.sleep(0.9)

    u.move(*TITLE_BOX)
    time.sleep(0.3)
    u.click(*TITLE_BOX, wait=1.4)
    time.sleep(0.5)

    u.set_clipboard(C.TITLE)
    time.sleep(0.45)
    forcefg.force_foreground(C.HWND)
    u.hotkey("ctrl", "v")
    time.sleep(1.8)
    shot("_dy6_title.png")
    print("title done:", C.TITLE, f"({len(C.TITLE)} 字)")
