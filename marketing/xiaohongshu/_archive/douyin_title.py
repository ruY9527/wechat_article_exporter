# -*- coding: utf-8 -*-
"""抖音：把标题插到描述编辑器最前面（抖音图文标题是编辑器首行，上限 20 字）"""
import ctypes
import os
import time

import douyin_config as C

import uiauto as u      # noqa: E402
import forcefg           # noqa: E402
import winlist           # noqa: E402

BASE = os.path.dirname(os.path.abspath(__file__))
EDITOR = (1180, 240)


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

    # 点编辑器内部（描述正文区）
    u.move(*EDITOR)
    time.sleep(0.3)
    u.click(*EDITOR, wait=1.4)
    time.sleep(0.5)

    # 移到最开头
    u.hotkey("ctrl", "home")
    time.sleep(1.0)
    shot("_dy4_home.png")

    # 粘贴标题 + 换行，让它成为首行
    u.set_clipboard(C.TITLE + "\n")
    time.sleep(0.45)
    forcefg.force_foreground(C.HWND)
    u.hotkey("ctrl", "v")
    time.sleep(1.8)
    shot("_dy5_title.png")
    print("title inserted")
