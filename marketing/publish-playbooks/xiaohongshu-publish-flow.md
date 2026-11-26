# 小红书图文草稿自动化 · 可执行流程

> **用途**：让 AI 在任意项目中，把「图片 + 标题 + 正文 + 标签」自动填进小红书创作服务平台的图文草稿箱。
> **终点**：点「暂存离开」保存草稿。**永不点击「发布」**。
> **适用**：Chrome 已登录 `creator.xiaohongshu.com`，Windows 环境。
>
> 本文档自包含，可直接投喂给 AI 执行。最后验证：2026-11，小红书创作服务平台 + Chrome 160。
> 配套代码：同目录的 `uiauto.py` / `forcefg.py` / `winlist.py`（见附录，可直接复制）。

---

## 0. 给 AI 的执行摘要

按顺序做这 7 件事，每步都要截图验证，不要跳：

```
1. 设 DPI 感知 → 找窗口 → 强前台
2. 导航到 /publish/publish?target=image
3. 上传图片（文件对话框 + Win32 直写路径）
4. 填标题（y≈405，点文字基线）
5. 填正文（y≈448）
6. 追加标签（Ctrl+End → 回车 → 逐个 #标签）
7. 点「暂存离开」(1066,1342) → 确认「保存成功」
```

**三条铁律**：

- 坐标必须先标定，文档里的数字只是参考值
- 每一步都截图，不要假设成功
- 绝不点击「发布」

---

## 1. 为什么必须用 UI 自动化（省掉重新试错的时间）

三条技术路线已实测，前两条不通：

| 方案 | 结果 |
| :--- | :--- |
| 默认 profile 加 `--remote-debugging-port` | Chrome 136+ 安全策略拒绝，端口不通 |
| 复制 profile 到别处再开调试端口 | Cookie 设备绑定加密，复制后变未登录（跳 `login?redirectReason=401`） |
| 读取/复制 Chrome 的 Cookies 文件 | 独占锁，`SeBackupPrivilege`、`robocopy /B`、`esentutl /y` 全部打不开 |

**结论**：唯一可行路径是操作屏幕上那个已登录的窗口，用 Win32 合成键鼠事件。

---

## 2. 环境准备

### 2.1 DPI 感知（第一步，漏了坐标全错）

```python
import ctypes
ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PER_MONITOR_AWARE
```

不加这句，所有坐标按系统缩放比例漂移，表现是「点击总是差几十像素」。

### 2.2 找窗口

```python
import ctypes
from ctypes import wintypes

user32 = ctypes.WinDLL("user32", use_last_error=True)
user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]

def list_chrome_windows():
    out = []
    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def cb(h, _):
        if not user32.IsWindowVisible(h):
            return True
        c = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(h, c, 256)
        if c.value != "Chrome_WidgetWin_1":
            return True
        r = wintypes.RECT()
        user32.GetWindowRect(h, ctypes.byref(r))
        if r.right - r.left < 400 or r.bottom - r.top < 300:
            return True
        t = ctypes.create_unicode_buffer(512)
        user32.GetWindowTextW(h, t, 512)
        out.append((h, t.value, (r.left, r.top, r.right, r.bottom)))
        return True
    user32.EnumWindows(cb, 0)
    return out

# 按标题匹配
for h, title, rect in list_chrome_windows():
    if "创作" in title or "creator" in title.lower():
        HWND = h
```

找不到就报错退出，**不要猜**——盲操作会点到别的窗口。

### 2.3 强制前台（焦点争夺对策）

多标签同窗口时，编辑器焦点会被别的标签抢走。用置顶抖动 + AttachThreadInput 绕过前台锁：

```python
HWND_TOPMOST, HWND_NOTOPMOST = wintypes.HWND(-1), wintypes.HWND(-2)
SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW = 0x0002, 0x0001, 0x0040

def force_foreground(hwnd, tries=15):
    cur = kernel32.GetCurrentThreadId()
    for _ in range(tries):
        if user32.GetForegroundWindow() == hwnd:
            return True
        user32.SetWindowPos(hwnd, HWND_TOPMOST, 0,0,0,0, SWP_NOMOVE|SWP_NOSIZE|SWP_SHOWWINDOW)
        user32.SetWindowPos(hwnd, HWND_NOTOPMOST, 0,0,0,0, SWP_NOMOVE|SWP_NOSIZE|SWP_SHOWWINDOW)
        fg = user32.GetForegroundWindow()
        ft = user32.GetWindowThreadProcessId(fg, None) if fg else 0
        tt = user32.GetWindowThreadProcessId(hwnd, None)
        attached = []
        for tid in (ft, tt):
            if tid and tid != cur and tid not in attached:
                user32.AttachThreadInput(cur, tid, True)
                attached.append(tid)
        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)
        for tid in attached:
            user32.AttachThreadInput(cur, tid, False)
        time.sleep(0.25)
    return user32.GetForegroundWindow() == hwnd
```

