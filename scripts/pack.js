'use strict';

/**
 * scripts/pack.js — 生成发布用 ZIP
 *
 * 产出两个文件：
 *   dist/wechat-article-exporter-v{version}.zip         仅扩展本体（src/），可直接分发/加载
 *   dist/wechat-article-exporter-v{version}-source.zip  完整源码（含 tests/scripts/plan/README）
 *
 * 用法：node scripts/pack.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

/** 完整源码包里要排除的目录 / 文件 */
const SOURCE_EXCLUDE_DIRS = new Set(['node_modules', 'dist', 'output', '.git', '.vscode', '.idea']);
const SOURCE_EXCLUDE_FILES = new Set(['package-lock.json']);

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
      if (SOURCE_EXCLUDE_DIRS.has(entry.name)) continue;
      out.push(...walk(abs, rel));
    } else if (entry.isFile()) {
      if (SOURCE_EXCLUDE_FILES.has(entry.name)) continue;
      out.push({ abs, rel });
    }
  }
  return out;
}

/**
 * 写入 zip
 * @param {Array<{abs:string, rel:string}>} files
 * @param {string} target
 * @param {string} rootPrefix zip 内的一级目录名（空串表示平铺）
 */
async function writeZip(JSZip, files, target, rootPrefix) {
  const zip = new JSZip();
  files.forEach((file) => {
    const name = rootPrefix ? rootPrefix + '/' + file.rel : file.rel;
    zip.file(name, fs.readFileSync(file.abs));
  });
  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });
  fs.writeFileSync(target, buffer);
  return buffer.length;
}

async function main() {
  // 复用扩展自带的 vendored JSZip，避免打一个 ZIP 还要额外的 npm 依赖
  const JSZip = require(path.join(SRC, 'libs', 'jszip.min.js'));
  const manifest = JSON.parse(fs.readFileSync(path.join(SRC, 'manifest.json'), 'utf8'));
  const version = manifest.version;

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('manifest.json 的 version 不是合法的 x.y.z：' + version);
  }

  fs.mkdirSync(DIST, { recursive: true });

  // 1) 扩展本体：src/ 平铺到 zip 根
  const srcFiles = walk(SRC);
  const extTarget = path.join(DIST, 'wechat-article-exporter-v' + version + '.zip');
  const extSize = await writeZip(JSZip, srcFiles, extTarget, '');
  console.log('扩展包  :', path.relative(ROOT, extTarget));
  console.log('  文件数:', srcFiles.length, ' 体积:', (extSize / 1024).toFixed(1) + ' KB');

  // 2) 完整源码：整个仓库（排除依赖与产物）
  const allFiles = walk(ROOT);
  const srcTarget = path.join(DIST, 'wechat-article-exporter-v' + version + '-source.zip');
  const srcSize = await writeZip(
    JSZip,
    allFiles,
    srcTarget,
    'wechat-article-exporter-' + version
  );
  console.log('源码包  :', path.relative(ROOT, srcTarget));
  console.log('  文件数:', allFiles.length, ' 体积:', (srcSize / 1024).toFixed(1) + ' KB');

  console.log('版本    :', version);
}

main().catch((error) => {
  console.error('打包失败:', error.message);
  process.exitCode = 1;
});

