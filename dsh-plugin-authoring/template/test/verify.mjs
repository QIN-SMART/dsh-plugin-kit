// __PKG__ — 自测。
//
// 用 mock 出来的最小 DOM 加载**真实的** lib/client.js（走真实的
// `window.__ModuleLoader__.load` 注册路径），覆盖插件最容易翻车的地方。
// 新增功能时在这里加用例，而不是手测。
//
// 运行：node --test test/verify.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(here, '..', 'lib', 'client.js');
const SOURCE = readFileSync(BUNDLE, 'utf8');

// ---------------------------------------------------------------------------
// 最小 DOM（够用即可；需要新 API 时在这里补，不要在插件里绕开）
// ---------------------------------------------------------------------------

function kebab(name) {
  return 'data-' + String(name).replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

/** 跨 vm realm 比较用：把插件返回的对象变成当前 realm 的普通对象。 */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeStyle() {
  const props = new Map();
  return {
    props,
    setProperty(k, v) { props.set(k, String(v)); },
    removeProperty(k) { props.delete(k); },
    getPropertyValue(k) { return props.get(k) || ''; }
  };
}

class MockNode {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.style = makeStyle();
    this.listeners = new Map();
    this.parentNode = null;
    this.className = '';
    this.value = '';
    this.title = '';
    this.isContentEditable = false;
    this._text = '';
    const self = this;
    this.dataset = new Proxy({}, {
      get: (_, key) => {
        const attr = kebab(key);
        return attr in self.attributes ? self.attributes[attr] : undefined;
      },
      set: (_, key, value) => { self.setAttribute(kebab(key), value); return true; },
      deleteProperty: (_, key) => { self.removeAttribute(kebab(key)); return true; },
      has: (_, key) => kebab(key) in self.attributes
    });
  }
  get textContent() { return this._text; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get firstChild() { return this.children[0] || null; }
  appendChild(node) { this.children.push(node); node.parentNode = this; return node; }
  remove() {
    if (!this.parentNode) return;
    const i = this.parentNode.children.indexOf(this);
    if (i >= 0) this.parentNode.children.splice(i, 1);
    this.parentNode = null;
  }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  dispatch(type, event = {}) {
    (this.listeners.get(type) || []).slice().forEach((fn) => fn(event));
  }
  querySelectorAll(selector) { return descendants(this).filter((n) => matches(n, selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    let node = this;
    while (node) {
      if (matches(node, selector)) return node;
      node = node.parentNode;
    }
    return null;
  }
}

function descendants(root) {
  const out = [];
  const walk = (node) => { node.children.forEach((child) => { out.push(child); walk(child); }); };
  walk(root);
  return out;
}

/** 支持 `tag`、`[attr]`、`[attr="v"]`、`[attr^="v"]` 及其串联。 */
function matches(node, selector) {
  const m = /^([a-z]*)((?:\s*\[[a-z-]+(?:\^?="[^"]*")?\])+)$/.exec(String(selector).trim());
  if (!m) return false;
  if (m[1] && node.tagName !== m[1].toUpperCase()) return false;
  const clauses = m[2].match(/\[[^\]]+\]/g) || [];
  return clauses.every((clause) => {
    const inner = clause.slice(1, -1);
    let mm = /^([a-z-]+)\^="([^"]*)"$/.exec(inner);
    if (mm) {
      const value = node.getAttribute(mm[1]);
      return typeof value === 'string' && value.startsWith(mm[2]);
    }
    mm = /^([a-z-]+)="([^"]*)"$/.exec(inner);
    if (mm) return node.getAttribute(mm[1]) === mm[2];
    mm = /^([a-z-]+)$/.exec(inner);
    if (mm) return node.getAttribute(mm[1]) !== null;
    return false;
  });
}

function makeDocument() {
  const head = new MockNode('head');
  const body = new MockNode('body');
  const documentElement = new MockNode('html');
  documentElement.lang = 'zh-CN';   // 模拟 dsh-client-locale 写入的 <html lang>
  documentElement.appendChild(head);
  documentElement.appendChild(body);
  const docListeners = new Map();
  return {
    head,
    body,
    documentElement,
    createElement: (tag) => new MockNode(tag),
    querySelector: (sel) => descendants(documentElement).find((n) => matches(n, sel)) || null,
    querySelectorAll: (sel) => descendants(documentElement).filter((n) => matches(n, sel)),
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = docListeners.get(type) || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    dispatch(type, event = {}) { (docListeners.get(type) || []).slice().forEach((fn) => fn(event)); },
    listenerCount(type) { return (docListeners.get(type) || []).length; }
  };
}

class MockMutationObserver {
  constructor(callback) { this.callback = callback; this.disconnected = false; }
  observe() {}
  disconnect() { this.disconnected = true; }
}

function makeLocalStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    _map: map
  };
}

