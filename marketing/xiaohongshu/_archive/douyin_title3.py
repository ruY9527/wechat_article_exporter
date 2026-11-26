# -*- coding: utf-8 -*-
"""抖音：在描述编辑器开头插入标题行（抖音图文首行即标题）"""
import ctypes
import os
import time

import douyin_config as C

import uiauto as u      # noqa: E402
import forcefg           # noqa: E402
import winlist           # noqa: E402

BASE = os.path.dirname(os.path.abspath(__file__))
DESC_AREA = (1180, 300)     # 描述正文内部（已知可聚焦处）


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

    u.move(*DESC_AREA)
    time.sleep(0.3)
    u.click(*DESC_AREA, wait=1.4)
    time.sleep(0.5)

    u.hotkey("ctrl", "home")
    time.sleep(1.0)
    shot("_dy7_home.png")

    # 首行写标题，再换行接原文
    u.set_clipboard(C.TITLE + "\n")
    time.sleep(0.45)
    forcefg.force_foreground(C.HWND)
    u.hotkey("ctrl", "v")
    time.sleep(2.0)
    shot("_dy8_titlefirst.png")
    print("inserted title at head")
