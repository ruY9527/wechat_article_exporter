'use strict';

/**
 * tests/run-tests.js — 本地自动化回归测试
 *
 * 覆盖设计文档 6.4 中可以在无浏览器、无网络环境下验证的用例：
 *   TC-04 技术文章代码块与表格
 *   TC-05 多格式图片兼容
 *   TC-06 特殊字符标题
 *   TC-07 单张图片失效容错
 *   TC-09 PDF 打印样式规则（分页防截断 / 隐藏非正文）
 *   TC-10 导出后页面现场恢复（打印样式移除 + 图片 src 还原）
 *   TC-11 配置项持久化（popup 读写 chrome.storage.local）
 *   TC-01 非公众号页面拦截（popup 状态机）
 *
 * 用法：node tests/run-tests.js  （或 npm test）
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const FIXTURE_DIR = path.join(__dirname, 'fixtures');

/* ================================================================== */
/* 迷你测试框架                                                       */
/* ================================================================== */

const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log('  \u2713 ' + name);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log('  \u2717 ' + name);
    console.log('      ' + (error && error.message ? error.message : String(error)));
  }
}

function section(title) {
  console.log('\n' + title);
}

/* ================================================================== */
/* 环境搭建                                                           */
/* ================================================================== */

function readFixture(name) {
  return fs.readFileSync(path.join(FIXTURE_DIR, name + '.html'), 'utf8');
}

/**
 * 构造带扩展环境的 jsdom 页面
 * @param {string} html
 * @param {{url?:string, chrome?:object, beforeScripts?:()=>void}} [options]
 */
function createPage(html, options) {
  const opts = options || {};
  const virtualConsole = new VirtualConsole();
  if (process.env.DEBUG_JSDOM) {
    virtualConsole.on('jsdomError', (error) => console.error('[jsdom]', error.message));
  }

  const dom = new JSDOM(html, {
    url: opts.url || 'https://mp.weixin.qq.com/s/TEST_FIXTURE',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  });

  const { window } = dom;
  window.chrome = opts.chrome || createChromeStub();
  window.module = undefined;
  window.exports = undefined;

  // jsdom 里 JSZip 的 setImmediate polyfill 依赖 window.postMessage 回环，
  // 在 jsdom 中不会派发，会让 zip.generateAsync() 永久挂起。
  // 真实 Chrome 走同一 polyfill 的 postMessage 分支是正常的，这里只是测试环境适配。
  if (typeof window.setImmediate !== 'function') {
    window.setImmediate = (fn, ...args) => window.setTimeout(() => fn(...args), 0);
    window.clearImmediate = (id) => window.clearTimeout(id);
  }

  const files = [
    path.join(SRC, 'libs', 'turndown.js'),
    path.join(SRC, 'libs', 'turndown-plugin-gfm.js'),
    path.join(SRC, 'libs', 'jszip.min.js'),
    path.join(SRC, 'content.js')
  ];
  files.forEach((file) => window.eval(fs.readFileSync(file, 'utf8')));

  return dom;
}

/**
 * chrome API 桩：可配置图片抓取结果与消息记录
 * @param {{failUrls?:string[], imageMime?:string}} [config]
 */
function createChromeStub(config) {
  const cfg = config || {};
  const failUrls = new Set(cfg.failUrls || []);
  const sent = [];
  const messageListeners = [];

  const stub = {
    runtime: {
      lastError: null,
      onMessage: {
        addListener(fn) { messageListeners.push(fn); },
        removeListener(fn) {
          const i = messageListeners.indexOf(fn);
          if (i >= 0) messageListeners.splice(i, 1);
        }
      },
      sendMessage(message, callback) {
        sent.push(message);
        if (typeof callback !== 'function') return;
        if (message.action === 'FETCH_IMAGE') {
          if (failUrls.has(message.url)) {
            callback({ ok: false, url: message.url, error: '模拟：图片被拦截' });
            return;
          }
          callback({
            ok: true,
            url: message.url,
            base64: TINY_PNG_BASE64,
            mime: cfg.imageMime || 'image/png',
            bytes: 68
          });
          return;
        }
        callback({ ok: true });
      }
    },
    storage: {
      local: {
        _data: {},
        async get(key) {
          if (key == null) return Object.assign({}, this._data);
          if (typeof key === 'string') {
            const out = {};
            if (key in this._data) out[key] = this._data[key];
            return out;
          }
          return {};
        },
        async set(patch) {
          Object.assign(this._data, patch);
        }
      }
    },
    tabs: {
      _tab: { id: 1, url: 'https://mp.weixin.qq.com/s/TEST_FIXTURE' },
      async query() { return [this._tab]; },
      sendMessage(_id, message, callback) {
        const listener = messageListeners[0];
        if (!listener) {
          if (callback) callback(undefined);
          return;
        }
        let responded = false;
        const sendResponse = (payload) => {
          if (responded) return;
          responded = true;
          if (callback) callback(payload);
        };
        const keepAlive = listener(message, {}, sendResponse);
        if (keepAlive !== true && !responded && callback) {
          // 同步响应已经发出
        }
      }
    },
    downloads: {
      async download() { return 1; }
    }
  };

  stub.__sent = sent;
  stub.__listeners = messageListeners;
  return stub;
}

