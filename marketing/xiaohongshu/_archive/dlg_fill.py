# -*- coding: utf-8 -*-
"""在已弹出的文件选择框中填入 5 个图片完整路径并确认"""
import ctypes
import os
import time

ctypes.windll.shcore.SetProcessDpiAwareness(2)

import uiauto as u      # noqa: E402
import winfocus as wf   # noqa: E402

BASE = os.path.dirname(os.path.abspath(__file__))
FILES = ["01-cover.png", "02-popup.png", "03-formats.png", "04-data.png", "05-install.png"]

# 文件对话框的「文件名」输入框（按截图定位）
FILENAME_BOX = (600, 631)
OPEN_BTN = (716, 671)


def find_dialog():
    """查找标准打开对话框（#32770）"""
    import ctypes as C
    from ctypes import wintypes
    user32 = C.WinDLL("user32")
    hwnds = []

    @C.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def cb(h, _):
        if not user32.IsWindowVisible(h):
            return True
        c = C.create_unicode_buffer(64)
        user32.GetClassNameW(h, c, 64)
        if c.value == "#32770":
            hwnds.append(h)
        return True

    user32.EnumWindows(cb, 0)
    return hwnds


if __name__ == "__main__":
    print("dialogs:", find_dialog())
    paths = " ".join('"%s"' % os.path.join(BASE, f) for f in FILES)

    # 直接点文件名框（对话框是模态的，会自己保持前台）
    u.click(*FILENAME_BOX, wait=0.5)
    u.set_clipboard(paths)
    time.sleep(0.4)
    u.hotkey("ctrl", "v")
    time.sleep(0.8)
    u.screenshot(os.path.join(BASE, "_dlg1.png"))
    print("filled")
