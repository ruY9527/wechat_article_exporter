# -*- coding: utf-8 -*-
"""诊断：点击标题框后，直接发送按键字符，看是否进入输入框
   若字符出现 → 点击有效，问题在剪贴板粘贴
   若字符不出现 → 点击未命中，需要换定位方式
"""
import ctypes
import os
import time

ctypes.windll.shcore.SetProcessDpiAwareness(2)

import forcefg       # noqa: E402
import uiauto as u   # noqa: E402

HWND = 1252932
BASE = os.path.dirname(os.path.abspath(__file__))
user32 = ctypes.WinDLL("user32")


def shot(n):
    u.screenshot(os.path.join(BASE, n))
    print("  ->", n)


def send_unicode_char(ch):
    """用 KEYEVENTF_UNICODE 直接发送一个字符"""
    code = ord(ch)
    user32.keybd_event(0, code, 0x0004, 0)          # KEYDOWN | UNICODE
    time.sleep(0.01)
    user32.keybd_event(0, code, 0x0004 | 0x0002, 0)  # KEYUP | UNICODE
    time.sleep(0.01)


if __name__ == "__main__":
    forcefg.force_foreground(HWND); time.sleep(0.7)

    # 试多个候选点
    for pos in [(250, 210), (300, 211), (400, 210)]:
        forcefg.force_foreground(HWND); time.sleep(0.3)
        u.click(*pos, wait=0.8)
        forcefg.force_foreground(HWND); time.sleep(0.4)
        for ch in "测A":
            send_unicode_char(ch)
        time.sleep(0.6)
        shot(f"_diag_{pos[0]}_{pos[1]}.png")
        print("tried", pos)
