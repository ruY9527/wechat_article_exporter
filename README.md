# 微信公众号文章导出助手（WeChat Article Exporter）

一款完全免费、开源、**无外部后端依赖**的 Chrome 扩展（Manifest V3），在公众号文章页
（`https://mp.weixin.qq.com/s/...`）一键把当前文章导出为：

| 格式 | 说明 |
| :--- | :--- |
| **Markdown（`.zip`）** | `{标题}.md` + `images/img_001.png…`，图片本地化，断网也能正常渲染，彻底解决防盗链裂图 |
| **Markdown（`.md`）** | 不下载图片，保留原图链接，适合快速摘录文字 |
| **复制 Markdown** | 不下载文件，直接把清洗后的完整 Markdown 写入剪贴板 |
| **高保真 PDF** | 懒加载图片全量预处理 + 分层分页控制 + 打印样式注入，文字可选可搜索 |
| **单文件离线 HTML** | 正文图片 Base64 内联、CSS 内嵌，双击即可离线阅读 |
| **EPUB 3 电子书** | 严格良构 XHTML、EPUB 3 导航与旧版 NCX，本地图片及封面元数据 |
| **全页长图 PNG** | 按需申请临时 `debugger` 权限，通过 CDP 截取完整正文，超长文章自动降倍 |

零构建：改完代码在 `chrome://extensions/` 刷新扩展即可，不需要 npm build。

