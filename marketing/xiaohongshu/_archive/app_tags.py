# -*- coding: utf-8 -*-
"""正文已有。追加标签：点正文末尾 → 输入 #标签
   小红书编辑器里输入 # 会弹出话题下拉，回车即选中。
"""
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


def type_tag(tag):
    """输入一个标签：先 #，再逐字输入，最后按 Enter 选中下拉项"""
    forcefg.force_foreground(HWND)
    u.set_clipboard("#" + tag)
    time.sleep(0.3)
    forcefg.force_foreground(HWND)
    u.hotkey("ctrl", "v")
    time.sleep(1.2)          # 等下拉出现
    forcefg.force_foreground(HWND)
    u.press("enter")
    time.sleep(0.6)


def main():
    forcefg.force_foreground(HWND); time.sleep(0.5)

    # 点到正文最后一行（「有问题开 issue，我都会看。点个 star 就是最好的支持 ⭐」）
    u.click(300, 700, wait=1.0)
    forcefg.force_foreground(HWND); time.sleep(0.4)

    # 移到文末
    u.hotkey("ctrl", "end")
    time.sleep(0.5)
    shot("_t0.png")

    # 换行后逐个加标签
    u.press("enter")
    time.sleep(0.3)

    for i, tag in enumerate(TAGS):
        type_tag(tag)
        if i == 4:
            shot("_t1.png")
    shot("_t2.png")
    print("tags done")


if __name__ == "__main__":
    main()
