# -*- coding: utf-8 -*-
"""抖音：追加话题标签 + 保存草稿"""
import ctypes
import os
import time

import douyin_config as C

import uiauto as u      # noqa: E402
import forcefg           # noqa: E402
import winlist           # noqa: E402

BASE = os.path.dirname(os.path.abspath(__file__))
TAGS = ["公众号文章导出", "效率工具", "开源项目", "知识管理"]
DESC_END = (1180, 400)      # 描述区（用于 Ctrl+End）
SAVE_BTN = (1101, 1300)     # 暂存离开（滚到底后）


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

    # 1) 光标到描述末尾
    u.move(*DESC_END)
    time.sleep(0.3)
    u.click(*DESC_END, wait=1.4)
    time.sleep(0.4)
    u.hotkey("ctrl", "end")
    time.sleep(1.0)
    shot("_tag0_end.png")

    # 2) 逐个加话题
    u.press("enter")
    time.sleep(0.5)
    for tag in TAGS:
        u.set_clipboard("#" + tag)
        time.sleep(0.45)
        forcefg.force_foreground(C.HWND)
        u.hotkey("ctrl", "v")
        time.sleep(1.5)
        # 抖音话题需要下拉选中，回车确认
        u.press("enter")
        time.sleep(0.9)
        print("tag:", tag)

    shot("_tag1_done.png")
    print("tags done")
