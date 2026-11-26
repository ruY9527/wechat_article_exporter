# -*- coding: utf-8 -*-
"""
小红书草稿填写 —— 键盘优先方案
1) 关掉旧 app 窗口，重开独立的 app 窗口
2) 用剪贴板 + Tab 序列填标题/正文，避免坐标点击
3) 每一步截图核对
"""
import ctypes
import os
import subprocess
import time

ctypes.windll.shcore.SetProcessDpiAwareness(2)

import forcefg          # noqa: E402
import uiauto as u      # noqa: E402
import winlist          # noqa: E402

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PROFILE = os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\User Data")
URL = "https://creator.xiaohongshu.com/publish/publish?target=image"
BASE = os.path.dirname(os.path.abspath(__file__))


def find_xhs():
    for h, t, r in winlist.list_chrome():
        if "创作服务" in t or "creator" in t.lower():
            return h
    return None


def kill_xhs_window():
    h = find_xhs()
    if h:
        # 关闭窗口（不杀浏览器主进程）
        ctypes.windll.user32.PostMessageW(h, 0x0010, 0, 0)  # WM_CLOSE
        time.sleep(2)


def launch():
    subprocess.Popen([CHROME, f"--user-data-dir={PROFILE}", "--app=" + URL,
                      "--window-size=1500,1150", "--window-position=100,60"],
                     close_fds=True)
    for _ in range(20):
        time.sleep(1.5)
        h = find_xhs()
        if h:
            time.sleep(3)
            return h
    raise RuntimeError("窗口未出现")


def shot(n):
    u.screenshot(os.path.join(BASE, n))


if __name__ == "__main__":
    kill_xhs_window()
    h = launch()
    print("hwnd:", h)
    forcefg.force_foreground(h)
    time.sleep(2)
    shot("_k1.png")
    print("ready")
