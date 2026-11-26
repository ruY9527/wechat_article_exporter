/* eslint-disable no-console */
'use strict';

/**
 * popup.js — 扩展弹窗交互
 *
 * 对应设计文档 4.5：
 *   · 页面状态提示栏（匹配 mp.weixin.qq.com/s，否则禁用按钮）
 *   · 导出选项（持久化到 chrome.storage.local）
 *   · 两个主操作按钮 + 进度反馈条
 *   · 消息协议：EXPORT_MARKDOWN / EXPORT_PDF / EXPORT_PROGRESS
 */

const DEFAULT_SETTINGS = Object.freeze({
  bundleImages: true,
  frontMatter: true,
  convertWebp: false,
  keepMediaPlaceholders: true,
  includeComments: false
});

/** 文章页 URL 判定：https://mp.weixin.qq.com/s... */
const ARTICLE_URL_PATTERN = /^https:\/\/mp\.weixin\.qq\.com\/s(?:[/?#]|$)/i;

/** 进度阶段 → 进度条百分比 / 说明 */
const STAGE_MAP = {
  extracting: { percent: 8, text: '正在提取正文…' },
  downloading: { percent: 10, text: '正在下载图片…' },
  converting: { percent: 82, text: '正在转换 Markdown…' },
  packing: { percent: 90, text: '正在打包 ZIP…' },
  saving: { percent: 97, text: '正在保存文件…' },
  preloading: { percent: 35, text: '正在加载全部图片…' },
  printing: { percent: 80, text: '正在打开打印预览…' },
  done: { percent: 100, text: '完成' }
};

const ui = {};

let activeTabId = null;
let busy = false;

/* ------------------------------------------------------------------ */
/* 初始化                                                              */
/* ------------------------------------------------------------------ */

document.addEventListener('DOMContentLoaded', () => {
  cacheDom();
  bindEvents();
  chrome.runtime.onMessage.addListener(handleProgressMessage);
  initialize();
});

function cacheDom() {
  ui.statusBar = document.getElementById('page-status');
  ui.statusText = document.getElementById('page-status-text');
  ui.optBundle = document.getElementById('opt-bundle');
  ui.optFrontMatter = document.getElementById('opt-frontmatter');
  ui.optWebp = document.getElementById('opt-webp');
  ui.optMedia = document.getElementById('opt-media');
  ui.optComments = document.getElementById('opt-comments');
  ui.btnMarkdown = document.getElementById('btn-markdown');
  ui.btnCopy = document.getElementById('btn-copy');
  ui.btnPdf = document.getElementById('btn-pdf');
  ui.btnHtml = document.getElementById('btn-html');
  ui.btnEpub = document.getElementById('btn-epub');
  ui.btnLongPng = document.getElementById('btn-long-png');
  ui.progress = document.getElementById('progress');
  ui.progressFill = document.getElementById('progress-fill');
  ui.progressText = document.getElementById('progress-text');
  ui.hint = document.getElementById('hint');
}

function bindEvents() {
  ui.optBundle.addEventListener('change', persistSettings);
  ui.optFrontMatter.addEventListener('change', persistSettings);
  ui.optWebp.addEventListener('change', persistSettings);
  ui.optMedia.addEventListener('change', persistSettings);
  ui.optComments.addEventListener('change', persistSettings);
  ui.btnMarkdown.addEventListener('click', onExportMarkdown);
  ui.btnCopy.addEventListener('click', onCopyMarkdown);
  ui.btnPdf.addEventListener('click', onExportPdf);
  ui.btnHtml.addEventListener('click', onExportHtml);
  ui.btnEpub.addEventListener('click', onExportEpub);
  ui.btnLongPng.addEventListener('click', onExportLongPng);
}

async function initialize() {
  await loadSettings();

  let tab = null;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (error) {
    setStatus('error', '无法读取当前标签页：' + errorText(error));
    disableActions(true);
    return;
  }

  if (!tab || typeof tab.id !== 'number') {
    setStatus('error', '无法读取当前标签页信息');
    disableActions(true);
    return;
  }

  activeTabId = tab.id;

  // TC-01：非公众号页面拦截
  if (!tab.url || !ARTICLE_URL_PATTERN.test(tab.url)) {
    setStatus('warn', '仅支持微信公众号文章页面（mp.weixin.qq.com/s…）');
    disableActions(true);
    return;
  }

  // 页面是文章页，进一步确认内容脚本可用（扩展刷新后旧页面会掉线）
  const ping = await sendToTab({ action: 'PING_PAGE' }, 1500);
  if (!ping.ok) {
    setStatus('warn', '内容脚本未就绪，请刷新该文章页面后重新打开本弹窗');
    disableActions(true);
    return;
  }
  if (!ping.data || ping.data.supported !== true) {
    setStatus('warn', '未检测到文章正文，请确认页面已完全加载');
    disableActions(true);
    return;
  }

  setStatus('ok', '已就绪：' + shortenUrl(tab.url));
  disableActions(false);
}

/* ------------------------------------------------------------------ */
/* 设置                                                                */
/* ------------------------------------------------------------------ */

async function loadSettings() {
  let settings = Object.assign({}, DEFAULT_SETTINGS);
  try {
    const stored = await chrome.storage.local.get('wxExporterSettings');
    if (stored && stored.wxExporterSettings) {
      settings = Object.assign(settings, stored.wxExporterSettings);
    }
  } catch (_) {
    /* 读取失败时用默认值 */
  }
  ui.optBundle.checked = settings.bundleImages !== false;
  ui.optFrontMatter.checked = settings.frontMatter !== false;
  ui.optWebp.checked = settings.convertWebp === true;
  ui.optMedia.checked = settings.keepMediaPlaceholders !== false;
  ui.optComments.checked = settings.includeComments === true;
}

async function persistSettings() {
  const settings = {
    bundleImages: ui.optBundle.checked,
    frontMatter: ui.optFrontMatter.checked,
    convertWebp: ui.optWebp.checked,
    keepMediaPlaceholders: ui.optMedia.checked,
    includeComments: ui.optComments.checked
  };
  try {
    await chrome.storage.local.set({ wxExporterSettings: settings });
  } catch (error) {
    showHint('error', '保存设置失败：' + errorText(error));
  }
}

function readSettings() {
  return {
    bundleImages: ui.optBundle.checked,
    frontMatter: ui.optFrontMatter.checked,
    convertWebp: ui.optWebp.checked,
    keepMediaPlaceholders: ui.optMedia.checked,
    includeComments: ui.optComments.checked
  };
}

/* ------------------------------------------------------------------ */
/* 导出动作                                                            */
/* ------------------------------------------------------------------ */

async function onExportMarkdown() {
  if (busy) return;
  const settings = readSettings();
  const bundleNote = settings.bundleImages ? '含图片 ZIP' : '纯 Markdown';

  setBusy(true);
  clearHint();
  showProgress(0, '正在提取正文…');

  const result = await sendToTab(
    { action: 'EXPORT_MARKDOWN', settings: Object.assign({}, settings, { download: true }) },
    settings.bundleImages ? 180000 : 60000
  );

  setBusy(false);

  if (!result.ok) {
    showProgress(0, '导出失败');
    showHint('error', friendlyError(result.error));
    return;
  }

  const data = result.data || {};
  if (data.ok === false) {
    showProgress(0, '导出失败');
    showHint('error', friendlyError(data.error));
    return;
  }

  showProgress(100, '导出完成');

  const failed = Number(data.imageFailed || 0);
  const total = Number(data.imageTotal || 0);
  const savedName = data.filename || '文章';

  if (failed > 0) {
    // TC-07：失败图片保留原链接
    showHint('warn', failed + ' 张图片下载失败，已保留原链接。文件：' + savedName);
  } else if (data.mode === 'zip' && total > 0) {
    showHint('success', '已打包 ' + total + ' 张图片：' + savedName);
  } else {
    showHint('success', '已保存 ' + bundleNote + '：' + savedName);
  }
}

async function onExportPdf() {
  if (busy) return;

  setBusy(true);
  clearHint();
  showProgress(0, '正在加载全部图片…');

  const result = await sendToTab({ action: 'EXPORT_PDF' }, 180000);

  setBusy(false);

  if (!result.ok) {
    showProgress(0, '导出失败');
    showHint('error', friendlyError(result.error));
    return;
  }

  const data = result.data || {};
  if (data.ok === false) {
    showProgress(0, '导出失败');
    showHint('error', friendlyError(data.error));
    return;
  }

  showProgress(100, '已打开打印预览');
  const failed = Number(data.failed || 0);
  const tip = '在打印对话框中把「目标打印机」选为“另存为 PDF”，展开“更多设置”勾选“背景图形”，并取消“页眉和页脚”。';
  if (failed > 0) {
    showHint('warn', failed + ' 张图片未加载成功（已跳过）。' + tip);
  } else {
    showHint('info', tip);
  }
}

async function onCopyMarkdown() {
  if (busy) return;
  setBusy(true);
  clearHint();
  showProgress(null, '正在生成 Markdown…');
  try {
    const result = await sendToTab({ action: 'COPY_MARKDOWN', settings: readSettings() }, 60000);
    if (!result.ok) throw new Error(result.error);
    const data = result.data || {};
    if (data.ok === false) throw new Error(data.error);
    await writeClipboard(String(data.markdown || ''));
    showProgress(100, '复制完成');
    showHint('success', '已复制 Markdown 到剪贴板（共 ' + Number(data.charCount || 0).toLocaleString('zh-CN') + ' 字）');
  } catch (error) {
    showProgress(0, '复制失败');
    showHint('error', friendlyError(errorText(error)));
  } finally {
    setBusy(false);
  }
}

async function writeClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (_) { /* 继续尝试隐藏 textarea 兜底 */ }
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch (_) { copied = false; }
  textarea.remove();
  if (!copied) throw new Error('剪贴板写入失败，请允许扩展访问剪贴板后重试');
}

async function onExportHtml() {
  await exportAdditionalFile('EXPORT_HTML', '离线 HTML');
}

async function onExportEpub() {
  await exportAdditionalFile('EXPORT_EPUB', 'EPUB 电子书');
}

async function exportAdditionalFile(action, label) {
  if (busy) return;
  setBusy(true);
  clearHint();
  showProgress(0, '正在准备' + label + '…');
  try {
    const result = await sendToTab({ action, settings: readSettings() }, 180000);
    if (!result.ok) throw new Error(result.error);
    const data = result.data || {};
    if (data.ok === false) throw new Error(data.error);
    showProgress(100, '导出完成');
    const failed = Number(data.imageFailed || 0);
    const failureNote = action === 'EXPORT_EPUB'
      ? failed + ' 张图片下载失败，EPUB 中已改为文本占位。'
      : failed + ' 张图片下载失败，已保留原链接。';
    showHint(failed ? 'warn' : 'success',
      (failed ? failureNote : '已保存 ' + label + '：') + (data.filename || ''));
  } catch (error) {
    showProgress(0, '导出失败');
    showHint('error', friendlyError(errorText(error)));
  } finally {
    setBusy(false);
  }
}

async function ensureDebuggerPermission() {
  if (!chrome.permissions) return false;
  const granted = await chrome.permissions.contains({ permissions: ['debugger'] });
  if (granted) return true;
  return chrome.permissions.request({ permissions: ['debugger'] });
}

async function onExportLongPng() {
  if (busy) return;
  setBusy(true);
  clearHint();
  showProgress(0, '正在申请长图截图权限…');
  let attempted = false;
  try {
    const granted = await ensureDebuggerPermission();
    if (!granted) {
      showProgress(0, '已取消');
      showHint('info', '需要临时调试权限以截取完整长图，已取消');
      return;
    }
    attempted = true;
    showProgress(null, '正在加载图片并计算完整页面…');
    const prepared = await sendToTab({ action: 'PREPARE_LONG_PNG', settings: readSettings() }, 180000);
    if (!prepared.ok) throw new Error(prepared.error);
    const prepData = prepared.data || {};
    if (prepData.ok === false) throw new Error(prepData.error);

    showProgress(80, '正在截取完整长图…');
    const capture = await sendToBackground({
      action: 'CAPTURE_LONG_PNG',
      tabId: activeTabId,
      clip: prepData.clip,
      filename: sanitizePngFilename(prepData.title) + '.png'
    }, 180000);
    if (!capture.ok) throw new Error(capture.error);
    const captureData = capture.data || {};
    if (captureData.ok === false) throw new Error(captureData.error);
    showProgress(100, '长图已保存');
    const failed = Number(prepData.failed || 0);
    showHint(failed ? 'warn' : 'success', failed ? failed + ' 张图片未加载成功，请检查长图。' : '全页长图 PNG 已保存。');
  } catch (error) {
    showProgress(0, '长图导出失败');
    showHint('error', friendlyError(errorText(error)));
  } finally {
    if (attempted) {
      const cleaned = await sendToTab({ action: 'CLEANUP_LONG_PNG' }, 5000);
      if (!cleaned.ok || !cleaned.data || cleaned.data.ok === false) {
        showHint('warn', '长图流程已结束，但页面自动恢复未确认；请刷新文章页以清理临时状态。');
      }
    }
    setBusy(false);
  }
}

function sendToBackground(message, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: '后台截图超时，请重试' });
    }, timeoutMs || 180000);
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const lastError = chrome.runtime.lastError;
        if (lastError) resolve({ ok: false, error: lastError.message || '后台消息异常' });
        else if (!response) resolve({ ok: false, error: '后台截图无响应' });
        else resolve({ ok: true, data: response });
      });
    } catch (error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, error: errorText(error) });
    }
  });
}

