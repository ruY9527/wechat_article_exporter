# -*- coding: utf-8 -*-
"""在正文末尾追加标签（正文 960/1000，留 40 字余量，只加精简标签）"""
import ctypes
import os
import time

ctypes.windll.shcore.SetProcessDpiAwareness(2)

import forcefg       # noqa: E402
import uiauto as u   # noqa: E402

HWND = 1252932
BASE = os.path.dirname(os.path.abspath(__file__))

# 只加 4 个核心标签，总长约 4×8=32 字符，留出余量
TAGS = ["公众号文章导出", "效率工具", "开源项目", "知识管理"]


def shot(n):
    u.screenshot(os.path.join(BASE, n))


def main():
    forcefg.force_foreground(HWND); time.sleep(0.6)
    # 光标已在正文末尾
    u.press("enter")
    time.sleep(0.4)

    for tag in TAGS:
        u.set_clipboard("#" + tag)
        time.sleep(0.35)
        forcefg.force_foreground(HWND)
        u.hotkey("ctrl", "v")
        time.sleep(1.0)
        forcefg.force_foreground(HWND)
        u.press("enter")       # 选中下拉第一个
        time.sleep(0.5)

    shot("_r1.png")
    print("tags appended")


if __name__ == "__main__":
    main()
