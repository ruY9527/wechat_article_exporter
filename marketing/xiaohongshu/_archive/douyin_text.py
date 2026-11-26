# -*- coding: utf-8 -*-
"""抖音图文：填标题 + 描述 + 话题标签"""
import ctypes
import os
import time

import douyin_config as C

import uiauto as u      # noqa: E402
import forcefg           # noqa: E402
import winlist           # noqa: E402

BASE = os.path.dirname(os.path.abspath(__file__))


def find_window():
    for h, t, r in winlist.list_chrome():
        if C.WINDOW_KEYWORD in t:
            return h
    raise RuntimeError("找不到抖音窗口")


def shot(n):
    u.screenshot(os.path.join(BASE, n))
    print("  ->", n)


def focus():
    forcefg.force_foreground(C.HWND)


def paste_at(pos, text, tag, t_paste=None):
    focus()
    u.move(*pos)
    time.sleep(0.3)
    u.click(*pos, wait=C.T_FOCUS)
    u.set_clipboard(text)
    time.sleep(0.45)
    focus()
    u.hotkey("ctrl", "v")
    time.sleep(t_paste or C.T_PASTE)
    shot(tag)


if __name__ == "__main__":
    C.HWND = find_window()
    print("window:", C.HWND)
    focus()
    time.sleep(0.8)

    # 1) 标题
    print("[标题]")
    paste_at(C.TITLE_INPUT, C.TITLE, "_dy2_title.png")

    # 2) 描述
    print("[描述]")
    paste_at(C.DESC_INPUT, C.BODY, "_dy3_desc.png", t_paste=3.0)