function sanitizePngFilename(title) {
  const value = String(title || 'wechat-article')
    .replace(/[\\/:*?"<>|\r\n]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/g, '');
  return value || 'wechat-article';
}

/* ------------------------------------------------------------------ */
/* 消息                                                                */
/* ------------------------------------------------------------------ */

/**
 * 向内容脚本发消息并等待响应
 * @param {object} message
 * @param {number} [timeoutMs]
 * @returns {Promise<{ok:boolean, data?:any, error?:string}>}
 */
function sendToTab(message, timeoutMs) {
  return new Promise((resolve) => {
    if (activeTabId === null) {
      resolve({ ok: false, error: '未找到可用的标签页' });
      return;
    }

    let settled = false;
    const timer = timeoutMs
      ? setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, error: '操作超时（' + Math.round(timeoutMs / 1000) + ' 秒），请重试或刷新页面' });
      }, timeoutMs)
      : null;

    try {
      chrome.tabs.sendMessage(activeTabId, message, (response) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);

        const lastError = chrome.runtime.lastError;
        if (lastError) {
          resolve({ ok: false, error: lastError.message || '消息通道异常' });
          return;
        }
        if (!response) {
          resolve({ ok: false, error: '内容脚本无响应，请刷新页面后重试' });
          return;
        }
        resolve({ ok: true, data: response });
      });
    } catch (error) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve({ ok: false, error: errorText(error) });
    }
  });
}

