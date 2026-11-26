# 小红书图文草稿自动化 — 操作手册

把内容自动填进小红书发布页并存为草稿（**不发布**）。本文档记录完整可复现的流程、坐标标定方法、以及踩过的所有坑。

> 适用场景：已在小红书网页端登录，需要在 `creator.xiaohongshu.com` 创建图文草稿。
> 最后验证时间：2026-11-23，小红书创作服务平台 + Chrome 160。

---

## 0. 一句话结论

**用 Win32 合成鼠标键盘事件操作已登录的窗口**，不要试图走 CDP。

---

## 1. 为什么必须用 UI 自动化

三条技术路线，前两条已实测失败：

| 方案 | 结果 |
| :--- | :--- |
| 默认 profile 加 `--remote-debugging-port` | Chrome 136+ 安全策略拒绝，端口不通 |
| 复制 profile 到别处再开调试端口 | Cookie 设备绑定加密，复制后变未登录（跳 `login?redirectReason=401`） |
| 读取/复制 Chrome 的 Cookies 文件 | 独占锁，`SeBackupPrivilege`、`robocopy /B`、`esentutl /y` 全部打不开 |

结论：唯一可行路径是操作屏幕上那个**已登录**的窗口。

---

## 2. 环境准备

### 2.1 DPI 感知（第一步，漏了坐标全错）

```python
import ctypes
ctypes.windll.shcore.SetProcessDpiAwareness(2)  # PER_MONITOR_AWARE
```

不加这句，所有坐标会按系统缩放比例偏移，表现为点击总是差几十像素。

### 2.2 找到目标窗口

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
```

按标题关键字匹配：`"创作"` 或 `"creator"`。

### 2.3 强制前台（焦点争夺对策）

DSH 和浏览器同窗口时会不断抢焦点。用置顶抖动 + AttachThreadInput 绕过前台锁：

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

⚠️ **关键**：点击进入编辑器之后，不要再插 `SetWindowPos`/`BringWindowToTop`，会把 contenteditable 的焦点打断。只在需要时提前聚焦。

---

## 3. 坐标标定（本任务的头号失败原因）

窗口是否最大化、书签栏是否展开，都会让坐标整体平移几十到上百像素。**每次操作前重新标定**。

### 标定步骤

```
1. 最大化窗口 + 前台化
2. 截全屏
3. 用 read_image 读图，确认各元素纵向位置
4. 裁剪目标区域放大核对（别靠猜）
5. 写入代码常量
```

### 参考坐标

窗口最大化，`rect = (-8, -8, 2568, 1400)`，DPI 96，屏幕 2560×1440：

| 元素 | 坐标 | 说明 |
| :--- | ---: | :--- |
| 上传图文 标签 | (448, 157) | 书签栏展开会遮挡，先按 Esc |
| 空态「上传图片」按钮 | (790, 500) | 仅在无图时存在 |
| **标题输入框** | **(900, 405)** | 关键！点偏就落进缩略图区 |
| **正文输入框** | **(900, 448)** | |
| 暂存离开 | (1066, 1342) | |
| 发布（**禁用**） | (868, 1342) | 绝不点击 |
| 草稿箱 | (597, 81) | 位置随页面状态变 |
| 智能标题 | (1487, 274) | 位置浮动，不一定可靠 |

### 为什么 y=274 是陷阱

上传图片后，缩略图栏占据 y≈145–390。之前一直把标题定位在 y=274，那个位置是**图片缩略图**，所以每次点击都弹出文件选择框，而不是聚焦标题。真正的标题框在缩略图**下方**，y≈405。

---

## 4. 完整流程

### 4.1 导航

```python
URL = "https://creator.xiaohongshu.com/publish/publish?target=image"
hotkey("ctrl", "l"); paste(URL); press("enter"); sleep(7)
```

`hotkey("ctrl","t")` 新开的标签在后台，需要显式切换（如 `ctrl+3`）才能看到内容。

### 4.2 上传图片

文件对话框是唯一稳的路。**不要**点上传区靠猜坐标。

```python
UP_BTN = (790, 500)          # 空态上传按钮
click(*UP_BTN); sleep(2)

dlg = FindWindowW("#32770", "打开") or FindWindowW("#32770", None)
edits = enum_children(dlg, "Edit")

# 多文件：空格分隔的双引号路径串
text = " ".join(f'"{p}"' for p in paths)
SendMessageW(edits[0], WM_SETTEXT, 0, ctypes.cast(buf, ctypes.c_void_p))

# 必须读回验证
assert "05-install.png" in get_text(edits[0])

# BM_CLICK 到按钮控件（不是 WM_COMMAND IDOK）
for b in enum_children(dlg, "Button"):
    if "打开" in get_text(b, 64):
        SendMessageW(b, BM_CLICK, 0, None)
        break

sleep(15)   # 等上传完成
```

`SendMessageW` 签名：

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

## 5. 逐字输入（备用方案）

当剪贴板不好用时，可以逐字发送 Unicode：

```python
KEYEVENTF_UNICODE, KEYEVENTF_KEYUP = 0x0004, 0x0002

def uni_char(ch):
    code = ord(ch)
    user32.keybd_event(0, code, KEYEVENTF_UNICODE, 0)
    time.sleep(0.008)
    user32.keybd_event(0, code, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, 0)
    time.sleep(0.008)
