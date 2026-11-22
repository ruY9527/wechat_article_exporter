'use strict';

/**
 * scripts/make-icons.js — 生成扩展图标（16/48/128 PNG）
 *
 * 纯 Node 实现，不依赖 canvas / sharp：
 *   绿色圆角方形底 + 白色文档轮廓 + 底部导出箭头。
 * 用法：node scripts/make-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.resolve(__dirname, '..', 'src', 'icons');
const SIZES = [16, 48, 128];

/* ---------------- PNG 编码 ---------------- */

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * RGBA 像素数组 -> PNG Buffer
 * @param {Uint8Array} rgba 长度 = w*h*4
 * @param {number} w
 * @param {number} h
 */
function encodePng(rgba, w, h) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y += 1) {
    raw[y * (stride + 1)] = 0; // filter type none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1);
  }

  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- 绘制 ---------------- */

const GREEN = [7, 193, 96];
const GREEN_DARK = [6, 173, 86];
const WHITE = [255, 255, 255];

/**
 * 带超采样的绘制：scale 倍采样后取平均，得到平滑边缘
 * @param {number} size
 * @param {number} scale
 */
function drawIcon(size, scale) {
  const S = size * scale;
  const buf = new Float32Array(S * S * 4);

  const setPx = (x, y, color, alpha) => {
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    const a = alpha == null ? 1 : alpha;
    buf[i] = buf[i] * (1 - a) + color[0] * a;
    buf[i + 1] = buf[i + 1] * (1 - a) + color[1] * a;
    buf[i + 2] = buf[i + 2] * (1 - a) + color[2] * a;
    buf[i + 3] = buf[i + 3] * (1 - a) + 255 * a;
  };

  // 圆角方形背景（垂直渐变）
  const radius = S * 0.22;
  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      if (!insideRoundedRect(x + 0.5, y + 0.5, 0, 0, S, S, radius)) continue;
      const t = y / S;
      const color = [
        GREEN[0] * (1 - t) + GREEN_DARK[0] * t,
        GREEN[1] * (1 - t) + GREEN_DARK[1] * t,
        GREEN[2] * (1 - t) + GREEN_DARK[2] * t
      ];
      setPx(x, y, color, 1);
    }
  }

  // 白色文档（圆角矩形）轮廓：上方 2/3
  const docX = S * 0.28;
  const docW = S * 0.44;
  const docY = S * 0.20;
  const docH = S * 0.40;
  const docR = S * 0.06;
  for (let y = Math.floor(docY); y < Math.ceil(docY + docH); y += 1) {
    for (let x = Math.floor(docX); x < Math.ceil(docX + docW); x += 1) {
      if (!insideRoundedRect(x + 0.5, y + 0.5, docX, docY, docW, docH, docR)) continue;
      setPx(x, y, WHITE, 1);
    }
  }

  // 文档内文字横线（绿色，制造「文章」意象）
  const lineColor = GREEN;
  const lines = [
    { y: docY + docH * 0.28, x0: docX + docW * 0.16, x1: docX + docW * 0.84 },
    { y: docY + docH * 0.48, x0: docX + docW * 0.16, x1: docX + docW * 0.72 },
    { y: docY + docH * 0.68, x0: docX + docW * 0.16, x1: docX + docW * 0.60 }
  ];
  const lineH = Math.max(1, S * 0.045);
  lines.forEach((line) => {
    for (let y = Math.floor(line.y - lineH / 2); y < Math.ceil(line.y + lineH / 2); y += 1) {
      for (let x = Math.floor(line.x0); x < Math.ceil(line.x1); x += 1) {
        setPx(x, y, lineColor, 0.92);
      }
    }
  });

  // 底部导出箭头（向下 + 底座）
  const cx = S * 0.5;
  const arrowTop = S * 0.64;
  const arrowBottom = S * 0.80;
  const shaftW = S * 0.10;
  for (let y = Math.floor(arrowTop); y < Math.ceil(arrowBottom); y += 1) {
    const t = (y - arrowTop) / (arrowBottom - arrowTop);
    const halfW = shaftW * 0.5 + S * 0.16 * Math.pow(t, 2.2);
    for (let x = Math.floor(cx - halfW); x < Math.ceil(cx + halfW); x += 1) {
      setPx(x, y, WHITE, 1);
    }
  }
  // 底座横条
  const barY = S * 0.86;
  const barH = Math.max(1, S * 0.07);
  for (let y = Math.floor(barY); y < Math.ceil(barY + barH); y += 1) {
    for (let x = Math.floor(S * 0.26); x < Math.ceil(S * 0.74); x += 1) {
      setPx(x, y, WHITE, 1);
    }
  }

  // 降采样
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const i = ((y * scale + dy) * S + (x * scale + dx)) * 4;
          r += buf[i];
          g += buf[i + 1];
          b += buf[i + 2];
          a += buf[i + 3];
        }
      }
      const n = scale * scale;
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
      out[o + 3] = Math.round(a / n);
    }
  }

  return out;
}

function insideRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const rx = Math.min(r, w / 2);
  const ry = Math.min(r, h / 2);
  const corners = [
    { cx: x + rx, cy: y + ry, inX: px < x + rx, inY: py < y + ry },
    { cx: x + w - rx, cy: y + ry, inX: px > x + w - rx, inY: py < y + ry },
    { cx: x + rx, cy: y + h - ry, inX: px < x + rx, inY: py > y + h - ry },
    { cx: x + w - rx, cy: y + h - ry, inX: px > x + w - rx, inY: py > y + h - ry }
  ];
  for (const c of corners) {
    if (c.inX && c.inY) {
      const dx = px - c.cx;
      const dy = py - c.cy;
      if (dx * dx + dy * dy > rx * ry) return false;
    }
  }
  return true;
}

/* ---------------- 主流程 ---------------- */

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  SIZES.forEach((size) => {
    const scale = size <= 16 ? 8 : (size <= 48 ? 6 : 4);
    const rgba = drawIcon(size, scale);
    const png = encodePng(rgba, size, size);
    const target = path.join(OUT_DIR, 'icon' + size + '.png');
    fs.writeFileSync(target, png);
    console.log('wrote', path.relative(process.cwd(), target), png.length + ' bytes');
  });
}

if (require.main === module) {
  main();
}

module.exports = { encodePng, drawIcon };