/**
 * 接收内容脚本的 EXPORT_PROGRESS
 * @param {any} message
 */
function handleProgressMessage(message) {
  if (!message || message.action !== 'EXPORT_PROGRESS') return;
  const stage = message.stage;
  const preset = STAGE_MAP[stage];

  if (stage === 'downloading' && typeof message.done === 'number' && typeof message.total === 'number' && message.total > 0) {
    const ratio = Math.min(1, message.done / message.total);
    const percent = 10 + Math.round(ratio * 70);
    showProgress(percent, message.message || ('正在下载图片 (' + message.done + '/' + message.total + ')…'));
    return;
  }

  if (preset) {
    showProgress(preset.percent, message.message || preset.text);
    return;
  }

  if (message.message) showProgress(null, message.message);
}

/* ------------------------------------------------------------------ */
/* UI 渲染                                                             */
/* ------------------------------------------------------------------ */

/**
 * @param {'ok'|'warn'|'error'|'checking'} kind
 * @param {string} text
 */
function setStatus(kind, text) {
  ui.statusBar.className = 'status status--' + kind;
  ui.statusText.textContent = text;
}

function disableActions(disabled) {
  [ui.btnMarkdown, ui.btnCopy, ui.btnPdf, ui.btnHtml, ui.btnEpub, ui.btnLongPng]
    .forEach((button) => { button.disabled = disabled; });
}

