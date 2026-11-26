# -*- coding: utf-8 -*-
"""
完整流程（带每步验证）：
1. 上传 5 张图（Win32 对话框）
2. 精确点击标题框 → 粘贴标题 → 截图验证
3. 点正文框 → 粘贴正文 → 截图验证
4. 追加标签
5. 暂存离开
"""
import ctypes
import os
import sys
import time
from ctypes import wintypes

ctypes.windll.shcore.SetProcessDpiAwareness(2)

import forcefg       # noqa: E402
import uiauto as u   # noqa: E402
import winlist       # noqa: E402

user32 = ctypes.WinDLL("user32", use_last_error=True)
user32.FindWindowW.restype = wintypes.HWND
user32.SendMessageW.restype = ctypes.c_ssize_t
user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT,
                                wintypes.WPARAM, ctypes.c_void_p]
user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]

BASE = os.path.dirname(os.path.abspath(__file__))
FILES = ["01-cover.png", "02-popup.png", "03-formats.png", "04-data.png", "05-install.png"]

HWND = None

# 上传页布局（窗口左上角 10,10）
UP_BTN = (537, 726)
TITLE_BOX = (400, 130)      # 「填写标题会有更多赞哦」
BODY_BOX = (400, 200)       # 「输入正文描述」
SAVE_BTN = (550, 1335)      # 「暂存离开」

TITLE = "公众号好文，一键变成能存一辈子的文件"

BODY = """先说一个我憋了很久的事。

收藏夹里几百篇公众号文章，当时都觉得「以后一定用得上」。结果这两年回头翻，一半打不开了——作者删号、图床过期、被下架。就算页面还在，图也全变成灰框，微信图床有防盗链，换个环境打开就是空白。

最讽刺的是：我收藏的时候以为自己留住了它，其实只是留了一个链接。

后来我自己写了个 Chrome 扩展，把这件事彻底解决掉。

打开任意一篇公众号文章，点一下，三选一：

① Markdown + 图片 ZIP（最完整）
解压后是 文章标题.md + images/ 文件夹。md 里所有图片链接都重写成 ./images/img_001.png，图片真的下载到本地了。拖进 Typora / Obsidian / VS Code 直接看，断网也能正常渲染。

② 纯 .md（最轻）
不下载图片，保留原图链接，只要文字，几 KB。

③ 高保真 PDF（最好读）
图片全量预热、打印样式注入、分层分页控制。文字是矢量的，能选中、能搜索、能复制。

三个我在意的点：

纯本地处理。没有任何后端服务器，不收数据，不上传任何东西。代码 MIT 开源，可以自己审。
完全免费。没会员、没付费版、没广告。
68 项自动化测试。连 PDF 排版都是量化闸门守着的。

说到排版，我被人怼过一次。他发来导出的 PDF 说「你这导的什么垃圾，一页大半页是空的，图还是灰块」。

我量了：单页最大空白 609pt，A4 整页才 842pt，等于 72% 的版面是空的，11 张图全渲染成灰块。原因是我一开始把所有不能拆的元素都设成 break-inside: avoid，一个大块在页底放不下就整块推到下一页，上一页自然空掉。

后来改成分层处理，打印前逐张确认图片真的解码成功，失败的压平。再量：最大空白 27.2pt，灰块 0 张。

一个导出的动作，如果连排版都不对，那跟截图有什么区别。

装上两分钟：GitHub 下载 ZIP，chrome://extensions 打开开发者模式，加载 src 目录，Pin 一下。没上架商店，因为一个人维护，上架要交开发者费还要过审，手动加载一次就行。

项目地址：github.com/ruY9527/wechat_article_exporter

有问题开 issue，我都会看。点个 star 就是最好的支持"""

TAGS = ["公众号文章导出", "效率工具", "开源项目", "知识管理"]


def shot(n):
    p = os.path.join(BASE, n)
    u.screenshot(p)
    print("  shot:", n)
    return p


def find_xhs():
    for h, t, r in winlist.list_chrome():
        if "创作" in t or "creator" in t.lower():
            return h
    return None


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


def set_text(h, text):
    buf = ctypes.create_unicode_buffer(text, len(text) + 1)
    user32.SendMessageW(h, 0x000C, 0, ctypes.cast(buf, ctypes.c_void_p))


def get_text(h, cap=8192):
    buf = ctypes.create_unicode_buffer(cap)
    user32.SendMessageW(h, 0x000D, cap, ctypes.cast(buf, ctypes.c_void_p))
    return buf.value


def upload():
    print("[1] upload")
    forcefg.force_foreground(HWND); time.sleep(0.6)
    u.click(*UP_BTN, wait=1.5)

    dlg = None
    for _ in range(30):
        dlg = user32.FindWindowW("#32770", "打开") or user32.FindWindowW("#32770", None)
        if dlg:
            break
        time.sleep(0.5)
    if not dlg:
        raise RuntimeError("对话框未出现")

    edits = enum_children(dlg, "Edit")
    set_text(edits[0], " ".join('"%s"' % os.path.join(BASE, f) for f in FILES))
    time.sleep(0.5)
    if "05-install.png" not in get_text(edits[0]):
        raise RuntimeError("路径写入失败")

    for b in enum_children(dlg, "Button"):
        if get_text(b, 64) in ("打开(O)", "打开", "&Open"):
            user32.SendMessageW(b, 0x00F5, 0, None)
            break
    print("  等待上传…")
    time.sleep(14)
    forcefg.force_foreground(HWND); time.sleep(1.5)
    shot("_v1_uploaded.png")


if __name__ == "__main__":
    HWND = find_xhs()
    if not HWND:
        raise SystemExit("找不到小红书窗口")
    print("hwnd:", HWND)
    upload()
