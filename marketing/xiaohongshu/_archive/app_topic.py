# -*- coding: utf-8 -*-
"""点「话题」按钮添加标签（不占正文字数）"""
import ctypes
import os
import time

ctypes.windll.shcore.SetProcessDpiAwareness(2)

import forcefg       # noqa: E402
import uiauto as u   # noqa: E402

HWND = 1252932
BASE = os.path.dirname(os.path.abspath(__file__))

TAGS = ["公众号文章导出", "微信公众号", "Markdown", "效率工具", "Chrome插件",
        "开源项目", "Obsidian", "知识管理", "第二大脑", "笔记软件"]


def shot(n):
    u.screenshot(os.path.join(BASE, n))


def main():
    forcefg.force_foreground(HWND); time.sleep(0.6)
    # 关掉位置授权浮层（「一律不允许」）
    u.click(137, 224, wait=1.2)
    forcefg.force_foreground(HWND); time.sleep(0.6)
    shot("_p0.png")
    print("closed geo popup")

    # 点「话题」
    forcefg.force_foreground(HWND); time.sleep(0.4)
    u.click(222, 176, wait=1.5)
    forcefg.force_foreground(HWND); time.sleep(1.0)
    shot("_p1.png")
    print("clicked 话题")


if __name__ == "__main__":
    main()