> **v1.2.0 新增**：内联粗体/斜体/删除线/高亮保留，封面与摘要提取，音视频/名片/引用卡片占位，
> 图片消息（小绿书）适配，可选精选评论，以及 Copy MD、离线 HTML、EPUB 3、WebP 转 PNG、全页长图 PNG。
> `debugger` 仅声明在 `optional_permissions`，只在用户点击长图导出并同意后使用，截图结束立即 detach。
>
> **v1.1.0 重点修复**：PDF 排版。原实现最大页内空白达 609pt（整页 72% 是空的）、
> 11 张图变成灰块。现已降到 27.2pt、0 张灰块。修复依据与实测数据见 [§6 排版设计说明](#6-排版设计说明)。

---

## 1. 目录结构

```text
wechat_article_exporter/
├── plan/
│   ├── design_and_test_plan.md      # v1.0/v1.1 设计与测试方案
│   └── v1.2_extension_implementation_plan.md # v1.2 功能扩展实施规格
├── src/                             # ← 加载已解压扩展时选这个目录
│   ├── manifest.json                # MV3 清单与权限
│   ├── background.js                # Service Worker：跨域拉图 / 下载兜底 / 偏好读写
│   ├── content.js                   # 内容脚本：DOM 提取、清洗、MD 转换、ZIP、PDF 打印
│   ├── converters/
│   │   ├── html.js                  # 单文件离线 HTML 转换器（零构建）
│   │   └── epub.js                  # EPUB 3 打包与严格 XHTML 序列化
│   ├── popup/
│   │   ├── popup.html               # 弹窗 UI
│   │   ├── popup.css                # 弹窗样式
│   │   └── popup.js                 # 页面判定、选项持久化、进度展示
│   ├── styles/
│   │   └── print.css                # 打印样式参考副本（运行时的真源在 content.js）
│   ├── libs/
│   │   ├── turndown.js              # 7.2.0（本地静态引入）
│   │   ├── turndown-plugin-gfm.js   # 1.0.2
│   │   └── jszip.min.js             # 3.10.1
│   └── icons/
│       ├── icon16.png  icon48.png  icon128.png
├── scripts/
│   ├── make-icons.js                # 纯 Node 生成图标（无 canvas 依赖）
│   └── pack.js                      # 打包 dist/*.zip（只含 src/）
├── tests/
│   ├── run-tests.js                 # 主回归测试（content.js + popup.js + 结构一致性）
│   ├── background-tests.js          # background.js 单元测试（vm + fetch 桩）
│   ├── print-sim.js                 # 排版质量闸门：真实 Chrome 打印 + 指标断言
│   ├── pdf_metrics.py               # 用 PyMuPDF 量 PDF 排版指标
│   ├── pdf-layout.js                # 独立度量入口与阈值定义
│   ├── convert.js                   # 离线转换自测，输出 Markdown 到 tests/output/
│   ├── fixtures/                    # 静态 HTML 样本
│   │   ├── tech-article.html        # 代码块 / 表格 / 公式 / 隐藏节点
│   │   ├── multi-image.html         # PNG·JPG·GIF·WebP 混排 + 特殊字符标题
│   │   ├── long-article.html        # 16 图并发压力样本
│   │   ├── broken-images.html       # 图全取不到（防盗链/超时）的极端样本
│   │   ├── real-structure.html      # 真实公众号卡片结构：图成功/失败混合
│   │   └── assets/                  # 样本用真实图片（wide / tall / sq）
│   └── output/                      # convert.js 的产物
└── package.json                     # 仅用于跑测试（devDependency: jsdom）
```

---

## 2. 本地安装

1. 打开 Chrome，地址栏输入 `chrome://extensions/`。
2. 打开右上角 **开发者模式**。
3. 点 **加载已解压的扩展程序**，选择本项目的 `src/` 目录。
4. 把扩展固定（Pin）到工具栏。

**热更新**：

- 改 `popup/` 下文件 → 重新点开弹窗即可生效。
- 改 `content.js` / `background.js` → 在 `chrome://extensions/` 点该扩展的刷新图标，**并刷新已打开的公众号文章页**。

---

## 3. 使用

### 3.1 导出 Markdown

弹窗里勾选：

- **导出 Markdown 时打包本地图片（ZIP）** — 默认勾选。取消后得到纯 `.md`，图片保留原链接。
- **添加 YAML Front Matter 元信息头** — 默认勾选。

点「导出 Markdown」，进度条依次显示 `提取正文 → 下载图片 (n/N) → 转换 → 打包 → 保存`。

产物：

```text
文章标题.zip
├── 文章标题.md
└── images/
    ├── img_001.png
    ├── img_002.jpg
    └── …
```

`.md` 内图片链接已重写为 `./images/img_001.png`，可直接拖进 Typora / Obsidian / VS Code。

### 3.2 导出 PDF

点「导出 PDF」，扩展会：

1. 把 `#js_content img` 的 `data-src` 强制写回 `src` 并移除 `loading="lazy"`；
2. 等所有图片 `load` / `error`（单图 5 s 兜底）；
3. 注入 `<style id="wx-exporter-print-style">`；
4. 调用 `window.print()`；
5. 监听 `afterprint` 一次性清理样式并还原图片 `src`（部分平台取消打印不派发 `afterprint`，另有焦点回归计时兜底）。

在打印对话框里：

- 「目标打印机」选 **另存为 PDF**
- 展开「更多设置」→ 勾选 **背景图形**，取消 **页眉和页脚**

### 3.3 v1.2 导出与高级选项

- **复制 Markdown**：始终保留原图链接，不创建 ZIP 或 `.md` 文件；成功后显示复制字符数。`clipboardWrite` 用于异步生成完成后的可靠写入，保留用户点击路径与隐藏文本框兜底。
- **离线 HTML / EPUB 电子书**：自动下载正文图片与封面；下载失败的图片保留原链接并显示警告。
- **导出长图 PNG**：首次使用时 Chrome 会请求临时调试权限。授权后依次完成图片预热、页面准备、CDP 截图与现场恢复；拒绝授权不会改动页面。
- **WebP 自动转 PNG**：在「更多解析与图片选项」中开启，Markdown ZIP、HTML 和 EPUB 共用本地转码；浏览器解码或 Canvas 失败时保留原 WebP。
- **保留音视频/卡片占位**：默认开启；关闭后沿用 v1.1 的噪声剔除行为。
- **附带导出精选评论**：默认关闭；开启后追加评论作者、点赞数和作者回复。
- **图片消息 / 小绿书**：轮播图与短文进入统一导出管线；纯脚本渲染页面可回退解析 `picture_page_info_list`。

长图超过 12,000 CSS 像素时缩放倍率从 2 降为 1，以降低 Chrome 的截图内存压力。截图期间可能出现 Chrome 调试提示，完成或失败后都会执行 detach；后台在 Popup 被关闭时仍发送页面清理，内容脚本另有超时恢复兜底，最终恢复页面样式、图片属性与滚动位置。

---

## 4. 三端调试

| 环境 | 打开方式 | 观察点 |
| :--- | :--- | :--- |
| **Popup** | 点插件图标 → 弹窗空白处右键 → 检查 | UI 状态、发出的消息、`chrome.storage.local` |
| **Content Script** | 文章页 `F12` → Console → 执行上下文切到本扩展 | 日志与报错；Elements 里查 `#wx-exporter-print-style` |
| **Service Worker** | `chrome://extensions/` → 检查视图：Service Worker | Network 里看 `mmbiz.qpic.cn` 是否 `200` 而非 `403` |

---

## 5. 测试

依赖只有 `jsdom`（仅测试用，不进扩展）；排版度量额外需要本机 Chrome/Edge 与 Python 的 `pymupdf`：

```bash
npm install          # 安装 devDependency
npm test             # 逻辑回归：run-tests.js + background-tests.js
npm run test:layout  # 排版度量：真实 Chrome 打印 + PyMuPDF 量指标
npm run test:all     # 两者都跑
npm run test:convert # 离线转换，产物在 tests/output/*.md
npm run icons        # 重新生成图标
npm run pack         # 打包 dist/wechat-article-exporter-v1.2.0.zip
```

### 5.1 自动化覆盖

**`tests/run-tests.js`（79 项）**

- **TC-04** 代码块（去行号列、保留语言标识、多段 `<code>` 逐行拼接、**代码块内空行与缩进不被后处理破坏**、
  4 反引号围栏不被误判）、表格（含 `<td>` 表头提升为 `<th>`）、
  行内 `$…$` / 块级 `$$…$$` 公式、引用与列表、隐藏节点/广告/二维码/`script`/`iframe` 剔除、
  空锚点降级、围栏外空行压缩、原页面 DOM 不被修改
- **TC-05** `wx_fmt` 优先决定扩展名、无 `wx_fmt` 时按路径识别 `.gif`、协议相对地址补全、
  同图去重、`data:image/svg+xml` 占位图剔除、MIME 兜底映射
- **TC-06** 特殊字符标题替换与 80 字符截断、`2026年11月18日` → `2026-11-18`、空标题兜底
- **TC-07** 指定一张图失败时整体不中断、`imageFailed = 1`、失败图回退为原链接
- **长文压力** 16 图全成功、编号连续、扩展名按 `wx_fmt` 轮转、ZIP 内 `.md` + 16 张图、并发池峰值 ≤ 5
- **TC-09** `@page A4 / 16mm 18mm`、关键节点隐藏清单、正文宽度自适应、
  **分页防截断分层控制**（代码块 avoid、表格 auto + 表头重复、引用 auto，且不得回到一刀切写法）、
  **失败图片压平规则**、代码块容器不得使用 `pre-wrap`
- **TC-10** 打印样式注入后按 `PRINT_STYLE_ID` 完全移除
- **TC-01 / TC-11** 非公众号页拦截并禁用按钮、文章页启用、内容脚本掉线提示、五项偏好读写、六按钮顺序与折叠高级选项
- **TC-12 ~ TC-16** 内联语义样式及标题/代码保护、封面摘要与 ZIP 封面、媒体占位开关、图片消息 DOM/纯脚本解析、精选评论开关
- **TC-17 ~ TC-20** Copy MD 不触发下载、单文件 HTML 图片/CSS 内联、EPUB ZIP 反解与 `mimetype` STORE/XML 良构、WebP 转码及异常回退
- **结构一致性** manifest 字段、`debugger` 仅可选权限、转换器加载顺序、所有声明文件存在、`content_scripts` 匹配、`content.js` 与
  `print.css` 关键声明同步、PNG 魔数与 IHDR 尺寸、`background.js` 顶层注册 listener

**`tests/background-tests.js`（19 项）**

`FETCH_IMAGE` 成功/403 不重试/500 重试一次/重试成功/空响应体/非法协议拒绝、
`referrerPolicy: 'no-referrer'` 与 `credentials: 'omit'`、`//` 协议补全、
`FETCH_IMAGES` 顺序一致、`DOWNLOAD_DATA_URL` 触发 `chrome.downloads` 且拒绝非 `data:`、
`GET/SET_SETTINGS` 默认值与持久化、未知 action 返回 `false`。

**`tests/print-sim.js` + `tests/pdf_metrics.py`（排版质量闸门）**

排版问题肉眼看不准，所以做成了可执行的数字闸门：用 jsdom 跑 `content.js` 的真实清洗与
`preloadImagesForPrint()`，注入 `buildPrintStyleSheet()`，交给 headless Chrome 打印，
再用 PyMuPDF 量指标。

| 指标 | 含义 | 阈值 |
| :--- | :--- | :--- |
| `hugeGapPt` | 单页最大纵向空白 | ≤ 60pt |
| `avgGapPt` | 各页最大空白的平均 | ≤ 40pt |
| `grayImgCount` | 栅格化后近单色 / 绝大多数行同色的图（灰块、只画出顶边） | = 0 |
| `textChars` | 可提取文字数（证明是矢量文字而非图片） | ≥ 600 |
| `textLeft` / `textTop` | 正文起始坐标（校验页边距） | ≤ 60pt |
| `headerFooter` | 是否混入浏览器页眉页脚 | 必须为 false |

覆盖三条路径：`broken-images`（图全失败）、`real-structure`（图全失败）、
`real-structure --keep-images`（3 张成功 / 6 张失败，最接近真实）。

### 5.2 排版修复实测数据

用户反馈的坏 PDF 与我修复后的同一批指标对比：

| 指标 | 修复前（用户提供的 PDF） | 修复后（`real-structure` 混合路径） |
| :--- | ---: | ---: |
| 最大页内空白 | **609.1 pt** | **27.2 pt** |
| 平均最大空白 | **177.1 pt** | 26.9 pt |
| 灰块 / 破损图片 | **11 张** | **0 张** |
| 浏览器页眉页脚 | **有** | 无 |
| 可提取文字 | 58,876 字 | 5,211 字（样本本身较短） |

### 5.3 需人工在真实 Chrome 验证的用例

这几条依赖真实浏览器渲染与打印管线，脚本无法替代：

| 编号 | 场景 | 判定 |
| :--- | :--- | :--- |
| **TC-02** | 含 15+ 图长文，**不滚动**直接导出 MD | ZIP 解压后图片完整、无占位图 |
| **TC-03** | 解压产物拖进 Typora / Obsidian，**断网**打开 | 图片全部正常渲染 |
| **TC-08** | 长图文，**不滚动**直接导出 PDF | 预览里图片已加载、无侧边二维码与底部推荐栏 |
| **TC-09（人工部分）** | 另存 PDF 后打开 | 图/代码块不被拦腰截断；文字可选中复制 |
| **TC-17（人工部分）** | 点击「复制 Markdown」后粘贴到编辑器 | 内容完整，字符数提示正确，不产生下载 |
| **TC-18（人工部分）** | 断网双击导出的单文件 HTML | 排版与全部成功下载的图片可离线显示 |
| **TC-19（人工部分）** | EPUB 导入 Calibre / 微信读书 | 封面、目录锚点、正文图片与 XHTML 可正常读取 |
| **TC-21（人工部分）** | 首次长图授权、拒绝授权、成功与中途失败 | 权限提示符合预期；结束后无调试横幅，页面位置与图片状态恢复 |

### 5.4 离线转换自测（改规则时用）

避免每次都刷新微信页面：

1. 浏览器「网页，仅 HTML」保存 1~3 篇典型文章到 `tests/fixtures/`；
2. `npm run test:convert`；
3. 打开 `tests/output/*.md` 比对代码块、表格、空行、公式。

---

## 6. 排版设计说明

这一节记录 PDF 排版为什么是现在这样，都是实测踩出来的。

### 6.1 大页空白（最严重的问题）

原实现把所有「不能拆」的元素都设成 `break-inside: avoid`：

```css
img, pre, blockquote, table, figure, .code-snippet__fix {
  break-inside: avoid !important;
}
```

一个 400pt 高的块如果在页底放不下，整块被推到下一页，上一页就空掉 400pt。
实测用户 PDF 最大 609pt（A4 高 842pt，等于 **72% 的版面空白**），平均 177pt。

现在分层处理：

| 元素 | 策略 | 理由 |
| :--- | :--- | :--- |
| 代码块 `.code-snippet__fix` | `avoid` + `max-height: 210mm` | 真不能拆，但给高度上限，超高块宁愿拆 |
| 表格 `table` | `auto` | 宽表整体推页最伤排版 |
| 表头 `thead` | `display: table-header-group` | 跨页时重复表头 |
| 引用 `blockquote` | `auto` | 长引用允许跨页 |
| 图片 `img` | `avoid` + `max-height: 165mm` | 图内不拆，但失败图不会撑满全页 |
| 标题 | `break-after: avoid` | 标题后不落单，但不参与 `break-inside` |

### 6.2 图片变灰块 / 只画出一条边

微信 `<img>` 带 `width`/`height` 属性。图片没解码成功时，Chrome **按属性预留高度**
（例如 `677×313` 就占 313pt），却只画一个 `14×16` 的破图标 —— 于是既看不到图，
又留下大块空白。我在用户 PDF 里量到 11 张这样的图，`uniformRows` 0.94~1.0
（即 94%~100% 的行是单一颜色）。

修法两道：

1. **打印前逐张确认**：`preloadImagesForPrint()` 等 `load`/`error` + `img.decode()`，
   再复查 `naturalWidth > 0`；失败的图打 `data-wx-img-broken` 并清掉 `width`/`height`/`data-ratio`。
2. **CSS 兜底**：`img[data-wx-img-broken]` 压到 0；同时给所有 `img` 一条
   `max-height: 165mm`，即使图片恰好在打印瞬间才失败，也不会撑出 200pt 以上的空洞
   （实测：完全不跑 JS、只用 CSS，最大空白也只有 30.3pt）。

### 6.3 代码块的两个布局陷阱

**陷阱一：flex 没解除。** 微信代码块外框是 `display: flex`（左行号列 + 右代码区）。
隐藏行号列后如果不改 `display`，代码只占左半栏，右侧大片空白。
—— 实测代码右边界停在 252pt，而正文宽度是 460pt。

**陷阱二：容器上的 `white-space: pre-wrap`。** 结构是

```html
<div class="code-snippet__fix">
  <ul class="code-snippet__line-index">…</ul>
  <pre><code>…</code></pre>
</div>
```

给这个 `div` 设 `pre-wrap` 后，元素之间那几个 `"\n      "` 缩进文本会被当成代码空行
渲染出来，把 `<pre>` 从 4064px 顶到 4130px（**66px 空白**）。
现在容器用 `normal`，只在 `<pre>`/`<code>` 内部用 `pre-wrap`。

**另外**：`#js_content pre, #js_content .code-snippet__fix` 这种合并写法有隐患 ——
它让内层 `#js_content .code-snippet__fix > pre { margin: 0 }` 与 `#js_content pre { margin: 8pt }`
优先级相同（都是 1,0,1），后写的赢，内层 `pre` 又拿到 8pt 外边距。必须分两条写。

### 6.4 页边距让给 @page

Chrome 的「页眉页脚」画在 `@page` 的 `margin` 区域。原先 `margin: 12mm 14mm`，
正文被页眉页脚挤下去，观感像「顶部有巨大空白」。现在 `@page { size: A4; margin: 16mm 18mm }`，
并在使用说明里要求取消「页眉和页脚」。

### 6.5 正文字号与节奏

不再用「12pt + 1.75 行高」这种被放大的网页排版：

| 项目 | 值 |
| :--- | :--- |
| 正文 | 11pt / 行高 1.6 / `letter-spacing: 0.01em` |
| 段间距 | `0.55em`（不用整行空段） |
| 标题 | h1 15pt / h2 13.5pt / h3 12pt，上 1.1em 下 0.5em |
| 引用 | 10.5pt、左侧 2.5pt 绿线、浅底 |
| 代码 | 9pt / 行高 1.5、左侧绿线、浅底 |
| 表格 | 9.5pt、`table-layout: fixed` |

空 `<p>`/`<section>`/`<div>` 一律 `display: none`，否则微信编辑器留下的大量空段落
会挤出成片空白。

---

## 7. 已知取舍

- **PDF 走 `window.print()`**，不是静默下载。静默方案需要 `chrome.debugger` +
  `Page.printToPDF`，调用期间浏览器顶部会出现「正在调试此浏览器」横幅，故留作后续进阶。
- **必须在打印对话框里取消「页眉和页脚」**。Chrome 的页眉页脚画在 `@page` 边距区，
  取消后正文才能真正占满纸张。这一步浏览器不允许扩展强制修改。
- **图片并发 `5`、单图 `10 s` 超时**（PDF 预热 `5 s`）。微信图床对高频请求有限流，调高并发容易触发 403。
- **文件名截断到 80 字符**并替换 `\ / : * ? " < > |`，兼顾 Windows `MAX_PATH` 与 macOS 限制。
- **`print.css` 是参考副本**，运行时真源是 `content.js` 的 `buildPrintStyleSheet()`；
  测试里有一条用例专门校验两边关键声明不漂移。改样式请改 `content.js` 再同步 `print.css`。
- **加载失败的图片会被隐藏，而不是显示占位图**。微信原页面失败时是一个灰色小框，
  打印出来既难看又占位；压平更符合「导出成品」的预期。若你想保留可见提示，
  把 `#js_content img[data-wx-img-broken]` 的 `display: none` 改成小尺寸占位样式即可。
- **超长竖图（长截图）被限制在 165mm 内**，避免单图跨页。代价是极长图会等比缩小。

