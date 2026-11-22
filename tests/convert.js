'use strict';

/**
 * tests/convert.js — 离线转换自测（设计文档 6.3）
 *
 * 用途：不打开微信页面，直接把 tests/fixtures/*.html 跑过 content.js 的
 * 清洗 + Turndown 定制规则，输出 Markdown 到 tests/output/，用于快速回归。
 *
 * 用法：
 *   node tests/convert.js                       # 跑全部 fixture
 *   node tests/convert.js fixture=tech-article  # 只跑一个
 *   node tests/convert.js images=1              # 同时验证图片收集（不联网）
 */

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const OUT_DIR = path.join(__dirname, 'output');

/* ------------------------------------------------------------------ */
/* 环境搭建：在 jsdom 里注入 libs + content.js                        */
/* ------------------------------------------------------------------ */

/**
 * 创建带扩展运行环境的 jsdom 实例
 * @param {string} html
 * @param {string} [url]
 */
function createPage(html, url) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => {
    // 页面内 <script> 被移除等属于预期行为，仅在非预期时打印
    if (process.env.DEBUG_JSDOM) console.error('[jsdom]', error.message);
  });

  const dom = new JSDOM(html, {
    url: url || 'https://mp.weixin.qq.com/s/OFFLINE_FIXTURE',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  });

  const { window } = dom;

  // chrome API 桩：content.js 只会用到这些通道
  const chromeStub = {
    runtime: {
      lastError: null,
      onMessage: { addListener() {}, removeListener() {} },
      sendMessage(_message, callback) {
        if (typeof callback === 'function') {
          callback({ ok: false, error: 'offline: no background' });
        }
      }
    }
  };
  window.chrome = chromeStub;

  // 让 content.js 里 `typeof module` 的分支不生效
  window.module = undefined;
  window.exports = undefined;

  injectScript(window, path.join(SRC, 'libs', 'turndown.js'));
  injectScript(window, path.join(SRC, 'libs', 'turndown-plugin-gfm.js'));
  injectScript(window, path.join(SRC, 'libs', 'jszip.min.js'));
  injectScript(window, path.join(SRC, 'content.js'));

  return dom;
}

/**
 * 在 jsdom 窗口里执行脚本
 * @param {Window} window
 * @param {string} file
 */
function injectScript(window, file) {
  const code = fs.readFileSync(file, 'utf8');
  try {
    window.eval(code);
  } catch (error) {
    throw new Error('注入脚本失败 ' + path.basename(file) + ': ' + error.message);
  }
}

/* ------------------------------------------------------------------ */
/* 单篇转换                                                            */
/* ------------------------------------------------------------------ */

/**
 * 跑一篇 fixture，返回 Markdown 与统计信息
 * @param {string} fixtureName 不含 .html
 */
function convertFixture(fixtureName) {
  const fixturePath = path.join(FIXTURE_DIR, fixtureName + '.html');
  if (!fs.existsSync(fixturePath)) {
    throw new Error('找不到 fixture: ' + fixturePath);
  }

  const html = fs.readFileSync(fixturePath, 'utf8');
  const dom = createPage(html);
  const { window } = dom;
  const api = window.__WX_EXPORTER_INTERNALS__;
  if (!api) throw new Error('content.js 未暴露测试钩子');

  const doc = window.document;

  // 原页面快照，用于验证「不破坏原 DOM」
  const beforeSnapshot = doc.querySelector('#js_content').innerHTML;

  const meta = api.extractMetadata(doc, window.location.href);
  const container = api.extractContent(doc);

  // collectImages 会把 src 清空（模拟走本地化流程）
  const { items } = api.collectImages(container);
  const localMap = new Map();
  items.forEach((item, index) => {
    const ext = item.ext || 'png';
    localMap.set(item.url, './images/img_' + String(index + 1).padStart(3, '0') + '.' + ext);
  });
  items.forEach((item) => {
    item.nodes.forEach((img) => img.setAttribute('data-wx-original-url', item.url));
  });
  api.applyImageSrc(container, localMap);

  const body = api.convertHtmlToMarkdown(container, {
    imageResolver: (url) => localMap.get(url) || url
  });
  const markdown = api.buildFrontMatter(meta) + body;

  const afterSnapshot = doc.querySelector('#js_content').innerHTML;

  return {
    name: fixtureName,
    meta,
    markdown,
    images: items.map((item, index) => ({
      url: item.url,
      ext: item.ext,
      local: localMap.get(item.url),
      occurrences: item.nodes.length,
      order: index
    })),
    domUntouched: beforeSnapshot === afterSnapshot,
    printCss: api.buildPrintStyleSheet(),
    api
  };
}

/* ------------------------------------------------------------------ */
/* 入口                                                                */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const args = {};
  argv.slice(2).forEach((raw) => {
    const [key, value] = raw.split('=');
    args[key] = value === undefined ? true : value;
  });
  return args;
}

function listFixtures() {
  if (!fs.existsSync(FIXTURE_DIR)) return [];
  return fs
    .readdirSync(FIXTURE_DIR)
    .filter((file) => file.endsWith('.html'))
    .map((file) => file.replace(/\.html$/, ''));
}

function main() {
  const args = parseArgs(process.argv);
  const names = args.fixture ? [String(args.fixture)] : listFixtures();

  if (!names.length) {
    console.error('tests/fixtures/ 下没有 .html 样本，请先保存 1~2 篇公众号文章网页');
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  names.forEach((name) => {
    const result = convertFixture(name);
    const outFile = path.join(OUT_DIR, name + '.md');
    fs.writeFileSync(outFile, result.markdown, 'utf8');

    console.log('\n=== ' + name + ' ===');
    console.log('标题      :', result.meta.title);
    console.log('公众号    :', result.meta.account);
    console.log('作者      :', result.meta.author);
    console.log('发布日期  :', result.meta.publishTime, '→', result.meta.publishDate);
    console.log('图片数量  :', result.images.length);
    result.images.forEach((img) => {
      console.log('   · ' + img.local + '  ← ' + img.url + '  (出现 ' + img.occurrences + ' 次)');
    });
    console.log('原DOM未变 :', result.domUntouched ? 'yes' : 'NO — 正文被修改了');
    console.log('输出      :', path.relative(process.cwd(), outFile));
  });

  console.log('\n完成：' + names.length + ' 篇');
}

if (require.main === module) {
  main();
}

module.exports = { createPage, convertFixture, listFixtures };