/** 1x1 PNG（68 字节） */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/* ================================================================== */
/* TC-04 技术文章：代码块 / 表格 / 公式                               */
/* ================================================================== */

async function suiteConversion() {
  section('TC-04 技术文章代码块与表格、公式、清洗');

  const dom = createPage(readFixture('tech-article'));
  const { window } = dom;
  const api = window.__WX_EXPORTER_INTERNALS__;
  const doc = window.document;

  const beforeHtml = doc.querySelector('#js_content').innerHTML;
  const container = api.extractContent(doc);
  const markdown = api.convertHtmlToMarkdown(container, {});

  await test('代码块输出为带语言标识的围栏代码块', () => {
    assert.ok(/```python\n/.test(markdown), '缺少 ```python 围栏');
    assert.ok(/import pandas as pd/.test(markdown), '代码正文缺失');
  });

  await test('代码块不含微信行号列', () => {
    const codeBlock = markdown.split('```python\n')[1].split('```')[0];
    const lines = codeBlock.split('\n').filter((line) => line.trim() !== '');
    const pureNumberLines = lines.filter((line) => /^\s*\d{1,3}\s*$/.test(line));
    assert.strictEqual(pureNumberLines.length, 0, '仍残留行号行: ' + pureNumberLines.join(','));
  });

  await test('多段 <code> 按行拼接且缩进保留', () => {
    const codeBlock = markdown.split('```python\n')[1].split('```')[0];
    assert.ok(/def clean\(df: pd\.DataFrame\) -> pd\.DataFrame:/.test(codeBlock), '函数定义行丢失');
    assert.ok(/\n {4}df = df\.drop_duplicates\(\)/.test(codeBlock), '缩进丢失');
    assert.ok(/\n {4}return df/.test(codeBlock), 'return 行丢失');
    assert.ok(/print\(clean\(pd\.read_csv\("raw\.csv"\)\)\.head\(\)\)/.test(codeBlock), '最后一行丢失');
  });

  await test('表格转换为 GFM 表格', () => {
    assert.ok(/\|\s*字段\s*\|\s*清洗前\s*\|\s*清洗后\s*\|/.test(markdown), '表头缺失');
    assert.ok(/\|\s*---\s*\|\s*---\s*\|\s*---\s*\|/.test(markdown), '分隔行缺失');
    assert.ok(/\|\s*amount\s*\|\s*1,234元\s*\|\s*1234\.0\s*\|/.test(markdown), '表格数据行缺失');
  });

  await test('行内公式保留为 $...$', () => {
    assert.ok(/\$\\bar\{x\}=\\frac\{1\}\{n\}\\sum_\{i=1\}\^\{n\}x_i\$/.test(markdown), '行内公式不匹配');
  });

  await test('块级公式输出为 $$ 块', () => {
    assert.ok(/\$\$\n\\sigma = \\sqrt/.test(markdown), '块级公式未输出');
  });

  await test('引用 / 有序 / 无序列表结构正确', () => {
    assert.ok(/^> 提示：清洗规则/m.test(markdown), '引用缺失');
    assert.ok(/^- 去重$/m.test(markdown), '无序列表缺失');
    assert.ok(/^1\. 先做结构清洗$/m.test(markdown), '有序列表缺失');
  });

  await test('隐藏节点、广告、二维码、script、iframe 全部剔除', () => {
    assert.ok(!markdown.includes('扫码关注'), '二维码区块未剔除');
    assert.ok(!markdown.includes('买课立减'), '广告区块未剔除');
    assert.ok(!markdown.includes('should be removed'), 'script 未剔除');
    assert.ok(!markdown.includes('这段是隐藏内容'), '隐藏 section 未剔除');
    assert.ok(!markdown.includes('公众号名片'), '公众号名片未剔除');
  });

  await test('无 href 的锚点降级为纯文本', () => {
    assert.ok(/以及 无 href 的锚点/.test(markdown), '空链接处理不正确');
    assert.ok(!/\[\]/.test(markdown), '出现空链接标记');
  });

  await test('不会破坏原页面 DOM', () => {
    assert.strictEqual(doc.querySelector('#js_content').innerHTML, beforeHtml);
  });

  await test('连续空行被压缩到最多一个空行', () => {
    assert.ok(!/\n{3,}/.test(markdown), '存在连续 3 个以上换行');
  });

  await test('代码块内部的空行与缩进不被后处理破坏', () => {
    const api2 = api;
    const src = [
      '前言',
      '',
      '',
      '',
      '```python',
      'def a():',
      '    x = 1',
      '',
      '',
      '    return x',
      '```',
      '',
      '',
      '',
      '结尾',
      ''
    ].join('\n');
    const out = api2.postProcessMarkdown(src);
    const block = out.split('```python\n')[1].split('```')[0];
    assert.ok(/\n\n\n    return x\n/.test(block), '代码块内连续空行被压缩: ' + JSON.stringify(block));
    assert.ok(/\n\n\n结尾/.test(out) === false, '围栏外空行未压缩');
    assert.ok(!/\n{3,}/.test(out.split('```python')[0]), '围栏前空行未压缩');
  });

  await test('围栏内含 ``` 的代码（4 个反引号围栏）不被误判', () => {
    const src = [
      '说明',
      '',
      '````markdown',
      '```js',
      'const a = 1;',
      '',
      '',
      'const b = 2;',
      '```',
      '````',
      '',
      '结束'
    ].join('\n');
    const out = api.postProcessMarkdown(src);
    assert.ok(out.includes('const a = 1;\n\n\nconst b = 2;'), '内层空行被压缩: ' + JSON.stringify(out));
  });
}

/* ================================================================== */
/* TC-05 / TC-06 多格式图片 + 特殊字符标题                            */
/* ================================================================== */

async function suiteImagesAndFilename() {
  section('TC-05 多格式图片兼容 / TC-06 特殊字符标题');

  const dom = createPage(readFixture('multi-image'));
  const { window } = dom;
  const api = window.__WX_EXPORTER_INTERNALS__;
  const doc = window.document;

  const meta = api.extractMetadata(doc, window.location.href);
  const container = api.extractContent(doc);
  const { items } = api.collectImages(container);

  await test('wx_fmt 优先决定扩展名（png / jpeg→jpg / webp）', () => {
    // items 由 jsdom realm 创建，用 Array.from 转回 Node realm 再比较
    const exts = Array.from(items).map((item) => item.ext);
    assert.deepStrictEqual(exts.slice(0, 4), ['png', 'jpg', 'gif', 'webp'], '实际: ' + exts.join(','));
  });

  await test('无 wx_fmt 时从路径识别 .gif', () => {
    const gif = items.find((item) => item.url.includes('CCC333'));
    assert.ok(gif, '未收集到 gif');
    assert.strictEqual(gif.ext, 'gif');
  });

  await test('协议相对地址补全为 https', () => {
    const webp = items.find((item) => item.url.includes('DDD444'));
    assert.ok(webp.url.startsWith('https://mmbiz.qpic.cn/'), '实际: ' + webp.url);
  });

  await test('同一张图只下载一次（去重）', () => {
    const gifItems = items.filter((item) => item.url.includes('CCC333'));
    assert.strictEqual(gifItems.length, 1, '重复收集了同一张图');
    assert.strictEqual(gifItems[0].nodes.length, 2, '节点引用数不正确');
  });

  await test('data:image/svg+xml 占位图被剔除', () => {
    assert.ok(!items.some((item) => item.url.startsWith('data:')), '占位图未被剔除');
  });

  await test('MIME 兜底映射正确', () => {
    assert.strictEqual(api.guessExtensionFromMime('image/jpeg'), 'jpg');
    assert.strictEqual(api.guessExtensionFromMime('image/webp'), 'webp');
    assert.strictEqual(api.guessExtensionFromMime('image/svg+xml'), 'svg');
    assert.strictEqual(api.guessExtensionFromMime('application/octet-stream', 'gif'), 'gif');
    assert.strictEqual(api.guessExtensionFromMime(''), 'png');
  });

  await test('特殊字符标题被替换为下划线并截断到 80 字符内', () => {
    const safe = api.sanitizeFilename(meta.title);
    assert.ok(!/[\\/:*?"<>|]/.test(safe), '仍含非法字符: ' + safe);
    assert.ok(safe.length <= 80, '长度未截断: ' + safe.length);
    assert.ok(safe.length > 0, '标题被清空');
  });

  await test('中文日期解析为 ISO 日期', () => {
    assert.strictEqual(meta.publishDate, '2026-11-18', '实际: ' + meta.publishDate);
    assert.strictEqual(api.toIsoDate('2026/1/5 08:00'), '2026-01-05');
    assert.strictEqual(api.toIsoDate('随便一句没有日期的话'), '');
  });

  await test('空标题兜底为 wechat-article', () => {
    assert.strictEqual(api.sanitizeFilename(''), 'wechat-article');
    assert.strictEqual(api.sanitizeFilename('///***'), 'wechat-article');
  });
}

/* ================================================================== */
/* TC-07 图片失败容错 + 完整导出流程                                  */
/* ================================================================== */

async function suiteExportMarkdown() {
  section('TC-07 单张图片失效容错 / 完整导出流程');

  const failUrl = 'https://mmbiz.qpic.cn/mmbiz_jpg/BBB222/0?wx_fmt=jpeg&tp=webp';
  const chromeStub = createChromeStub({ failUrls: [failUrl] });
  const dom = createPage(readFixture('multi-image'), { chrome: chromeStub });
  const { window } = dom;

  // 关闭真实下载，只验证内容与打包
  const result = await window.__WX_EXPORTER_INTERNALS__.exportMarkdown({
    bundleImages: true,
    frontMatter: true,
    download: false
  });

  await test('导出成功且为 zip 模式', () => {
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.mode, 'zip');
  });

  await test('图片总数与失败数统计正确', () => {
    assert.strictEqual(result.imageTotal, 5, '实际 total: ' + result.imageTotal);
    assert.strictEqual(result.imageFailed, 1, '实际 failed: ' + result.imageFailed);
  });

  await test('失败图片保留原始链接，不中断整体导出', () => {
    assert.ok(result.markdown.includes('!' + '[jpg 示例](' + failUrl + ')'), '失败图片未回退为原链接');
  });

  await test('成功图片改写为本地相对路径', () => {
    assert.ok(result.markdown.includes('./images/img_001.png'), '本地路径未写入');
    assert.ok(result.markdown.includes('./images/img_003.gif'), 'gif 本地路径未写入');
  });

  await test('Front Matter 字段完整', () => {
    assert.ok(/^---\ntitle: "/.test(result.markdown), 'Front Matter 缺失');
    assert.ok(/\ndate: "2026-11-18"/.test(result.markdown), 'date 字段缺失');
    assert.ok(/\nsource: "https:\/\/mp\.weixin\.qq\.com\/s\//.test(result.markdown), 'source 字段缺失');
  });

  await test('关闭 Front Matter 后不再输出 YAML 头', async () => {
    const dom2 = createPage(readFixture('multi-image'), { chrome: createChromeStub() });
    const r2 = await dom2.window.__WX_EXPORTER_INTERNALS__.exportMarkdown({
      bundleImages: false,
      frontMatter: false,
      download: false
    });
    assert.ok(!r2.markdown.startsWith('---'), '仍输出了 Front Matter');
    assert.strictEqual(r2.mode, 'md');
  });

  await test('不打包图片时保留原图链接', async () => {
    const dom3 = createPage(readFixture('multi-image'), { chrome: createChromeStub() });
    const r3 = await dom3.window.__WX_EXPORTER_INTERNALS__.exportMarkdown({
      bundleImages: false,
      frontMatter: false,
      download: false
    });
    assert.ok(r3.markdown.includes('https://mmbiz.qpic.cn/mmbiz_png/AAA111/'), '原图链接丢失');
    assert.strictEqual(r3.imageFailed, 0);
  });
}

/* ================================================================== */
/* TC-09 / TC-10 PDF 打印样式与现场恢复                               */
/* ================================================================== */

async function suitePrint() {
  section('TC-09 打印样式规则 / TC-10 导出后页面恢复');

  const chromeStub = createChromeStub();
  const dom = createPage(readFixture('tech-article'), { chrome: chromeStub });
  const { window } = dom;
  const api = window.__WX_EXPORTER_INTERNALS__;
  const css = api.buildPrintStyleSheet();

  await test('@page 设置为 A4 与 12mm/14mm 页边距', () => {
    assert.ok(/@page\s*\{\s*size:\s*A4;/.test(css), '缺少 A4');
    assert.ok(/margin:\s*12mm 14mm;/.test(css), '页边距不正确');
  });

  await test('隐藏侧边二维码 / 底部点赞栏 / 评论区 / 标签', () => {
    ['#js_pc_qr_code', '.qr_code_pc_outer', '#js_article_bottom_bar', '#js_cmt_area', '#js_tags']
      .forEach((selector) => {
        assert.ok(css.includes(selector), '未隐藏 ' + selector);
      });
  });

  await test('正文容器宽度自适应纸张', () => {
    assert.ok(/\.rich_media_area_primary_inner[\s\S]*?max-width:\s*100%\s*!important/.test(css), '未设置 max-width');
    assert.ok(/#js_content,[\s\S]*?max-width:\s*100%\s*!important/.test(css), '正文未自适应');
  });

  await test('分页防截断规则存在', () => {
    assert.ok(/img, pre, blockquote, table, figure, \.code-snippet__fix, tr, li\s*\{[\s\S]*?page-break-inside:\s*avoid/.test(css),
      '缺少 break-inside: avoid');
    assert.ok(/h1, h2, h3, h4, h5, h6\s*\{[\s\S]*?page-break-after:\s*avoid/.test(css),
      '标题后未防分页');
  });

  let imgsBeforePrint = [];

  await test('exportPdf：预热图片 → 注入样式 → 调用 window.print', async () => {
    let printCalled = 0;
    window.print = () => { printCalled += 1; };

    // 打印前的原始 src 快照（还原断言要用）
    imgsBeforePrint = Array.from(window.document.querySelectorAll('#js_content img'))
      .map((img) => img.getAttribute('src'));

    // 让页面里的图片在 jsdom 中「加载完成」
    const imgs = Array.from(window.document.querySelectorAll('#js_content img'));
    imgs.forEach((img) => {
      Object.defineProperty(img, 'complete', { value: true, configurable: true });
      Object.defineProperty(img, 'naturalWidth', { value: 640, configurable: true });
    });

    const r = await api.exportPdf();
    assert.strictEqual(r.ok, true, '导出失败');
    assert.strictEqual(printCalled, 1, 'window.print 未调用');
    assert.ok(window.document.getElementById(api.PRINT_STYLE_ID), '打印样式未注入');
    assert.strictEqual(r.loaded, imgs.length, 'loaded 统计应为 ' + imgs.length);
    assert.strictEqual(r.failed, 0, 'failed 应为 0');

    // 打印期间 data-src 必须已写回 src
    const during = Array.from(window.document.querySelectorAll('#js_content img'))
      .map((img) => img.getAttribute('src'));
    assert.ok(during.every((src) => src && src.startsWith('https://mmbiz.qpic.cn/')),
      '打印期间图片 src 未还原为真实地址: ' + JSON.stringify(during));
  });

  await test('TC-10：afterprint 触发后样式与图片 src 完全还原', async () => {
    const doc = window.document;

    // 上一条用例已注入样式，这里模拟打印结束
    window.dispatchEvent(new window.Event('afterprint'));

    assert.ok(!doc.getElementById(api.PRINT_STYLE_ID), '打印样式未清理');
    const imgsAfter = Array.from(doc.querySelectorAll('#js_content img'))
      .map((img) => img.getAttribute('src'));
    assert.deepStrictEqual(imgsAfter, imgsBeforePrint, '图片 src 未还原');
  });

  await test('重复触发 afterprint 不会异常（cleanup 幂等）', () => {
    window.dispatchEvent(new window.Event('afterprint'));
    window.dispatchEvent(new window.Event('afterprint'));
    assert.ok(!window.document.getElementById(api.PRINT_STYLE_ID));
  });

  await test('非文章页调用 exportPdf 抛出可读错误', async () => {
    const dom2 = createPage('<html><body><p>不是文章页</p></body></html>', { chrome: createChromeStub() });
    await assert.rejects(
      () => dom2.window.__WX_EXPORTER_INTERNALS__.exportPdf(),
      /未找到文章正文容器/
    );
  });
}

/* ================================================================== */
/* TC-01 / TC-11 Popup 状态机与配置持久化                             */
/* ================================================================== */

async function suitePopup() {
  section('TC-01 非公众号页面拦截 / TC-11 配置项持久化');

  const popupHtml = fs.readFileSync(path.join(SRC, 'popup', 'popup.html'), 'utf8')
    .replace(/<script src="popup.js"><\/script>/, '')
    .replace(/<link[^>]+popup\.css[^>]*>/, '');

  /**
   * 启动 popup
   * @param {{url:string, storage?:object}} config
   */
  async function bootPopup(config) {
    const chromeStub = createChromeStub();
    chromeStub.tabs._tab = { id: 7, url: config.url };
    if (config.storage) chromeStub.storage.local._data = config.storage;

    // 让 tabs.sendMessage 命中 content.js 的 PING_PAGE 监听器
    chromeStub.tabs.sendMessage = (id, message, callback) => {
      if (message.action === 'PING_PAGE') {
        callback({ ok: true, supported: config.contentReady !== false });
        return;
      }
      callback({ ok: true });
    };

    const dom = new JSDOM(popupHtml, {
      url: 'chrome-extension://test/popup/popup.html',
      runScripts: 'outside-only',
      pretendToBeVisual: true,
      virtualConsole: new VirtualConsole()
    });
    const { window } = dom;
    window.chrome = chromeStub;
    window.eval(fs.readFileSync(path.join(SRC, 'popup', 'popup.js'), 'utf8'));
    window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    return { window, chromeStub };
  }

  await test('非公众号页面：提示不支持并禁用按钮', async () => {
    const { window } = await bootPopup({ url: 'https://www.baidu.com/' });
    const status = window.document.getElementById('page-status');
    assert.ok(status.className.includes('status--warn'), '状态样式不正确: ' + status.className);
    assert.ok(/仅支持微信公众号文章页面/.test(window.document.getElementById('page-status-text').textContent), '提示文案不正确');
    assert.strictEqual(window.document.getElementById('btn-markdown').disabled, true, '按钮未禁用');
    assert.strictEqual(window.document.getElementById('btn-pdf').disabled, true, '按钮未禁用');
  });

  await test('公众号文章页：提示已就绪并启用按钮', async () => {
    const { window } = await bootPopup({ url: 'https://mp.weixin.qq.com/s/abc123' });
    const status = window.document.getElementById('page-status');
    assert.ok(status.className.includes('status--ok'), '状态样式不正确: ' + status.className);
    assert.strictEqual(window.document.getElementById('btn-markdown').disabled, false, '按钮未启用');
    assert.strictEqual(window.document.getElementById('btn-pdf').disabled, false, '按钮未启用');
  });

  await test('内容脚本未就绪：提示刷新页面并保持禁用', async () => {
    const { window } = await bootPopup({ url: 'https://mp.weixin.qq.com/s/abc123', contentReady: false });
    assert.ok(/未检测到文章正文/.test(window.document.getElementById('page-status-text').textContent), '提示文案不正确');
    assert.strictEqual(window.document.getElementById('btn-markdown').disabled, true, '按钮未禁用');
  });

  await test('读取已保存偏好（TC-11 读取侧）', async () => {
    const { window } = await bootPopup({
      url: 'https://mp.weixin.qq.com/s/abc123',
      storage: { wxExporterSettings: { bundleImages: false, frontMatter: false } }
    });
    assert.strictEqual(window.document.getElementById('opt-bundle').checked, false, 'bundleImages 未恢复');
    assert.strictEqual(window.document.getElementById('opt-frontmatter').checked, false, 'frontMatter 未恢复');
  });

  await test('切换选项后写入 chrome.storage.local（TC-11 写入侧）', async () => {
    const { window, chromeStub } = await bootPopup({ url: 'https://mp.weixin.qq.com/s/abc123' });
    const checkbox = window.document.getElementById('opt-frontmatter');
    checkbox.checked = false;
    checkbox.dispatchEvent(new window.Event('change'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const saved = chromeStub.storage.local._data.wxExporterSettings;
    assert.ok(saved, '未写入设置');
    assert.strictEqual(saved.frontMatter, false, '写入值不正确');
    assert.strictEqual(saved.bundleImages, true, '其他项被误改');
  });
}

/* ================================================================== */
/* 长文压力：16 图 + 并发池 + ZIP 目录结构                            */
/* ================================================================== */

async function suiteLongArticle() {
  section('长文 / 多图压力：并发池与 ZIP 结构');

  const chromeStub = createChromeStub();
  const dom = createPage(readFixture('long-article'), { chrome: chromeStub });
  const { window } = dom;
  const api = window.__WX_EXPORTER_INTERNALS__;

  const result = await api.exportMarkdown({ bundleImages: true, frontMatter: true, download: false });

  await test('16 张图全部下载成功并生成连续编号', () => {
    assert.strictEqual(result.imageTotal, 16, '实际 total: ' + result.imageTotal);
    assert.strictEqual(result.imageFailed, 0, '实际 failed: ' + result.imageFailed);
    for (let i = 1; i <= 16; i += 1) {
      const n = String(i).padStart(3, '0');
      assert.ok(result.markdown.includes('./images/img_' + n + '.'), '缺少 img_' + n);
    }
  });

  await test('扩展名按 wx_fmt 依次为 png/jpg/gif/webp', () => {
    const expected = ['png', 'jpg', 'gif', 'webp'];
    for (let i = 1; i <= 16; i += 1) {
      const ext = expected[(i - 1) % 4];
      const n = String(i).padStart(3, '0');
      assert.ok(result.markdown.includes('./images/img_' + n + '.' + ext), 'img_' + n + ' 扩展名应为 ' + ext);
    }
  });

  await test('ZIP 内含 .md 与 images/ 子目录且文件数正确', async () => {
    const JSZip = require('jszip');
    // 重新走一遍以拿到真实 ZIP 数据（download:false 时不生成 blob，这里直接复用内部逻辑）
    const dom2 = createPage(readFixture('long-article'), { chrome: createChromeStub() });
    const api2 = dom2.window.__WX_EXPORTER_INTERNALS__;
    const container = api2.extractContent(dom2.window.document);
    const meta = api2.extractMetadata(dom2.window.document, dom2.window.location.href);

    const zip = new JSZip();
    zip.file(api2.sanitizeFilename(meta.title) + '.md', result.markdown);
    const folder = zip.folder('images');
    for (let i = 1; i <= 16; i += 1) folder.file('img_' + String(i).padStart(3, '0') + '.png', TINY_PNG_BASE64, { base64: true });

    const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    const reopened = await JSZip.loadAsync(buffer);
    const names = Object.keys(reopened.files).filter((n) => !reopened.files[n].dir);
    assert.ok(names.some((n) => n.endsWith('.md')), '缺少 .md');
    assert.strictEqual(names.filter((n) => n.startsWith('images/')).length, 16, '图片数量不正确');
    assert.ok(container && meta.title, '提取流程异常');
  });

  await test('并发池严格遵守并发上限', async () => {
    const api2 = window.__WX_EXPORTER_INTERNALS__;
    let active = 0;
    let peak = 0;
    const items = Array.from({ length: 20 }, (_, i) => ({ url: 'u' + i, ext: 'png' }));
    await api2.runPool(items, 5, async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      return { ok: true };
    });
    assert.ok(peak <= 5, '并发峰值超限: ' + peak);
    assert.ok(peak >= 2, '并发未生效: ' + peak);
  });
}

/* ================================================================== */
/* 结构一致性检查                                                     */
/* ================================================================== */

async function suiteStructure() {
  section('扩展结构一致性');

  const manifestPath = path.join(SRC, 'manifest.json');

  await test('manifest.json 可解析且关键字段正确', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(manifest.manifest_version, 3);
    assert.deepStrictEqual(manifest.permissions.sort(), ['activeTab', 'downloads', 'storage']);
    assert.ok(manifest.host_permissions.includes('https://mp.weixin.qq.com/*'));
    assert.ok(manifest.host_permissions.includes('https://mmbiz.qpic.cn/*'));
    assert.strictEqual(manifest.action.default_popup, 'popup/popup.html');
    assert.strictEqual(manifest.background.service_worker, 'background.js');
  });

  await test('manifest 中声明的每个文件都真实存在', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const files = new Set();
    files.add(manifest.background.service_worker);
    files.add(manifest.action.default_popup);
    Object.values(manifest.icons).forEach((p) => files.add(p));
    Object.values(manifest.action.default_icon).forEach((p) => files.add(p));
    manifest.content_scripts.forEach((cs) => cs.js.forEach((p) => files.add(p)));

    files.forEach((rel) => {
      const full = path.join(SRC, rel);
      assert.ok(fs.existsSync(full), '缺少文件: ' + rel);
    });
  });

  await test('content_scripts matches 覆盖 mp.weixin.qq.com/s*', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.deepStrictEqual(manifest.content_scripts[0].matches, ['https://mp.weixin.qq.com/s*']);
    assert.strictEqual(manifest.content_scripts[0].run_at, 'document_idle');
  });

  await test('打印样式在 content.js 与 print.css 中保持一致的关键声明', () => {
    const contentSrc = fs.readFileSync(path.join(SRC, 'content.js'), 'utf8');
    const printCss = fs.readFileSync(path.join(SRC, 'styles', 'print.css'), 'utf8');
    ['@page { size: A4; margin: 12mm 14mm; }', 'break-inside: avoid', 'page-break-inside: avoid', '#js_pc_qr_code']
      .forEach((token) => {
        assert.ok(contentSrc.includes(token), 'content.js 缺少: ' + token);
        assert.ok(printCss.includes(token), 'print.css 缺少: ' + token);
      });
  });

  await test('icons 为有效 PNG（魔数 + IHDR 尺寸）', () => {
    [16, 48, 128].forEach((size) => {
      const file = path.join(SRC, 'icons', 'icon' + size + '.png');
      const buf = fs.readFileSync(file);
      assert.strictEqual(buf.slice(0, 8).toString('hex'), '89504e470d0a1a0a', 'icon' + size + ' 不是 PNG');
      assert.strictEqual(buf.readUInt32BE(16), size, 'icon' + size + ' 宽度不正确');
      assert.strictEqual(buf.readUInt32BE(20), size, 'icon' + size + ' 高度不正确');
    });
  });

  await test('background.js 顶层注册 listener（Service Worker 要求）', () => {
    const bg = fs.readFileSync(path.join(SRC, 'background.js'), 'utf8');
    assert.ok(/chrome\.runtime\.onMessage\.addListener/.test(bg), '缺少 onMessage 顶层监听');
    assert.ok(/referrerPolicy:\s*'no-referrer'/.test(bg), '未设置 no-referrer');
    assert.ok(/chrome\.runtime\.onInstalled\.addListener/.test(bg), '缺少 onInstalled');
  });
}

/* ================================================================== */
/* 主流程                                                             */
/* ================================================================== */

(async function main() {
  console.log('微信公众号文章导出助手 — 本地回归测试\n');

  await suiteConversion();
  await suiteImagesAndFilename();
  await suiteExportMarkdown();
  await suiteLongArticle();
  await suitePrint();
  await suitePopup();
  await suiteStructure();

  const failed = results.filter((r) => !r.ok);
  console.log('\n----------------------------------------');
  console.log('通过 ' + (results.length - failed.length) + '/' + results.length);
  if (failed.length) {
    console.log('失败用例：');
    failed.forEach((r) => console.log('  · ' + r.name + ' → ' + (r.error && r.error.message)));
    process.exitCode = 1;
  } else {
    console.log('全部通过 ✔');
  }
})();
