# 微信公众号文章导出助手（WeChat Article Exporter）设计与测试方案

## 1. 项目概述

### 1.1 项目目标
开发一款完全免费、开源、无外部后端依赖的 Google Chrome 浏览器扩展（基于 **Manifest V3**），实现在微信公众号文章页面（`https://mp.weixin.qq.com/s/...`）一键将当前文章导出为：
1. **Markdown（`.md` / `.zip`）**：保留标题、正文结构、代码块、表格、引用与公式，并支持将微信图片下载到本地打包，彻底解决防盗链导致的裂图问题。
2. **高保真 PDF**：自动加载懒加载图片、清理页面广告/侧边栏/评论区，优化分页防截断样式，输出文字可选中复制的清晰 PDF。

### 1.2 技术选型
* **扩展规范**：Chrome Extension Manifest V3
* **开发语言**：原生 JavaScript (ES6+)、HTML5、CSS3（初期采用**零构建方案**，修改代码后在 Chrome 刷新扩展即可生效，降低开发与调试成本）
* **第三方依赖（本地静态引入至 `libs/`，不依赖外网 CDN）**：
  * `turndown.js`：将清洗后的 HTML 转换为标准 Markdown
  * `turndown-plugin-gfm.js`：补充 GitHub Flavored Markdown 支持（表格、删除线、任务列表）
  * `jszip.min.js`：将 `.md` 文件与本地图片目录打包为单个 `.zip` 下载

---

## 2. 项目目录结构规划

```text
wechat_article_exporter/
├── plan/
│   └── design_and_test_plan.md   # 本设计、实现细节与本地测试文档
├── src/                          # Chrome 扩展根目录（加载已解压扩展时选择此目录）
│   ├── manifest.json             # 扩展清单与权限配置 (MV3)
│   ├── background.js             # Service Worker：负责跨域拉取微信图片、处理下载
│   ├── content.js                # 内容脚本：DOM 提取、懒加载还原、MD 转换、PDF 打印注入
│   ├── popup/
│   │   ├── popup.html            # 扩展弹窗 UI
│   │   ├── popup.css             # 弹窗样式
│   │   └── popup.js              # 弹窗交互逻辑与进度展示
│   ├── styles/
│   │   └── print.css             # 可选：独立的打印样式参考
│   ├── libs/
│   │   ├── turndown.js
│   │   ├── turndown-plugin-gfm.js
│   │   └── jszip.min.js
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
└── tests/                        # 本地自动化/回归测试辅助文件（不打包进扩展）
    └── fixtures/                 # 保存的典型公众号静态 HTML 样本
```

---

## 3. Manifest V3 配置与权限设计

`src/manifest.json` 核心配置要点：

* `manifest_version`: `3`
* `permissions`:
  * `activeTab`：获取当前活动标签页信息
  * `downloads`：支持通过浏览器下载 API 保存文件
  * `storage`：持久化用户的导出偏好设置（如是否包含 Front Matter、是否打包图片）
* `host_permissions`:
  * `https://mp.weixin.qq.com/*`：访问微信公众号文章页
  * `https://mmbiz.qpic.cn/*`、`https://mmbiz.qlogo.cn/*`、`https://res.wx.qq.com/*`：允许 Service Worker 跨域拉取微信图床图片资源
* `content_scripts`:
  * `matches`: `["https://mp.weixin.qq.com/s*"]`
  * `js`: `["libs/turndown.js", "libs/turndown-plugin-gfm.js", "libs/jszip.min.js", "content.js"]`
  * `run_at`: `"document_idle"`
* `background`:
  * `service_worker`: `"background.js"`
* `action`:
  * `default_popup`: `"popup/popup.html"`

---

## 4. 核心模块实现细节

### 4.1 页面元数据与正文提取（DOM 解析）

在 `content.js` 中，所有 DOM 操作均应基于克隆节点进行，**绝不破坏原页面用于正常阅读的 DOM 结构**（PDF 打印时的临时样式除外）。

1. **元数据提取规则**：
   * **文章标题**：`document.querySelector('#activity-name')?.innerText.trim()`，兜底 `document.title`
   * **公众号名称**：`document.querySelector('#js_name')?.innerText.trim()`
   * **作者**：`document.querySelector('.rich_media_meta_text')?.innerText.trim()`
   * **发布时间**：`document.querySelector('#publish_time')?.innerText.trim()`
   * **原文链接**：`window.location.href`
2. **正文提取与清洗**：
   * 定位核心容器：`const rawContent = document.querySelector('#js_content')`
   * 深拷贝：`const clonedContent = rawContent.cloneNode(true)`
   * 移除无关节点：
     * 隐藏节点（`style` 中含 `display: none` 或 `visibility: hidden` 的元素）
     * 微信广告、小程序卡片占位、音频/视频脚本标签（`<script>`、`<style>`、`<iframe>`、`.qr_code_pc` 等）
