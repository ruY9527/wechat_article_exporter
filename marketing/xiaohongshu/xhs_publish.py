# -*- coding: utf-8 -*-
"""
小红书图文草稿 —— 一键执行

用法:
    python xhs_publish.py                 # 走完整流程（导航→上传→标题→正文→标签→保存）
    python xhs_publish.py --from title    # 从某一步开始（title/body/tags/save）
    python xhs_publish.py --no-nav        # 不导航，直接用当前页面

终点是「暂存离开」存草稿，绝不点「发布」。
坐标与文案全部从 xhs_config.py 读，换环境只改那个文件。

详细说明见 PLAYBOOK.md
"""
import argparse
import ctypes
import os
import sys
import time
from ctypes import wintypes

import xhs_config as C   # 导入即设置 DPI 感知

import uiauto as u       # noqa: E402
import forcefg            # noqa: E402
import winlist            # noqa: E402

user32 = ctypes.WinDLL("user32", use_last_error=True)
user32.FindWindowW.restype = wintypes.HWND
user32.SendMessageW.restype = ctypes.c_ssize_t
user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT,
                                wintypes.WPARAM, ctypes.c_void_p]
user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]

WM_SETTEXT, WM_GETTEXT, BM_CLICK = 0x000C, 0x000D, 0x00F5
BASE = os.path.dirname(os.path.abspath(__file__))


# ---------------- 基础 ----------------
def log(msg):
    print(f"  {msg}", flush=True)


def shot(tag):
    p = os.path.join(BASE, f"_xhs_{tag}.png")
    u.screenshot(p)
    log(f"截图 {os.path.basename(p)}")
    return p


def find_window():
    key = C.WINDOW_KEYWORD
    for h, title, rect in winlist.list_chrome():
        if key in title or "creator" in title.lower():
            return h
    raise RuntimeError("找不到小红书创作平台窗口，请先在 Chrome 打开该页面")


def focus():
    if not forcefg.force_foreground(C.HWND):
        raise RuntimeError("无法把窗口切到前台")


def paste_at(pos, text, tag, t_focus=None, t_paste=None):
    """点坐标 → 粘贴 → 截图验证"""
    focus()
    u.move(*pos)
    time.sleep(0.3)
    u.click(*pos, wait=t_focus or C.T_FOCUS)
    u.set_clipboard(text)
    time.sleep(0.4)
    focus()
    u.hotkey("ctrl", "v")
    time.sleep(t_paste or C.T_PASTE)
    shot(tag)


# ---------------- 文件对话框 ----------------
def enum_children(dlg, klass):
    found = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def cb(h, _):
        b = ctypes.create_unicode_buffer(64)
        user32.GetClassNameW(h, b, 64)
        if b.value == klass:
            found.append(h)
        return True

    user32.EnumChildWindows(dlg, cb, 0)
    return found


def get_text(h, cap=8192):
    buf = ctypes.create_unicode_buffer(cap)
    user32.SendMessageW(h, WM_GETTEXT, cap, ctypes.cast(buf, ctypes.c_void_p))
    return buf.value


def set_text(h, text):
    buf = ctypes.create_unicode_buffer(text, len(text) + 1)
    user32.SendMessageW(h, WM_SETTEXT, 0, ctypes.cast(buf, ctypes.c_void_p))


def cancel_dialog():
    """兜底：若有残留对话框，取消掉"""
    dlg = user32.FindWindowW("#32770", "打开") or user32.FindWindowW("#32770", None)
    if not dlg:
        return False
    for b in enum_children(dlg, "Button"):
        if "取消" in get_text(b, 64):
            user32.SendMessageW(b, BM_CLICK, 0, None)
            time.sleep(1.2)
            return True
    return False