⚠️ **关键**：点击进入编辑器之后，**不要**再插 `SetWindowPos` / `BringWindowToTop`——会打断 contenteditable 的焦点。只在操作前聚焦。

---

## 3. 坐标标定（本任务的头号失败原因）

窗口是否最大化、书签栏是否展开，会让坐标整体平移几十到上百像素。**每次执行前必须标定**。

### 标定步骤

```
1. 最大化窗口 + 前台化
2. 截全屏
3. 读图确认各元素纵向位置
4. 裁剪目标区域放大核对（别靠猜）
5. 写入代码常量
```

裁剪核对示例：

```python
from PIL import Image
Image.open("shot.png").crop((720, 130, 1560, 420)).resize((1680, 580)).save("zoom.png")
```

### 参考坐标（2560×1440，DPI 96，窗口最大化 rect=(-8,-8,2568,1400)）

| 元素 | 坐标 | 说明 |
| :--- | ---: | :--- |
| 上传图文 标签 | (448, 157) | 书签栏展开会遮挡，先按 `Esc` |
| 空态「上传图片」按钮 | (790, 500) | **仅在无图时存在** |
| **标题输入框** | **(900, 405)** | 关键！点偏就落进缩略图区 |
| **正文输入框** | **(900, 448)** | |
| 暂存离开 | (1066, 1342) | |
| 发布（**禁用**） | (868, 1342) | 绝不点击 |
| 草稿箱 | (597, 81) | 位置随页面状态变 |

### 为什么 y=274 是陷阱

上传图片后，缩略图栏占据 y≈145–390。若把标题定位在 y=274，那个位置是**图片缩略图**，每次点击都弹出文件选择框而不是聚焦标题。真正的标题框在缩略图**下方**，y≈405。

---

## 4. 执行流程

### 4.1 导航

```python
URL = "https://creator.xiaohongshu.com/publish/publish?target=image"
hotkey("ctrl", "l"); paste(URL); press("enter"); sleep(7)
```

`ctrl+t` 新开的标签在**后台**，需要显式切换（如 `ctrl+3`）才能看到内容。

### 4.2 上传图片

文件对话框是唯一稳的路。**不要**点上传区靠猜坐标。

```python
UP_BTN = (790, 500)          # 空态上传按钮
click(*UP_BTN); sleep(2)

dlg = FindWindowW("#32770", "打开") or FindWindowW("#32770", None)
edits = enum_children(dlg, "Edit")

# 多文件：空格分隔的双引号路径串，一次全选
text = " ".join(f'"{p}"' for p in paths)
SendMessageW(edits[0], WM_SETTEXT, 0, ctypes.cast(buf, ctypes.c_void_p))

# 必须读回验证
assert paths[-1].split("\\")[-1] in get_text(edits[0])

# BM_CLICK 到按钮控件（不是 WM_COMMAND IDOK）
for b in enum_children(dlg, "Button"):
    if "打开" in get_text(b, 64):
        SendMessageW(b, BM_CLICK, 0, None)
        break

sleep(15)   # 等上传完成
```

`SendMessageW` 签名必须这样写，否则传字符串会报 `TypeError`：

```python
user32.SendMessageW.argtypes = [wintypes.HWND, wintypes.UINT, wintypes.WPARAM, ctypes.c_void_p]
# WM_SETTEXT=0x000C, WM_GETTEXT=0x000D, BM_CLICK=0x00F5
```

### 4.3 填标题

```python
click(900, 405); sleep(1.3)        # 点文字基线
set_clipboard(TITLE); sleep(0.4)
hotkey("ctrl", "v"); sleep(1.6)
screenshot("verify_title.png")     # 必须验证
```

**验证判据**：框内出现文字 + 右上出现字数计数（如 `18/20`）+ 右侧手机预览同步显示标题。

### 4.4 填正文

```python
click(900, 448); sleep(1.4)
set_clipboard(BODY); sleep(0.5)
hotkey("ctrl", "v"); sleep(3.0)
screenshot("verify_body.png")
```

粘贴后如果只看到中间段落，先 `Ctrl+Home` 回开头再截图——通常内容其实是完整的，只是视图滚动到了中间。

### 4.5 加标签

```python
click(900, 500); sleep(1.0)
hotkey("ctrl", "end"); sleep(1.0)   # 到文末
press("enter")

for tag in TAGS:
    set_clipboard("#" + tag); sleep(0.4)
    hotkey("ctrl", "v"); sleep(1.4)
    press("enter"); sleep(0.8)      # 选中下拉第一项
```

标签占用正文字数（上限 1000）。4 个核心标签约 32 字符，正文控制在 950 字内。

### 4.6 保存草稿

```python
click(1066, 1342); sleep(4)     # 暂存离开
screenshot("verify_saved.png")
```

**验证判据**：顶部出现绿色「保存成功」+ 草稿箱计数 +1 + 列表里能看到标题和封面缩略图。

---

## 5. 内容适配（换项目时改这里）