3. **文件名安全处理**：
   * Windows/macOS 文件名清洗正则：`title.replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 80)`，避免下载失败。

---

### 4.2 图片懒加载还原与防盗链本地化

微信公众号图片存在两大特性：**懒加载（`data-src`）** 与 **Referer 防盗链**。

1. **URL 提取与去重**：
   * 遍历 `clonedContent.querySelectorAll('img')`：
     * 真实地址优先取 `img.getAttribute('data-src') || img.getAttribute('src')`。
     * 过滤掉 `data:image/svg+xml` 等透明占位符。
   * 建立 `Map<url, localRelativePath>`，同一张图在文中多次出现时只下载一次。
2. **文件扩展名识别**：
   * 优先解析 URL 查询参数中的 `wx_fmt`（例如 `wx_fmt=png` / `jpeg` / `gif` / `webp`）。
   * 若 URL 中缺失 `wx_fmt`，则根据 `fetch` 返回响应头的 `Content-Type`（如 `image/jpeg` -> `.jpg`）兜底，默认 `.png`。
   * 本地命名格式：`images/img_001.png`、`images/img_002.jpg`。
3. **绕过防盗链下载流程（Content ↔ Background）**：
   * `content.js` 将待下载的唯一图片 URL 列表分批发送给 `background.js`。
   * `background.js` 在拥有 `host_permissions` 的前提下，执行：
     ```javascript
     const resp = await fetch(url, { referrerPolicy: 'no-referrer' });
     const blob = await resp.blob();
     ```
   * 将 `Blob` 转为 Base64（或 DataURL）通过消息回调传回 `content.js`（Manifest V3 消息通道不支持直接传 Blob 对象）。
   * **并发与容错**：
     * 采用并发池控制（建议 `concurrency = 5`），避免短时间发出几十个请求导致浏览器卡顿或微信限流。
     * 单张图片设置 10 秒超时；若某张图片下载失败，记录失败数量并在 Markdown 中保留原始 URL，不中断整体导出流程。

---

### 4.3 HTML 转 Markdown（Turndown 定制规则）

使用 `TurndownService` + `turndownPluginGfm.gfm`，基础选项如下：
```javascript
const turndownService = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*'
});
turndownService.use(turndownPluginGfm.gfm);
```

针对微信公众号特有的富文本结构，必须添加以下**自定义规则**：

1. **微信代码块规则（`.code-snippet__fix`）**：
   * 微信技术文章的代码块常包含行号列表（`<ul class="code-snippet__line-index">`）与实际代码区（`<code>`）。
   * 处理方式：先移除 `.code-snippet__line-index` 节点，读取 `pre[data-lang]` 获取语言名（如 `python`、`js`），提取每一行 `<code>` 文本并用 `\n` 拼接，最终输出标准的围栏代码块：
     ````markdown
     ```python
     print("hello")
     ```
     ````
2. **数学公式规则**：
   * 检查包含 `data-formula` 或 `data-latex` 属性的节点（微信内置公式/第三方排版工具插入的公式），优先提取 LaTeX 源码，按行内 `$...$` 或块级 `$$...$$` 输出；若为纯 SVG 且无源码属性，则回退保留或提示。
3. **冗余 `<section>` 与空行压缩**：
   * 微信编辑器大量嵌套 `<section>`，转换后容易出现连续 4~5 个空行。
   * 在最终 Markdown 文本生成后执行后处理：
     * 去除行尾多余空格；
     * 将连续 3 个及以上换行符压缩为 2 个换行符（`md.replace(/\n{3,}/g, '\n\n')`）。
4. **YAML Front Matter（可选开关）**：
   ```markdown
   ---
   title: "文章标题"
   author: "公众号名称"
   date: "2026-11-22"
   source: "https://mp.weixin.qq.com/s/..."
   ---
   ```
5. **打包输出策略**：
   * **模式一（默认推荐：ZIP 离线包）**：使用 `JSZip` 创建压缩包，根目录放 `{title}.md`，图片放 `images/` 子目录，Markdown 内图片链接全部替换为 `./images/img_001.png`。生成 Blob URL 触发浏览器下载 `{title}.zip`。
   * **模式二（纯 `.md` 文件）**：不下载图片，直接保留原链接并下载 `{title}.md`，适合快速摘录文字。

---

### 4.4 高保真 PDF 导出实现

采用**“全量图片预加载 + 打印 CSS 动态注入 + `window.print()`”**方案。相比 `html2canvas` 截图方案，该方案文字矢量清晰、可复制搜索，且无超长文章画布截断问题。

