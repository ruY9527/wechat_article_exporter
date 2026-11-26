# -*- coding: utf-8 -*-
"""精确坐标填写标题与正文（y=210 标题 / y=242 正文）"""
import ctypes
import os
import time

ctypes.windll.shcore.SetProcessDpiAwareness(2)

import forcefg       # noqa: E402
import uiauto as u   # noqa: E402

HWND = 1252932
BASE = os.path.dirname(os.path.abspath(__file__))

TITLE_POS = (300, 210)
BODY_POS = (300, 245)
SAVE_POS = (550, 1335)

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
    u.screenshot(os.path.join(BASE, n))
    print("  ->", n)


def paste_at(pos, text, label):
    forcefg.force_foreground(HWND); time.sleep(0.6)
    u.move(*pos); time.sleep(0.35)
    forcefg.force_foreground(HWND); time.sleep(0.2)
    u.click(*pos, wait=1.3)
    forcefg.force_foreground(HWND); time.sleep(0.5)
    u.set_clipboard(text); time.sleep(0.4)
    forcefg.force_foreground(HWND); time.sleep(0.2)
    u.hotkey("ctrl", "v"); time.sleep(1.8)
    forcefg.force_foreground(HWND); time.sleep(0.5)
    shot(f"_final_{label}.png")
    print(label, "pasted")


if __name__ == "__main__":
    paste_at(TITLE_POS, TITLE, "title")
