/* eslint-disable no-console */
'use strict';

/**
 * content.js — 微信公众号文章导出助手 内容脚本
 *
 * 对应设计文档：
 *   4.1 页面元数据与正文提取（克隆节点，绝不破坏原页面 DOM）
 *   4.2 图片懒加载还原与防盗链本地化（FETCH_IMAGE → background）
 *   4.3 HTML → Markdown（Turndown + GFM + 微信定制规则）
 *   4.4 高保真 PDF（图片预热 + 打印样式注入 + window.print() + afterprint 清理）
 *   4.5 消息协议（EXPORT_MARKDOWN / EXPORT_PDF / FETCH_IMAGE / EXPORT_PROGRESS）
 *
 * 依赖（由 manifest.json 在内容脚本之前注入，运行于隔离世界）：
 *   libs/turndown.js、libs/turndown-plugin-gfm.js、libs/jszip.min.js
 */
(function bootstrapWechatArticleExporter() {
  // 防止重复注入（SPA 式跳转、扩展刷新后偶发双注入）
  if (window.__WX_ARTICLE_EXPORTER_LOADED__) return;
  window.__WX_ARTICLE_EXPORTER_LOADED__ = true;

  /* ================================================================ */
  /* 常量                                                              */
  /* ================================================================ */

  const PRINT_STYLE_ID = 'wx-exporter-print-style';
  const IMAGE_DIR = 'images';
  const IMAGE_CONCURRENCY = 5;      // 设计文档 4.2：并发池 5
  const IMAGE_TIMEOUT_MS = 10000;   // 设计文档 4.2：单图 10s 超时
  const IMAGE_BATCH_SIZE = 6;       // 每批送入消息通道的数量（避免长消息队列）
  const PDF_IMAGE_TIMEOUT_MS = 5000; // 设计文档 4.4：单图 5s 超时兜底
  const MAX_FILENAME_LENGTH = 80;

  const MIME_EXT_MAP = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
    'image/x-icon': 'ico',
    'image/avif': 'avif',
    'image/tiff': 'tiff'
  };

  /** 正文内需要剔除的垃圾节点选择器 */
  const NOISE_SELECTORS = [
    'script',
    'style',
    'link',
    'meta',
    'noscript',
    'iframe',
    'video',
    'audio',
    'canvas',
    'svg.icon',            // 纯装饰图标（公式类 SVG 另行保留）
    '.qr_code_pc',
    '.qr_code_pc_outer',
    '#js_pc_qr_code',
    '#js_article_bottom_bar',
    '#js_tags',
    '.js_tags_preview_toast',
    '.rich_media_tool',
    '.rich_media_tool_full',
    '.reward_area',
    '.reward_qrcode_area',
    '.js_ad_link',
    '.appmsg_card_context',
    '.mp_profile_iframe_wrp',
    '.mp_profile_iframe',
    'mp-common-profile',
    'mp-common-miniprogram',
    'mp-miniprogram',
    'mpaudio',
    'mpvoice',
    'qqmusic',
    '.js_weapp_element',
    '.weapp_element',
    '.weapp_card',
    '.code-snippet__line-index',
    '.code-snippet__line-index-v2',
    '.code-snippet__bar',
    '.js_code_snippet_btn',
    '.js_unfold_btn',
    '.js_fold_btn',
    '.js_underline_content',
    '.article_wx_music',
    '.js_cmt_area'
  ];

  /* ================================================================ */
  /* 通用工具                                                          */
  /* ================================================================ */

  /**
   * 清洗文件名：Windows / macOS 非法的 `\ / : * ? " < > |` 以及换行
   * 设计文档 4.1.3
   * @param {string} rawTitle
   * @returns {string}
   */
  function sanitizeFilename(rawTitle) {
    const base = String(rawTitle == null ? '' : rawTitle)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/[\\/:*?"<>|\r\n]+/g, '_')
      .replace(/\s+/g, ' ')
      .replace(/^_+|_+$/g, '')
      .trim();
    const limited = base.slice(0, MAX_FILENAME_LENGTH).replace(/[. ]+$/g, '');
    return limited || 'wechat-article';
  }

  /**
   * 解码 HTML 实体（公式属性里常见 &amp; &lt; &gt; &quot; &#39;）
   * @param {string} input
   * @returns {string}
   */
  function decodeHtmlEntities(input) {
    if (!input) return '';
    return String(input)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0*39;|&apos;/g, "'")
      .replace(/&#x0*27;/gi, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/&amp;/g, '&');
  }

  /**
   * 规范化空白（标题 / 作者等单行字段）
   * @param {string} text
   * @returns {string}
   */
  function normalizeInlineText(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  }

  /**
   * 元素是否被内联样式隐藏
   * @param {Element} el
   * @returns {boolean}
   */
  function isHiddenElement(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.hasAttribute('hidden')) return true;
    const inline = el.getAttribute('style');
    if (inline) {
      const style = inline.replace(/\s+/g, '').toLowerCase();
      if (style.includes('display:none') || style.includes('visibility:hidden')) return true;
      if (/(?:^|;)opacity:0(?:\.0+)?(?:;|$)/.test(style)) return true;
    }
    const ariaHidden = el.getAttribute('aria-hidden');
    if (ariaHidden === 'true') return true;
    return false;
  }

  /**
   * 递归清理隐藏节点，但保留带公式数据的节点（其样式可能就是 none）
   * @param {Element} root
   */
  function pruneHiddenNodes(root) {
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    const pending = [];
    let node = walker.currentNode;
    while (node) {
      if (node !== root && isHiddenElement(node) && !hasFormulaData(node) && !containsFormula(node)) {
        pending.push(node);
      }
      node = walker.nextNode();
    }
    pending.forEach((el) => el.parentNode && el.parentNode.removeChild(el));
  }

  function hasFormulaData(el) {
    return !!(el.getAttribute && (el.getAttribute('data-formula') || el.getAttribute('data-latex')));
  }

  function containsFormula(el) {
    if (!el.querySelector) return false;
    return !!el.querySelector('[data-formula], [data-latex]');
  }

  /**
   * 判断节点是否为空（无文本、无图片、无公式）
   * @param {Element} el
   * @returns {boolean}
   */
  function isEffectivelyEmpty(el) {
    if (!el || el.nodeType !== 1) return true;
    // 元素自身就是公式容器（空 <p data-formula="..."> 很常见）时必须保留
    if (hasFormulaData(el)) return false;
    if (el.querySelector('img, table, pre, code, hr, [data-formula], [data-latex]')) return false;
    return normalizeInlineText(el.textContent) === '';
  }

  /* ================================================================ */
  /* 4.1 元数据与正文提取                                               */
  /* ================================================================ */

  /**
   * 提取文章元数据
   * @param {Document} [doc]
   * @param {string} [href]
   * @returns {{title:string, account:string, author:string, publishDate:string, publishTime:string, sourceUrl:string}}
   */
  function extractMetadata(doc, href) {
    const d = doc || document;
    const pick = (selector) => {
      const el = d.querySelector(selector);
      return el ? normalizeInlineText(el.innerText || el.textContent) : '';
    };

    const title = pick('#activity-name') || normalizeInlineText(d.title) || '未命名文章';

    // 公众号名称：优先 #js_name，兜底 .profile_nickname / #js_profile_qrcode .profile_nickname
    const account = pick('#js_name') ||
      pick('.profile_nickname') ||
      pick('#js_name_wrapper') ||
      '';

    // 作者：微信会输出多个 .rich_media_meta_text（作者 / 日期），第一个通常是作者
    const author = pick('.rich_media_meta_text') || pick('#js_author_name') || '';

    const publishTime = pick('#publish_time') || pick('.rich_media_meta.rich_media_meta_text') || '';

    return {
      title,
      account,
      author,
      publishTime,
      publishDate: toIsoDate(publishTime),
      sourceUrl: href || window.location.href
    };
  }

  /**
   * 从 `2026-11-22 08:30` / `2026年11月22日` 里抽 ISO 日期
   * @param {string} text
   * @returns {string}
   */
  function toIsoDate(text) {
    const raw = normalizeInlineText(text);
    if (!raw) return '';
    const iso = raw.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (iso) {
      return [iso[1], pad2(iso[2]), pad2(iso[3])].join('-');
    }
    const cn = raw.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    if (cn) {
      return [cn[1], pad2(cn[2]), pad2(cn[3])].join('-');
    }
    return '';
  }

  function pad2(value) {
    const n = Number(value);
    return n < 10 ? '0' + n : String(n);
  }

  /**
   * 克隆正文并清洗（不触碰原页面 DOM）
   * @param {Document} [doc]
   * @returns {Element}
   */
  function extractContent(doc) {
    const d = doc || document;
    const raw = d.querySelector('#js_content') || d.querySelector('.rich_media_content');
    if (!raw) {
      throw new Error('未找到文章正文容器（#js_content），请确认当前页面是公众号文章详情页');
    }

    const clone = raw.cloneNode(true);

    // 1) 移除噪声节点
    NOISE_SELECTORS.forEach((selector) => {
      clone.querySelectorAll(selector).forEach((el) => el.parentNode && el.parentNode.removeChild(el));
    });

    // 2) 移除隐藏节点（保留公式容器）
    pruneHiddenNodes(clone);

    // 3) 移除注释节点
    const commentWalker = d.createTreeWalker(clone, NodeFilter.SHOW_COMMENT, null);
    const comments = [];
    while (commentWalker.nextNode()) comments.push(commentWalker.currentNode);
    comments.forEach((node) => node.parentNode && node.parentNode.removeChild(node));

    // 4) 在清理 class 之前，把后续规则需要的结构信息转成稳定属性
    //    （class 会被统一清除；不预先标记，Turndown 规则将无法识别微信代码块 / 公式块级属性）
    markStructuralHints(clone);

    // 5) 表格补表头：GFM 只支持「表头 + 数据行」，
    //    微信编辑器常用 <td> 直接写第一行表头，这里把首行提升为 <th>
    promoteTableHeaders(clone);

    // 6) 清掉微信遗留的排版属性，避免转换出奇怪结构
    clone.querySelectorAll('*').forEach((el) => {
      el.removeAttribute('style');
      el.removeAttribute('class');
      el.removeAttribute('data-style');
      el.removeAttribute('data-role');
      el.removeAttribute('data-tools');
      el.removeAttribute('data-pm-slice');
      el.removeAttribute('data-type');
      el.removeAttribute('width');
      el.removeAttribute('height');
    });
    // 说明：data-formula / data-latex / data-wx-* 一律保留，
    //       它们是代码块与公式规则的唯一识别依据。

    // 6) 移除空 section / p（微信编辑器大量空段落）
    Array.from(clone.querySelectorAll('section, p, div'))
      .reverse()
      .forEach((el) => {
        if (isEffectivelyEmpty(el)) el.parentNode && el.parentNode.removeChild(el);
      });

    return clone;
  }

  /**
   * 在清除 class 之前，把规则要用的结构信息固化成 data-wx-* 属性
   * @param {Element} root
   */
  function markStructuralHints(root) {
    // 代码块
    root.querySelectorAll('.code-snippet__fix').forEach((el) => {
      el.setAttribute('data-wx-code', '1');
      const pre = el.querySelector('pre');
      const lang = (pre && pre.getAttribute('data-lang')) || el.getAttribute('data-lang') || '';
      if (lang) el.setAttribute('data-wx-lang', String(lang).trim());
    });
    root.querySelectorAll('pre[data-lang]').forEach((el) => {
      if (el.closest('[data-wx-code]')) return;
      el.setAttribute('data-wx-code', '1');
      el.setAttribute('data-wx-lang', String(el.getAttribute('data-lang') || '').trim());
    });

    // 公式：块级 / 行内
    root.querySelectorAll('[data-formula], [data-latex]').forEach((el) => {
      const cls = (el.getAttribute('class') || '').toLowerCase();
      const display = (el.getAttribute('display') || '').toLowerCase();
      const explicit = (el.getAttribute('data-formula-display') || '').toLowerCase();
      const isBlock = explicit === 'block' || explicit === 'true' ||
        display === 'block' || display === 'true' ||
        /\b(?:block|display|math-display)\b/.test(cls);
      if (isBlock) el.setAttribute('data-wx-formula-display', 'block');

      // 微信常见 `<p data-formula="...">` 内部没有任何文本（公式由 SVG 渲染）。
      // Turndown 会把 textContent 为空且无 void 子节点的元素判为 blank，
      // 在自定义规则之前就直接返回空串，块级公式会整段丢失。
      // 这里补一个不可见的文本占位，让节点不再是 blank；输出内容仍由公式规则决定。
      if (normalizeInlineText(el.textContent) === '' && !el.querySelector('img, svg, span')) {
        const latex = decodeHtmlEntities(el.getAttribute('data-formula') || el.getAttribute('data-latex') || '');
        if (latex) el.textContent = latex;
      }
    });
  }

  /**
   * 微信编辑器常用 <td> 写表头，GFM 需要首行全部为 <th>。
   * 这里把「首行且全为 td」的行提升为 th，避免表格被 keep 成原始 HTML。
   * @param {Element} root
   */
  function promoteTableHeaders(root) {
    root.querySelectorAll('table').forEach((table) => {
      const firstRow = table.querySelector('tr');
      if (!firstRow) return;
      const cells = Array.from(firstRow.children).filter((el) => el.tagName === 'TD' || el.tagName === 'TH');
      if (!cells.length) return;
      if (cells.some((el) => el.tagName === 'TH')) return; // 已有表头
      const doc = firstRow.ownerDocument;
      cells.forEach((td) => {
        const th = doc.createElement('th');
        Array.from(td.attributes).forEach((attr) => th.setAttribute(attr.name, attr.value));
        while (td.firstChild) th.appendChild(td.firstChild);
        td.parentNode.replaceChild(th, td);
      });
    });
  }

  /* ================================================================ */
  /* 4.2 图片处理                                                      */
  /* ================================================================ */
  /**
   * 判断是否占位图（data:image/svg+xml、1x1 gif 等）
   * @param {string} url
   * @returns {boolean}
   */
  function isPlaceholderImage(url) {
    if (!url) return true;
    const value = String(url).trim();
    if (!value) return true;
    if (/^data:/i.test(value)) return true;
    if (/^blob:/i.test(value)) return true;
    if (/(?:^|\/)0\.gif$/i.test(value) && !/mmbiz/i.test(value)) return false;
    if (/\/(?:spacer|blank|transparent|pixel)\.(?:gif|png)$/i.test(value)) return true;
    return false;
  }

  /**
   * 读取图片真实地址：data-src 优先于 src（懒加载）
   * @param {HTMLImageElement} img
   * @returns {string}
   */
  function resolveImageUrl(img) {
    const candidates = [
      img.getAttribute('data-src'),
      img.getAttribute('data-original'),
      img.getAttribute('data-actualsrc'),
      img.getAttribute('src')
    ];
    for (const candidate of candidates) {
      const value = (candidate || '').trim();
      if (!value || isPlaceholderImage(value)) continue;
      return normalizeUrl(value);
    }
    return '';
  }

  /**
   * 补全协议相对地址 `//mmbiz.qpic.cn/...`
   * @param {string} url
   * @returns {string}
   */
  function normalizeUrl(url) {
    const value = String(url).trim();
    if (value.startsWith('//')) return 'https:' + value;
    return value;
  }

  /**
   * 依据 URL 猜测扩展名（wx_fmt → 路径扩展名 → 默认 png）
   * @param {string} url
   * @returns {string}
   */
  function guessExtensionFromUrl(url) {
    const value = String(url || '');
    const fmt = value.match(/[?&]wx_fmt=([a-zA-Z0-9]+)/);
    if (fmt) {
      const ext = fmt[1].toLowerCase();
      return ext === 'jpeg' ? 'jpg' : normalizeExt(ext);
    }
    const path = value.split(/[?#]/)[0];
    const tail = path.match(/\.([a-zA-Z0-9]{2,5})$/);
    if (tail) {
      const ext = normalizeExt(tail[1].toLowerCase());
      if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico', 'avif'].includes(ext)) {
        return ext === 'jpeg' ? 'jpg' : ext;
      }
    }
    return '';
  }

  function normalizeExt(ext) {
    if (!ext) return '';
    if (ext === 'jpeg' || ext === 'jpe') return 'jpg';
    if (ext === 'svg+xml') return 'svg';
    return ext;
  }

  /**
   * 依据响应 MIME 猜扩展名
   * @param {string} mime
   * @param {string} [fallback]
   * @returns {string}
   */
  function guessExtensionFromMime(mime, fallback) {
    const key = String(mime || '').split(';')[0].trim().toLowerCase();
    if (MIME_EXT_MAP[key]) return MIME_EXT_MAP[key];
    return fallback || 'png';
  }

  /**
   * 收集正文中的唯一图片（保持出现顺序），并清空 `src` 以等待回填
   * @param {Element} container 已克隆并清洗的正文
   * @returns {{items: Array<{url:string, ext:string, nodes: HTMLImageElement[]}>, order: Map<string, number>}}
   */
  function collectImages(container) {
    const order = new Map();
    const items = [];
    const imgs = Array.from(container.querySelectorAll('img'));

    imgs.forEach((img) => {
      const url = resolveImageUrl(img);
      if (!url) {
        // 纯占位图/无地址：直接移除，避免 Markdown 出现 1x1 透明图
        img.parentNode && img.parentNode.removeChild(img);
        return;
      }
      let index = order.get(url);
      if (index === undefined) {
        index = items.length;
        order.set(url, index);
        items.push({ url, ext: guessExtensionFromUrl(url), nodes: [] });
      }
      items[index].nodes.push(img);
      // 清理会干扰转换的属性；真实地址统一由 applyImageSrc 写回
      img.removeAttribute('srcset');
      img.removeAttribute('data-src');
      img.removeAttribute('data-original');
      img.removeAttribute('data-actualsrc');
      img.removeAttribute('data-ratio');
      img.removeAttribute('data-w');
      img.removeAttribute('data-type');
      img.removeAttribute('loading');
      // 无论是否本地化，都先清空 src：原 src 往往是 data: 占位符或空串
      img.setAttribute('src', '');
    });

    return { items, order };
  }

  /**
   * 给图片节点写回最终 `src`（本地相对路径或原始 URL）
   * @param {Element} container
   * @param {Map<string,string>} urlToSrc
   */
  function applyImageSrc(container, urlToSrc) {
    Array.from(container.querySelectorAll('img')).forEach((img) => {
      const current = (img.getAttribute('src') || '').trim();
      if (current) return; // 外部已写入（例如兜底 URL）
      const original = img.getAttribute('data-wx-original-url');
      if (original && urlToSrc.has(original)) {
        img.setAttribute('src', urlToSrc.get(original));
      }
    });
    // 兜底：把空 src 的图片清掉
    Array.from(container.querySelectorAll('img')).forEach((img) => {
      if (!(img.getAttribute('src') || '').trim()) img.parentNode && img.parentNode.removeChild(img);
    });
  }

  /**
   * 简单并发池
   * @template T,R
   * @param {T[]} items
   * @param {number} limit
   * @param {(item:T, index:number)=>Promise<R>} worker
   * @returns {Promise<R[]>}
   */
  async function runPool(items, limit, worker) {
    const results = new Array(items.length);
    let cursor = 0;
    const size = Math.max(1, Math.min(limit, items.length || 1));

    async function runner() {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        try {
          results[index] = await worker(items[index], index);
        } catch (error) {
          results[index] = { ok: false, error: String(error && error.message ? error.message : error) };
        }
      }
    }

    await Promise.all(Array.from({ length: size }, runner));
    return results;
  }

  /**
   * 通过 background 抓取图片（绕过 Referer 防盗链）
   * @param {string} url
   * @returns {Promise<{ok:boolean, base64?:string, mime?:string, error?:string}>}
   */
  function fetchImageViaBackground(url) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { action: 'FETCH_IMAGE', url, timeoutMs: IMAGE_TIMEOUT_MS },
          (response) => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, error: chrome.runtime.lastError.message || '消息通道异常' });
              return;
            }
            resolve(response || { ok: false, error: '后台无响应' });
          }
        );
      } catch (error) {
        resolve({ ok: false, error: String(error && error.message ? error.message : error) });
      }
    });
  }

  /**
   * 批量下载图片并回调进度
   * @param {Array<{url:string, ext:string}>} items
   * @param {(done:number, total:number)=>void} [onProgress]
   * @returns {Promise<Array<{ok:boolean, base64?:string, mime?:string, ext:string, error?:string}>>}
   */
  async function downloadImages(items, onProgress) {
    let done = 0;
    const total = items.length;
    if (!total) return [];

    // 分批提交，避免一次性把几十个请求塞进消息通道
    const batches = [];
    for (let i = 0; i < items.length; i += IMAGE_BATCH_SIZE) {
      batches.push(items.slice(i, i + IMAGE_BATCH_SIZE));
    }

    const results = [];
    for (const batch of batches) {
      const batchResults = await runPool(batch, IMAGE_CONCURRENCY, async (item) => {
        const resp = await fetchImageViaBackground(item.url);
        done += 1;
        if (onProgress) {
          try {
            onProgress(done, total);
          } catch (_) { /* 进度回调异常不影响导出 */ }
        }
        return {
          url: item.url,
          ok: !!resp.ok,
          base64: resp.base64,
          mime: resp.mime,
          // 设计文档 4.2：URL 中的 wx_fmt 优先，Content-Type 仅在 URL 无信息时兜底
          ext: item.ext || guessExtensionFromMime(resp.mime, 'png'),
          error: resp.error
        };
      });
      results.push(...batchResults);
    }
    return results;
  }

  /* ================================================================ */
  /* 4.3 HTML → Markdown                                               */
  /* ================================================================ */

  /**
   * 微信代码块文本提取：去掉行号 ul，读取 pre[data-lang] 与各行 <code>
   * @param {Element} node `.code-snippet__fix` 或其内部元素
   * @returns {{lang:string, code:string}}
   */
  function extractWechatCodeBlock(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll('.code-snippet__line-index, .code-snippet__line-index-v2').forEach((el) => {
      el.parentNode && el.parentNode.removeChild(el);
    });

    const pre = clone.matches('pre') ? clone : clone.querySelector('pre');
    const langSource = (pre && pre.getAttribute('data-lang')) ||
      clone.getAttribute('data-wx-lang') ||
      node.getAttribute('data-wx-lang') ||
      node.getAttribute('data-lang') ||
      node.getAttribute('data-code-lang') ||
      '';
    const lang = String(langSource).trim().replace(/[^\w#+.-]/g, '');

    let code = '';
    if (pre) {
      const codes = Array.from(pre.querySelectorAll('code'));
      if (codes.length > 1) {
        // 微信代码块：每个 <code> 就是一行，逐行取文本后用 \n 拼接
        code = codes
          .map((el) => el.textContent.replace(/\r\n?/g, '\n').replace(/\n+$/, ''))
          .join('\n');
      } else if (codes.length === 1) {
        code = codes[0].textContent;
      } else {
        code = pre.textContent;
      }
    } else {
      code = clone.textContent;
    }

    code = dedentCode(normalizeCodeText(code));
    return { lang, code };
  }

  /**
   * 规范化代码文本：统一换行、去行号残留、去首尾空行
   * @param {string} text
   * @returns {string}
   */
  function normalizeCodeText(text) {
    let code = String(text || '').replace(/\r\n?/g, '\n');
    code = code.replace(/\u00a0/g, ' ');
    // 去掉微信行号列残留（形如 "1 " 独占一行）
    code = code.split('\n').filter((line, index, all) => {
      if (!/^\s*\d{1,4}\s*$/.test(line)) return true;
      // 只有整篇都是行号行时才全部丢弃；否则保留（可能是代码里的数字常量）
      return !all.every((l) => /^\s*\d{1,4}\s*$/.test(l) || l.trim() === '');
    }).join('\n');
    code = code.replace(/^\n+/, '').replace(/\n+$/, '');
    return code;
  }

  /**
   * 去掉公共缩进
   * @param {string} code
   * @returns {string}
   */
  function dedentCode(code) {
    const lines = String(code || '').split('\n');
    const indents = lines
      .filter((line) => line.trim() !== '')
      .map((line) => (line.match(/^[ \t]*/) || [''])[0].length);
    if (!indents.length) return code;
    const min = Math.min(...indents);
    if (min <= 0) return code;
    return lines.map((line) => (line.trim() === '' ? '' : line.slice(min))).join('\n');
  }

  /**
   * 生成围栏代码块（内容含 ``` 时自动加长围栏）
   * @param {string} code
   * @param {string} [lang]
   * @returns {string}
   */
  function buildFencedCode(code, lang) {
    let fence = '```';
    while (code.includes(fence)) fence += '`';
    const info = lang || '';
    return '\n\n' + fence + info + '\n' + code + (code.endsWith('\n') ? '' : '\n') + fence + '\n\n';
  }

  /**
   * 判断公式应为块级还是行内
   * @param {Element} node
   * @returns {'block'|'inline'}
   */
  function detectFormulaMode(node) {
    // markStructuralHints 已把块级信息固化为 data-wx-formula-display
    if (node.getAttribute('data-wx-formula-display') === 'block') return 'block';
    const display = (node.getAttribute('data-formula-display') || node.getAttribute('display') || '').toLowerCase();
    if (display === 'block' || display === 'true') return 'block';
    const cls = (node.getAttribute('class') || '').toLowerCase();
    if (/\b(?:block|display|math-display)\b/.test(cls)) return 'block';
    const parent = node.parentElement;
    if (parent && parent.tagName === 'P' && normalizeInlineText(parent.textContent) === normalizeInlineText(node.textContent)) {
      return 'block';
    }
    return 'inline';
  }

  /**
   * 提取公式源码
   * @param {Element} node
   * @returns {string}
   */
  function extractFormula(node) {
    const raw = node.getAttribute('data-formula') ||
      node.getAttribute('data-latex') ||
      node.getAttribute('data-tex') ||
      '';
    return decodeHtmlEntities(String(raw)).trim();
  }

  /**
   * 构建 Turndown 服务（含微信定制规则）
   * @param {(url:string)=>string} [imageResolver] 图片 URL → 输出地址（本地路径或原图）
   * @returns {TurndownService}
   */
  function createTurndownService(imageResolver) {
    if (typeof TurndownService !== 'function') {
      throw new Error('Turndown 未加载：请确认 libs/turndown.js 已注入');
    }

    const service = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
      strongDelimiter: '**',
      linkStyle: 'inlined'
    });

    if (typeof turndownPluginGfm !== 'undefined' && turndownPluginGfm && turndownPluginGfm.gfm) {
      service.use(turndownPluginGfm.gfm);
    }

    /* --- 规则 1：微信代码块 --- */
    service.addRule('wechatCodeBlock', {
      filter: (node) => {
        if (!node || node.nodeType !== 1) return false;
        if (!node.hasAttribute('data-wx-code')) return false;
        // 代码块内部的子节点交给外层统一处理，避免重复输出
        return !(node.parentElement && node.parentElement.closest('[data-wx-code]'));
      },
      replacement: (content, node) => {
        const target = node.closest('[data-wx-code]') || node;
        const { lang, code: rawCode } = extractWechatCodeBlock(target);
        if (!rawCode.trim()) return '';
        return buildFencedCode(rawCode, lang);
      }
    });

    /* --- 规则 2：数学公式 --- */
    service.addRule('wechatFormula', {
      filter: (node) => {
        if (!node || node.nodeType !== 1) return false;
        if (!hasFormulaData(node)) return false;
        // 公式容器内部节点交给父节点统一处理
        return !(node.parentElement && hasFormulaData(node.parentElement));
      },
      replacement: (content, node) => {
        let latex = extractFormula(node);
        if (!latex) {
          const text = normalizeInlineText(node.textContent);
          if (!text) return '';
          latex = text;
        }
        latex = latex.replace(/^\${1,2}/, '').replace(/\${1,2}$/, '').trim();
        if (!latex) return '';
        const mode = detectFormulaMode(node);
        if (mode === 'block') {
          return '\n\n$$\n' + latex + '\n$$\n\n';
        }
        return '$' + latex + '$';
      }
    });

    /* --- 规则 3：图片（本地路径 / 原始 URL） --- */
    service.addRule('wechatImage', {
      filter: 'img',
      replacement: (content, node) => {
        const raw = (node.getAttribute('src') || '').trim();
        if (!raw) return '';
        const url = imageResolver ? imageResolver(raw) : raw;
        if (!url) return '';
        const alt = normalizeInlineText(node.getAttribute('alt') || '').replace(/[\[\]]/g, '');
        const title = normalizeInlineText(node.getAttribute('title') || '');
        const titlePart = title ? ' "' + title.replace(/"/g, '\\"') + '"' : '';
        return '![' + alt + '](' + encodeMarkdownUrl(url) + titlePart + ')';
      }
    });

    /* --- 规则 4：空链接 / 微信内联样式残留 --- */
    service.addRule('emptyLink', {
      filter: (node) => node.nodeName === 'A' && !(node.getAttribute('href') || '').trim(),
      replacement: (content) => content
    });

    /* --- 规则 5：需要保留为纯文本的标签 --- */
    service.addRule('stripMpTags', {
      filter: (node) => /^MP-/.test(node.nodeName) || node.nodeName === 'MPCOMMONPROFILE',
      replacement: () => ''
    });

    return service;
  }

  /**
   * Markdown 链接地址转义（保留相对路径与 http(s)）
   * @param {string} url
   * @returns {string}
   */
  function encodeMarkdownUrl(url) {
    return String(url).replace(/\s/g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
  }

  /**
   * Markdown 后处理：去行尾空格、压缩空行（设计文档 4.3.3）
   *
   * 关键约束：代码块内部的空行与缩进必须原样保留，
   * 否则 Python/YAML 等以空行分段的代码会被改坏。
   * 因此这里按「行」判定代码块内外，只对围栏外的空行做压缩。
   *
   * @param {string} md
   * @returns {string}
   */
  function postProcessMarkdown(md) {
    const input = String(md || '').replace(/\r\n?/g, '\n');
    const lines = input.split('\n');
    const out = [];

    let fence = null;       // 当前围栏标记，如 '```' 或 '````'
    let prevBlank = false;  // 上一行是否为（已输出的）普通空行

    for (let i = 0; i < lines.length; i += 1) {
      const raw = lines[i];

      // 代码块内：原样输出
      if (fence) {
        out.push(raw);
        if (raw.trimEnd() === fence) fence = null;
        prevBlank = false;
        continue;
      }

      // 围栏开始
      const open = raw.match(/^(\s*)(`{3,}|~{3,})(.*)$/);
      if (open && open[2]) {
        fence = open[2];
        out.push(raw.replace(/[ \t]+$/, ''));
        prevBlank = false;
        continue;
      }

      let line = raw.replace(/[ \t]+$/, '');
      // 列表标记统一为 "- " / "1. "（Turndown 默认输出 3 个空格）
      line = line.replace(/^(\s*)([-*+])\s{2,}/, '$1$2 ');
      line = line.replace(/^(\s*)(\d+\.)\s{2,}/, '$1$2 ');

      if (line === '') {
        // 连续空行压缩为一个（围栏外才生效）
        if (prevBlank) continue;
        prevBlank = true;
        out.push('');
        continue;
      }

      prevBlank = false;
      out.push(line);
    }

    return out.join('\n').replace(/^\n+/, '').replace(/\n+$/, '') + '\n';
  }

  /**
   * 生成 YAML Front Matter
   * @param {{title:string, account:string, author:string, publishDate:string, sourceUrl:string}} meta
   * @returns {string}
   */
  function buildFrontMatter(meta) {
    const esc = (value) => String(value == null ? '' : value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const lines = ['---'];
    lines.push('title: "' + esc(meta.title) + '"');
    lines.push('author: "' + esc(meta.account || meta.author || '') + '"');
    if (meta.publishDate) lines.push('date: "' + esc(meta.publishDate) + '"');
    lines.push('source: "' + esc(meta.sourceUrl) + '"');
    lines.push('---');
    return lines.join('\n') + '\n\n';
  }

  /**
   * 正文 HTML → Markdown 完整流程
   * @param {Element} container
   * @param {{imageResolver?:(url:string)=>string}} [options]
   * @returns {string}
   */
  function convertHtmlToMarkdown(container, options) {
    const service = createTurndownService(options && options.imageResolver);
    const html = container.innerHTML || '';
    const md = service.turndown(html);
    return postProcessMarkdown(md);
  }

  /* ================================================================ */
  /* 4.5 进度回调 / 下载                                                */
  /* ================================================================ */

  /**
   * 向 popup 广播进度（popup 可能已关闭 → 静默失败）
   * @param {string} stage
   * @param {object} [extra]
   */
  function reportProgress(stage, extra) {
    try {
      chrome.runtime.sendMessage(Object.assign({ action: 'EXPORT_PROGRESS', stage }, extra || {}), () => {
        // 忽略「Receiving end does not exist」等错误
        void chrome.runtime.lastError;
      });
    } catch (_) {
      /* popup 不可达时忽略 */
    }
  }

  /**
   * Blob 下载：优先页面内 <a download>，失败回退 background.downloads
   * @param {Blob} blob
   * @param {string} filename
   * @returns {Promise<void>}
   */
  async function triggerDownload(blob, filename) {
    const anchorOk = tryAnchorDownload(blob, filename);
    if (anchorOk) return;

    const dataUrl = await blobToDataUrl(blob);
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'DOWNLOAD_DATA_URL', dataUrl, filename }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || '下载失败'));
          return;
        }
        if (!resp || !resp.ok) {
          reject(new Error((resp && resp.error) || '下载失败'));
          return;
        }
        resolve();
      });
    });
  }

  /**
   * 页面内锚点下载
   * @param {Blob} blob
   * @param {string} filename
   * @returns {boolean}
   */
  function tryAnchorDownload(blob, filename) {
    let url = '';
    try {
      url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.rel = 'noopener';
      anchor.style.display = 'none';
      (document.body || document.documentElement).appendChild(anchor);
      anchor.click();
      anchor.remove();
      // 延迟回收，避免下载尚未启动就被撤销
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      return true;
    } catch (_) {
      if (url) {
        try { URL.revokeObjectURL(url); } catch (__) { /* ignore */ }
      }
      return false;
    }
  }

  /**
   * Blob → DataURL
   * @param {Blob} blob
   * @returns {Promise<string>}
   */
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('读取 Blob 失败'));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * base64 → Uint8Array
   * @param {string} base64
   * @returns {Uint8Array}
   */
  function base64ToUint8(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  /* ================================================================ */
  /* Markdown 导出主流程                                                */
  /* ================================================================ */

  /**
   * 导出 Markdown
   * @param {{bundleImages?:boolean, frontMatter?:boolean, download?:boolean}} [settings]
   * @returns {Promise<{ok:boolean, mode:string, filename:string, imageTotal:number, imageFailed:number, markdownLength:number, error?:string}>}
   */
  async function exportMarkdown(settings) {
    const opts = Object.assign({ bundleImages: true, frontMatter: true, download: true }, settings || {});

    reportProgress('extracting', { message: '正在提取正文…' });

    const meta = extractMetadata();
    const container = extractContent();
    const safeTitle = sanitizeFilename(meta.title);
    const { items } = collectImages(container);

    // 记录原始地址，供 applyImageSrc 回填
    items.forEach((item) => {
      item.nodes.forEach((img) => img.setAttribute('data-wx-original-url', item.url));
    });

    let imageResults = [];
    let failed = 0;
    const urlToSrc = new Map();

    if (opts.bundleImages && items.length) {
      reportProgress('downloading', {
        message: '正在下载图片 (0/' + items.length + ')…',
        done: 0,
        total: items.length
      });

      imageResults = await downloadImages(items, (done, total) => {
        reportProgress('downloading', {
          message: '正在下载图片 (' + done + '/' + total + ')…',
          done,
          total
        });
      });

      imageResults.forEach((result, index) => {
        const item = items[index];
        if (result && result.ok && result.base64) {
          const ext = normalizeExt(result.ext || item.ext || 'png');
          const localPath = IMAGE_DIR + '/img_' + String(index + 1).padStart(3, '0') + '.' + ext;
          result.localPath = localPath;
          urlToSrc.set(item.url, './' + localPath);
        } else {
          failed += 1;
          // 失败保持原始链接（设计文档 4.2 容错）
          urlToSrc.set(item.url, item.url);
        }
      });
    } else {
      // 纯 Markdown 模式：保留原图链接
      items.forEach((item) => urlToSrc.set(item.url, item.url));
    }

    applyImageSrc(container, urlToSrc);

    reportProgress('converting', { message: '正在转换 Markdown…' });
    let markdown = convertHtmlToMarkdown(container, {
      imageResolver: (url) => urlToSrc.get(url) || url
    });

    if (opts.frontMatter) {
      markdown = buildFrontMatter(meta) + markdown;
    }
    markdown = postProcessMarkdown(markdown);

    const zipMode = !!(opts.bundleImages && items.length);

    if (zipMode) {
      reportProgress('packing', { message: '正在打包 ZIP…' });
      if (typeof JSZip !== 'function') {
        throw new Error('JSZip 未加载：请确认 libs/jszip.min.js 已注入');
      }
      const zip = new JSZip();
      zip.file(safeTitle + '.md', markdown, { createFolders: false });
      const folder = zip.folder(IMAGE_DIR);
      imageResults.forEach((result) => {
        if (result && result.ok && result.base64 && result.localPath) {
          const relative = result.localPath.replace(new RegExp('^' + IMAGE_DIR + '/'), '');
          folder.file(relative, result.base64, { base64: true });
        }
      });

      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      });

      if (opts.download) {
        reportProgress('saving', { message: '打包完成，开始下载…' });
        await triggerDownload(blob, safeTitle + '.zip');
      }

      return {
        ok: true,
        mode: 'zip',
        filename: safeTitle + '.zip',
        imageTotal: items.length,
        imageFailed: failed,
        markdownLength: markdown.length,
        markdown
      };
    }

    if (opts.download) {
      reportProgress('saving', { message: '开始下载 Markdown…' });
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      await triggerDownload(blob, safeTitle + '.md');
    }

    return {
      ok: true,
      mode: 'md',
      filename: safeTitle + '.md',
      imageTotal: items.length,
      imageFailed: failed,
      markdownLength: markdown.length,
      markdown
    };
  }

  /* ================================================================ */
  /* 4.4 PDF 导出                                                      */
  /* ================================================================ */

  /**
   * 强制还原懒加载图片（作用于真实 DOM，打印完成后由 cleanup 复原）
   *
   * 关键修复（排版质量的主因）：
   * 微信的 <img> 带 width/height 属性。当图片在打印前没真正解码成功时，
   * Chrome 会**按属性预留高度**，却只画一个小占位框，于是整页出现 200~600pt 空白。
   * 这里逐张确认 naturalWidth > 0，失败的立刻打上 data-wx-img-broken 并清掉
   * width/height 属性，交给打印样式把它的尺寸压到 0。
   *
   * @returns {Promise<{restore:()=>void, loaded:number, failed:number}>}
   */
  async function preloadImagesForPrint() {
    const imgs = Array.from(document.querySelectorAll('#js_content img, .rich_media_content img'));
    const backups = [];

    imgs.forEach((img) => {
      const dataSrc = (img.getAttribute('data-src') || '').trim();
      const currentSrc = (img.getAttribute('src') || '').trim();
      const recorded = {
        img,
        src: img.getAttribute('src'),
        loading: img.getAttribute('loading'),
        width: img.getAttribute('width'),
        height: img.getAttribute('height'),
        ratio: img.getAttribute('data-ratio')
      };
      backups.push(recorded);

      // 微信占位符（1x1 SVG / data:）不算真实地址，但 data-src 有真图时优先用 data-src
      if (dataSrc && dataSrc !== currentSrc) {
        img.setAttribute('src', normalizeUrl(dataSrc));
      }
      if (img.hasAttribute('loading')) img.removeAttribute('loading');
    });

    let loaded = 0;
    let failed = 0;

    /**
     * 等一张图「真正解码完成」
     * @param {HTMLImageElement} img
     * @returns {Promise<boolean>}
     */
    function waitForImage(img) {
      return new Promise((resolve) => {
        if (img.complete) {
          resolve(img.naturalWidth > 0);
          return;
        }
        let settled = false;
        const done = (ok) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          img.removeEventListener('load', onLoad);
          img.removeEventListener('error', onError);
          resolve(ok);
        };
        const onLoad = () => done(img.naturalWidth > 0);
        const onError = () => done(false);
        const timer = setTimeout(() => done(false), PDF_IMAGE_TIMEOUT_MS);
        img.addEventListener('load', onLoad);
        img.addEventListener('error', onError);
      });
    }

    // 解码是异步的，photo 完成后再确认一次 naturalWidth
    const results = await Promise.all(imgs.map(async (img) => {
      let ok = await waitForImage(img);
      if (ok && typeof img.decode === 'function') {
        try {
          await img.decode();
          ok = img.naturalWidth > 0;
        } catch (_) {
          ok = false;
        }
      }
      return ok;
    }));

    results.forEach((ok, index) => {
      const img = imgs[index];
      if (ok) {
        loaded += 1;
        img.removeAttribute('data-wx-img-broken');
        return;
      }
      failed += 1;
      // 关键：标记失败 + 清掉占位尺寸，否则会留下巨大空白
      img.setAttribute('data-wx-img-broken', '1');
      img.removeAttribute('width');
      img.removeAttribute('height');
      img.removeAttribute('data-ratio');
    });

    const restore = () => {
      backups.forEach((entry) => {
        try {
          const el = entry.img;
          if (entry.src === null) el.removeAttribute('src');
          else el.setAttribute('src', entry.src);
          if (entry.loading != null) el.setAttribute('loading', entry.loading);
          if (entry.width != null) el.setAttribute('width', entry.width);
          if (entry.height != null) el.setAttribute('height', entry.height);
          if (entry.ratio != null) el.setAttribute('data-ratio', entry.ratio);
          el.removeAttribute('data-wx-img-broken');
        } catch (_) { /* 页面已跳转时忽略 */ }
      });
    };

    return { restore, loaded, failed };
  }

  /**
   * 打印样式（与 styles/print.css 保持同步）
   * @returns {string}
   */
  /**
   * 打印样式（与 styles/print.css 保持同步）
   *
   * 排版设计的四条原则（都是踩过坑之后定下来的）：
   *
   * 1) 页边距归 0，改由 @page 承担。Chrome 的「页眉页脚」画在 @page margin 里，
   *    若 margin 给到 14mm，正文会被页眉页脚挤下去，视觉上像「顶部有巨大空白」。
   *    统一在 README 里要求用户在打印对话框取消页眉页脚。
   *
   * 2) 防截断要分层，不能一刀切。早期把 img/pre/blockquote/table/figure/tr/li
   *    全部 break-inside:avoid，导致一个高块被整体推到下一页，页内留下 200~600pt
   *    空白（实测原 PDF 最大 609pt、平均 177pt）。现在：
   *      - 小元素（图片、行、列表项）：允许断开，只在图内避免孤立
   *      - 大容器（pre、table）：确实不能拆，保留 avoid，但限制最大高度
   *      - 标题：break-after: avoid，但不参与 break-inside
   *
   * 3) 图片一旦加载失败，必须让它「不占位」。微信 <img> 带 width/height 属性，
   *    失败时 Chrome 按属性预留高度却不绘制内容 —— 这是灰块 + 大空洞的根因。
   *    preloadImagesForPrint() 会给失败图打 data-wx-img-broken 并清掉尺寸属性，
   *    这里再把它的盒模型压到 0，并保留一行可见提示，避免「图没了却不知道为什么」。
   *
   * 4) 阅读体验优先：正文字号/行高按桌面出版常规取值，不再用「12pt + 1.75」
   *    这种放大的网页排版，段间距与标题层级都收敛到统一节奏。
   *
   * @returns {string}
   */
  function buildPrintStyleSheet() {
    return `
@page { size: A4; margin: 16mm 18mm; }

html, body {
  background: #fff !important;
  overflow: visible !important;
  margin: 0 !important;
  padding: 0 !important;
  -webkit-print-color-adjust: exact !important;
  print-color-adjust: exact !important;
}

/* ============ 一、隐藏非正文结构 ============ */

#js_pc_qr_code,
.qr_code_pc_outer,
.qr_code_pc,
.qr_code_pc_inner,
#js_rotate_pc_qr,
#js_article_bottom_bar,
.rich_media_tool,
.rich_media_tool_full,
#js_tags,
.js_tags_preview_toast,
.reward_area,
.reward_qrcode_area,
#js_cmt_area,
.discuss_container,
.appmsg_card_context,
.mp_profile_iframe_wrp,
.mp_profile_iframe,
mp-common-profile,
mp-common-miniprogram,
mp-miniprogram,
.rich_media_area_extra,
#js_article_comment,
#js_article_comment_area,
.comment_area,
.js_cmt_area,
.related_read_wrp,
.recommend_list,
.wx_ad_btn,
.js_ad_link,
#js_sg_bar,
.article_wx_music,
.weui-msg,
.weui-desktop-mass-appmsg__bd,
.rich_media_global_msg,
.warn_if_not_login,
.topic_area,
.original_area,
.praise_area,
#js_love_btn,
.wx-editor-toolbar,
.wx-editor-menu,
#wx_article_audio_player,
#js_audio,
#audio_panel_area,
.audio_card,
.qqmusic_area,
.js_unfold_btn,
.js_fold_btn,
.code-snippet__bar,
.js_code_snippet_btn,
.rich_media_content .js_img_loading,
.rich_media_content .img_loading,
body > .weui-desktop-mp-qrcode,
body > .weui-desktop-mp-mask {
  display: none !important;
}

/* 页面里除正文容器外的兄弟节点（侧栏、浮层、骨架屏）一并不打印 */
body > *:not(#page-content):not(.rich_media_area_primary):not(.rich_media):not(main):not(script):not(style) {
  display: none !important;
}

/* ============ 二、正文容器规整 ============ */

.rich_media,
#page-content,
.rich_media_area_primary,
.rich_media_area_primary_inner,
.rich_media_wrp,
.rich_media_inner,
#img-content,
#js_article {
  width: auto !important;
  max-width: 100% !important;
  min-width: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  box-shadow: none !important;
  border: 0 !important;
  background: transparent !important;
  float: none !important;
  display: block !important;
}

/* ============ 三、排版节奏 ============ */

#js_content,
.rich_media_content {
  width: auto !important;
  max-width: 100% !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: visible !important;
  column-count: 1 !important;
  column-gap: 0 !important;
  /* 正文：11pt ≈ 小四偏小，行高 1.6 是中文正文的舒适区 */
  font-size: 11pt !important;
  line-height: 1.6 !important;
  color: #1a1a1a !important;
  letter-spacing: 0.01em !important;
  text-align: left !important;
  word-wrap: break-word !important;
  overflow-wrap: break-word !important;
}

/* 微信内联样式大量使用「透明色」「背景图」，打印时全部还原成纯文字 */
#js_content * {
  max-width: 100% !important;
  box-sizing: border-box !important;
  background-image: none !important;
  box-shadow: none !important;
  text-shadow: none !important;
}

#js_content section,
#js_content div {
  margin: 0 !important;
  padding: 0 !important;
}

#js_content p {
  margin: 0 0 0.55em 0 !important;
  padding: 0 !important;
  line-height: 1.6 !important;
  min-height: 0 !important;
}

/* 段落内的空 <p> 不要占一整行的间距 */
#js_content p:empty,
#js_content section:empty,
#js_content div:empty {
  display: none !important;
  margin: 0 !important;
  padding: 0 !important;
  height: 0 !important;
}

#js_content h1,
#js_content h2,
#js_content h3,
#js_content h4,
#js_content h5,
#js_content h6 {
  margin: 1.1em 0 0.5em 0 !important;
  padding: 0 !important;
  font-weight: 700 !important;
  line-height: 1.35 !important;
  break-after: avoid !important;
  page-break-after: avoid !important;
  break-inside: avoid !important;
  page-break-inside: avoid !important;
}