| 字段 | 上限 | 注意事项 |
| :--- | :--- | :--- |
| 标题 | 20 字 | 超了会被截断，建议 18 字内 |
| 正文 | 1000 字 | **标签也算在内**，正文控制在 950 字内 |
| 标签 | 不限个数，受字数限制 | 4 个核心标签约 32 字符 |
| 图片 | 18 张 | 3:4 竖版最佳（1080×1440） |

标题的写法建议：具体收益 + 情绪钩子，不要用「分享一个」「值得收藏」这类空话。

---

## 6. 验收清单

- [ ] 图片全部在缩略图栏，右上显示 `n/18`
- [ ] 标题框有文字 + 字数计数 + 右侧预览同步
- [ ] 正文从第一段开始（用 `Ctrl+Home` 确认）
- [ ] 标签出现在正文末尾
- [ ] 顶部绿色「保存成功」
- [ ] 草稿箱列表能看到这条，标题和封面正常
- [ ] **「发布」从未被点击**

---

## 7. 失败 → 修法速查

| 症状 | 原因 | 修法 |
| :--- | :--- | :--- |
| 一直弹文件选择框 | 坐标落在图片缩略图区 | 标题在缩略图**下方**，重新标定 y |
| 标题文字跑到正文里 | 正文先获得焦点 | 严格按 标题→正文 顺序，中间重截一次图 |
| 粘贴完全无反应 | 标签页不在前台 | `force_foreground` + 点页面空白 |
| 正文只粘进后半段 | 视图滚动误判 | `Ctrl+Home` 回开头再截图 |
| 点击文字没反应 | 点在块边缘/空白 | 点 placeholder 文字的基线 |
| 坐标整体偏移 | 漏了 DPI 感知 | 首行 `SetProcessDpiAwareness(2)` |
| 书签栏遮挡顶部 | 书签栏展开 | 先按 `Esc` 收起 |
| `SendMessageW` 报 TypeError | argtypes 写成 LPARAM | 改成 `ctypes.c_void_p` |
| 点「打开」没反应 | 用了 WM_COMMAND IDOK | 必须 `BM_CLICK` 到按钮 HWND |
| 焦点反复被抢 | 同窗口内的其他标签 | 用 `--app=URL` 开独立窗口 |

---

## 8. 剪贴板实现

### 纯文本

```python
CF_UNICODETEXT = 13
GMEM_MOVEABLE = 0x0002

def set_clipboard(text):
    for _ in range(20):
        if user32.OpenClipboard(None):
            break
        time.sleep(0.1)
    try:
        user32.EmptyClipboard()
        buf = ctypes.create_unicode_buffer(text)
        size = ctypes.sizeof(buf)
        h = kernel32.GlobalAlloc(GMEM_MOVEABLE, size)
        p = kernel32.GlobalLock(h)
        ctypes.memmove(p, buf, size)
        kernel32.GlobalUnlock(h)
        user32.SetClipboardData(CF_UNICODETEXT, h)
    finally:
        user32.CloseClipboard()
```

### 文件（CF_HDROP，备用）

等价于资源管理器 `Ctrl+C`。小红书上传区接受文件粘贴，但定位不稳，优先用文件对话框。

```python
CF_HDROP = 15
# DROPFILES 头 20 字节 + UTF-16LE 路径列表 + 双 \0
header = struct.pack("<IiiII", 20, 0, 0, 0, 1)   # pFiles=20, fWide=1
blob = header + b"".join(p.encode("utf-16-le") + b"\x00\x00" for p in paths) + b"\x00\x00"
```

### 逐字输入（剪贴板不可用时）

```python
KEYEVENTF_UNICODE, KEYEVENTF_KEYUP = 0x0004, 0x0002

def uni_char(ch):
    code = ord(ch)
    user32.keybd_event(0, code, KEYEVENTF_UNICODE, 0)
    time.sleep(0.008)
    user32.keybd_event(0, code, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, 0)
    time.sleep(0.008)
```

中文可直接发，但长文本慢，优先剪贴板。

---

## 9. 需要的手动前置

AI 无法代替的部分：

1. Chrome 必须在**同一台机器**上已登录小红书创作服务平台
2. 如果窗口关掉了，AI 可以导航，但**登录态需要用户自己确认**
3. 图片文件必须已经生成好，路径明确

---

## 附录：最小代码骨架

```python
# -*- coding: utf-8 -*-
import ctypes, os, time
from ctypes import wintypes

ctypes.windll.shcore.SetProcessDpiAwareness(2)   # ← 第一步

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

# --- 配置（必须现场标定） ---
URL         = "https://creator.xiaohongshu.com/publish/publish?target=image"
UPLOAD_BTN  = (790, 500)
TITLE_BOX   = (900, 405)
BODY_BOX    = (900, 448)
SAVE_BTN    = (1066, 1342)
PUBLISH_BTN = (868, 1342)   # 绝不点击

TITLE = "..."
BODY  = "..."
TAGS  = ["...", "..."]
IMAGES = ["...png", "...png"]

# 之后按 §4 的 6 步依次执行，每步截图验证
```