function setBusy(value) {
  busy = value;
  disableActions(value);
  const labels = [
    [ui.btnMarkdown, '导出 Markdown'],
    [ui.btnCopy, '复制 Markdown'],
    [ui.btnPdf, '导出 PDF'],
    [ui.btnHtml, '离线 HTML'],
    [ui.btnEpub, 'EPUB 电子书'],
    [ui.btnLongPng, '导出长图 PNG']
  ];
  labels.forEach(([button, label]) => {
    button.classList.toggle('btn--busy', value);
    button.querySelector('.btn__label').textContent = value ? '处理中…' : label;
  });
}

/**
 * 显示进度
 * @param {number|null} percent null 表示不确定进度
 * @param {string} text
 */
function showProgress(percent, text) {
  ui.progress.hidden = false;
  if (percent === null || percent === undefined) {
    ui.progressFill.classList.add('progress__fill--indeterminate');
  } else {
    ui.progressFill.classList.remove('progress__fill--indeterminate');
    ui.progressFill.style.width = Math.max(0, Math.min(100, percent)) + '%';
  }
  if (text) ui.progressText.textContent = text;
}

function showHint(kind, text) {
  ui.hint.hidden = false;
  ui.hint.className = 'hint hint--' + kind;
  ui.hint.textContent = text;
}

function clearHint() {
  ui.hint.hidden = true;
  ui.hint.textContent = '';
  ui.hint.className = 'hint';
}

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function errorText(error) {
  if (!error) return '未知错误';
  return String(error.message || error);
}

/**
 * 把内容脚本返回的原始错误翻译成用户能看懂的提示
 * @param {string} raw
 * @returns {string}
 */
function friendlyError(raw) {
  const text = String(raw || '未知错误');
  if (/Could not establish connection|Receiving end does not exist/i.test(text)) {
    return '内容脚本未就绪，请刷新文章页面后重试';
  }
  if (/未找到文章正文容器/.test(text)) {
    return '未找到文章正文，请确认当前页面是公众号文章详情页';
  }
  if (/Turndown 未加载|JSZip 未加载/.test(text)) {
    return '依赖库未正确加载，请在 chrome://extensions/ 刷新扩展后重试';
  }
  if (/上一次导出尚未完成/.test(text)) {
    return '上一次导出尚未完成，请稍候再试';
  }
  return text;
}

function shortenUrl(url) {
  const value = String(url || '');
  if (value.length <= 46) return value;
  return value.slice(0, 43) + '…';
}