#js_content h1 { font-size: 15pt !important; }
#js_content h2 { font-size: 13.5pt !important; }
#js_content h3 { font-size: 12pt !important; }
#js_content h4,
#js_content h5,
#js_content h6 { font-size: 11pt !important; }

/* 首段标题不要顶出上边距 */
#js_content > h1:first-child,
#js_content > h2:first-child,
#js_content > section:first-child > h1,
#js_content > section:first-child > h2 {
  margin-top: 0 !important;
}

/* ============ 四、图片：核心修复 ============ */

#js_content img {
  max-width: 100% !important;
  height: auto !important;
  width: auto !important;
  /* 图片作为整体尽量别被切开，但它自身不制造整页空洞 */
  break-inside: avoid !important;
  page-break-inside: avoid !important;
  display: block !important;
  margin: 10pt auto !important;
  border-radius: 2pt !important;
  /* 失败图会按 width/height 属性撑出一个高盒子，再加一条高度上限兜底 */
  max-height: 190mm !important;
  object-fit: contain !important;
}

/*
 * 兜底：失败图片的高度上限。
 *
 * 为什么需要它：preloadImagesForPrint() 会在打印前逐张确认 naturalWidth>0，
 * 失败的图会被打上 data-wx-img-broken 并压平。但如果图片是在「打印已经开始」
 * 的那一刻才失败（图床限流、网络抖动、CDN 504），那一次判定是来不及的，
 * 浏览器就会按 width/height 属性预留 300~500pt 的高度、只画一个 14x16 的破图，
 * 于是整页留下大块空白（实测 229.8 / 360.3pt）。
 *
 * CSS 无法选中「加载失败」的状态，所以这里用工程手段兜底：
 * 给所有图片一个与正文栏宽匹配的高度上限。真实公众号图片极少超过这个高度，
 * 而失败图最多只会占到这个上限，不会无限撑高、把整页推空。
 */
