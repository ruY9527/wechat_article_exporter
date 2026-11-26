# -*- coding: utf-8 -*-
import ctypes, time
import uiauto as u, forcefg
from ctypes import wintypes

ctypes.windll.shcore.SetProcessDpiAwareness(2)
user32 = ctypes.WinDLL("user32")
H = 531982

TITLE = "科研人必存：20个本地技能"

BODY = """读研最累的不是做实验，是不知道下一步该用哪个工具。

我把常用的20个本地技能整理成4张图，不用记命令，照着调用就行。

①NATURE｜科研日常5个实用技能
查文献、读论文、写文章、做配图、做汇报，一条线走完。适合研究生和科研工作者。

②CCF｜让科研想法一步步落地
打磨想法、复现代码、设计实验、审稿、绘图。模糊的点子丢进去，出来的是问题、机制和证据计划。适合计算机科研和模型实验。

③RESEARCH｜把证据链理清楚
找论文、查创新、排实验、审结果、写审稿回复。选题论证到投稿返修全覆盖。

④FIRECRAWL｜把网页变成可用资料
深度调研、论文检索、知识库、竞品追踪、提取设计规范（这个要配 Firecrawl API Key）。

20个不用全记，先挑你现在最卡的那一步，试一个就够了。图按01/04到04/04排，先收藏慢慢看。"""

TAGS = ["CodexSkills", "科研工具", "研究生日常", "AI效率工具"]

def ff():
    for _ in range(20):
        forcefg.force_foreground(H)
        time.sleep(0.2)
        if user32.GetForegroundWindow() == H:
            return True
    return False

def paste_at(pos, text, tag, t=2.0):
    ff()
    u.move(*pos)
    time.sleep(0.3)
    u.click(*pos, wait=0)
    time.sleep(1.3)
    u.set_clipboard(text)
    time.sleep(0.4)
    u.hotkey("ctrl", "v")
    time.sleep(t)
    u.screenshot("_%s.png" % tag)
    print("pasted", tag)

# 1) 标题（先于描述）
paste_at((1100, 316), TITLE, "dy_title")

# 2) 描述
paste_at((1100, 353), BODY, "dy_desc", t=2.5)

# 3) 标签
ff()
u.move(1100, 353)
time.sleep(0.2)
u.click(1100, 353, wait=0)
time.sleep(0.6)
u.hotkey("ctrl", "end")
time.sleep(0.6)
u.press("enter")
time.sleep(0.5)
for tg in TAGS:
    u.set_clipboard("#" + tg)
    time.sleep(0.4)
    u.hotkey("ctrl", "v")
    time.sleep(1.2)
    u.press("enter")
    time.sleep(0.8)
    print("tag", tg)
u.screenshot("_dy_tags.png")
print("all done")
