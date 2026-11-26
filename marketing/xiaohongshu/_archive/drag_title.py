# -*- coding: utf-8 -*-
"""用真实拖拽（mouse down-move-up）激活标题区，模拟人手操作"""
import ctypes
import os
import time

ctypes.windll.shcore.SetProcessDpiAwareness(2)

import forcefg       # noqa: E402
import uiauto as u   # noqa: E402

HWND = 531982
BASE = os.path.dirname(os.path.abspath(__file__))
user32 = ctypes.WinDLL("user32")

MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_MOVE = 0x0001


def drag(x1, y1, x2, y2, steps=12):
    u.move(x1, y1)
    time.sleep(0.15)
    user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    time.sleep(0.12)
    for i in range(1, steps + 1):
        x = int(x1 + (x2 - x1) * i / steps)
        y = int(y1 + (y2 - y1) * i / steps)
        user32.SetCursorPos(x, y)
        time.sleep(0.03)
    time.sleep(0.1)
    user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    time.sleep(0.4)


def shot(n):
    u.screenshot(os.path.join(BASE, n))
    print("  ->", n)


if __name__ == "__main__":
    forcefg.force_foreground(HWND); time.sleep(0.8)

    # 在标题行拖拽选中
    drag(730, 274, 1000, 274)
    time.sleep(0.6)
    shot("_d1_drag.png")

    # 立刻粘贴
    u.set_clipboard("公众号好文，一键变成能存一辈子的文件"); time.sleep(0.4)
    u.hotkey("ctrl", "v"); time.sleep(1.6)
    shot("_d2_title.png")
    print("done")
