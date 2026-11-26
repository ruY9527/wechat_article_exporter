# -*- coding: utf-8 -*-
import ctypes, time
import uiauto as u, forcefg
from ctypes import wintypes

ctypes.windll.shcore.SetProcessDpiAwareness(2)
user32 = ctypes.WinDLL("user32")
H = 531982

TITLE = "科研人必存：20个本地神仙技能"

BODY = """读研最累的，不是做实验，是不知道下一步该用什么工具。

我把自己常用的 20 个本地技能，整理成了 4 张图。不用记命令，照着顺序调用就行。

① NATURE｜科研日常，这5个很实用
查文献、读论文、写文章、做配图、做汇报——从 nature-academic-search 到 nature-paper2ppt，一条线走完。适合研究生和科研工作者。

② CCF｜让科研想法一步步落地
打磨想法、科研编程、实验设计、稿件审查、图表设计。模糊的点子丢进去，出来的是问题、机制和证据计划。适合计算机科研和模型实验。

③ RESEARCH｜做研究，把证据链理清楚
论文调研、创新审查、实验规划、结果审计、审稿回复。选题论证、实验分析、投稿返修，每一步都有对应的技能。

④ FIRECRAWL｜把网页信息变成可用资料
深度调研、学术检索、网页知识库、竞品追踪、提取设计规范。做调研和竞品分析的直接用（这个需要配 Firecrawl API Key）。

20 个技能不用全记。先挑你现在最卡的那一步，试一个就够了。

图是按 01/04 到 04/04 排的，存下来慢慢看。"""

TAGS = ["CodexSkills", "科研工具", "研究生日常", "AI效率工具"]

def ff():
    for _ in range(20):
        forcefg.force_foreground(H)
        time.sleep(0.2)
        if user32.GetForegroundWindow() == H:
            return True
    return False

def paste_at(pos, text, tag, t=1.6):
    ff()
    u.move(*pos)
    time.sleep(0.3)
    u.click(*pos, wait=0)
    time.sleep(1.3)
    u.set_clipboard(text)
    u.hotkey("ctrl", "v")
    time.sleep(t)
    u.screenshot("_%s.png" % tag)
    print("pasted", tag)

# 1) 标题（必须在正文之前）
paste_at((900, 400), TITLE, "fill_title")

# 2) 正文
paste_at((900, 446), BODY, "fill_body", t=2.5)

# 3) 标签：光标到正文末尾，回车，逐个 #标签 + 回车
ff()
u.move(900, 446)
time.sleep(0.2)
u.click(900, 446, wait=0)
time.sleep(0.6)
u.hotkey("ctrl", "end")
time.sleep(0.5)
u.press("enter")
time.sleep(0.5)
for tg in TAGS:
    u.set_clipboard("#" + tg)
    u.hotkey("ctrl", "v")
    time.sleep(0.8)
    u.press("enter")
    time.sleep(0.6)
    print("tag", tg)
u.screenshot("_fill_tags.png")
print("all done")