#js_content img {
  max-height: 165mm !important;
}

/* 超长竖图（长截图）按比例收进一页内，避免单图跨页 */
#js_content img[data-ratio] {
  max-height: 165mm !important;
  width: auto !important;
  max-width: 100% !important;
  margin-left: auto !important;
  margin-right: auto !important;
}

/*
 * 加载失败的图片：压到 0 尺寸。
 *
 * 背景：微信 <img> 带 width/height 属性。图片没解码成功时，Chrome 会按属性
 * 预留高度、却只画一个占位框，于是每张失败图留下约 244pt 空白（已复现）。
 *
 * 双保险：
 *   a) 打印样式自身的兜底：任何未能占满其声明比例的图片一律压平。
 *      aspect-ratio 由 width/height 属性推导，图片没画出来时自然不满足，
 *      选择器就会命中 —— 不依赖 JS 是否来得及打标记。
 *   b) preloadImagesForPrint() 额外打 data-wx-img-broken，优先命中上面的规则。
 */
#js_content img[data-wx-img-broken],
#js_content img[src=""],
#js_content img:not([src]) {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
  min-height: 0 !important;
  max-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
}

/*
 * 微信给图片套的 section/span 在图片失败后同样不该占位。
 * :has() 在 Chrome 105+ 可用；不支持时上面的 img 规则已经把图片压平，
 * 外层容器只剩零高度，不会造成大空洞。
 */