# ---------------- 步骤 ----------------
def step_nav():
    print("[导航]")
    focus()
    u.hotkey("ctrl", "l")
    time.sleep(0.5)
    u.set_clipboard(C.URL)
    time.sleep(0.4)
    focus()
    u.hotkey("ctrl", "v")
    time.sleep(0.4)
    u.press("enter")
    time.sleep(7)
    focus()
    shot("01_nav")


def step_upload():
    print("[上传图片]")
    cancel_dialog()
    focus()

    paths = [os.path.join(BASE, f) for f in C.IMAGES]
    missing = [p for p in paths if not os.path.isfile(p)]
    if missing:
        raise FileNotFoundError(missing[0])

    u.click(*C.UPLOAD_BTN, wait=2.0)

    dlg = None
    for _ in range(int(C.T_DIALOG / 0.5)):
        dlg = user32.FindWindowW("#32770", "打开") or user32.FindWindowW("#32770", None)
        if dlg:
            break
        time.sleep(0.5)
    if not dlg:
        raise RuntimeError("文件对话框未出现 —— 上传按钮坐标可能偏了")
    log(f"对话框 {dlg}")

    edits = enum_children(dlg, "Edit")
    if not edits:
        raise RuntimeError("找不到文件名输入框")
    set_text(edits[0], " ".join(f'"{p}"' for p in paths))
    time.sleep(0.6)
    if C.IMAGES[-1] not in get_text(edits[0]):
        raise RuntimeError("路径写入失败")
    log("路径已写入")

    for b in enum_children(dlg, "Button"):
        if "打开" in get_text(b, 64):
            user32.SendMessageW(b, BM_CLICK, 0, None)
            log("已点打开")
            break

    time.sleep(C.T_UPLOAD)
    focus()
    shot("02_uploaded")


def step_title():
    print("[填写标题]")
    paste_at(C.TITLE_BOX, C.TITLE, "03_title")


def step_body():
    print("[填写正文]")
    paste_at(C.BODY_BOX, C.BODY, "04_body", t_paste=3.0)
    # 回开头截图，确认第一段在（避免只看到中间段落的误判）
    u.hotkey("ctrl", "home")
    time.sleep(1.0)
    shot("04b_body_top")


def step_tags():
    print("[追加标签]")
    focus()
    u.click(*C.TAGS_ANCHOR, wait=1.0)
    time.sleep(0.5)
    u.hotkey("ctrl", "end")
    time.sleep(1.0)
    u.press("enter")
    time.sleep(0.4)

    for tag in C.TAGS:
        u.set_clipboard("#" + tag)
        time.sleep(0.4)
        focus()
        u.hotkey("ctrl", "v")
        time.sleep(1.4)
        focus()
        u.press("enter")
        time.sleep(0.8)
        log(tag)
    shot("05_tags")


def step_save():
    # 本脚本永不点击发布，PUBLISH_BTN 仅作记录
    print("[保存草稿]")
    focus()
    u.move(*C.SAVE_BTN)
    time.sleep(0.3)
    u.click(*C.SAVE_BTN, wait=C.T_SAVE)
    time.sleep(1.5)
    shot("06_saved")
    log("请核对截图：顶部应出现绿色「保存成功」")


STEPS = [("nav", step_nav), ("upload", step_upload), ("title", step_title),
         ("body", step_body), ("tags", step_tags), ("save", step_save)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="start", default="nav",
                    choices=[s for s, _ in STEPS], help="从哪一步开始")
    ap.add_argument("--no-nav", action="store_true", help="跳过导航")
    a = ap.parse_args()

    C.HWND = find_window()
    print(f"窗口: {C.HWND}")

    names = [s for s, _ in STEPS]
    begin = 1 if a.no_nav else names.index(a.start)
    if a.start != "nav":
        begin = names.index(a.start)

    try:
        for name, fn in STEPS[begin:]:
            fn()
        print("\n完成。草稿已在草稿箱，请人工审核后再发布。")
    finally:
        cancel_dialog()


if __name__ == "__main__":
    main()