/** 加载真实 bundle，返回 { plugin, window, document, storage, observers }。 */
function loadBundle(options = {}) {
  const document = makeDocument();
  const storage = makeLocalStorage(options.seed || {});
  const winListeners = new Map();
  const observers = [];
  const window = {
    document,
    localStorage: storage,
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = winListeners.get(type) || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    dispatchStorage(event) { (winListeners.get('storage') || []).slice().forEach((fn) => fn(event)); },
    windowListenerCount(type) { return (winListeners.get(type) || []).length; }
  };
  window.window = window;

  const registrations = [];
  window.__ModuleLoader__ = { load(entry) { registrations.push(entry); } };

  const sandbox = {
    window,
    document,
    console,
    setTimeout,
    clearTimeout,
    navigator: { platform: options.platform || 'MacIntel', userAgent: 'node' },
    MutationObserver: class extends MockMutationObserver {
      constructor(cb) { super(cb); observers.push(this); }
    }
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: BUNDLE });

  assert.equal(registrations.length, 1, 'bundle 只应注册一个 ModuleLoader 条目');
  const reactStub = {
    createElement: (type, props, children) => ({ type, props, children }),
    useState: (init) => [init, () => {}],
    useEffect: () => {}
  };
  const requireStub = (name) => {
    if (name === 'react') return reactStub;
    if (name === '@deepseek-ai/dsh-client-ui-primitives') {
      return { MenuItemButton: function MenuItemButton() { return null; } };
    }
    throw new Error('unexpected require: ' + name);
  };
  const plugin = registrations[0].factory(requireStub);
  return { entry: registrations[0], plugin, window, document, storage, observers };
}

/** 造一行会话 DOM：结构与 DSH 一致（slot + title + time）。 */
function addRow(document, sessionId, extras = {}) {
  const row = document.createElement('div');
  row.setAttribute('data-row-key', 'session:' + sessionId);
  row.setAttribute('role', 'treeitem');
  row.setAttribute('aria-selected', extras.selected ? 'true' : 'false');
  const slot = document.createElement('span');
  const title = document.createElement('span');
  title.textContent = extras.title || '会话 ' + sessionId;
  const time = document.createElement('span');
  time.textContent = '刚刚';
  row.appendChild(slot);
  row.appendChild(title);
  row.appendChild(time);
  (extras.host || document.body).appendChild(row);
  return { row, slot, title, time };
}

/** apply() 用的 ctx 桩：记录注册与 effect。 */
function makeCtx() {
  const registered = [];
  const injections = [];
  const effects = [];
  const ctx = {
    slots: {
      inject(name, callback) {
        injections.push(name);
        const disposer = callback();
        return () => { if (typeof disposer === 'function') disposer(); };
      },
      register(options, component) {
        registered.push({ options, component });
        return () => {};
      }
    },
    effect(fn, label) {
      const cleanup = fn();
      effects.push({ label, cleanup });
      return () => { if (typeof cleanup === 'function') cleanup(); };
    }
  };
  return { ctx, registered, injections, effects };
}

function keyEvent(over = {}) {
  return Object.assign({
    key: 's', metaKey: true, ctrlKey: false, shiftKey: true,
    defaultPrevented: false, target: null,
    preventDefault() { this.defaultPrevented = true; }
  }, over);
}

// ---------------------------------------------------------------------------
// 用例
// ---------------------------------------------------------------------------

test('模块形状：id 等于包名、平铺导出 apply/inject、没有 default', () => {
  const { entry, plugin } = loadBundle();
  assert.equal(entry.id, '__PKG__', 'ModuleLoader id 必须等于 package.json 的 name');
  assert.equal(typeof entry.factory, 'function');
  assert.equal(typeof plugin.apply, 'function');
  assert.deepEqual([...plugin.inject], ['slots']);
  assert.equal(plugin.default, undefined, '不要 export default（会丢 inject）');
});

