'use strict';

/**
 * tests/print-sim.js — 模拟扩展的打印链路，产出可度量的 PDF
 *
 * 为什么需要它：真实扩展要在 Chrome 里手动点按钮，无法进 CI，也无法反复对比。
 * 这里做的是同一件事的最小复刻：
 *   1. 用 jsdom 加载 fixture，跑 content.js 的清洗（得到打印时的真实 DOM 形态）
 *   2. 取 content.js 的 buildPrintStyleSheet()，注入页面
 *   3. 用 headless Chrome 打印成 PDF（与扩展里 window.print() 相同的排版引擎）
 *   4. 交给 pdf_metrics.py 量指标
 *
 * 因此改 CSS 后，`node tests/print-sim.js --assert` 就能证明：空白降了、灰块没了、
 * 而且没有把别处改坏。
 *
 * 用法：
 *   node tests/print-sim.js                    # 度量当前 fixture
 *   node tests/print-sim.js --assert           # 与基线比较
 *   node tests/print-sim.js --fixture=layout-regression --keep   # 保留中间产物
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const WORK_DIR = path.join(os.tmpdir(), 'wx-print-sim');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * 加载 fixture 并跑 content.js 的清洗逻辑，返回打印用的整页 HTML
 *
 * 与扩展的 exportPdf() 对齐的关键点：
 *   · 先跑 preloadImagesForPrint()，让失败图被打上 data-wx-img-broken
 *   · 注入同一份 buildPrintStyleSheet()
 *   · 用同一份原始页面 DOM（不是 Markdown 克隆体）
 *
 * 重要限制：jsdom 不解码图片（complete=false、naturalWidth=0、无 decode），
 * 因此**所有**图片在这里都会被判为失败。这只能覆盖「图全挂」的最坏情况。
 * 要覆盖「图正常」的路径用 buildPrintHtmlKeepImages()：
 * 它跳过 jsdom 的判定，直接按浏览器语义保留可加载的图片。
 *
 * @param {string} fixtureName
 * @param {{skipImagePreload?:boolean}} [opts]
 * @returns {Promise<{html:string, api:object, printCss:string, stats:object}>}
 */
async function buildPrintHtml(fixtureName, opts) {
  const options = opts || {};
  const html = fs.readFileSync(path.join(FIXTURE_DIR, fixtureName + '.html'), 'utf8');

  const dom = new JSDOM(html, {
    url: 'https://mp.weixin.qq.com/s/SIM',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole: new VirtualConsole()
  });
  const { window } = dom;
  window.chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener() {} },
      sendMessage(_m, cb) { if (typeof cb === 'function') cb({ ok: false }); }
    }
  };
  if (typeof window.setImmediate !== 'function') {
    window.setImmediate = (fn, ...args) => window.setTimeout(() => fn(...args), 0);
    window.clearImmediate = (id) => window.clearTimeout(id);
  }
  ['libs/turndown.js', 'libs/turndown-plugin-gfm.js', 'libs/jszip.min.js', 'content.js']
    .forEach((file) => window.eval(fs.readFileSync(path.join(SRC, file), 'utf8')));

  const api = window.__WX_EXPORTER_INTERNALS__;
  const printCss = api.buildPrintStyleSheet();
  const doc = window.document;

  let stats = { loaded: 0, failed: 0 };

  if (options.skipImagePreload) {
    /*
     * 「图片部分可用」路径：本地 assets/ 能加载，远程 mmbiz 地址必然失败。
     *
     * 这里不能简单地跳过判定 —— 那样失败图会带着 width/height 属性进打印，
     * Chrome 按属性预留 346~544px 高度却只画一个 14x16 破图标，整页留白
     * （实测 229.8/360.3pt）。真实扩展里 preloadImagesForPrint() 会把这些图压平，
     * 所以这里也必须做同样的事，否则测的就不是扩展的真实行为。
     *
     * 区别只在于：本地图按「能加载」处理，远程图按「加载失败」处理。
     */
    const imgs = Array.from(doc.querySelectorAll('#js_content img, .rich_media_content img'));
    let ok = 0;
    let bad = 0;
    imgs.forEach((img) => {
      const dataSrc = img.getAttribute('data-src') || '';
      const src = dataSrc || img.getAttribute('src') || '';
      img.removeAttribute('loading');
      const isLocal = /^assets\//.test(src);
      if (isLocal) {
        img.setAttribute('src', src);
        img.removeAttribute('data-wx-img-broken');
        ok += 1;
      } else {
        // 远程地址在离线环境必然失败：与扩展一致的压平处理
        img.setAttribute('data-wx-img-broken', '1');
        img.removeAttribute('width');
        img.removeAttribute('height');
        img.removeAttribute('data-ratio');
        bad += 1;
      }
    });
    stats = { loaded: ok, failed: bad };
  } else {
    // 最坏情况：jsdom 里所有图都加载不出来，正好等价于「微信图床全部取不到」
    stats = await api.preloadImagesForPrint();
  }

  const styleEl = doc.createElement('style');
  styleEl.id = api.PRINT_STYLE_ID;
  styleEl.textContent = printCss;
  doc.head.appendChild(styleEl);

  // 关键：给图片预留足够的加载时间。
  // headless 的 --virtual-time-budget 会在图片解码完成前就触发打印，
  // 结果同一份 HTML 里有的图是完整 1080x500、有的只是 14x16 的坏图标。
  // 这里把等待时间写进 HTML 自身，确保所有 <img> 都 settled 再交给打印。
  const waitScript = `
<script>
(function () {
  var imgs = Array.prototype.slice.call(document.images);
  var pending = imgs.length;
  function done() { pending -= 1; if (pending <= 0) document.documentElement.setAttribute('data-wx-ready', '1'); }
  imgs.forEach(function (img) {
    if (img.complete) { done(); return; }
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
  });
  if (imgs.length === 0) document.documentElement.setAttribute('data-wx-ready', '1');
})();
</script>`;

  return {
    html: window.document.documentElement.outerHTML.replace('</body>', waitScript + '</body>'),
    api,
    printCss,
    stats
  };
}

