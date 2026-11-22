#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tests/pdf_metrics.py — PDF 排版度量（配合 tests/pdf-layout.js）

输出一行 JSON，字段：
  pageCount     总页数
  hugeGapPt     所有页中最大的纵向空白（pt）
  avgGapPt      各页最大空白的平均值（pt）
  gapPages      空白超阈值的页码（1-based）
  grayImgCount  栅格化后近单色（灰块/白块）的图片数量
  imgRects      每张图的 bbox 与实际渲染一致性是否可疑
  textChars     可提取文字字符数
  textLeft/Top  正文字符的最小 x / y（pt）
  headerFooter  是否检测到浏览器页眉页脚
"""

import json
import sys
import re
import pymupdf

# 视为「正文横向溢出」的阈值
GAP_THRESHOLD = 150.0      # 单页内纵向空白超过即视为排版断档（pt）
FLAT_STD_THRESHOLD = 1.2   # 图片像素标准差低于此值视为灰块/白块


def pixel_std(pix):
    """
    按网格采样估计像素标准差。

    注意：早期版本只采中心列，结果把「顶行有内容、其余纯灰」的坏图判成正常。
    这里改为二维网格采样，并对「行方向单一色」单独计数，才能抓住
    「只画出顶边一条、其余是空白/灰块」这类典型的图片加载失败。
    """
    w, h = pix.width, pix.height
    if w < 4 or h < 4:
        return 0.0, 1

    step_x = max(1, w // 48)
    step_y = max(1, h // 48)
    rows_uniform = 0
    rows_total = 0
    vals = []

    for y in range(0, h, step_y):
        row_vals = []
        for x in range(0, w, step_x):
            sample = pix.pixel(x, y)
            v = sample[0] if isinstance(sample, (tuple, list)) else sample
            row_vals.append(v)
            vals.append(v)
        rows_total += 1
        if row_vals and (max(row_vals) - min(row_vals)) <= 2:
            rows_uniform += 1

    if not vals:
        return 0.0, rows_total

    mean = sum(vals) / len(vals)
    var = sum((v - mean) ** 2 for v in vals) / len(vals)
    uniformity = rows_uniform / rows_total if rows_total else 1.0
    return var ** 0.5, uniformity


def is_broken_image(pix):
    """
    判定图片是否「没真正画出来」：
      1) 整体近单色（纯灰 / 纯白 / 纯黑）
      2) 绝大多数行是单一色（只剩顶边一条内容，下面是灰块）
    """
    std, uniformity = pixel_std(pix)
    if std < FLAT_STD_THRESHOLD:
        return True
    if uniformity >= 0.9:
        return True
    return False


def page_gap(page):
    """返回该页最大的纵向空白（pt）及其位置。"""
    blocks = [b for b in page.get_text("dict")["blocks"]]
    rects = []
    for b in blocks:
        x0, y0, x1, y1 = b["bbox"]
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        # 跳过页眉页脚区域（顶部/底部 45pt）
        if y1 < 45 or y0 > page.rect.height - 45:
            continue
        rects.append((y0, y1))
    if len(rects) < 2:
        return 0.0, None
    rects.sort()
    best, at = 0.0, None
    cur_bottom = rects[0][1]
    for y0, y1 in rects[1:]:
        gap = y0 - cur_bottom
        if gap > best:
            best, at = gap, (cur_bottom, y0)
        cur_bottom = max(cur_bottom, y1)
    return best, at


def looks_like_header_footer(page):
    """检测浏览器自带的页眉页脚：页面顶部出现 URL、日期时间、右侧页码。"""
    h = page.rect.height
    w = page.rect.width
    top = page.get_text("text", clip=pymupdf.Rect(0, 0, w, 40))
    bottom = page.get_text("text", clip=pymupdf.Rect(0, h - 40, w, h))
    hay = (top or "") + "\n" + (bottom or "")
    if not hay.strip():
        return False
    # 页眉页脚特征：http(s) 链接、YYYY/M/D H:MM 时间戳、单独页码 "12/113"
    if re.search(r"https?://", hay):
        return True
    if re.search(r"\d{4}/\d{1,2}/\d{1,2}\s+\d{1,2}:\d{2}", hay):
        return True
    if re.search(r"^\s*\d+\s*/\s*\d+\s*$", hay.strip(), re.M):
        return True
    return False


def analyze(pdf_path):
    doc = pymupdf.open(pdf_path)

    gaps = []
    gap_pages = []
    gray_imgs = 0
    img_rects = []
    text_chars = 0
    text_left = None
    text_top = None
    header_footer = False

    for pno in range(doc.page_count):
        page = doc[pno]

        gap, at = page_gap(page)
        gaps.append(gap)
        if gap > GAP_THRESHOLD:
            gap_pages.append({"page": pno + 1, "gap": round(gap, 1)})

        # 图片栅格化检查：把图片本体还原出来，看是不是「没画出来」
        for info in page.get_images(full=True):
            xref = info[0]
            try:
                pix = pymupdf.Pixmap(doc, xref)
                std, uniformity = pixel_std(pix)
                if is_broken_image(pix):
                    gray_imgs += 1
                    img_rects.append({
                        "page": pno + 1,
                        "xref": xref,
                        "size": [pix.width, pix.height],
                        "std": round(std, 3),
                        "uniformRows": round(uniformity, 3)
                    })
            except Exception:
                pass

        # 文字度量（跳过页眉页脚区域）
        clip = pymupdf.Rect(0, 45, page.rect.width, page.rect.height - 45)
        txt = page.get_text("dict", clip=clip)
        for b in txt["blocks"]:
            if b["type"] != 0:
                continue
            for line in b["lines"]:
                for span in line["spans"]:
                    content = span.get("text", "")
                    if not content.strip():
                        continue
                    text_chars += len(content.strip())
                    x0, y0 = span["bbox"][0], span["bbox"][1]
                    text_left = x0 if text_left is None else min(text_left, x0)
                    text_top = y0 if text_top is None else min(text_top, y0)

        if not header_footer and looks_like_header_footer(page):
            header_footer = True

    return {
        "pageCount": doc.page_count,
        "hugeGapPt": round(max(gaps) if gaps else 0.0, 1),
        "avgGapPt": round(sum(gaps) / len(gaps), 1) if gaps else 0.0,
        "gapPages": gap_pages[:10],
        "grayImgCount": gray_imgs,
        "flatImages": img_rects[:10],
        "textChars": text_chars,
        "textLeft": round(text_left or 0.0, 1),
        "textTop": round(text_top or 0.0, 1),
        "headerFooter": header_footer
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: pdf_metrics.py <pdf>"}))
        sys.exit(2)
    try:
        result = analyze(sys.argv[1])
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}))
        sys.exit(3)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
