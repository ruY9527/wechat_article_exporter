# -*- coding: utf-8 -*-
"""抖音标题：点描述区聚焦 → Shift+Tab 反向跳到标题 input → 粘贴"""
import ctypes
import os
import time

import douyin_config as C

import uiauto as u      # noqa: E402
import forcefg           # noqa: E402
import winlist           # noqa: E402

BASE = os.path.dirname(os.path.abspath(__file__))
DESC_AREA = (1180, 300)
TITLE = "公众号好文一键存成文件"


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

    # 聚焦描述区
    u.move(*DESC_AREA); time.sleep(0.3)
    u.click(*DESC_AREA, wait=1.4)
    time.sleep(0.5)
    shot("_dt0_desc.png")

    # 反向 Tab 到标题
    u.hotkey("shift", "tab")
    time.sleep(1.0)
    shot("_dt1_tab.png")

    u.set_clipboard(TITLE)
    time.sleep(0.45)
    forcefg.force_foreground(C.HWND)
    u.hotkey("ctrl", "v")
    time.sleep(1.8)
    shot("_dt2_title.png")
    print("done")