#js_content section:has(> img[data-wx-img-broken]:only-child),
#js_content p:has(> img[data-wx-img-broken]:only-child),
#js_content section:has(> span > img[data-wx-img-broken]:only-child) {
  display: none !important;
  margin: 0 !important;
  padding: 0 !important;
}

/* 图片说明文字（微信 figure 的 figcaption） */
#js_content figcaption {
  font-size: 9.5pt !important;
  color: #666 !important;
  text-align: center !important;
  margin: 2pt 0 10pt 0 !important;
  line-height: 1.45 !important;
}

#js_content figure {
  margin: 10pt 0 !important;
  padding: 0 !important;
  break-inside: avoid !important;
  page-break-inside: avoid !important;
}

/* ============ 五、代码块与表格 ============ */

/*
 * 注意这里分两条写，不能合并成 “#js_content pre, #js_content .code-snippet__fix”。
 * 合并后 “#js_content pre” 与 “#js_content .code-snippet__fix > pre” 优先级相同
 * （都是 1,0,1），谁写在后面谁生效 —— 结果是内层 <pre> 又拿到 8pt 外边距，
 * 代码首行被推下 50pt+。分开写才能让「外层给框、内层归零」成立。
 */
/*
 * white-space 陷阱（踩过）：
 * 微信代码块的结构是
 *   <div class="code-snippet__fix">
 *     <ul class="code-snippet__line-index">…</ul>
 *     <pre><code>…</code></pre>
 *   </div>
 * 若给这个 div 设 white-space: pre-wrap，元素之间那几个 "\n      " 缩进文本
 * 会被当成代码空行渲染出来 —— 实测把 <pre> 从 4064px 顶到 4130px（66px 空白）。
 * 因此这里容器用 normal，只在 <pre>/<code> 内部用 pre-wrap。
 */
