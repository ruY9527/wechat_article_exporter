# 微信公众号文章导出助手（WeChat Article Exporter）

一款完全免费、开源、**无外部后端依赖**的 Chrome 扩展（Manifest V3），在公众号文章页
（`https://mp.weixin.qq.com/s/...`）一键把当前文章导出为：

| 格式 | 说明 |
| :--- | :--- |
| **Markdown（`.zip`）** | `{标题}.md` + `images/img_001.png…`，图片本地化，断网也能正常渲染，彻底解决防盗链裂图 |
| **Markdown（`.md`）** | 不下载图片，保留原图链接，适合快速摘录文字 |
| **高保真 PDF** | 懒加载图片全量预热 + 打印样式注入 + `window.print()`，文字可选可搜索，分页防截断 |

零构建：改完代码在 `chrome://extensions/` 刷新扩展即可，不需要 npm build。

---

## 1. 目录结构

```text
wechat_article_exporter/
├── plan/
│   └── design_and_test_plan.md      # 设计与测试方案（本项目的唯一规格来源）
├── src/                             # ← 加载已解压扩展时选这个目录
│   ├── manifest.json                # MV3 清单与权限
│   ├── background.js                # Service Worker：跨域拉图 / 下载兜底 / 偏好读写
│   ├── content.js                   # 内容脚本：DOM 提取、清洗、MD 转换、ZIP、PDF 打印
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
│   ├── convert.js                   # 离线转换自测，输出 Markdown 到 tests/output/
│   ├── fixtures/                    # 静态 HTML 样本
│   │   ├── tech-article.html        # 代码块 / 表格 / 公式 / 隐藏节点
│   │   ├── multi-image.html         # PNG·JPG·GIF·WebP 混排 + 特殊字符标题
│   │   └── long-article.html         # 16 图并发压力样本
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

---

## 4. 三端调试

| 环境 | 打开方式 | 观察点 |
| :--- | :--- | :--- |
| **Popup** | 点插件图标 → 弹窗空白处右键 → 检查 | UI 状态、发出的消息、`chrome.storage.local` |
| **Content Script** | 文章页 `F12` → Console → 执行上下文切到本扩展 | 日志与报错；Elements 里查 `#wx-exporter-print-style` |
| **Service Worker** | `chrome://extensions/` → 检查视图：Service Worker | Network 里看 `mmbiz.qpic.cn` 是否 `200` 而非 `403` |

---

## 5. 测试

依赖只有 `jsdom`（仅测试用，不进扩展）：

```bash
npm install          # 安装 devDependency
npm test             # run-tests.js + background-tests.js
npm run test:convert # 离线转换，产物在 tests/output/*.md
npm run icons        # 重新生成图标
npm run pack         # 打包 dist/wechat-article-exporter-v1.0.0.zip
```

### 5.1 自动化覆盖

**`tests/run-tests.js`（52 项）**

- **TC-04** 代码块（去行号列、保留语言标识、多段 `<code>` 逐行拼接、**代码块内空行与缩进不被后处理破坏**、
  4 反引号围栏不被误判）、表格（含 `<td>` 表头提升为 `<th>`）、
  行内 `$…$` / 块级 `$$…$$` 公式、引用与列表、隐藏节点/广告/二维码/`script`/`iframe` 剔除、
  空锚点降级、围栏外空行压缩、原页面 DOM 不被修改
- **TC-05** `wx_fmt` 优先决定扩展名、无 `wx_fmt` 时按路径识别 `.gif`、协议相对地址补全、
  同图去重、`data:image/svg+xml` 占位图剔除、MIME 兜底映射
- **TC-06** 特殊字符标题替换与 80 字符截断、`2026年11月18日` → `2026-11-18`、空标题兜底
- **TC-07** 指定一张图失败时整体不中断、`imageFailed = 1`、失败图回退为原链接
- **长文压力** 16 图全成功、编号连续、扩展名按 `wx_fmt` 轮转、ZIP 内 `.md` + 16 张图、并发池峰值 ≤ 5
- **TC-09** `@page A4 / 12mm 14mm`、关键节点隐藏清单、正文宽度自适应、`break-inside: avoid`
- **TC-10** 打印样式注入后按 `PRINT_STYLE_ID` 完全移除
- **TC-01 / TC-11** 非公众号页拦截并禁用按钮、文章页启用、内容脚本掉线提示、偏好读写
- **结构一致性** manifest 字段、所有声明文件存在、`content_scripts` 匹配、`content.js` 与
  `print.css` 关键声明同步、PNG 魔数与 IHDR 尺寸、`background.js` 顶层注册 listener

**`tests/background-tests.js`（15 项）**

`FETCH_IMAGE` 成功/403 不重试/500 重试一次/重试成功/空响应体/非法协议拒绝、
`referrerPolicy: 'no-referrer'` 与 `credentials: 'omit'`、`//` 协议补全、
`FETCH_IMAGES` 顺序一致、`DOWNLOAD_DATA_URL` 触发 `chrome.downloads` 且拒绝非 `data:`、
`GET/SET_SETTINGS` 默认值与持久化、未知 action 返回 `false`。

### 5.2 需人工在真实 Chrome 验证的用例

这两条依赖真实浏览器渲染与打印管线，脚本无法替代：

| 编号 | 场景 | 判定 |
| :--- | :--- | :--- |
| **TC-02** | 含 15+ 图长文，**不滚动**直接导出 MD | ZIP 解压后图片完整、无占位图 |
| **TC-03** | 解压产物拖进 Typora / Obsidian，**断网**打开 | 图片全部正常渲染 |
| **TC-08** | 长图文，**不滚动**直接导出 PDF | 预览里图片已加载、无侧边二维码与底部推荐栏 |
| **TC-09（人工部分）** | 另存 PDF 后打开 | 图/代码块不被拦腰截断；文字可选中复制 |

### 5.3 离线转换自测（改规则时用）

避免每次都刷新微信页面：

1. 浏览器「网页，仅 HTML」保存 1~3 篇典型文章到 `tests/fixtures/`；
2. `npm run test:convert`；
3. 打开 `tests/output/*.md` 比对代码块、表格、空行、公式。

---

## 6. 已知取舍

- **PDF 走 `window.print()`**，不是静默下载。静默方案需要 `chrome.debugger` +
  `Page.printToPDF`，调用期间浏览器顶部会出现「正在调试此浏览器」横幅，故留作后续进阶。
- **图片并发 `5`、单图 `10 s` 超时**（PDF 预热 `5 s`）。微信图床对高频请求有限流，调高并发容易触发 403。
- **文件名截断到 80 字符**并替换 `\ / : * ? " < > |`，兼顾 Windows `MAX_PATH` 与 macOS 限制。
- **`print.css` 是参考副本**，运行时真源是 `content.js` 的 `buildPrintStyleSheet()`；
  测试里有一条用例专门校验两边关键声明不漂移。改样式请改 `content.js` 再同步 `print.css`。
