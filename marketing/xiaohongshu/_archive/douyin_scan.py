# -*- coding: utf-8 -*-
"""y 扫描：在标题框纵向范围逐点测试，用「0/20」计数器变化判定聚焦位置"""
import ctypes
import os
import time

import douyin_config as C

import uiauto as u      # noqa: E402
import forcefg           # noqa: E402
import winlist           # noqa: E402
from PIL import Image    # noqa: E402

BASE = os.path.dirname(os.path.abspath(__file__))
YS = [196, 202, 208, 214, 220, 226]
X = 1150

# 计数器区域（右上角 0/20）
COUNTER_BOX = (1480, 195, 1560, 225)


def find_window():
    for h, t, r in winlist.list_chrome():
        if C.WINDOW_KEYWORD in t:
            return h
    raise RuntimeError("找不到抖音窗口")


def counter_digits(path):
    """粗判：计数器区域有多少深色像素（有数字就比空的时候多）"""
    im = Image.open(path).convert("L").crop(COUNTER_BOX)
    px = list(im.getdata())
    return sum(1 for v in px if v < 160)


if __name__ == "__main__":
    C.HWND = find_window()
    forcefg.force_foreground(C.HWND)
    time.sleep(0.9)

    u.screenshot(os.path.join(BASE, "_scan_base.png"))
    base = counter_digits(os.path.join(BASE, "_scan_base.png"))
    print("baseline dark px:", base)

    for y in YS:
        forcefg.force_foreground(C.HWND)
        time.sleep(0.4)
        u.move(X, y)
        time.sleep(0.25)
        u.click(X, y, wait=1.0)
        time.sleep(0.4)
        # 输入一个字符
        u.hotkey("ctrl", "a")
        time.sleep(0.2)
        u.set_clipboard("A")
        time.sleep(0.3)
        u.hotkey("ctrl", "v")
        time.sleep(1.2)
        p = os.path.join(BASE, f"_scan_y{y}.png")
        u.screenshot(p)
        d = counter_digits(p)
        print(f"y={y}: counter dark={d}  {'<<< 命中' if d > base + 3 else ''}")
