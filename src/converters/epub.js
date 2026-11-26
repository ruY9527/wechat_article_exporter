'use strict';

/* EPUB 3 转换器：严格 XHTML 序列化 + EPUB 3 nav + EPUB 2 NCX。 */
(function bootstrapEpubConverter(root, factory) {
  const api = factory(root);
  if (root) root.__WX_EPUB_CONVERTER__ = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null, function createEpubConverter(root) {
  const ILLEGAL_XML_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;
  const VALID_XML_ATTRIBUTE = /^[A-Za-z_][A-Za-z0-9_.:-]*$/;

  function cleanXmlText(value) {
    return String(value == null ? '' : value).replace(ILLEGAL_XML_CHARS, '');
  }

  function escapeXml(value) {
    return cleanXmlText(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function cleanElementForXml(element) {
    Array.from(element.attributes || []).forEach((attribute) => {
      if (!VALID_XML_ATTRIBUTE.test(attribute.name)) element.removeAttribute(attribute.name);
      else element.setAttribute(attribute.name, cleanXmlText(attribute.value));
    });
    Array.from(element.childNodes).forEach((node) => {
      if (node.nodeType === 3 || node.nodeType === 4) node.nodeValue = cleanXmlText(node.nodeValue);
      else if (node.nodeType === 1) cleanElementForXml(node);
    });
  }

  function extractHeadingsForToc(element) {
    if (!element || !element.querySelectorAll) return [];
    const reserved = new Set(Array.from(element.querySelectorAll('[id]')).map((node) => node.id).filter(Boolean));
    const used = new Set();
    let sequence = 0;
    return Array.from(element.querySelectorAll('h1, h2, h3')).map((heading) => {
      let id = String(heading.id || '').trim();
      if (!id || used.has(id)) {
        do {
          sequence += 1;
          id = 'heading-' + sequence;
        } while (reserved.has(id) || used.has(id));
        heading.setAttribute('id', id);
        reserved.add(id);
      }
      used.add(id);
      return {
        id,
        level: Number(heading.tagName.slice(1)),
        text: String(heading.textContent || '').replace(/\s+/g, ' ').trim() || '章节 ' + used.size
      };
    });
  }

  function serializeToXhtml(element) {
    if (!element || !element.ownerDocument) throw new Error('缺少可序列化的正文元素');
    const view = element.ownerDocument.defaultView || root;
    const Serializer = view && view.XMLSerializer;
    if (typeof Serializer !== 'function') throw new Error('当前环境缺少 XMLSerializer');
    const clone = element.cloneNode(true);
    extractHeadingsForToc(clone);
    cleanElementForXml(clone);
    const serializer = new Serializer();
    return Array.from(clone.childNodes).map((node) => serializer.serializeToString(node)).join('\n');
  }

  function identifier() {
    if (root && root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
      const random = Math.floor(Math.random() * 16);
      const value = token === 'x' ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    });
  }

  function modifiedTimestamp() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  function buildNav(meta, headings) {
    const items = ['<li><a href="chapter1.xhtml">' + escapeXml(meta.title || '微信公众号文章') + '</a></li>'];
    headings.forEach((heading) => {
      items.push('<li class="level-' + heading.level + '"><a href="chapter1.xhtml#' + escapeXml(encodeURIComponent(heading.id)) + '">' + escapeXml(heading.text) + '</a></li>');
    });
    return '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN" xml:lang="zh-CN">\n' +
      '<head><meta charset="utf-8" /><title>目录</title><link rel="stylesheet" type="text/css" href="styles/book.css" /></head>\n' +
      '<body><nav epub:type="toc" id="toc"><h1>目录</h1><ol>' + items.join('') + '</ol></nav></body></html>\n';
  }

  function buildNcx(meta, bookId, headings) {
    const points = ['<navPoint id="navPoint-1" playOrder="1"><navLabel><text>' + escapeXml(meta.title || '微信公众号文章') + '</text></navLabel><content src="chapter1.xhtml" /></navPoint>'];
    headings.forEach((heading, index) => {
      const order = index + 2;
      points.push('<navPoint id="navPoint-' + order + '" playOrder="' + order + '"><navLabel><text>' + escapeXml(heading.text) + '</text></navLabel><content src="chapter1.xhtml#' + escapeXml(encodeURIComponent(heading.id)) + '" /></navPoint>');
    });
    return '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="zh-CN">\n' +
      '<head><meta name="dtb:uid" content="urn:uuid:' + escapeXml(bookId) + '" /><meta name="dtb:depth" content="3" /><meta name="dtb:totalPageCount" content="0" /><meta name="dtb:maxPageNumber" content="0" /></head>\n' +
      '<docTitle><text>' + escapeXml(meta.title || '微信公众号文章') + '</text></docTitle>\n' +
      '<navMap>' + points.join('') + '</navMap></ncx>\n';
  }

  async function buildEpubZip(options) {
    const opts = options || {};
    const Zip = opts.JSZip || (root && root.JSZip);
    if (typeof Zip !== 'function') throw new Error('JSZip 未加载');
    if (!opts.contentElement) throw new Error('缺少 EPUB 正文');
    const meta = Object.assign({ title: '微信公众号文章', language: 'zh-CN' }, opts.meta || {});
    const images = (opts.imageResults || []).filter((image) => image && image.ok && image.base64 && image.localPath);
    const headings = extractHeadingsForToc(opts.contentElement);
    const bodyXhtml = serializeToXhtml(opts.contentElement);
    const bookId = identifier();
    const zip = new Zip();

    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    zip.file('META-INF/container.xml', '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
      '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles></container>\n');

    const manifest = [
      '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />',
      '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />',
      '<item id="css" href="styles/book.css" media-type="text/css" />',
      '<item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml" />'
    ];
    images.forEach((image, index) => {
      const path = String(image.localPath).replace(/^\.\//, '');
      const id = image.isCover ? 'cover-image' : 'image-' + (index + 1);
      const properties = image.isCover ? ' properties="cover-image"' : '';
      manifest.push('<item id="' + id + '" href="' + escapeXml(path) + '" media-type="' + escapeXml(image.mime || 'image/png') + '"' + properties + ' />');
      zip.file('OEBPS/' + path, image.base64, { base64: true });
    });

    const cover = images.find((image) => image.isCover);
    const modified = modifiedTimestamp();
    const opf = '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="zh-CN">\n' +
      '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">\n' +
      '<dc:identifier id="book-id">urn:uuid:' + escapeXml(bookId) + '</dc:identifier>\n' +
      '<dc:title>' + escapeXml(meta.title) + '</dc:title>\n' +
      '<dc:creator>' + escapeXml(meta.author || meta.account || '微信公众号') + '</dc:creator>\n' +
      '<dc:date>' + escapeXml(meta.publishDate || modified.slice(0, 10)) + '</dc:date>\n' +
      '<dc:language>zh-CN</dc:language>\n' +
      '<dc:description>' + escapeXml(meta.description || '') + '</dc:description>\n' +
      '<dc:source>' + escapeXml(meta.sourceUrl || '') + '</dc:source>\n' +
      '<meta property="dcterms:modified">' + modified + '</meta>\n' +
      (cover ? '<meta name="cover" content="cover-image" />\n' : '') +
      '</metadata>\n<manifest>' + manifest.join('') + '</manifest>\n' +
      '<spine toc="ncx"><itemref idref="chapter1" /></spine>\n</package>\n';
    zip.file('OEBPS/content.opf', opf);
    zip.file('OEBPS/nav.xhtml', buildNav(meta, headings));
    zip.file('OEBPS/toc.ncx', buildNcx(meta, bookId, headings));
    zip.file('OEBPS/styles/book.css', EPUB_CSS);

    const coverXhtml = cover
      ? '<section class="cover"><img src="' + escapeXml(String(cover.localPath).replace(/^\.\//, '')) + '" alt="文章封面" /></section>\n'
      : '';
    const chapter = '<?xml version="1.0" encoding="utf-8"?>\n' +
      '<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN" xml:lang="zh-CN">\n' +
      '<head><meta charset="utf-8" /><title>' + escapeXml(meta.title) + '</title><link rel="stylesheet" type="text/css" href="styles/book.css" /></head>\n' +
      '<body><main><header><h1>' + escapeXml(meta.title) + '</h1>' +
      '<p class="meta">' + escapeXml([meta.account, meta.author, meta.publishDate].filter(Boolean).join(' · ')) + '</p></header>\n' +
      coverXhtml + '<article>' + bodyXhtml + '</article></main></body></html>\n';
    zip.file('OEBPS/chapter1.xhtml', chapter);

    return zip.generateAsync({
      type: opts.outputType || 'blob',
      mimeType: 'application/epub+zip',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });
  }

  const EPUB_CSS = `body { color: #202124; background: #fff; font-family: serif; font-size: 1em; line-height: 1.75; }
main { max-width: 42em; margin: 0 auto; padding: 1em; }
header { margin-bottom: 2em; border-bottom: 1px solid #ddd; }
h1, h2, h3 { line-height: 1.4; }
.meta { color: #777; font-size: 0.85em; }
img { display: block; max-width: 100%; height: auto; margin: 1em auto; }
pre { overflow-wrap: anywhere; white-space: pre-wrap; }
code { font-family: monospace; }
blockquote { margin-left: 0; padding-left: 1em; border-left: 0.2em solid #07c160; color: #555; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 0.4em; border: 1px solid #bbb; }
.wx-comment { margin: 1em 0; padding: 0.7em; background: #f4f4f4; }
`;

  return { buildEpubZip, serializeToXhtml, extractHeadingsForToc };
});