test('import 期间零副作用：不碰 DOM、不挂全局', () => {
  const { window, document } = loadBundle();
  assert.equal(document.querySelector('style[data-plugin-css="__PKG__/style"]'), null);
  assert.equal(window.__GLOBAL__, undefined);
  assert.equal(document.listenerCount('keydown'), 0);
});

test('apply()：样式表带 data-plugin、注册插槽、装快捷键与 storage 监听、挂调试全局', () => {
  const { plugin, window, document } = loadBundle();
  const { ctx, registered, injections } = makeCtx();
  plugin.apply(ctx);

  const tag = document.querySelector('style[data-plugin-css="__PKG__/style"]');
  assert.ok(tag, '样式表必须存在');
  assert.equal(tag.dataset.plugin, '__PKG__', '必须自己打 data-plugin，否则会被别的插件认领');

  assert.deepEqual(injections, ['sidebar.session.row.leading', 'sidebar.workspaces.session.menu.item']);
  assert.equal(registered.length, 2);
  assert.equal(registered[0].options.id, '__PKG__:dot');
  assert.equal(registered[1].options.order, 350);

  assert.equal(document.listenerCount('keydown'), 1);
  assert.equal(window.windowListenerCount('storage'), 1);
  assert.ok(window.__GLOBAL__, '调试全局应挂出');
  assert.equal(window.__GLOBAL__.storageKey, '__PKG__.v1');
});

test('apply() 幂等：重复装载不会插入第二张样式表', () => {
  const { plugin, document } = loadBundle();
  plugin.apply(makeCtx().ctx);
  plugin.apply(makeCtx().ctx);
  assert.equal(document.querySelectorAll('style[data-plugin-css="__PKG__/style"]').length, 1);
});

test('标记状态：toggle / setMarked / isMarked', () => {
  const { plugin } = loadBundle();
  const I = plugin.__internals;
  assert.equal(I.isMarked('s1'), false);
  assert.equal(I.toggle('s1'), true);
  assert.equal(I.isMarked('s1'), true);
  assert.equal(I.toggle('s1'), false);
  assert.equal(I.isMarked('s1'), false);
  assert.equal(I.setMarked('', true), false, '空 id 不该产生状态');
});

test('行标注：标记 -> 行属性；取消后摘掉；未标记的行与非会话行零改动', () => {
  const { plugin, document } = loadBundle();
  const I = plugin.__internals;
  const a = addRow(document, 's1');
  const b = addRow(document, 's2');
  const ws = document.createElement('div');
  ws.setAttribute('data-row-key', 'workspace:w1');
  document.body.appendChild(ws);

  I.setMarked('s1', true);
  assert.equal(a.row.getAttribute('data-__SLUG__'), '1');
  assert.equal(b.row.getAttribute('data-__SLUG__'), null, '未标记的行一个字节都不动');
  assert.equal(ws.getAttribute('data-__SLUG__'), null, '工作区行不该被标注');

  I.setMarked('s1', false);
  assert.equal(a.row.getAttribute('data-__SLUG__'), null, '取消后要摘掉');
});

test('行标注：archived / 运行中的行照样生效（不依赖插槽）', () => {
  const { plugin, document } = loadBundle();
  const archived = addRow(document, 'a1');
  const running = addRow(document, 'r1');
  const I = plugin.__internals;
  I.setMarked('a1', true);
  I.setMarked('r1', true);
  assert.equal(I.annotateRows(), 2);
  assert.equal(archived.row.getAttribute('data-__SLUG__'), '1');
  assert.equal(running.row.getAttribute('data-__SLUG__'), '1');
});

