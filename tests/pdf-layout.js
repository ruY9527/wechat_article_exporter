'use strict';

/**
 * tests/pdf-layout.js — PDF 排版度量与回归
 *
 * 这是一个「可执行的质量闸门」：用真实 Chrome 把 fixture 打成 PDF，
 * 再用 PyMuPDF 量出排版指标，和基线阈值比较。排版问题不可见时靠肉眼看，
 * 一旦要改样式，就必须有数字能证明改好了、且没有把别处改坏。
 *
 * 度量项（均为页平均 / 极值）：
 *   hugeGapPt     页内最大纵向空白（pt）。防截断规则用得过猛会让整页只放一个块，
 *                 空白暴涨到 200pt+，这是「排版很差」的最主要来源
 *   grayImgCount  按 110dpi 栅格化后，非白色像素标准差 < 1.2 的图片数。
 *                 这类图就是「灰块」：图没画出来，或画了一半
 *   pageCount     总页数
 *   textChars     可提取文字字符数（文字是否被矢量保留）
 *   textLeft/Top  正文起始坐标（校验页边距是否生效）
 *   headerFooter  是否检测到浏览器自带页眉页脚（URL / 日期 / 页码）
 *
 * 用法：
 *   node tests/pdf-layout.js                 # 打印当前 fixture 的度量
 *   node tests/pdf-layout.js --assert        # 与基线阈值比较，超限则非零退出
 *   node tests/pdf-layout.js --md            # 同时输出 Markdown 版（走扩展的 Markdown 链路）
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE_DIR = path.join(__dirname, 'fixtures');
const WORK_DIR = path.join(os.tmpdir(), 'wx-pdf-layout');

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

/**
 * 排版基线阈值。
 *
 * 校准依据（都不是拍脑袋）：
 *   · 用户反馈的坏 PDF：maxGap 609pt / avgGap 177pt / 11 张 Broken 图 / 有页眉页脚
 *   · 修复前的 broken-images fixture：maxGap 243.7pt / avgGap 149.5pt
 *   · 修复后同一 fixture：maxGap 27.2pt / avgGap 27.2pt
 *
 * 阈值取「明显好于坏样本、又不会被正常波动误伤」的位置。
 */
const BASELINE = {
  fixture: 'broken-images',
  maxPageCount: 12,
  maxHugeGapPt: 60,       // 单页最大纵向空白上限（修复后实测 27.2）
  maxAvgGapPt: 40,        // 平均最大空白上限（修复后实测 27.2）
  maxGrayImages: 0,       // 灰块/破损图片必须为 0
  minTextChars: 600,      // 文字必须能被提取（本 fixture 正文约 690 字）
  maxTextLeftPt: 60,      // 正文左边界不大于 60pt（18mm ≈ 51pt）
  maxTextTopPt: 60,
  requireNoHeaderFooter: true
};

function findChrome() {
  for (const candidate of CHROME_CANDIDATES) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * 用 headless Chrome 把 HTML 打印成 PDF
 * @param {string} chrome
 * @param {string} htmlPath
 * @param {string} pdfPath
 * @param {{headerFooter?:boolean, extraCssFrom?:string}} [options]
 */
function printToPdf(chrome, htmlPath, pdfPath, options) {
  const opts = options || {};
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-extensions',
    '--allow-file-access-from-files',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=8000',
    `--print-to-pdf=${pdfPath}`
  ];
  if (!opts.headerFooter) args.push('--no-pdf-header-footer');
  args.push('file:///' + htmlPath.replace(/\\/g, '/').replace(/ /g, '%20'));

  execFileSync(chrome, args, { stdio: ['ignore', 'ignore', 'ignore'], timeout: 120000 });
  if (!fs.existsSync(pdfPath)) throw new Error('PDF 未生成: ' + pdfPath);
  return pdfPath;
}

/**
 * 调用 Python + PyMuPDF 度量 PDF
 * @param {string} pdfPath
 * @returns {object}
 */
function measurePdf(pdfPath) {
  const script = path.join(__dirname, 'pdf_metrics.py');
  const output = execFileSync('python', [script, pdfPath], {
    encoding: 'utf8',
    timeout: 180000
  });
  return JSON.parse(output.trim().split('\n').pop());
}

async function main() {
  const args = process.argv.slice(2);
  const doAssert = args.includes('--assert');
  const fixture = (args.find((a) => a.startsWith('--fixture=')) || '').split('=')[1] ||
    BASELINE.fixture;

  const chrome = findChrome();
  if (!chrome) {
    console.error('未找到 Chrome / Edge，无法进行 PDF 排版度量');
    process.exitCode = 1;
    return;
  }

  const htmlPath = path.join(FIXTURE_DIR, fixture + '.html');
  if (!fs.existsSync(htmlPath)) {
    console.error('缺少 fixture: ' + htmlPath);
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(WORK_DIR, { recursive: true });
  const pdfPath = path.join(WORK_DIR, fixture + '.pdf');

  console.log('Chrome  :', chrome);
  console.log('Fixture :', path.relative(ROOT, htmlPath));
  printToPdf(chrome, htmlPath, pdfPath, { headerFooter: false });
  console.log('PDF     :', pdfPath, '(' + (fs.statSync(pdfPath).size / 1024).toFixed(1) + ' KB)');

  const m = measurePdf(pdfPath);
  const rows = [
    ['总页数', m.pageCount, BASELINE.maxPageCount, m.pageCount <= BASELINE.maxPageCount],
    ['最大页内空白 (pt)', m.hugeGapPt, BASELINE.maxHugeGapPt, m.hugeGapPt <= BASELINE.maxHugeGapPt],
    ['平均最大空白 (pt)', m.avgGapPt.toFixed(1), BASELINE.maxAvgGapPt, m.avgGapPt <= BASELINE.maxAvgGapPt],
    ['灰块图片数', m.grayImgCount, BASELINE.maxGrayImages, m.grayImgCount <= BASELINE.maxGrayImages],
    ['可提取字符数', m.textChars, '≥' + BASELINE.minTextChars, m.textChars >= BASELINE.minTextChars],
    ['正文左边界 (pt)', m.textLeft.toFixed(1), '≤' + BASELINE.maxTextLeftPt, m.textLeft <= BASELINE.maxTextLeftPt],
    ['正文上边界 (pt)', m.textTop.toFixed(1), '≤' + BASELINE.maxTextTopPt, m.textTop <= BASELINE.maxTextTopPt],
    ['浏览器页眉页脚', m.headerFooter ? '有' : '无', '无', !BASELINE.requireNoHeaderFooter || !m.headerFooter]
  ];

  console.log('\n指标                       实测        阈值        判定');
  console.log('--------------------------------------------------------------');
  rows.forEach(([name, actual, limit, ok]) => {
    const pad = (s, n) => String(s).padEnd(n, ' ');
    console.log(pad(name, 26) + pad(actual, 12) + pad(limit, 12) + (ok ? 'PASS' : 'FAIL'));
  });

  const failures = rows.filter((r) => !r[3]);
  if (doAssert && failures.length) {
    console.log('\n排版基线未通过：' + failures.map((f) => f[0]).join('、'));
    console.log('PDF 已保留供人工核对: ' + pdfPath);
    process.exitCode = 1;
  } else if (doAssert) {
    console.log('\n排版基线全部通过 ✔');
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('度量失败:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { findChrome, printToPdf, measurePdf, BASELINE };