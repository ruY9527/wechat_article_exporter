# -*- coding: utf-8 -*-
"""
小红书推广图渲染器 — 微信公众号文章导出助手
输出 1080x1440 (3:4) PNG，2x 超采样后 LANCZOS 降采样。
所有卡片高度由测量驱动，避免溢出。
运行: python marketing/xiaohongshu/render.py
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

S = 2
W, H = 1080, 1440
OUT = os.path.dirname(os.path.abspath(__file__))

GREEN      = (7, 193, 96)
GREEN_DARK = (6, 158, 82)
GREEN_DEEP = (16, 105, 61)
GREEN_SOFT = (233, 250, 240)
GREEN_LINE = (183, 235, 208)
INK        = (31, 35, 41)
INK_SOFT   = (108, 116, 127)
INK_FAINT  = (152, 160, 171)
WHITE      = (255, 255, 255)
SOFT       = (246, 247, 249)
BORDER     = (228, 231, 235)
AMBER      = (183, 121, 31)
AMBER_SOFT = (255, 248, 235)
RED        = (214, 69, 41)
RED_SOFT   = (253, 236, 232)
SLATE      = (55, 65, 81)
SLATE_SOFT = (241, 244, 248)

FD = r"C:\Windows\Fonts"
FONTS = {
    "bold":  ("msyhbd.ttc", 0),
    "reg":   ("msyh.ttc", 0),
    "light": ("msyhl.ttc", 0),
    "mono":  ("consola.ttf", 0),
    "monob": ("consolab.ttf", 0),
}
_c = {}


def F(size, kind="reg"):
    k = (kind, round(size, 2))
    if k not in _c:
        fn, idx = FONTS[kind]
        _c[k] = ImageFont.truetype(os.path.join(FD, fn), max(1, int(round(size * S))), index=idx)
    return _c[k]


class Cv:
    def __init__(self, w=W, h=H):
        self.w, self.h = w, h
        self.img = Image.new("RGB", (w * S, h * S), WHITE)
        self.d = ImageDraw.Draw(self.img)

    # ---- primitives
    def vgrad(self, top, bottom, box=None):
        x0, y0, x1, y1 = box or (0, 0, self.w, self.h)
        for py in range(int(y0 * S), int(y1 * S)):
            t = (py / S - y0) / max(1.0, (y1 - y0))
            self.d.line([(x0 * S, py), (x1 * S, py)],
                        fill=tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))

    def rr(self, box, r=0, fill=None, outline=None, width=1.4):
        self.d.rounded_rectangle([v * S for v in box], r * S, fill=fill,
                                 outline=outline, width=max(1, int(width * S)))

    def rect(self, box, fill):
        self.d.rectangle([v * S for v in box], fill=fill)

    def ellipse(self, box, fill=None, outline=None, width=1.4):
        self.d.ellipse([v * S for v in box], fill=fill, outline=outline,
                       width=max(1, int(width * S)))

    def line(self, pts, fill, width=1.4):
        self.d.line([(p[0] * S, p[1] * S) for p in pts], fill=fill,
                    width=max(1, int(width * S)), joint="curve")

    def poly(self, pts, fill):
        self.d.polygon([(p[0] * S, p[1] * S) for p in pts], fill=fill)

    def text(self, xy, s, font, fill=INK, anchor="la"):
        self.d.text((xy[0] * S, xy[1] * S), s, font=font, fill=fill, anchor=anchor)

    def tw(self, s, font):
        return self.d.textlength(s, font=font) / S

    def lh(self, font):
        a, d = font.getmetrics()
        return (a + d) / S

    def shadow(self, box, r, blur=24, opacity=32, dy=8):
        layer = Image.new("L", self.img.size, 0)
        ImageDraw.Draw(layer).rounded_rectangle(
            [box[0] * S, (box[1] + dy) * S, box[2] * S, (box[3] + dy) * S], r * S, fill=opacity)
        layer = layer.filter(ImageFilter.GaussianBlur(blur * S))
        self.img.paste(Image.new("RGB", self.img.size, (16, 24, 40)), (0, 0), layer)
        self.d = ImageDraw.Draw(self.img)

    def card(self, box, r=28, fill=WHITE, outline=BORDER, sh=True, blur=24, op=30, bw=1.4):
        if sh:
            self.shadow(box, r, blur, op)
        self.rr(box, r, fill=fill, outline=outline, width=bw)

    def save(self, name):
        p = os.path.join(OUT, name)
        self.img.resize((self.w, self.h), Image.LANCZOS).save(p, "PNG", optimize=True)
        print("saved", os.path.basename(p))
        return p


# ---------------- 文本度量/排版 ----------------
import re

_NO_LINE_START = set("，。、；：？！）】」』%’”·…,.;:?!)]}>")
_CJK = re.compile(r"[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]")


def _tokens(s):
    """CJK 逐字切，ASCII 连续串（英文/数字/URL）作为不可分割整体"""
    out, buf = [], ""
    for ch in s:
        if ch == "\n":
            if buf:
                out.append(buf); buf = ""
            out.append("\n")
        elif _CJK.match(ch) or ch == " ":
            if buf:
                out.append(buf); buf = ""
            out.append(ch)
        else:
            buf += ch
    if buf:
        out.append(buf)
    return out


def wrap(cv, s, font, maxw):
    """像素宽度折行：不切断英文单词，标点不出现在行首"""
    lines, cur = [], ""
    for tk in _tokens(s):
        if tk == "\n":
            lines.append(cur); cur = ""; continue
        trial = cur + tk
        if cur and cv.tw(trial, font) > maxw:
            if tk in _NO_LINE_START:          # 标点悬挂在行尾
                cur += tk
                continue
            lines.append(cur)
            cur = "" if tk == " " else tk
        else:
            cur = trial
    if cur:
        lines.append(cur)
    return lines


def para_h(cv, s, font, maxw, lh=1.58):
    return len(wrap(cv, s, font, maxw)) * cv.lh(font) * lh


def para(cv, xy, s, font, maxw, fill=INK, lh=1.58):
    x, y = xy
    step = cv.lh(font) * lh
    for ln in wrap(cv, s, font, maxw):
        cv.text((x, y), ln, font, fill)
        y += step
    return y


def fit_font(cv, s, size, maxw, kind="bold", floor=18):
    """字号自动收缩到指定宽度内"""
    while size > floor:
        f = F(size, kind)
        if cv.tw(s, f) <= maxw:
            return f
        size -= 1
    return F(size, kind)


def chip(cv, x, y, s, font, fill=GREEN_SOFT, fg=GREEN_DEEP, padx=22, pady=12):
    h = cv.lh(font) + pady * 2 - 10
    w = cv.tw(s, font) + padx * 2
    cv.rr((x, y, x + w, y + h), h / 2, fill=fill)
    cv.text((x + padx, y + pady - 6), s, font, fg)
    return x + w, y + h


def chip_row(cv, x, y, labels, size, maxw, gap=14, **kw):
    """自动换行的标签行，返回底部 y"""
    cx, cy = x, y
    for lab in labels:
        f = F(size, "bold")
        w = cv.tw(lab, f) + 44
        if cx + w > x + maxw:
            cx = x; cy += cv.lh(f) + 26
        cx, ch = chip(cv, cx, cy, lab, f, **kw)
        cx += gap
    return cy + cv.lh(F(size, "bold")) + 22


# ---------------- 图标 ----------------
def brand_mark(cv, x, y, size=62):
    cv.rr((x, y, x + size, y + size), size * 0.26, fill=GREEN)
    k = size / 64.0
    cv.rr((x + 17 * k, y + 13 * k, x + 47 * k, y + 37 * k), 4 * k, fill=WHITE)
    for i, yy in enumerate((19.5, 24.5, 29.5)):
        cv.rect((x + 22 * k, y + yy * k, x + (42 if i < 2 else 35) * k, y + (yy + 2.2) * k), GREEN)
    cv.rect((x + 30.4 * k, y + 39 * k, x + 33.6 * k, y + 47 * k), WHITE)
    cv.poly([(x + 24 * k, y + 44 * k), (x + 40 * k, y + 44 * k), (x + 32 * k, y + 55 * k)], WHITE)


def ico_doc(cv, x, y, s, color=GREEN):
    cv.rr((x, y, x + s * 0.76, y + s), s * 0.12, outline=color, width=max(2, s * 0.07))
    for i in range(3):
        cv.rect((x + s * 0.16, y + s * (0.24 + i * 0.2),
                 x + s * (0.6 if i < 2 else 0.44), y + s * (0.28 + i * 0.2)), color)


def ico_pdf(cv, x, y, s, color=GREEN):
    cv.rr((x, y, x + s * 0.76, y + s), s * 0.12, fill=color)
    cv.text((x + s * 0.09, y + s * 0.33), "PDF", F(s * 0.21, "bold"), WHITE)


def ico_zip(cv, x, y, s, color=GREEN):
    cv.rr((x, y, x + s * 0.76, y + s), s * 0.12, outline=color, width=max(2, s * 0.07))
    for i in range(4):
        cv.rect((x + s * 0.3, y + s * (0.13 + i * 0.14),
                 x + s * 0.46, y + s * (0.2 + i * 0.14)), color)
    cv.rr((x + s * 0.26, y + s * 0.72, x + s * 0.5, y + s * 0.87), s * 0.05, fill=color)


def ico_lock(cv, x, y, s, color=GREEN):
    cv.rr((x + s * 0.1, y + s * 0.4, x + s * 0.9, y + s * 0.95), s * 0.14, fill=color)
    cv.ellipse((x + s * 0.26, y + s * 0.06, x + s * 0.74, y + s * 0.52),
               outline=color, width=max(2, int(s * 0.09)))
    cv.rect((x + s * 0.26, y + s * 0.38, x + s * 0.74, y + s * 0.58), color)
    cv.ellipse((x + s * 0.43, y + s * 0.55, x + s * 0.57, y + s * 0.69), WHITE)


def ico_check(cv, x, y, s=30, color=GREEN):
    cv.ellipse((x, y, x + s, y + s), fill=color)
    cv.line([(x + s * .27, y + s * .52), (x + s * .44, y + s * .69), (x + s * .74, y + s * .33)],
            WHITE, s * 0.12)


def ico_broken(cv, x, y, w, h):
    """裂图占位符"""
    cv.rr((x, y, x + w, y + h), 10, fill=(232, 234, 238))
    cv.line([(x + w * .2, y + h * .3), (x + w * .8, y + h * .7)], (198, 202, 210), 2.4)
    cv.line([(x + w * .8, y + h * .3), (x + w * .2, y + h * .7)], (198, 202, 210), 2.4)


# ============================================================
# 图 1 封面
# ============================================================
def cover():
    cv = Cv()
    cv.vgrad((231, 251, 242), (255, 255, 255))

    glow = Image.new("RGB", cv.img.size, WHITE)
    ImageDraw.Draw(glow).ellipse((int(W * .5 * S), int(-200 * S), int(W * 1.3 * S), int(620 * S)),
                                 fill=(212, 246, 229))
    cv.img.paste(glow.filter(ImageFilter.GaussianBlur(80)), (0, 0),
                 Image.new("L", cv.img.size, 58))
    cv.d = ImageDraw.Draw(cv.img)

    brand_mark(cv, 96, 92, 60)
    cv.text((172, 96), "公众号文章导出助手", F(32, "bold"))
    cv.text((172, 136), "Chrome 扩展 · MIT 开源 · 完全免费", F(23, "reg"), INK_SOFT)

    f1 = F(88, "bold")
    cv.text((96, 246), "公众号好文", f1)
    cv.text((96, 352), "一键变成", f1)
    cv.text((96, 458), "能存一辈子的文件", f1)
    cv.rr((96, 584, 96 + 430, 600), 8, fill=GREEN)

    cv.text((96, 630), "Markdown + 图片一起打包", F(40, "bold"), GREEN_DARK)
    cv.text((96, 694), "原帖删了、图床挂了、断网了，都还能正常打开", F(29, "reg"), INK_SOFT)

    # ---- ZIP 结构演示卡
    zy = 768
    cv.card((96, zy, 984, zy + 196), 30)
    cv.text((136, zy + 34), "文章标题.zip", F(30, "bold"), INK)
    chip(cv, 984 - 146 - (cv.tw("导出成品", F(21, "bold")) + 40), zy + 28,
         "导出成品", F(21, "bold"), fill=GREEN_SOFT, fg=GREEN_DEEP, padx=20, pady=10)
    cv.line([(136, zy + 88), (944, zy + 88)], BORDER, 1.2)
    rows = [("文章标题.md", "纯文本 · 可进 Obsidian / Typora / VS Code", F(26, "bold")),
            ("images/", "16 张图，链接已重写为 ./images/img_001.png", F(26, "reg"))]
    ry = zy + 104
    for name, desc, fo in rows:
        cv.text((136, ry), "├" if name.endswith(".md") else "└", F(26, "reg"), INK_FAINT)
        cv.text((170, ry), name, fo, INK)
        cv.text((170 + cv.tw(name, fo) + 22, ry + 3), desc, F(22, "reg"), INK_SOFT)
        ry += 44

    # ---- 底部标签
    chip_row(cv, 96, 1006, ["零后端", "纯本地处理", "不收任何数据", "免费开源"],
             28, 888, gap=16)

    # ---- 收尾一句
    cv.text((96, 1084), "收藏夹里的文章，过两年还能打开的没几篇——这就是我写它的原因。",
            F(24, "reg"), INK_FAINT)

    # ---- 底部裂图/完整 对比
    cy = 1140
    cv.card((96, cy, 984, cy + 226), 30, sh=True, op=26)
    # 左：裂图
    cv.text((136, cy + 30), "直接收藏", F(23, "bold"), RED)
    for i in range(3):
        ico_broken(cv, 136 + i * 108, cy + 68, 92, 66)
    cv.text((136, cy + 152), "图全裂了，点进去 404", F(21, "reg"), INK_FAINT)
    # 分隔
    cv.line([(540, cy + 30), (540, cy + 196)], BORDER, 1.4)
    # 右：完整
    cv.text((584, cy + 30), "导出成文件", F(23, "bold"), GREEN_DARK)
    for i in range(3):
        bx = 584 + i * 108
        cv.rr((bx, cy + 68, bx + 92, cy + 134), 10, fill=GREEN_SOFT)
        cv.rr((bx + 8, cy + 76, bx + 84, cy + 118), 6, fill=GREEN_LINE)
        cv.rr((bx + 8, cy + 124, bx + 60, cy + 130), 3, fill=GREEN)
    cv.text((584, cy + 152), "本地图片，断网也能看", F(21, "reg"), INK_FAINT)

    return cv.save("01-cover.png")


# ============================================================
# 图 2 弹窗
# ============================================================
def popup_mock(cv, ox, oy, k):
    PAD, BW = 14, 340
    total = 334

    def X(v): return ox + v * k
    def Y(v): return oy + v * k

    cv.card((X(0), Y(0), X(BW), Y(total)), 26 * k, sh=True, blur=22, op=44, bw=1.2)

    cv.rr((X(PAD), Y(PAD), X(PAD + 28), Y(PAD + 28)), 7 * k, fill=GREEN)
    cv.text((X(PAD + 14), Y(PAD + 14)), "MD", F(11 * k, "bold"), WHITE, anchor="mm")
    cv.text((X(PAD + 38), Y(PAD + 1)), "公众号文章导出", F(14 * k, "bold"))
    cv.text((X(PAD + 38), Y(PAD + 20)), "v1.1.0 · Markdown / PDF", F(11 * k, "reg"), INK_SOFT)

    sy = PAD + 44
    cv.rr((X(PAD), Y(sy), X(BW - PAD), Y(sy + 38)), 8 * k,
          fill=GREEN_SOFT, outline=GREEN_LINE, width=1.2)
    cv.ellipse((X(PAD + 11), Y(sy + 15), X(PAD + 19), Y(sy + 23)), fill=GREEN)
    cv.text((X(PAD + 27), Y(sy + 10)), "已识别到公众号文章，可以导出", F(12 * k, "reg"), GREEN_DEEP)

    oy0 = sy + 50
    cv.rr((X(PAD), Y(oy0), X(BW - PAD), Y(oy0 + 82)), 8 * k, outline=BORDER, width=1.2)
    for i, (lab, hint) in enumerate([
        ("导出 Markdown 时打包本地图片（ZIP）", "关闭后仅保留原图链接，保存为纯 .md"),
        ("添加 YAML Front Matter 元信息头", "包含标题、作者、日期与原文链接")]):
        yy = oy0 + 9 + i * 37
        cv.rr((X(PAD + 12), Y(yy + 4), X(PAD + 26), Y(yy + 18)), 3 * k, fill=GREEN)
        cv.line([(X(PAD + 15), Y(yy + 11)), (X(PAD + 18.5), Y(yy + 15)),
                 (X(PAD + 23.5), Y(yy + 7))], WHITE, 2.2 * k)
        cv.text((X(PAD + 34), Y(yy + 2)), lab, F(12 * k, "reg"))
        cv.text((X(PAD + 34), Y(yy + 19)), hint, F(11 * k, "reg"), INK_SOFT)

    by = oy0 + 94
    gap = 8
    bw = (BW - PAD * 2 - gap) / 2
    cv.rr((X(PAD), Y(by), X(PAD + bw), Y(by + 34)), 8 * k, fill=GREEN)
    cv.text((X(PAD + bw / 2), Y(by + 17)), "导出 Markdown", F(12.5 * k, "bold"), WHITE, anchor="mm")
    cv.rr((X(PAD + bw + gap), Y(by), X(BW - PAD), Y(by + 34)), 8 * k,
          fill=WHITE, outline=BORDER, width=1.2)
    cv.text((X(PAD + bw + gap + bw / 2), Y(by + 17)), "导出 PDF", F(12.5 * k, "bold"), INK, anchor="mm")

    py = by + 46
    cv.rr((X(PAD), Y(py), X(BW - PAD), Y(py + 5)), 3 * k, fill=(236, 238, 241))
    cv.rr((X(PAD), Y(py), X(PAD + (BW - PAD * 2) * .72), Y(py + 5)), 3 * k, fill=GREEN)
    cv.text((X(PAD), Y(py + 13)), "下载图片 12/16 · 转换 · 打包 · 保存", F(11.5 * k, "reg"), INK_SOFT)

    fy = py + 42
    cv.line([(X(PAD), Y(fy - 8)), (X(BW - PAD), Y(fy - 8))], BORDER, 1.2)
    cv.text((X(BW / 2), Y(fy + 3)), "仅供个人归档使用 · 请遵守内容版权",
            F(10.5 * k, "reg"), INK_FAINT, anchor="ma")


def ui_shot():
    cv = Cv()
    cv.vgrad((243, 251, 247), (255, 255, 255))

    cv.text((96, 92), "真实弹窗长这样", F(60, "bold"))
    cv.text((96, 174), "点一下扩展图标，两个按钮，没有多余设置", F(27, "reg"), INK_SOFT)

    k = 1.40
    popup_mock(cv, 96, 256, k)
    card_bottom = 256 + 334 * k  # ≈ 724

    items = [
        ("只在文章页可用", "打开 mp.weixin.qq.com 的文章，弹窗自动亮起可点；\n在别的网页上两个按钮是灰的，不会误操作。"),
        ("两个开关就够", "要不要连图一起打包、要不要加 YAML 元信息头，\n勾一下就行，设置会记住，下次不用重设。"),
        ("进度看得见", "下载图片 → 转换 → 打包 → 保存，每一步都写在\n进度条下面，长文也不会假装卡死。"),
    ]
    iy = card_bottom + 40
    for title, desc in items:
        cv.ellipse((96, iy + 5, 96 + 12, iy + 17), fill=GREEN)
        cv.text((124, iy), title, F(29, "bold"))
        iy = para(cv, (124, iy + 44), desc, F(24, "reg"), 810, INK_SOFT, 1.52) + 30

    cv.line([(96, 1256), (984, 1256)], BORDER, 1.4)
    para(cv, (96, 1276),
         "零构建：改完代码在 chrome://extensions 里点刷新即可，不需要 npm build；\n"
         "排版质量有自动化闸门，改样式不会悄悄退化。",
         F(23, "reg"), 888, INK_FAINT, 1.55)

    return cv.save("02-popup.png")


# ============================================================
# 图 3 三种格式
# ============================================================
def formats():
    cv = Cv()
    cv.vgrad((245, 252, 248), (255, 255, 255))

    cv.text((96, 96), "同一个按钮", F(62, "bold"))
    cv.text((96, 178), "三种存法，看你缺什么", F(62, "bold"), GREEN_DARK)
    cv.text((96, 278), "要带走图，还是要能搜索的文字，自己挑", F(28, "reg"), INK_SOFT)

    rows = [
        ("Markdown + 图片 ZIP", "最完整", GREEN_SOFT, GREEN_DEEP, ico_zip,
         "md 里所有图片链接重写成 ./images/img_001.png，图片一起打包。"
         "防盗链、图床过期、原帖被删都照样能打开。"),
        ("纯 .md 文件", "最轻", SLATE_SOFT, SLATE, ico_doc,
         "不下载图片，只保留原图链接。适合只要文字的摘录，"
         "导出只要一两秒，体积几 KB，随手丢进笔记软件。"),
        ("高保真 PDF", "最好读", AMBER_SOFT, AMBER, ico_pdf,
         "懒加载图片全量预热、打印样式注入、分层分页控制。"
         "文字是矢量的，可以选中、可以搜索、可以复制。"),
    ]

    DESC_W = 656
    y = 348
    for title, tag, soft, fg, icon, desc in rows:
        df = F(25, "reg")
        dh = para_h(cv, desc, df, DESC_W, 1.66)
        h = dh + 170
        cv.card((96, y, 984, y + h), 30)
        cv.rr((136, y + 38, 232, y + 134), 24, fill=soft)
        icon(cv, 136 + 22, y + 38 + 22, 52, fg)
        cv.text((264, y + 42), title, F(36, "bold"))
        chip(cv, 264, y + 94, tag, F(22, "bold"), fill=soft, fg=fg, padx=18, pady=9)
        para(cv, (264, y + 148), desc, df, DESC_W, INK_SOFT, 1.66)
        y += h + 26

    cv.text((96, y + 2), "PDF 的排版细节写在 README 第 6 节，全部是实测踩出来的。",
            F(23, "reg"), INK_FAINT)

    return cv.save("03-formats.png")


# ============================================================
# 图 4 排版数据
# ============================================================
def data_shot():
    cv = Cv()
    cv.vgrad((255, 252, 246), (255, 255, 255))

    cv.text((96, 96), "我收到的坏 PDF", F(60, "bold"))
    cv.text((96, 176), "一页 72% 是空白", F(60, "bold"), RED)
    cv.text((96, 274), "11 张图渲染成灰块——这是量出来的，不是感觉", F(28, "reg"), INK_SOFT)

    # 条形对比
    y = 372
    cv.text((96, y), "单页最大纵向空白", F(31, "bold"))
    cv.text((984, y + 6), "A4 整页 842 pt", F(22, "reg"), INK_FAINT, anchor="ra")
    y += 56

    TRACK_X, TRACK_W = 236, 620
    cv.text((96, y + 4), "修复前", F(25, "reg"), INK_SOFT)
    cv.rr((TRACK_X, y, TRACK_X + TRACK_W, y + 32), 16, fill=(250, 233, 229))
    cv.rr((TRACK_X, y, TRACK_X + TRACK_W * .723, y + 32), 16, fill=RED)
    cv.text((TRACK_X + TRACK_W + 20, y + 1), "609.1 pt", F(30, "bold"), RED)
    y += 60

    cv.text((96, y + 4), "修复后", F(25, "reg"), GREEN_DARK)
    cv.rr((TRACK_X, y, TRACK_X + TRACK_W, y + 32), 16, fill=GREEN_SOFT)
    cv.rr((TRACK_X, y, TRACK_X + TRACK_W * .0323, y + 32), 16, fill=GREEN)
    cv.text((TRACK_X + TRACK_W + 20, y + 1), "27.2 pt", F(30, "bold"), GREEN_DARK)

    # 灰块
    y += 100
    cv.text((96, y), "灰块 / 破损图片", F(31, "bold"))
    cv.text((984, y + 6), "修复前后同口径对比", F(22, "reg"), INK_FAINT, anchor="ra")
    y += 54

    # 两栏并排
    colw = 424
    cv.rr((96, y, 96 + colw, y + 232), 24, fill=RED_SOFT)
    cv.text((128, y + 24), "修复前", F(24, "bold"), RED)
    for i in range(11):
        bx = 128 + (i % 6) * 58
        by = y + 64 + (i // 6) * 46
        cv.rr((bx, by, bx + 46, by + 34), 6, fill=(228, 230, 234))
        cv.rr((bx, by, bx + 46, by + 11), 6, fill=(206, 209, 214))
    cv.text((128, y + 190), "11 张图只剩灰色框，还占着高度", F(20, "reg"), (150, 90, 76))

    cv.rr((96 + colw + 40, y, 984, y + 232), 24, fill=GREEN_SOFT)
    cv.text((128 + colw + 40, y + 24), "修复后", F(24, "bold"), GREEN_DARK)
    ico_check(cv, 128 + colw + 40, y + 72, 40)
    cv.text((182 + colw + 40, y + 78), "0 张，全部正常渲染", F(26, "bold"), GREEN_DARK)
    cv.text((128 + colw + 40, y + 132), "打印前逐张确认 + CSS 兜底压平", F(20, "reg"), (60, 130, 95))

    y += 232 + 38

    # 指标表：三行补充对比
    rows = [
        ("浏览器页眉页脚", "有", "无"),
        ("文字可提取（矢量）", "58,876 字", "5,211 字"),
        ("图片被拦腰截断", "多张", "分层控制后不再截断"),
    ]
    rh = 54
    cv.text((96, y), "同批指标", F(26, "bold"), INK)
    cv.text((984, y + 4), "修复前 → 修复后", F(21, "reg"), INK_FAINT, anchor="ra")
    y += 44
    cv.rr((96, y, 984, y + rh * len(rows) + 16), 22, fill=SOFT)
    ry = y + 18
    for k, a, b in rows:
        cv.text((132, ry + 6), k, F(23, "reg"), INK_SOFT)
        cv.text((560, ry + 6), a, F(22, "reg"), (176, 96, 78))
        cv.text((676, ry + 6), "→", F(22, "reg"), INK_FAINT)
        cv.text((724, ry + 6), b, F(22, "reg"), GREEN_DEEP)
        ry += rh
    y += rh * len(rows) + 40

    # 数据口径
    txt = ("修复前取自用户反馈的实际 PDF；修复后用仓库内 real-structure 样本（3 张图成功 / 6 张失败，"
           "最接近真实场景）跑自动化排版闸门测得。指标定义与阈值见 README 5.1 / 5.2。")
    tf = F(22, "reg")
    th = para_h(cv, txt, tf, 792, 1.54)
    cv.card((96, y, 984, y + th + 88), 24, fill=WHITE, outline=BORDER, sh=False, bw=1.2)
    cv.text((132, y + 22), "数据口径", F(23, "bold"))
    para(cv, (132, y + 56), txt, tf, 792, INK_SOFT, 1.54)
    y += th + 88 + 24

    cv.text((96, y), "修复动作：分层分页控制 · 打印前逐张确认图片 · 失败图压平", F(22, "reg"), INK_FAINT)

    return cv.save("04-data.png")


# ============================================================
# 图 5 安装 + 地址
# ============================================================
def install_shot():
    cv = Cv()
    cv.vgrad((238, 253, 245), (255, 255, 255))

    cv.text((96, 96), "三步装上", F(62, "bold"))
    cv.text((96, 178), "两分钟开始用", F(62, "bold"), GREEN_DARK)

    steps = [
        ("01", "下载源码",  "打开 GitHub 仓库，点绿色 Code → Download ZIP，解压到任意目录。"),
        ("02", "加载扩展",  "Chrome 地址栏输入 chrome://extensions，右上角打开「开发者模式」，再点「加载已解压的扩展程序」，选中解压出来的 src 目录。"),
        ("03", "固定到工具栏", "点扩展栏的图钉图标 Pin 一下。之后打开任何公众号文章，点它就能导出。"),
    ]
    y = 276
    for num, title, desc in steps:
        df = F(24, "reg")
        dh = para_h(cv, desc, df, 686, 1.62)
        h = 58 + dh + 28
        cv.card((96, y, 984, y + h), 28)
        cv.text((140, y + 32), num, F(48, "bold"), (208, 241, 222))
        cv.text((232, y + 26), title, F(34, "bold"))
        para(cv, (232, y + 80), desc, df, 686, INK_SOFT, 1.62)
        y += h + 22

    # 地址卡
    cy = y + 8
    ch = 214
    cv.card((96, cy, 984, cy + ch), 32, fill=(24, 28, 34), outline=None, sh=True, op=52)
    cv.text((140, cy + 30), "项目地址", F(24, "bold"), (140, 148, 158))
    cv.text((140, cy + 70), "github.com/ruY9527", F(36, "mono"), WHITE)
    cv.text((140, cy + 120), "/wechat_article_exporter", F(36, "mono"), (126, 231, 178))
    cv.line([(140, cy + 172), (940, cy + 172)], (52, 58, 68), 1.2)
    cv.text((140, cy + 184), "MIT 许可 · 完全免费 · 无会员、无付费版、无广告", F(22, "reg"), (150, 158, 168))
    y = cy + ch + 36

    # 三个特性
    feats = [("纯本地处理", "没有任何服务器"), ("零构建", "改完刷新即生效"), ("68 项测试", "逻辑 + 排版闸门")]
    colw = 268
    for i, (t1, t2) in enumerate(feats):
        bx = 96 + i * (colw + 22)
        cv.rr((bx, y, bx + colw, y + 134), 24, fill=WHITE, outline=BORDER, width=1.4)
        ico_check(cv, bx + 22, y + 20, 30)
        cv.text((bx + 22, y + 64), t1, F(24, "bold"))
        cv.text((bx + 22, y + 100), t2, F(18, "reg"), INK_FAINT)

    return cv.save("05-install.png")


if __name__ == "__main__":
    cover(); ui_shot(); formats(); data_shot(); install_shot()
