# -*- coding: utf-8 -*-
"""在独立 app 窗口中上传 5 张图（CF_HDROP 剪贴板粘贴）"""
import ctypes
import os
import time

ctypes.windll.shcore.SetProcessDpiAwareness(2)

import clipfile as cf   # noqa: E402
import uiauto as u      # noqa: E402
import winfocus as wf   # noqa: E402

HWND = 41949210
BASE = os.path.dirname(os.path.abspath(__file__))
FILES = ["01-cover.png", "02-popup.png", "03-formats.png", "04-data.png", "05-install.png"]
PATHS = [os.path.join(BASE, f) for f in FILES]

# 该窗口内关键坐标（窗口从 (10,10) 起，宽 1265）
UP_BTN = (683, 723)        # 上传图片按钮
ZONE = (660, 700)


def shot(name):
    u.screenshot(os.path.join(BASE, name))


if __name__ == "__main__":
    cf.set_files(PATHS)
    print("clip files:", cf.has_files())

    wf.ensure(HWND)
    time.sleep(0.4)

    # 先点上传区，让页面拿到焦点
    u.move(*ZONE)
    time.sleep(0.2)
    wf.ensure(HWND)
    u.click(*ZONE, wait=1.0)
    print("focus ok:", wf.foreground() == HWND)
    shot("_u1.png")

    # 粘贴文件
    wf.ensure(HWND)
    u.hotkey("ctrl", "v")
    time.sleep(8)
    shot("_u2.png")
    print("pasted")