```

中文可以直接发。但长文本速度慢，优先用剪贴板。

---

## 6. 剪贴板：两种格式

### 6.1 纯文本

```python
CF_UNICODETEXT = 13
OpenClipboard(None); EmptyClipboard()
h = GlobalAlloc(GMEM_MOVEABLE, size)
p = GlobalLock(h); ctypes.memmove(p, buf, size); GlobalUnlock(h)
SetClipboardData(CF_UNICODETEXT, h)
CloseClipboard()
```

### 6.2 文件（CF_HDROP，等价于资源管理器 Ctrl+C）

```python
CF_HDROP = 15
# DROPFILES 头 20 字节 + UTF-16LE 路径列表 + 双 \0
header = struct.pack("<IiiII", 20, 0, 0, 0, 1)   # pFiles=20, fWide=1
blob = header + b"".join(p.encode("utf-16-le") + b"\x00\x00" for p in paths) + b"\x00\x00"
# 对齐后写入剪贴板
```

小红书上传区**接受**文件粘贴，但定位不稳，优先用文件对话框。

---

## 7. 验收清单

- [ ] 5 张图全部在缩略图栏，右上显示 `5/18`
- [ ] 标题框有文字 + 字数计数
- [ ] 正文从第一段开始（用 `Ctrl+Home` 确认）
- [ ] 标签出现在正文末尾
- [ ] 顶部绿色「保存成功」
- [ ] 草稿箱列表能看到这条，标题和封面正常
- [ ] **「发布」从未被点击**

---

## 8. 坑速查

| 症状 | 原因 | 修法 |
| :--- | :--- | :--- |
| 一直弹文件选择框 | 坐标落在图片缩略图区 | 标题在缩略图**下方**，重新标定 y |
| 标题文字跑到正文里 | 正文先获得焦点 | 严格按 标题→正文 顺序 |
| 粘贴完全无反应 | 标签页不在前台 | `force_foreground` + 点页面空白 |
| 正文只粘进后半段 | 视图滚动误判 | `Ctrl+Home` 回开头再截图 |
| 点击文字没反应 | 点在块边缘/空白 | 点 placeholder 文字的基线 |
| 坐标整体偏移 | 漏了 DPI 感知 | 首行 `SetProcessDpiAwareness(2)` |
| 书签栏遮挡顶部 | 书签栏展开 | 先按 `Esc` 收起 |
| `SendMessageW` 报 TypeError | argtypes 写成 LPARAM | 改成 `ctypes.c_void_p` |
| 点「打开」没反应 | 用了 WM_COMMAND IDOK | 必须 `BM_CLICK` 到按钮 HWND |
| 焦点反复被抢 | 同窗口内的 DSH 标签 | 用 `--app=URL` 开独立窗口 |

---

## 9. 代码文件

本项目 `marketing/xiaohongshu/` 下的可复用模块：

| 文件 | 用途 |
| :--- | :--- |
| `uiauto.py` | 键盘/鼠标/剪贴板/截屏基础封装 |
| `winfocus.py` | 基础前台聚焦 |
| `forcefg.py` | 置顶抖动 + AttachThreadInput 强制前台 |
| `winlist.py` | 枚举 Chrome 窗口 |
| `clipfile.py` | CF_HDROP 文件剪贴板 |
| `fix_title.py` / `fix_body.py` / `fix_tags.py` | 各步骤独立脚本（坐标已校准） |
| `render.py` | 5 张推广图的 Pillow 渲染脚本 |

---

## 10. 复用步骤

新任务时：

1. 复制 `uiauto.py`、`forcefg.py`、`winlist.py` 到新目录
2. **重新标定坐标**（窗口状态可能不同）
3. 准备好图片路径和目标文案
4. 按 导航 → 上传 → 标题 → 正文 → 标签 → 保存 顺序执行
5. 每一步截图验证，不要跳过

---

## 11. 抖音版（对比记录）

抖音图文发布用同一套底层，但有几个必须知道的差异：

### 11.1 路由不是 /upload

```
✅ https://creator.douyin.com/creator-micro/content/post/image
❌ https://creator.douyin.com/creator-micro/content/upload
```

`/upload` 是视频上传页。点顶部「发布图文」标签也不跳转，直接访问 `/post/image` 才进得去。

### 11.2 标题框在 y≈320，不是 210

页面顶部有个「快速填写」按钮在 y≈210，一直点它当然填不进标题。

正确位置是「添加作品标题」文字行，y≈320。诊断方法：截图后裁 `(1010,180)-(1580,330)` 放大，占位文字在裁剪图的 93% 高度处，换算回原图 ≈320。

### 11.3 按钮必须先滚到底

抖音的「发布 / 暂存离开」在页面最底部，初始视口看不到。流程：

```python
click(700, 1200)     # 点空白让页面获得滚动焦点
press("end"); sleep(1.0)
press("end"); sleep(1.5)     # 按两次
# 此时 发布=(954,1300)  暂存离开=(1101,1300)
```

### 11.4 保存成功的判断方式

小红书是顶部绿色「保存成功」提示；抖音是**页面跳回上传页**并显示：

```
⚠ 你还有上次未发布的图文，是否继续编辑？   [继续编辑] [放弃]
```

看到这行就说明草稿已保存。

### 11.5 其它

- 标题和描述**分开计数**（各 20 / 1000），不像小红书标题独立
- 位置权限弹窗会挡页面，按 `Esc` 关
- `Ctrl+A` 会全选整个页面而不是输入框内容，不要用它清空
- 「继续编辑」按钮坐标 (1479,149) 容易点到旁边的 AI 工坊，注意核对

### 11.6 坐标速查（抖音，2560×1440 最大化）

| 元素 | 坐标 |
| :--- | ---: |
| 上传区 | (1758, 480) |
| **标题框** | **(1100, 320)** |
| 描述框 | (1180, 400) |
| 暂存离开（滚到底后） | (1101, 1300) |
| 发布（**禁用**） | (954, 1300) |
