# -*- coding: utf-8 -*-
"""y 坐标扫描：找出标题框真正可聚焦的位置。
   每次点 (300,y) 后输入标记字符，最后把标题区域裁图拼成一张对比图。
"""
import ctypes
import os
import time

ctypes.windll.shcore.SetProcessDpiAwareness(2)

import forcefg       # noqa: E402
import uiauto as u   # noqa: E402
from PIL import Image  # noqa: E402

HWND = 1252932
BASE = os.path.dirname(os.path.abspath(__file__))
user32 = ctypes.WinDLL("user32")

YS = [196, 202, 208, 214, 220, 226]


def uni_char(ch):
    code = ord(ch)
    user32.keybd_event(0, code, 0x0004, 0)
    time.sleep(0.01)
    user32.keybd_event(0, code, 0x0004 | 0x0002, 0)
    time.sleep(0.01)


def type_u(s):
    for ch in s:
        uni_char(ch)


if __name__ == "__main__":
    crops = []
    for i, y in enumerate(YS):
        forcefg.force_foreground(HWND); time.sleep(0.5)
        u.move(300, y); time.sleep(0.25)
        forcefg.force_foreground(HWND); time.sleep(0.2)
        u.click(300, y, wait=0.7)
        forcefg.force_foreground(HWND); time.sleep(0.35)
        type_u(f"[Y{y}]")
        time.sleep(0.7)
        forcefg.force_foreground(HWND); time.sleep(0.3)
        p = os.path.join(BASE, f"_scan_{y}.png")
        u.screenshot(p)
        crops.append((y, p))
        print("scanned y=", y)

    # 拼接标题条带
    imgs = []
    for y, p in crops:
        im = Image.open(p).crop((180, 185, 1000, 265))
        imgs.append(im)
    w = max(i.width for i in imgs)
    h = sum(i.height for i in imgs) + 6 * (len(imgs) - 1)
    out = Image.new("RGB", (w, h), (255, 255, 255))
    cy = 0
    for i in imgs:
        out.paste(i, (0, cy))
        cy += i.height + 6
    out.save(os.path.join(BASE, "_scan_all.png"))
    print("combined saved")
