# -*- coding: utf-8 -*-
"""标题输入三策略对比测试（每个策略后截图，通过文字是否出现判定）"""
import ctypes
import os
import time

ctypes.windll.shcore.SetProcessDpiAwareness(2)

import forcefg       # noqa: E402
import uiauto as u   # noqa: E402

HWND = 1252932
BASE = os.path.dirname(os.path.abspath(__file__))
user32 = ctypes.WinDLL("user32")
TITLE = "公众号好文一键变成能存一辈子的文件"


def shot(n):
    u.screenshot(os.path.join(BASE, n))


def uni_char(ch):
    code = ord(ch)
    user32.keybd_event(0, code, 0x0004, 0)
    time.sleep(0.008)
    user32.keybd_event(0, code, 0x0004 | 0x0002, 0)
    time.sleep(0.008)


def type_unicode(s):
    for ch in s:
        uni_char(ch)


def clear_focus():
    forcefg.force_foreground(HWND)
    time.sleep(0.4)


if __name__ == "__main__":
    # 策略 A：点正文（已知有效）→ Shift+Tab 回到标题
    clear_focus()
    u.click(300, 245, wait=1.0)
    clear_focus(); time.sleep(0.4)
    u.hotkey("shift", "tab"); time.sleep(0.6)
    clear_focus(); time.sleep(0.3)
    type_unicode("AAA")
    time.sleep(0.8)
    shot("_s_A.png")
    print("A done")

    # 策略 B：点标题框正上方一点
    clear_focus()
    u.click(300, 208, wait=1.0)
    clear_focus(); time.sleep(0.4)
    type_unicode("BBB")
    time.sleep(0.8)
    shot("_s_B.png")
    print("B done")

    # 策略 C：点标题框文字左侧空白处
    clear_focus()
    u.click(196, 210, wait=1.0)
    clear_focus(); time.sleep(0.4)
    type_unicode("CCC")
    time.sleep(0.8)
    shot("_s_C.png")
    print("C done")