test('快捷键：⌘⇧S 与 Ctrl+Shift+S 都能切换当前会话；输入框与组字期间不抢键', () => {
  const mac = loadBundle();
  mac.plugin.apply(makeCtx().ctx);
  addRow(mac.document, 's1', { selected: true });
  assert.equal(mac.plugin.__internals.currentSessionId(), 's1');
  mac.document.dispatch('keydown', keyEvent());
  assert.equal(mac.plugin.__internals.isMarked('s1'), true, 'mac 上 ⌘⇧S 应生效');

  const win = loadBundle({ platform: 'Win32' });
  win.plugin.apply(makeCtx().ctx);
  addRow(win.document, 's1', { selected: true });
  assert.equal(win.window.__GLOBAL__.hotkey, 'Ctrl+Shift+S');
  win.document.dispatch('keydown', keyEvent({ metaKey: false, ctrlKey: true }));
  assert.equal(win.plugin.__internals.isMarked('s1'), true, 'Windows/Linux 上 Ctrl+Shift+S 应生效');

  // 不抢键的三种情形：断言「状态没被改动」，而不是断言某个固定值
  const before = win.plugin.__internals.isMarked('s1');
  const input = win.document.createElement('textarea');
  win.document.body.appendChild(input);
  win.document.dispatch('keydown', keyEvent({ metaKey: false, ctrlKey: true, target: input }));
  assert.equal(win.plugin.__internals.isMarked('s1'), before, '可编辑元素里不该抢键');

  win.document.dispatch('keydown', keyEvent({ metaKey: false, ctrlKey: true, isComposing: true }));
  win.document.dispatch('keydown', keyEvent({ metaKey: false, ctrlKey: true, keyCode: 229 }));
  assert.equal(win.plugin.__internals.isMarked('s1'), before, '输入法组字期间不该抢键');
  assert.equal(before, true, '前置条件：此时确实处于已标记状态');
});

test('持久化：写盘 -> 读回一致；坏数据与非法条目被丢弃', () => {
  const { plugin, storage } = loadBundle();
  const I = plugin.__internals;
  I.setMarked('s1', true);
  I.setMarked('s2', true);
  assert.equal(I.saveMarks(), true);
  assert.match(storage.getItem('__PKG__.v1'), /"version":1/);

  I.setMarkedRaw(Object.create(null));
  I.loadMarks();
  assert.deepEqual(Object.keys(I.getMarked()).sort(), ['s1', 's2']);

  const polluted = I.parse(JSON.stringify({ version: 1, ids: ['ok', 7, null, ''] }));
  assert.deepEqual(Object.keys(polluted), ['ok'], '非法条目应被丢弃');
  assert.equal(Object.keys(I.parse('{not json')).length, 0, '坏 JSON 不该抛错');
  assert.equal(Object.keys(I.parse(null)).length, 0);
});

test('多标签页：storage 事件后重新读取并重绘', () => {
  const { plugin, document, window, storage } = loadBundle();
  plugin.apply(makeCtx().ctx);
  const { row } = addRow(document, 's9');
  storage.setItem('__PKG__.v1', JSON.stringify({ version: 1, ids: ['s9'] }));
  window.dispatchStorage({ key: '__PKG__.v1' });
  assert.equal(row.getAttribute('data-__SLUG__'), '1');

  plugin.__internals.setMarked('s9', false);
  window.dispatchStorage({ key: 'something-else' });
  assert.equal(row.getAttribute('data-__SLUG__'), null);
});

test('文案跟随 <html lang>：中文 / English', () => {
  const { plugin, document } = loadBundle();
  assert.equal(plugin.__internals.currentLang(), 'zh');
  assert.equal(plugin.__internals.t('mark'), '标记');
  document.documentElement.lang = 'en-US';
  assert.equal(plugin.__internals.currentLang(), 'en');
  assert.equal(plugin.__internals.t('mark'), 'Mark');
  document.documentElement.lang = '';
  assert.equal(plugin.__internals.currentLang(), 'en', '读不到语言时回退英文');
});

test('dispose()：样式表、全局、observer、监听器全部清理', () => {
  const { plugin, window, document, observers } = loadBundle();
  const { ctx, effects } = makeCtx();
  plugin.apply(ctx);
  assert.equal(observers.length, 1);
  assert.equal(observers[0].disconnected, false);
  effects[0].cleanup();
  assert.equal(document.querySelector('style[data-plugin-css="__PKG__/style"]'), null);
  assert.equal(window.__GLOBAL__, undefined);
  assert.equal(observers[0].disconnected, true);
  assert.equal(document.listenerCount('keydown'), 0);
  assert.equal(window.windowListenerCount('storage'), 0);
});

test('CSS：只用稳定钩子、不碰哈希类名', () => {
  const { plugin } = loadBundle();
  const css = plugin.__internals.CSS;
  assert.match(css, /\[data-row-key\^="session:"\]/);
  assert.doesNotMatch(css, /_[A-Za-z0-9-]{4,}_/, '不应出现打包生成的哈希类名');
  assert.match(css, /dsh-__SLUG__-/, '插件类名带自己的前缀，避免和 DSH 撞');
});