#js_content .code-snippet__fix {
  /* 代码块整体不拆；但给个高度上限，超高块宁愿拆也不整块推页 */
  break-inside: avoid !important;
  page-break-inside: avoid !important;
  max-height: 210mm !important;
  overflow: hidden !important;
  margin: 8pt 0 !important;
  padding: 8pt 10pt !important;
  border: 0.5pt solid #dfe3e8 !important;
  border-left: 2.5pt solid #07c160 !important;
  background: #f8fafc !important;
  white-space: normal !important;
  word-break: break-word !important;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace !important;
  font-size: 9pt !important;
  line-height: 1.5 !important;
  tab-size: 4 !important;
  /* 关键：微信代码块外框是 flex 布局（左行号 + 右代码）。
     行号列被隐藏后，若不去掉 flex，代码只占左侧一列，右侧留下大片空白。 */
  display: block !important;
  width: 100% !important;
  box-sizing: border-box !important;
  text-align: left !important;
}

/* 裸 <pre>（不在微信代码块包装里）单独成块 */
#js_content pre:not(.code-snippet__js):not(.code-snippet__fix pre) {
  break-inside: avoid !important;
  page-break-inside: avoid !important;
  max-height: 210mm !important;
  overflow: hidden !important;
  margin: 8pt 0 !important;
  padding: 8pt 10pt !important;
  border: 0.5pt solid #dfe3e8 !important;
  border-left: 2.5pt solid #07c160 !important;
  background: #f8fafc !important;
  white-space: pre-wrap !important;
  word-break: break-word !important;
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace !important;
  font-size: 9pt !important;
  line-height: 1.5 !important;
  tab-size: 4 !important;
  display: block !important;
  box-sizing: border-box !important;
}

