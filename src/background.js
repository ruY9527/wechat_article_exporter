'use strict';

/**
 * background.js — Manifest V3 Service Worker
 *
 * 职责（对应设计文档 4.2 / 4.5）：
 *   1. FETCH_IMAGE  ：借助 host_permissions 跨域拉取微信图床图片，
 *                     以 base64 + MIME 回传（MV3 消息通道不支持直接传 Blob）。
 *   2. FETCH_IMAGES ：批量版本，便于内容脚本聚合请求（可选通道）。
 *   3. DOWNLOAD_DATA_URL：兜底下载通道，当页面内 <a download> 被站点策略拦截时使用。
 *   4. GET_SETTINGS / SET_SETTINGS：偏好设置的默认值初始化与读写。
 *
 * 说明：Service Worker 每次唤醒都会重新执行本文件顶层代码，
 * 因此所有 listener 必须在顶层同步注册。
 */

const DEFAULT_SETTINGS = Object.freeze({
  bundleImages: true, // 导出 Markdown 时打包本地图片（ZIP）
  frontMatter: true   // 生成 YAML Front Matter
});

const IMAGE_TIMEOUT_MS = 10000; // 单图 10s 超时（设计文档 4.2）
const MAX_RETRY = 1;            // 仅对网络错误 / 5xx / 429 重试一次

/* ------------------------------------------------------------------ */
/* 工具函数                                                           */
/* ------------------------------------------------------------------ */

/**
 * ArrayBuffer -> base64（Service Worker 中无 FileReader，分块避免爆栈）
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * 校验 URL 是否可以作为图片资源拉取（只允许 http/https）
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeImageUrl(raw) {
  if (typeof raw !== 'string') throw new Error('图片地址无效');
  let url = raw.trim();
  if (!url) throw new Error('图片地址为空');
  if (url.startsWith('//')) url = 'https:' + url;
  if (!/^https?:\/\//i.test(url)) throw new Error('不支持的图片协议: ' + url.slice(0, 32));
  return url;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ------------------------------------------------------------------ */
/* 图片抓取（绕防盗链）                                                */
/* ------------------------------------------------------------------ */

/**
 * 单次抓取，不重试。
 * @param {string} url
 * @param {number} timeoutMs
 */
async function fetchImageOnce(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      // 关键：不携带 Referer，绕过 mmbiz.qpic.cn 的防盗链校验
      referrerPolicy: 'no-referrer',
      signal: controller.signal
    });

    if (!response.ok) {
      const error = new Error('HTTP ' + response.status);
      error.status = response.status;
      error.retryable = response.status >= 500 || response.status === 429;
      throw error;
    }

    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const buffer = await response.arrayBuffer();
    if (!buffer || buffer.byteLength === 0) {
      const error = new Error('图片响应为空');
      error.retryable = true;
      throw error;
    }

    return {
      ok: true,
      mime: contentType,
      bytes: buffer.byteLength,
      base64: arrayBufferToBase64(buffer)
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 带重试的图片抓取。
 * @param {string} rawUrl
 * @param {{timeoutMs?: number, maxRetry?: number}} [opts]
 */
async function fetchImage(rawUrl, opts) {
  const url = normalizeImageUrl(rawUrl);
  const timeoutMs = Math.max(1000, Number(opts?.timeoutMs) || IMAGE_TIMEOUT_MS);
  const maxRetry = Number.isFinite(opts?.maxRetry) ? Number(opts.maxRetry) : MAX_RETRY;

  let lastError = null;
  for (let attempt = 0; attempt <= maxRetry; attempt += 1) {
    try {
      const result = await fetchImageOnce(url, timeoutMs);
      return Object.assign(result, { url, attempts: attempt + 1 });
    } catch (error) {
      lastError = error;
      const retryable = error?.retryable === true || error?.name === 'AbortError' ||
        (error instanceof TypeError); // 网络层失败
      if (!retryable || attempt === maxRetry) break;
      await sleep(200 * (attempt + 1));
    }
  }

  const message = lastError?.name === 'AbortError'
    ? '请求超时（' + timeoutMs + 'ms）'
    : (lastError?.message || '未知错误');
  return { ok: false, url, error: message, status: lastError?.status || 0 };
}

/* ------------------------------------------------------------------ */
/* 偏好设置                                                            */
/* ------------------------------------------------------------------ */

async function getSettings() {
  const stored = await chrome.storage.local.get('wxExporterSettings');
  const merged = Object.assign({}, DEFAULT_SETTINGS, stored?.wxExporterSettings || {});
  return {
    bundleImages: merged.bundleImages !== false,
    frontMatter: merged.frontMatter !== false
  };
}

async function setSettings(patch) {
  const current = await getSettings();
  const next = Object.assign({}, current, patch || {});
  await chrome.storage.local.set({ wxExporterSettings: next });
  return next;
}

/* ------------------------------------------------------------------ */
/* 生命周期                                                            */
/* ------------------------------------------------------------------ */

chrome.runtime.onInstalled.addListener(() => {
  getSettings()
    .then((settings) => chrome.storage.local.set({ wxExporterSettings: settings }))
    .catch(() => { /* 初始化失败不影响使用，popup 侧仍会兜底 */ });
});

/* ------------------------------------------------------------------ */
/* 消息路由                                                            */
/* ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const action = message && message.action;

  if (action === 'FETCH_IMAGE') {
    fetchImage(message.url, { timeoutMs: message.timeoutMs })
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, url: message?.url, error: String(error?.message || error) }));
    return true; // 异步响应
  }

  if (action === 'FETCH_IMAGES') {
    const urls = Array.isArray(message.urls) ? message.urls : [];
    Promise.all(urls.map((url) => fetchImage(url, { timeoutMs: message.timeoutMs })))
      .then((results) => sendResponse({ ok: true, results }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error), results: [] }));
    return true;
  }

  if (action === 'DOWNLOAD_DATA_URL') {
    const url = String(message.dataUrl || '');
    const filename = String(message.filename || 'download');
    if (!/^data:/i.test(url)) {
      sendResponse({ ok: false, error: '仅支持 data: URL' });
      return false;
    }
    chrome.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' })
      .then((downloadId) => sendResponse({ ok: true, downloadId }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (action === 'GET_SETTINGS') {
    getSettings()
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (action === 'SET_SETTINGS') {
    setSettings(message.patch)
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (action === 'PING') {
    sendResponse({ ok: true, from: 'background', ts: Date.now() });
    return false;
  }

  return false;
});
