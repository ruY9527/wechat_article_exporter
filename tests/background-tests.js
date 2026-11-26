'use strict';

/**
 * tests/background-tests.js — background.js（Service Worker）单元测试
 *
 * 用 vm 沙箱加载 src/background.js，桩掉 chrome / fetch，验证：
 *   · FETCH_IMAGE 成功：返回 base64 + MIME，且请求使用 referrerPolicy: 'no-referrer'
 *   · FETCH_IMAGE 遇到 403：返回 ok:false，不抛异常
 *   · FETCH_IMAGE 遇到 5xx：重试一次
 *   · FETCH_IMAGE 超时：返回 ok:false 且错误信息含「超时」
 *   · DOWNLOAD_DATA_URL：非 data: URL 被拒绝
 *   · GET_SETTINGS / SET_SETTINGS：默认值与持久化
 *   · Service Worker 顶层注册 listener
 *
 * 用法：node tests/background-tests.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const BG_PATH = path.resolve(__dirname, '..', 'src', 'background.js');
const BG_SOURCE = fs.readFileSync(BG_PATH, 'utf8');

const results = [];

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log('  \u2713 ' + name);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log('  \u2717 ' + name);
    console.log('      ' + (error && error.message ? error.message : String(error)));
  }
}

/**
 * 构造沙箱并返回 message 分发器
 * @param {{fetch?:Function, storage?:object}} [config]
 */
function loadBackground(config) {
  const cfg = config || {};
  const storage = cfg.storage || {};
  const listeners = { message: [], installed: [] };
  const downloads = [];
  const debuggerCalls = [];
  const tabMessages = [];

  const chromeStub = {
    runtime: {
      onMessage: { addListener: (fn) => listeners.message.push(fn) },
      onInstalled: { addListener: (fn) => listeners.installed.push(fn) }
    },
    storage: {
      local: {
        async get(key) {
          const out = {};
          if (typeof key === 'string') {
            if (key in storage) out[key] = storage[key];
            return out;
          }
          return Object.assign({}, storage);
        },
        async set(patch) {
          Object.assign(storage, patch);
        }
      }
    },
    downloads: {
      async download(options) {
        downloads.push(options);
        debuggerCalls.push('download');
        if (cfg.downloadError) throw new Error(cfg.downloadError);
        return downloads.length;
      }
    },
    tabs: {
      async sendMessage(tabId, message) {
        tabMessages.push({ tabId, message });
        return { ok: true };
      }
    },
    debugger: {
      async attach(debuggee, version) {
        debuggerCalls.push('attach');
        if (cfg.onAttach) cfg.onAttach(debuggee, version);
      },
      async sendCommand(debuggee, method, options) {
        debuggerCalls.push('capture');
        if (cfg.onCapture) cfg.onCapture(debuggee, method, options);
        if (cfg.captureError) throw new Error(cfg.captureError);
        return { data: cfg.captureData || 'UE5HX0RBVEE=' };
      },
      async detach() {
        debuggerCalls.push('detach');
        if (cfg.detachError) throw new Error(cfg.detachError);
      }
    }
  };

  const sandbox = {
    chrome: chromeStub,
    fetch: cfg.fetch || (async () => { throw new Error('fetch 未桩'); }),
    AbortController,
    btoa,
    atob,
    Uint8Array,
    ArrayBuffer,
    setTimeout,
    clearTimeout,
    console,
    Promise
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(BG_SOURCE, sandbox, { filename: 'background.js' });

  /**
   * 模拟 chrome.runtime.onMessage 投递
   * @param {object} message
   */
  function dispatch(message) {
    const listener = listeners.message[0];
    if (!listener) throw new Error('background 未注册 onMessage');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('sendResponse 超时')), 8000);
      const sendResponse = (payload) => {
        clearTimeout(timer);
        resolve(payload);
      };
      const keep = listener(message, {}, sendResponse);
      if (keep !== true && keep !== undefined) {
        // 同步返回
      }
    });
  }

  return { sandbox, storage, downloads, debuggerCalls, tabMessages, listeners, dispatch };
}