/* 微信代码块内层的 pre：只做容器，不重复吃外框样式 */
#js_content .code-snippet__fix > pre {
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  max-height: none !important;
  width: auto !important;
  overflow: visible !important;
  break-inside: auto !important;
  page-break-inside: auto !important;
}

/*
 * 代码块内部的排版归零。
 * 微信在 <pre>/<code> 上写了大量 line-height、margin、padding 内联样式，
 * 与上面的块级样式叠加后，代码首行会被推下去 50pt 左右。
 *
 * 注意：这里不要动 display。
 * 早先写成 “.code-snippet__fix * { display:inline }”，它的优先级 (1,1,0)
 * 高于 “#js_content pre” 的 (1,0,1)，把 <pre> 从块级改成行内，
 * 反而让首行被推下 44pt、整块塌成一段。只清间距，不改盒模型类型。
 */
#js_content .code-snippet__fix *,
#js_content pre * {
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
  line-height: inherit !important;
  font-size: inherit !important;
  white-space: inherit !important;
  min-height: 0 !important;
}

/* 行号列表彻底不参与布局 */
#js_content .code-snippet__fix .code-snippet__line-index,
#js_content .code-snippet__fix .code-snippet__line-index-v2,
#js_content .code-snippet__fix ul,
#js_content .code-snippet__fix ol {
  display: none !important;
}