#### 执行步骤：
1. **强制加载全部懒加载图片**：
   * 遍历页面真实 DOM 中 `#js_content img`：
     * 若存在 `data-src` 且 `src !== data-src`，将 `img.src = img.dataset.src`。
     * 移除 `loading="lazy"` 属性。
   * 等待所有图片加载完成：
     ```javascript
     await Promise.all(
       imgs.map(img => new Promise(resolve => {
         if (img.complete && img.naturalWidth > 0) return resolve();
         const timer = setTimeout(resolve, 5000); // 单图 5s 超时兜底
         img.onload = img.onerror = () => { clearTimeout(timer); resolve(); };
       }))
     );
     ```
2. **动态注入打印样式（`<style id="wx-exporter-print-style">`）**：
   * 页面尺寸与边距：`@page { size: A4; margin: 12mm 14mm; }`
   * 隐藏非正文元素：隐藏 `#js_pc_qr_code`（右侧二维码）、`#js_article_bottom_bar`（底部点赞栏）、`#js_tags`、评论区、相关推荐、顶部导航等。
   * 正文排版优化：让 `.rich_media_area_primary_inner` 宽度自适应打印纸张（`max-width: 100% !important; margin: 0 !important; padding: 0 !important;`）。
   * **防分页截断**：
     ```css
     @media print {
       img, pre, blockquote, table, figure, .code-snippet__fix {
         break-inside: avoid !important;
         page-break-inside: avoid !important;
       }
       h1, h2, h3, h4 {
         break-after: avoid !important;
         page-break-after: avoid !important;
       }
     }
     ```
3. **触发打印与清理现场**：
   * 注册一次性事件 `window.addEventListener('afterprint', cleanup, { once: true })`，在打印对话框关闭后移除注入的 `<style>` 标签，保证原网页恢复正常。
   * 调用 `window.print()`，由用户在预览中确认（勾选“背景图形”、取消“页眉和页脚”）并另存为 PDF。

> **后续可选进阶**：如果希望实现“不弹打印框、静默直接下载 `.pdf`”，可在后续版本中评估使用 `chrome.debugger` 的 `Page.printToPDF` CDP 指令。缺点是调用期间浏览器顶部会短暂出现“正在调试此浏览器”的提示横幅。

---

### 4.5 Popup UI 与消息通信协议

#### Popup 界面元素：
* **页面状态提示栏**：检测当前 Tab URL 是否匹配 `mp.weixin.qq.com/s`。若不匹配，提示“请在微信公众号文章页面使用”并禁用操作按钮。
* **导出选项区**（状态存入 `chrome.storage.local`）：
  * `[x]` 导出 Markdown 时打包本地图片（ZIP）
  * `[x]` 添加 YAML Front Matter 元信息头
* **主操作按钮**：
  * 按钮 1：**导出 Markdown**
  * 按钮 2：**导出 PDF**
* **进度与状态反馈条**：如 `正在提取正文...` → `正在下载图片 (6/15)...` → `打包完成，开始下载`。

#### 消息类型约定：
| 消息 `action` | 发送方 → 接收方 | 说明 |
| :--- | :--- | :--- |
| `EXPORT_MARKDOWN` | `popup` → `content` | 触发 Markdown 提取与打包，携带用户配置项 |
| `EXPORT_PDF` | `popup` → `content` | 触发图片预加载、打印样式注入与 `window.print()` |
| `FETCH_IMAGE` | `content` → `background` | 请求后台绕过防盗链拉取单张图片并返回 Base64 + MIME |
| `EXPORT_PROGRESS` | `content` → `popup` | 实时回传导出阶段与图片下载进度 |

---

## 5. 分阶段开发计划

* **Phase 1（骨架搭建）**：编写 `manifest.json`、`popup` 基础界面、`content.js` 元数据与正文提取，打通 Popup ↔ Content 通信。
* **Phase 2（Markdown + 本地图片）**：集成 `turndown`、`turndown-plugin-gfm`、`jszip`，实现 `background.js` 图片并发下载、代码块/公式规则及 ZIP 导出。
* **Phase 3（PDF 导出）**：实现全量懒加载图片预热、打印样式动态注入、分页防截断与 `afterprint` 清理。
* **Phase 4（体验与边界打磨）**：完善进度条、错误提示、文件名清洗、偏好持久化，完成全套本地测试用例验证。

---

## 6. 本地测试方案

### 6.1 本地安装与加载步骤
1. 打开 Google Chrome，在地址栏输入 `chrome://extensions/` 并回车。
2. 打开右上角的 **“开发者模式”** 开关。
3. 点击左上角 **“加载已解压的扩展程序”**，选择本项目中的 `wechat_article_exporter/src` 目录。
4. 将扩展固定（Pin）到浏览器工具栏，方便快速点击测试。
5. **热更新说明**：
   * 修改 `popup/` 文件：重新点击打开弹窗即可生效。
   * 修改 `content.js` 或 `background.js`：需在 `chrome://extensions/` 点击该扩展的 **刷新图标**，并**刷新已打开的微信公众号文章页面**。