/* ------------------------------------------------------------------ */

function okResponse(body, contentType) {
  const bytes = Buffer.from(body);
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        if (name.toLowerCase() === 'content-type') return contentType;
        return null;
      }
    },
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  };
}

function errorResponse(status) {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    async arrayBuffer() { return new ArrayBuffer(0); }
  };
}

(async function main() {
  console.log('background.js — 单元测试\n');

  await test('顶层注册 onMessage / onInstalled', async () => {
    const bg = loadBackground();
    assert.strictEqual(bg.listeners.message.length, 1, 'onMessage 未注册');
    assert.strictEqual(bg.listeners.installed.length, 1, 'onInstalled 未注册');
  });

  await test('FETCH_IMAGE 成功返回 base64 与 MIME', async () => {
    let captured = null;
    const bg = loadBackground({
      fetch: async (url, options) => {
        captured = { url, options };
        return okResponse('fake-image-bytes', 'image/png');
      }
    });
    const resp = await bg.dispatch({ action: 'FETCH_IMAGE', url: 'https://mmbiz.qpic.cn/a.png' });
    assert.strictEqual(resp.ok, true, '应成功: ' + JSON.stringify(resp));
    assert.strictEqual(resp.mime, 'image/png');
    assert.strictEqual(resp.bytes, 16);
    assert.strictEqual(Buffer.from(resp.base64, 'base64').toString(), 'fake-image-bytes');
  });

  await test('图片请求使用 referrerPolicy: no-referrer（绕防盗链）', async () => {
    let captured = null;
    const bg = loadBackground({
      fetch: async (url, options) => {
        captured = options;
        return okResponse('x', 'image/jpeg');
      }
    });
    await bg.dispatch({ action: 'FETCH_IMAGE', url: 'https://mmbiz.qpic.cn/a.jpg' });
    assert.strictEqual(captured.referrerPolicy, 'no-referrer');
    assert.strictEqual(captured.credentials, 'omit');
  });

  await test('协议相对地址 //mmbiz... 被补全为 https', async () => {
    let capturedUrl = '';
    const bg = loadBackground({
      fetch: async (url) => {
        capturedUrl = url;
        return okResponse('x', 'image/png');
      }
    });
    await bg.dispatch({ action: 'FETCH_IMAGE', url: '//mmbiz.qpic.cn/b.png' });
    assert.strictEqual(capturedUrl, 'https://mmbiz.qpic.cn/b.png');
  });

  await test('403 返回 ok:false 且不重试抛出', async () => {
    let calls = 0;
    const bg = loadBackground({
      fetch: async () => {
        calls += 1;
        return errorResponse(403);
      }
    });
    const resp = await bg.dispatch({ action: 'FETCH_IMAGE', url: 'https://mmbiz.qpic.cn/deny.png' });
    assert.strictEqual(resp.ok, false);
    assert.strictEqual(resp.status, 403);
    assert.strictEqual(calls, 1, '403 不应重试，实际调用 ' + calls + ' 次');
  });

  await test('500 自动重试一次后失败', async () => {
    let calls = 0;
    const bg = loadBackground({
      fetch: async () => {
        calls += 1;
        return errorResponse(500);
      }
    });
    const resp = await bg.dispatch({ action: 'FETCH_IMAGE', url: 'https://mmbiz.qpic.cn/err.png' });
    assert.strictEqual(resp.ok, false);
    assert.strictEqual(calls, 2, '应重试一次，实际调用 ' + calls + ' 次');
  });

  await test('5xx 后重试成功则返回成功', async () => {
    let calls = 0;
    const bg = loadBackground({
      fetch: async () => {
        calls += 1;
        if (calls === 1) return errorResponse(503);
        return okResponse('recovered', 'image/webp');
      }
    });
    const resp = await bg.dispatch({ action: 'FETCH_IMAGE', url: 'https://mmbiz.qpic.cn/r.webp' });
    assert.strictEqual(resp.ok, true);
    assert.strictEqual(resp.mime, 'image/webp');
    assert.strictEqual(calls, 2);
  });

  await test('空响应体被视为失败', async () => {
    const bg = loadBackground({
      fetch: async () => ({
        ok: true,
        status: 200,
        headers: { get: () => 'image/png' },
        async arrayBuffer() { return new ArrayBuffer(0); }
      })
    });
    const resp = await bg.dispatch({ action: 'FETCH_IMAGE', url: 'https://mmbiz.qpic.cn/empty.png' });
    assert.strictEqual(resp.ok, false);
    assert.ok(/为空/.test(resp.error), '错误信息: ' + resp.error);
  });

  await test('非法协议被拒绝（不发起 fetch）', async () => {
    let calls = 0;
    const bg = loadBackground({
      fetch: async () => {
        calls += 1;
        return okResponse('x', 'image/png');
      }
    });
    const resp = await bg.dispatch({ action: 'FETCH_IMAGE', url: 'file:///etc/passwd' });
    assert.strictEqual(resp.ok, false);
    assert.ok(/不支持的图片协议/.test(resp.error), '错误信息: ' + resp.error);
    assert.strictEqual(calls, 0, '不应发起请求');
  });

  await test('FETCH_IMAGES 批量返回与请求顺序一致', async () => {
    const bg = loadBackground({
      fetch: async (url) => okResponse(url.endsWith('.gif') ? 'g' : 'p', url.endsWith('.gif') ? 'image/gif' : 'image/png')
    });
    const resp = await bg.dispatch({
      action: 'FETCH_IMAGES',
      urls: ['https://mmbiz.qpic.cn/1.png', 'https://mmbiz.qpic.cn/2.gif']
    });
    assert.strictEqual(resp.ok, true);
    assert.strictEqual(resp.results.length, 2);
    assert.strictEqual(resp.results[0].url, 'https://mmbiz.qpic.cn/1.png');
    assert.strictEqual(resp.results[1].mime, 'image/gif');
  });

  await test('DOWNLOAD_DATA_URL 触发 chrome.downloads', async () => {
    const bg = loadBackground();
    const resp = await bg.dispatch({
      action: 'DOWNLOAD_DATA_URL',
      dataUrl: 'data:text/markdown;base64,aGVsbG8=',
      filename: '文章.md'
    });
    assert.strictEqual(resp.ok, true);
    assert.strictEqual(bg.downloads.length, 1);
    assert.strictEqual(bg.downloads[0].filename, '文章.md');
    assert.strictEqual(bg.downloads[0].conflictAction, 'uniquify');
  });

  await test('DOWNLOAD_DATA_URL 拒绝非 data: URL', async () => {
    const bg = loadBackground();
    const resp = await bg.dispatch({ action: 'DOWNLOAD_DATA_URL', dataUrl: 'https://evil/x', filename: 'x' });
    assert.strictEqual(resp.ok, false);
    assert.strictEqual(bg.downloads.length, 0);
  });

  await test('GET_SETTINGS 返回五项规范化默认值', async () => {
    const bg = loadBackground();
    const resp = await bg.dispatch({ action: 'GET_SETTINGS' });
    assert.strictEqual(resp.ok, true);
    // 对象由 vm realm 创建，逐字段比对而非 deepStrictEqual
    assert.strictEqual(resp.settings.bundleImages, true);
    assert.strictEqual(resp.settings.frontMatter, true);
    assert.strictEqual(resp.settings.convertWebp, false);
    assert.strictEqual(resp.settings.keepMediaPlaceholders, true);
    assert.strictEqual(resp.settings.includeComments, false);
  });

  await test('SET_SETTINGS 合并写入并可被 GET_SETTINGS 读回', async () => {
    const bg = loadBackground();
    await bg.dispatch({ action: 'SET_SETTINGS', patch: { frontMatter: false } });
    const resp = await bg.dispatch({ action: 'GET_SETTINGS' });
    assert.strictEqual(resp.settings.frontMatter, false);
    assert.strictEqual(resp.settings.bundleImages, true);
    assert.ok(bg.storage.wxExporterSettings, '未写入 storage');
  });

  await test('TC-21：长图 CDP 按 attach → capture → download → detach 执行', async () => {
    let capture = null;
    const bg = loadBackground({
      onCapture: (_debuggee, method, options) => { capture = { method, options }; }
    });
    const resp = await bg.dispatch({
      action: 'CAPTURE_LONG_PNG',
      tabId: 7,
      clip: { x: -4, y: 10.2, width: 750.2, height: 5000.1 },
      filename: '文章.png'
    });
    assert.strictEqual(resp.ok, true, JSON.stringify(resp));
    assert.deepStrictEqual(bg.debuggerCalls, ['attach', 'capture', 'download', 'detach']);
    assert.strictEqual(capture.method, 'Page.captureScreenshot');
    assert.strictEqual(capture.options.captureBeyondViewport, true);
    assert.strictEqual(capture.options.fromSurface, true);
    assert.strictEqual(capture.options.clip.scale, 2);
    assert.strictEqual(capture.options.clip.width, 751);
    assert.strictEqual(capture.options.clip.height, 5001);
    assert.ok(bg.downloads[0].url.startsWith('data:image/png;base64,'));
  });

  await test('TC-21：高度超过 12000 时自动降 scale=1', async () => {
    let options = null;
    const bg = loadBackground({ onCapture: (_d, _m, value) => { options = value; } });
    const resp = await bg.dispatch({
      action: 'CAPTURE_LONG_PNG', tabId: 8,
      clip: { x: 0, y: 0, width: 750, height: 12001 }, filename: '长文.png'
    });
    assert.strictEqual(resp.ok, true);
    assert.strictEqual(resp.scale, 1);
    assert.strictEqual(options.clip.scale, 1);
    assert.deepStrictEqual(bg.debuggerCalls, ['attach', 'capture', 'download', 'detach']);
  });

  await test('TC-21：sendCommand 抛错仍 detach 且不触发下载', async () => {
    const bg = loadBackground({ captureError: '模拟 CDP 崩溃' });
    const resp = await bg.dispatch({
      action: 'CAPTURE_LONG_PNG', tabId: 9,
      clip: { x: 0, y: 0, width: 750, height: 3000 }, filename: '异常.png'
    });
    assert.strictEqual(resp.ok, false);
    assert.ok(/模拟 CDP 崩溃/.test(resp.error));
    assert.deepStrictEqual(bg.debuggerCalls, ['attach', 'capture', 'detach']);
    assert.strictEqual(bg.downloads.length, 0);
    assert.strictEqual(bg.tabMessages.length, 1);
    assert.strictEqual(bg.tabMessages[0].message.action, 'CLEANUP_LONG_PNG');
  });

  await test('TC-21：下载失败仍 detach 并由后台恢复页面', async () => {
    const bg = loadBackground({ downloadError: '模拟下载失败' });
    const resp = await bg.dispatch({
      action: 'CAPTURE_LONG_PNG', tabId: 10,
      clip: { x: 0, y: 0, width: 750, height: 3000 }, filename: '异常.png'
    });
    assert.strictEqual(resp.ok, false);
    assert.deepStrictEqual(bg.debuggerCalls, ['attach', 'capture', 'download', 'detach']);
    assert.strictEqual(bg.tabMessages[0].message.action, 'CLEANUP_LONG_PNG');
  });

  await test('未知 action 返回 false（不占用异步通道）', async () => {
    const bg = loadBackground();
    const listener = bg.listeners.message[0];
    const keep = listener({ action: 'NOPE' }, {}, () => {});
    assert.strictEqual(keep, false);
  });

  /* ---------------- 汇总 ---------------- */
  const failed = results.filter((r) => !r.ok);
  console.log('\n----------------------------------------');
  console.log('通过 ' + (results.length - failed.length) + '/' + results.length);
  if (failed.length) {
    console.log('失败用例：');
    failed.forEach((r) => console.log('  · ' + r.name + ' → ' + (r.error && r.error.message)));
    process.exitCode = 1;
  } else {
    console.log('全部通过 ✔');
  }
})();