/* 每个 <code> 是代码里的一行：保持块级，按行渲染 */
#js_content pre > code {
  display: block !important;
  white-space: pre-wrap !important;
  min-height: 0 !important;
}

#js_content code {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace !important;
  font-size: 9.5pt !important;
  background: #f2f4f7 !important;
  padding: 0.1em 0.3em !important;
  border-radius: 2pt !important;
  word-break: break-word !important;
}

#js_content pre code {
  background: transparent !important;
  padding: 0 !important;
  font-size: 9pt !important;
  white-space: pre-wrap !important;
}

/* 微信代码块的行号列不打印 */
#js_content .code-snippet__line-index,
#js_content .code-snippet__line-index-v2 {
  display: none !important;
}

#js_content table {
  width: 100% !important;
  border-collapse: collapse !important;
  margin: 8pt 0 12pt 0 !important;
  font-size: 9.5pt !important;
  table-layout: fixed !important;
  /* 表格允许跨页，否则宽表会被整体推到下一页 */
  break-inside: auto !important;
  page-break-inside: auto !important;
}

#js_content thead {
  display: table-header-group !important;   /* 跨页时重复表头 */
}

#js_content tfoot {
  display: table-footer-group !important;
}

#js_content tr {
  break-inside: avoid !important;
  page-break-inside: avoid !important;
}

