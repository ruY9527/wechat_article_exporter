# -*- coding: utf-8 -*-
"""启动一个独立的 Chrome 应用窗口（--app 模式）打开小红书创作页。
同一个 user-data-dir => 复用你已登录的 cookie/会话，且与 DSH 窗口互不抢焦点。
"""
import ctypes
import os
import subprocess
import sys
import time

ctypes.windll.shcore.SetProcessDpiAwareness(2)

CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

# 用你当前正在用的默认 profile（已登录小红书）
PROFILE = os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\User Data")
URL = "https://creator.xiaohongshu.com/publish/publish?target=image"

if __name__ == "__main__":
    # 检测是否已有用该 profile 的 chrome 主进程
    args = [
        CHROME,
        f"--user-data-dir={PROFILE}",
        "--app=" + URL,
        "--window-size=1500,1150",
        "--window-position=100,60",
        "--new-window",
    ]
    # 关键：不加 --remote-debugging，纯 UI 自动化
    p = subprocess.Popen(args, close_fds=True)
    print("launched pid", p.pid)
    time.sleep(6)
    print("waiting for window")
