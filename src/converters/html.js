'use strict';

/* 单文件离线 HTML 转换器：无构建、无网络依赖，由 content_scripts 先行加载。 */
(function bootstrapStandaloneHtmlConverter(root, factory) {
  const api = factory();
  if (root) root.__WX_HTML_CONVERTER__ = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function createStandaloneHtmlConverter() {
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeHttpUrl(value) {
    const url = String(value || '').trim();
    return /^https?:\/\//i.test(url) ? url : '';
  }

  function buildStandaloneHtml(options) {
    const opts = options || {};
    const meta = opts.meta || {};
    const title = escapeHtml(meta.title || '微信公众号文章');
    const sourceUrl = safeHttpUrl(meta.sourceUrl);
    const coverDataUrl = /^data:image\/[a-z0-9.+-]+;base64,/i.test(opts.coverDataUrl || '')
      ? opts.coverDataUrl
      : '';
    const detail = [meta.account, meta.author, meta.publishDate || meta.publishTime]
      .filter(Boolean)
      .map(escapeHtml)
      .join(' · ');

    return '<!DOCTYPE html>\n' +
      '<html lang="zh-CN">\n<head>\n' +
      '<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: https: http:; style-src \'unsafe-inline\'; font-src data:; media-src https: http:; script-src \'none\'; connect-src \'none\'">\n' +
      '<meta name="generator" content="WeChat Article Exporter">\n' +
      (meta.description ? '<meta name="description" content="' + escapeHtml(meta.description) + '">\n' : '') +
      '<title>' + title + '</title>\n' +
      '<style>\n' + READING_CSS + '\n</style>\n</head>\n<body>\n' +
      '<main class="wx-article">\n<header class="wx-header">\n' +
      '<h1>' + title + '</h1>\n' +
      (detail ? '<p class="wx-meta">' + detail + '</p>\n' : '') +
      (sourceUrl ? '<p class="wx-source"><a href="' + escapeHtml(sourceUrl) + '">查看原文</a></p>\n' : '') +
      (meta.description ? '<p class="wx-description">' + escapeHtml(meta.description) + '</p>\n' : '') +
      (coverDataUrl ? '<img class="wx-cover" src="' + coverDataUrl + '" alt="文章封面">\n' : '') +
      '</header>\n<article class="wx-content">\n' + String(opts.contentHtml || '') + '\n</article>\n' +
      String(opts.commentsHtml || '') + '\n</main>\n</body>\n</html>\n';
  }

  const READING_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html { background: #f5f6f7; }
body { margin: 0; color: #25282c; background: #f5f6f7; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; font-size: 16px; line-height: 1.75; }
.wx-article { width: min(100%, 820px); margin: 0 auto; padding: 40px 30px 56px; background: #fff; }
.wx-header { max-width: 760px; margin: 0 auto 28px; padding-bottom: 22px; border-bottom: 1px solid #e8eaed; }
.wx-header h1 { margin: 0 0 12px; color: #17191c; font-size: 28px; line-height: 1.4; }
.wx-meta, .wx-source { margin: 5px 0; color: #858b93; font-size: 13px; }
.wx-source a { color: #687077; text-decoration: none; }
.wx-description { margin: 14px 0 0; color: #626870; font-size: 14px; }
.wx-cover { display: block; margin: 20px auto 0; }
.wx-content, .wx-comments { max-width: 760px; margin-right: auto; margin-left: auto; }
img { max-width: 100%; height: auto; }
p { margin: 0.8em 0; }
h1, h2, h3, h4, h5, h6 { margin: 1.5em 0 0.65em; line-height: 1.45; }
a { color: #087f4d; overflow-wrap: anywhere; }
pre { padding: 14px 16px; overflow-x: auto; border-left: 3px solid #07c160; border-radius: 5px; background: #f4f6f8; font-size: 14px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
code { padding: 0.12em 0.3em; border-radius: 3px; background: #f1f3f5; font-family: Consolas, Menlo, monospace; }
pre code { padding: 0; background: transparent; }
blockquote { margin: 1em 0; padding: 8px 14px; border-left: 3px solid #07c160; background: #f6f8f7; color: #50565d; }
table { width: 100%; margin: 1em 0; border-collapse: collapse; table-layout: fixed; }
th, td { padding: 8px 10px; border: 1px solid #d8dde2; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
th { background: #f1f3f5; }
mark { padding: 0 0.12em; background: #fff2a8; }
.wx-comments { margin-top: 42px; padding-top: 24px; border-top: 1px solid #e5e7ea; }
.wx-comment { margin: 14px 0; padding: 14px 16px; border-radius: 7px; background: #f7f8fa; }
.wx-comment h3 { margin: 0 0 6px; font-size: 15px; }
.wx-comment p { margin: 0; }
.wx-comment-reply { margin: 10px 0 0; padding: 6px 10px; font-size: 14px; }
@media (max-width: 600px) {
  .wx-article { padding: 24px 18px 40px; }
  .wx-header h1 { font-size: 24px; }
}
`;

  return { buildStandaloneHtml };
});