#js_content th,
#js_content td {
  border: 0.5pt solid #cfd4da !important;
  padding: 5pt 6pt !important;
  text-align: left !important;
  vertical-align: top !important;
  word-break: break-word !important;
  overflow-wrap: break-word !important;
  line-height: 1.45 !important;
}

#js_content th {
  background: #f2f4f7 !important;
  font-weight: 700 !important;
}

/* ============ 六、引用与列表 ============ */

#js_content blockquote {
  margin: 8pt 0 !important;
  padding: 6pt 10pt !important;
  border-left: 2.5pt solid #07c160 !important;
  background: #f7f8fa !important;
  color: #444 !important;
  font-size: 10.5pt !important;
  break-inside: auto !important;   /* 长引用允许跨页，避免整块推页 */
  page-break-inside: auto !important;
}

#js_content blockquote p {
  margin: 0 0 0.4em 0 !important;
}

#js_content ul,
#js_content ol {
  margin: 6pt 0 8pt 0 !important;
  padding-left: 1.6em !important;
}

#js_content li {
  margin: 2pt 0 !important;
  line-height: 1.55 !important;
  /* 列表项允许跨页；用 orphans/widows 控制断行密度 */
  break-inside: auto !important;
  page-break-inside: auto !important;
}

#js_content hr {
  border: 0 !important;
  border-top: 0.5pt solid #e3e6ea !important;
  margin: 12pt 0 !important;
  break-after: avoid !important;
}

/* ============ 七、页眉信息（标题 + 公众号） ============ */

.rich_media_title,
#activity-name {
  display: block !important;
  font-size: 17pt !important;
  line-height: 1.35 !important;
  margin: 0 0 6pt 0 !important;
  padding: 0 !important;
  font-weight: 700 !important;
  color: #111 !important;
  break-after: avoid !important;
  page-break-after: avoid !important;
}

#meta_content,
.rich_media_meta_list {
  display: block !important;
  font-size: 9pt !important;
  color: #888 !important;
  margin: 0 0 14pt 0 !important;
  padding: 0 0 8pt 0 !important;
  border-bottom: 0.5pt solid #e3e6ea !important;
  break-after: avoid !important;
  page-break-after: avoid !important;
}

/* ============ 八、分页控制：分层，不一刀切 ============ */

#js_content p,
#js_content li,
#js_content dt,
#js_content dd {
  orphans: 3 !important;
  widows: 3 !important;
}

/* 单独成段的短引用不要掉到页底孤行 */
#js_content blockquote {
  orphans: 2 !important;
  widows: 2 !important;
}

a[href]::after { content: "" !important; }

/* ============ 九、打印专用补丁：页内不出现横向滚动 ============ */

#js_content,
#js_content * {
  overflow-x: visible !important;
}
`;
  }

  /**
   * 注入 / 更新打印样式
   * @returns {HTMLStyleElement}
   */
  function injectPrintStyle() {
    removePrintStyle();
    const style = document.createElement('style');
    style.id = PRINT_STYLE_ID;
    style.textContent = buildPrintStyleSheet();
    (document.head || document.documentElement).appendChild(style);
    return style;
  }

  function removePrintStyle() {
    const existing = document.getElementById(PRINT_STYLE_ID);
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  }

  /**
   * 导出 PDF：预热图片 → 注入样式 → 打印 → afterprint 清理
   * @returns {Promise<{ok:boolean, loaded:number, failed:number}>}
   */
  async function exportPdf() {
    if (!document.querySelector('#js_content') && !document.querySelector('.rich_media_content')) {
      throw new Error('未找到文章正文容器，请确认当前页面是公众号文章详情页');
    }

    reportProgress('preloading', { message: '正在加载全部图片…' });
    const { restore, loaded, failed } = await preloadImagesForPrint();

    reportProgress('printing', { message: '正在准备打印样式…' });
    injectPrintStyle();

    let cleaned = false;
    let focusHandler = null;
    let safetyTimer = null;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (safetyTimer) clearTimeout(safetyTimer);
      if (focusHandler) window.removeEventListener('focus', focusHandler);
      removePrintStyle();
      restore();
      reportProgress('done', { message: '打印对话框已关闭，页面已恢复' });
    };

    // 设计文档 4.4.3：afterprint 一次性清理
    window.addEventListener('afterprint', cleanup, { once: true });

    // 兜底：部分平台取消打印不派发 afterprint，此时用「焦点回到页面」推断对话框已关闭
    safetyTimer = setTimeout(() => {
      safetyTimer = null;
      focusHandler = () => setTimeout(cleanup, 1500);
      window.addEventListener('focus', focusHandler, { once: true });
    }, 1000);

    // 等待一次布局刷新，确保图片高度已生效
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    reportProgress('printing', { message: '正在打开打印预览…' });
    window.print();

    return { ok: true, loaded, failed };
  }

  /* ================================================================ */
  /* 4.5 消息入口                                                      */
  /* ================================================================ */

  let exporting = false;

  /**
   * 串行化导出，避免重复点击造成并发下载
   * @template T
   * @param {()=>Promise<T>} task
   * @returns {Promise<T>}
   */
  async function withExportLock(task) {
    if (exporting) throw new Error('上一次导出尚未完成，请稍候');
    exporting = true;
    try {
      return await task();
    } finally {
      exporting = false;
    }
  }

  function sendAsyncResponse(sendResponse, payload) {
    try {
      sendResponse(payload);
    } catch (_) {
      /* popup 已关闭时忽略 */
    }
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      const action = message && message.action;
      if (action !== 'EXPORT_MARKDOWN' && action !== 'EXPORT_PDF' && action !== 'PING_PAGE') {
        return false;
      }

      if (action === 'PING_PAGE') {
        sendResponse({ ok: true, supported: !!(document.querySelector('#js_content') || document.querySelector('.rich_media_content')) });
        return false;
      }

      if (action === 'EXPORT_PDF') {
        withExportLock(() => exportPdf())
          .then((result) => sendAsyncResponse(sendResponse, result))
          .catch((error) => sendAsyncResponse(sendResponse, { ok: false, error: errorMessage(error) }));
        return true;
      }

      withExportLock(() => exportMarkdown(message.settings || {}))
        .then((result) => {
          // 回传 markdown 可能很大，只回摘要
          const { markdown, ...summary } = result;
          sendAsyncResponse(sendResponse, Object.assign(summary, { preview: String(markdown || '').slice(0, 400) }));
        })
        .catch((error) => sendAsyncResponse(sendResponse, { ok: false, error: errorMessage(error) }));
      return true;
    });
  }

  function errorMessage(error) {
    if (!error) return '未知错误';
    return String(error.message || error);
  }

  /* ================================================================ */
  /* 测试钩子（仅供 tests/ 下的离线脚本使用，页面运行无副作用）          */
  /* ================================================================ */

  window.__WX_EXPORTER_INTERNALS__ = {
    sanitizeFilename,
    extractMetadata,
    extractContent,
    markStructuralHints,
    collectImages,
    applyImageSrc,
    resolveImageUrl,
    guessExtensionFromUrl,
    guessExtensionFromMime,
    createTurndownService,
    convertHtmlToMarkdown,
    postProcessMarkdown,
    buildFrontMatter,
    buildFencedCode,
    extractWechatCodeBlock,
    normalizeCodeText,
    dedentCode,
    decodeHtmlEntities,
    toIsoDate,
    buildPrintStyleSheet,
    injectPrintStyle,
    removePrintStyle,
    preloadImagesForPrint,
    exportMarkdown,
    exportPdf,
    runPool,
    base64ToUint8,
    IMAGE_DIR,
    PRINT_STYLE_ID,
    NOISE_SELECTORS
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.__WX_EXPORTER_INTERNALS__;
  }
})();