/**
 * 用 headless Chrome 打印
 * @param {string} chrome
 * @param {string} htmlPath
 * @param {string} pdfPath
 * @param {{headerFooter?:boolean}} [opts]
 */
function print(chrome, htmlPath, pdfPath, opts) {
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=15000',
    `--print-to-pdf=${pdfPath}`
  ];
  if (!(opts && opts.headerFooter)) args.push('--no-pdf-header-footer');
  args.push('file:///' + htmlPath.replace(/\\/g, '/').replace(/ /g, '%20'));
  execFileSync(chrome, args, { stdio: ['ignore', 'ignore', 'ignore'], timeout: 180000 });
  return pdfPath;
}

function measure(pdfPath) {
  const out = execFileSync('python', [path.join(__dirname, 'pdf_metrics.py'), pdfPath], {
    encoding: 'utf8',
    timeout: 300000
  });
  return JSON.parse(out.trim().split('\n').pop());
}

function main() {
  mainAsync().catch((error) => {
    console.error('度量失败:', error.message);
    process.exitCode = 1;
  });
}

async function mainAsync() {
  const args = process.argv.slice(2);
  const doAssert = args.includes('--assert');
  const keep = args.includes('--keep');
  const keepImages = args.includes('--keep-images');
  const fixture = (args.find((a) => a.startsWith('--fixture=')) || '').split('=')[1] || 'broken-images';

  const chrome = findChrome();
  if (!chrome) {
    console.error('未找到 Chrome/Edge');
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(WORK_DIR, { recursive: true });
  const { html, printCss, stats } = await buildPrintHtml(fixture, { skipImagePreload: keepImages });

  const htmlPath = path.join(FIXTURE_DIR, fixture + '.print.html');
  const pdfPath = path.join(WORK_DIR, fixture + '.print.pdf');
  fs.writeFileSync(htmlPath, html, 'utf8');

  print(chrome, htmlPath, pdfPath, { headerFooter: false });
  const m = measure(pdfPath);

  const baseline = require('./pdf-layout').BASELINE;
  const rows = [
    ['总页数', m.pageCount, '≤' + baseline.maxPageCount, m.pageCount <= baseline.maxPageCount],
    ['最大页内空白 (pt)', m.hugeGapPt, '≤' + baseline.maxHugeGapPt, m.hugeGapPt <= baseline.maxHugeGapPt],
    ['平均最大空白 (pt)', m.avgGapPt, '≤' + baseline.maxAvgGapPt, m.avgGapPt <= baseline.maxAvgGapPt],
    ['灰块/破损图片数', m.grayImgCount, '≤' + baseline.maxGrayImages, m.grayImgCount <= baseline.maxGrayImages],
    ['可提取字符数', m.textChars, '≥' + baseline.minTextChars, m.textChars >= baseline.minTextChars],
    ['正文左边界 (pt)', m.textLeft, '≤' + baseline.maxTextLeftPt, m.textLeft <= baseline.maxTextLeftPt],
    ['浏览器页眉页脚', m.headerFooter ? '有' : '无', '无', !m.headerFooter]
  ];

  console.log('Chrome  :', chrome);
  console.log('Fixture :', fixture);
  console.log('图片预热:', keepImages ? ('混合路径 loaded=' + stats.loaded + ' failed=' + stats.failed) : ('全失败路径 loaded=' + stats.loaded + ' failed=' + stats.failed));
  console.log('PDF     :', pdfPath, '(' + (fs.statSync(pdfPath).size / 1024).toFixed(1) + ' KB)');
  if (m.gapPages && m.gapPages.length) {
    console.log('空白页  :', JSON.stringify(m.gapPages));
  }
  if (m.flatImages && m.flatImages.length) {
    console.log('破损图  :', JSON.stringify(m.flatImages));
  }

  console.log('\n指标                       实测        阈值        判定');
  console.log('--------------------------------------------------------------');
  const pad = (s, n) => String(s).padEnd(n, ' ');
  rows.forEach(([name, actual, limit, ok]) => {
    console.log(pad(name, 26) + pad(actual, 12) + pad(limit, 12) + (ok ? 'PASS' : 'FAIL'));
  });

  const failures = rows.filter((r) => !r[3]);
  if (doAssert) {
    if (failures.length) {
      console.log('\n排版基线未通过：' + failures.map((f) => f[0]).join('、'));
      process.exitCode = 1;
    } else {
      console.log('\n排版基线全部通过 ✔');
    }
  }

  if (!keep) {
    try { fs.unlinkSync(htmlPath); } catch (_) { /* ignore */ }
  }
}

if (require.main === module) {
  main();
}

module.exports = { findChrome, buildPrintHtml, print, measure };