'use strict';

/**
 * scripts/pack.js — 生成可分发 ZIP（仅打包 src/）
 *
 * 用法：node scripts/pack.js
 * 产物：dist/wechat-article-exporter-v{version}.zip
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

/**
 * 递归收集文件
 * @param {string} dir
 * @param {string} [prefix]
 * @returns {Array<{abs:string, rel:string}>}
 */
function walk(dir, prefix) {
  const base = prefix || '';
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = base ? base + '/' + entry.name : entry.name;
    if (entry.isDirectory()) {
      out.push(...walk(abs, rel));
    } else if (entry.isFile()) {
      out.push({ abs, rel });
    }
  }
  return out;
}

async function main() {
  const JSZip = require('jszip');
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));

  const files = walk(SRC);
  const zip = new JSZip();
  files.forEach((file) => {
    zip.file(file.rel, fs.readFileSync(file.abs));
  });

  fs.mkdirSync(DIST, { recursive: true });
  const target = path.join(DIST, 'wechat-article-exporter-v' + manifest.version + '.zip');
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });
  fs.writeFileSync(target, buffer);

  console.log('打包完成:', path.relative(ROOT, target));
  console.log('文件数  :', files.length);
  console.log('体积    :', (buffer.length / 1024).toFixed(1) + ' KB');
}

main().catch((error) => {
  console.error('打包失败:', error.message);
  process.exitCode = 1;
});
