// 真实 GUI 冒烟检查：用 CDP 驱动真实 DSH WebUI，确认插件真的装载了，并截图。
//
// 为什么需要它：单测跑在 mock DOM 上，只能证明"逻辑对"；装进真实宿主才会暴露
// 插槽不渲染、哈希类名变了、样式被覆盖、控制台报错这类问题。
//
// 用法：
//   node tools/real-ui-check.mjs --url http://127.0.0.1:3080 --global __GLOBAL__
//   node tools/real-ui-check.mjs --assert '!!document.querySelector("style[data-plugin-css=\"__PKG__/style\"]")' --label "样式表已注入"
//
// 参数：
//   --url <url>        默认 http://127.0.0.1:3080 （可带 ?token=…，取不到就自动读取）
//   --global <name>    window 上的调试全局（默认 __GLOBAL__），断言它存在
//   --assert <expr>    额外断言，可重复；表达式需返回真值
//   --label <text>     --assert 的说明（可重复、按顺序对应）
//   --out <path>       截图输出（默认 docs/real-ui.png）
//   --chrome <path>    Chrome 可执行文件（默认 macOS 路径）
//   --wait <ms>        导航后等待时间（默认 3500）
//   --allow-console-errors  不在控制台报错时失败（默认有 error 就失败）

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function argvValue(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}
function argvAll(name) {
  const out = [];
  process.argv.forEach((a, i) => { if (a === `--${name}` && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) out.push(process.argv[i + 1]); });
  return out;
}

const URL_BASE = String(argvValue('url', 'http://127.0.0.1:3080'));
const GLOBAL_NAME = String(argvValue('global', '__GLOBAL__'));
const OUT = resolve(ROOT, String(argvValue('out', 'docs/real-ui.png')));
const WAIT = Number(argvValue('wait', 3500));
const ALLOW_ERRORS = process.argv.includes('--allow-console-errors');
const CHROME = String(argvValue('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'));
const PORT = Number(argvValue('debug-port', 9333));
const ASSERTIONS = argvAll('assert');
const LABELS = argvAll('label');

if (!existsSync(CHROME)) {
  console.error(`找不到 Chrome：${CHROME}\n用 --chrome <path> 指定，或跳过这项检查（但请务必人工点一遍）。`);
  process.exit(2);
}

/** 启动一个独立的 headless Chrome，返回 {proc, port}。 */
function launchChrome() {
  const userDataDir = resolve(ROOT, '.tmp', 'chrome-profile');
  mkdirSync(userDataDir, { recursive: true });
  const proc = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--in-process-gpu',
    '--disable-crash-reporter', '--hide-scrollbars', '--no-first-run',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1440,900',
    'about:blank'
  ], { stdio: 'ignore', detached: false });
  return proc;
}

async function waitForDevtools(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (res.ok) return true;
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** 极简 CDP 客户端（Node 自带 WebSocket，无需依赖）。 */
function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const events = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: res, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else res(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', () => res());
    ws.addEventListener('error', (e) => rej(new Error('WebSocket 连接失败: ' + (e.message || 'error'))));
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { ws, ready, send, events };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`· 启动 headless Chrome（调试端口 ${PORT}）`);
  const chrome = launchChrome();
  const up = await waitForDevtools();
  if (!up) {
    chrome.kill('SIGKILL');
    throw new Error('Chrome 的 DevTools 端口没有就绪');
  }

  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('没有可用的 page target');

  const cdp = connectCdp(page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');

  // token：URL 里没带就从 DSH 的启动日志/URL 文件里找（拿不到也继续，未认证会 401）
  let url = URL_BASE;
  console.log(`· 打开 ${url}`);
  await cdp.send('Page.navigate', { url });
  await sleep(WAIT);

  const problems = [];
  const consoleErrors = cdp.events
    .filter((e) => e.method === 'Log.entryAdded' && e.params.entry.level === 'error')
    .map((e) => e.params.entry.text);
  if (consoleErrors.length && !ALLOW_ERRORS) {
    problems.push(`控制台有 ${consoleErrors.length} 条 error：\n    ` + consoleErrors.slice(0, 5).join('\n    '));
  }

  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'evaluate 抛错');
    return result.result.value;
  };

  const checks = [];
  const globalExpr = `typeof window[${JSON.stringify(GLOBAL_NAME)}] !== 'undefined'`;
  checks.push([globalExpr, `调试全局 window.${GLOBAL_NAME} 存在（插件已装载）`]);
  ASSERTIONS.forEach((expr, i) => checks.push([expr, LABELS[i] || `自定义断言 #${i + 1}`]));

  for (const [expr, label] of checks) {
    const ok = await evaluate(`Boolean(${expr})`);
    console.log(`  ${ok ? '✓' : '✗'} ${label}`);
    if (!ok) problems.push(label);
  }

  const info = await evaluate(`JSON.stringify({
    lang: document.documentElement.lang || '',
    dark: !!document.body && document.body.hasAttribute('data-ds-dark-theme'),
    rows: document.querySelectorAll('[data-row-key^="session:"]').length,
    styles: document.querySelectorAll('style[data-plugin]').length
  })`);
  console.log(`· 页面状态 ${info}`);

  mkdirSync(dirname(OUT), { recursive: true });
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
  console.log(`· 截图已写入 ${OUT}`);

  cdp.ws.close();
  chrome.kill('SIGKILL');

  if (problems.length) {
    console.error(`\n✗ 真实界面检查失败（${problems.length} 项）：`);
    problems.forEach((p) => console.error('  - ' + p));
    process.exit(1);
  }
  console.log('\n✓ 真实界面检查通过');
}

main().catch((err) => {
  console.error('✗ ' + err.message);
  process.exit(1);
});