### 6.2 三端 DevTools 调试方法
Chrome 扩展的三个运行环境相互隔离，排查问题时需分别打开对应的开发者工具：
1. **调试 Popup**：点击插件图标弹出窗口 → 在弹窗空白处右键 → **“检查”**，查看 UI 逻辑与发出的消息。
2. **调试 Content Script**：在微信公众号文章页面按 `F12` → 切换到 **Console**，在左上角执行上下文下拉框中可切换至插件上下文查看日志与报错；在 **Elements** 中可检查打印注入的 `<style id="wx-exporter-print-style">`。
3. **调试 Background Service Worker**：在 `chrome://extensions/` 找到本扩展 → 点击 **“检查视图：Service Worker”**，可在 **Network** 面板直接观察 `mmbiz.qpic.cn` 图片请求的 HTTP 状态码（确认是否为 `200 OK` 而非 `403 Forbidden`）。

### 6.3 转换规则离线自测（推荐）
为了避免每次微调 Markdown 转换规则都要反复刷新微信页面：
1. 在浏览器中保存 2~3 篇典型公众号文章的“网页，仅 HTML”到 `tests/fixtures/`（例如：一篇技术代码文章、一篇多图排版文章、一篇含表格和公式的文章）。
2. 编写一个轻量 Node.js 脚本（借助 `jsdom` + `turndown`）直接加载 `tests/fixtures/*.html`，运行自定义 Turndown 规则并输出 `.md`，快速比对代码块、表格、空行和公式的转换效果。

### 6.4 端到端场景测试用例清单

| 编号 | 测试场景 | 操作步骤 | 预期结果 |
| :--- | :--- | :--- | :--- |
| **TC-01** | 非公众号页面拦截 | 在百度或 GitHub 页面点击插件图标 | Popup 显示“仅支持微信公众号文章页面”，导出按钮置灰不可点击 |
| **TC-02** | 未滚动页面直接导出 MD (ZIP) | 打开一篇含 15+ 张图片的长文，**不往下滚动**，直接点击“导出 Markdown” | 进度条正常推进；下载的 ZIP 解压后包含 `.md` 和完整的 `images/`，无占位图或缺失图 |
| **TC-03** | 本地编辑器防盗链验证 | 将 TC-02 解压后的 `.md` 拖入 **Typora / Obsidian / VS Code** 打开 | 所有图片均通过 `./images/img_xxx` 正常渲染，断网状态下依然可见 |
| **TC-04** | 技术文章代码块与表格 | 找一篇含多段带行号代码、Markdown 表格的公众号文章导出 MD | 代码块无多余行号数字、换行缩进正确、保留语言标识；表格结构完整 |
| **TC-05** | 多格式图片兼容 | 找一篇同时包含 PNG、JPG、GIF 动图、WebP 的文章导出 | 各图片扩展名识别正确，GIF 动图在本地仍可正常播放 |
| **TC-06** | 特殊字符标题 | 找一篇标题含 `:`、`?`、`/`、`|`、`"` 或超长标题的文章导出 | 自动替换为 `_` 并合理截断，Windows 下正常保存不报文件名错误 |
| **TC-07** | 单张图片失效容错 | 在 DevTools Network 中模拟拦截某一张图片请求（Block request URL）后导出 | 不卡死、不中断，其余图片正常打包，Popup 提示“1 张图片下载失败，已保留原链接” |
| **TC-08** | 未滚动页面直接导出 PDF | 打开长图文文章，**不滚动到底部**，直接点击“导出 PDF” | 插件自动等待所有图片加载完毕后再弹出打印预览；预览中无侧边二维码、无底部推荐栏 |
| **TC-09** | PDF 分页防截断与文字可选 | 将 TC-08 另存为 PDF 后用阅读器打开检查 | 图片和代码块不被分页拦腰截断；PDF 内正文文字可正常鼠标选中、复制与搜索 |
| **TC-10** | 导出后页面现场恢复 | 关闭 TC-08 的打印对话框后，回到原微信文章页浏览 | 页面样式完全恢复正常，无残留的隐藏或排版错乱 |
| **TC-11** | 配置项持久化 | 取消勾选“添加 Front Matter”，关闭弹窗并重启浏览器后再次打开 | 选项仍保持“未勾选”状态，导出的 `.md` 顶部不再包含 YAML 头 |

### 6.5 验收标准
* 所有 **TC-01 ~ TC-11** 测试用例全部通过；
* 扩展在 Chrome `chrome://extensions/` 页面无红色错误日志；
* 连续导出 3 篇不同长度（短文、中长图文、50+ 图超长文）文章，无内存泄漏或 Service Worker 崩溃现象。
