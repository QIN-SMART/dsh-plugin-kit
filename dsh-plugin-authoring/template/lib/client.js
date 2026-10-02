// __PKG__ — browser half（模板骨架，可直接改成一个真插件）。
//
// 这个骨架演示了本仓库的全部硬约束，逐条都在 skill/references/pitfalls.md 里有现场：
//   1. 顶层只注册 factory（lazy-CJS）；副作用全部留在 apply() 里
//   2. `id` 必须 === package.json 的 name
//   3. 平铺导出 apply/inject，不要 export default（否则 inject 静默丢失）
//   4. 样式表自己打 data-plugin / data-plugin-css
//   5. 只用稳定 DOM 钩子（[data-row-key^="session:"]、插槽名），不碰哈希类名
//   6. 行级叠加样式用 !important（DSH 的 hover 用 background 简写会重置 background-image）
//   7. 插槽会「让位」：leading 格在 archived / blank / 有状态点时不渲染 → 关键信息放行级标记
//   8. 快捷键躲开输入法组字（isComposing / keyCode 229）与可编辑元素
//   9. ctx.effect 里彻底清理
//
// 默认行为：没被标记的会话与原生界面完全一致。

window.__ModuleLoader__.load({
  id: '__PKG__',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require('react');

    // ======================================================================
    // 一、常量
    // ======================================================================

    var STORAGE_KEY = '__PKG__.v1';
    var STYLE_TAG_ID = '__PKG__/style';
    var GLOBAL_KEY = '__GLOBAL__';
    var ROW_PREFIX = 'session:';
    /** 打开/关闭当前会话标记的快捷键（Ctrl 或 ⌘ 都可以）。 */
    var HOTKEY = { key: 's', mod: true, shift: true };

    var STRINGS = {
      zh: { mark: '标记', unmark: '取消标记', hint: '快捷键 {key} 标记当前会话' },
      en: { mark: 'Mark', unmark: 'Unmark', hint: 'Press {key} to mark the current conversation' }
    };

    /** 标记在行上的表现形式：左侧 3px 色条（换成你自己的表现即可）。 */
    var CSS = [
      '[data-row-key^="session:"][data-__SLUG__]{box-shadow:inset 3px 0 0 0 var(--dsw-alias-state-business-primary,#4176e6)}',
      '.dsh-__SLUG__-dot{display:inline-flex;align-items:center;justify-content:center;width:8px;height:8px;' +
        'border-radius:50%;background:var(--dsw-alias-state-business-primary,#4176e6)}'
    ].join('\n');

    // ======================================================================
    // 二、状态与持久化（sessionId -> true）
    // ======================================================================

    var marked = Object.create(null);
    var listeners = new Set();
    var version = 0;
    var saveTimer = null;
    var deferred = [];

    function bump() {
      version += 1;
      listeners.forEach(function (fn) {
        try { fn(version); } catch (err) { /* 单个订阅者出错不影响其它 */ }
      });
    }

    function subscribe(fn) {
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    }

    function serialize() {
      return JSON.stringify({ version: 1, ids: Object.keys(marked) });
    }

    function parse(raw) {
      var out = Object.create(null);
      if (!raw) return out;
      var data;
      try { data = JSON.parse(raw); } catch (err) { return out; }
      var ids = data && Array.isArray(data.ids) ? data.ids : [];
      ids.forEach(function (id) {
        if (typeof id === 'string' && id) out[id] = true;
      });
      return out;
    }

    function storage() {
      try { return window.localStorage || null; } catch (err) { return null; }
    }

    function loadMarks() {
      var ls = storage();
      marked = parse(ls ? ls.getItem(STORAGE_KEY) : null);
      return marked;
    }

    function saveMarks() {
      var ls = storage();
      if (!ls) return false;
      try { ls.setItem(STORAGE_KEY, serialize()); return true; } catch (err) { return false; }
    }

    function scheduleSave() {
      if (saveTimer !== null) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () { saveTimer = null; saveMarks(); }, 200);
    }

    function isMarked(sessionId) {
      return !!marked[sessionId];
    }

    function setMarked(sessionId, value) {
      if (!sessionId) return false;
      if (value) marked[sessionId] = true; else delete marked[sessionId];
      scheduleSave();
      annotateRows();
      bump();
      return isMarked(sessionId);
    }

    function toggle(sessionId) {
      return setMarked(sessionId, !isMarked(sessionId));
    }

    // ======================================================================
    // 三、行标注引擎：把状态投影到 DOM（只碰被标记的行）
    // ======================================================================

    function sessionIdOfRow(row) {
      if (!row || typeof row.getAttribute !== 'function') return null;
      var key = row.getAttribute('data-row-key') || '';
      return key.indexOf(ROW_PREFIX) === 0 ? key.slice(ROW_PREFIX.length) : null;
    }

    function annotateRows(root) {
      var host = root || (typeof document !== 'undefined' ? document : null);
      if (!host || typeof host.querySelectorAll !== 'function') return 0;
      var rows = host.querySelectorAll('[data-row-key^="' + ROW_PREFIX + '"]');
      var count = 0;
      for (var i = 0; i < rows.length; i += 1) {
        var id = sessionIdOfRow(rows[i]);
        if (isMarked(id)) {
          rows[i].setAttribute('data-__SLUG__', '1');
          count += 1;
        } else {
          rows[i].removeAttribute('data-__SLUG__');
        }
      }
      return count;
    }

    // ======================================================================
    // 四、文案与平台
    // ======================================================================

    function currentLang() {
      var lang = '';
      try {
        lang = (document.documentElement && document.documentElement.lang) || '';
        if (!lang) lang = (typeof navigator !== 'undefined' && navigator.language) || '';
      } catch (err) { lang = ''; }
      return String(lang).toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
    }

    function t(key, params) {
      var table = STRINGS[currentLang()] || STRINGS.en;
      var text = table[key] !== undefined ? table[key] : STRINGS.en[key];
      if (text === undefined) return key;
      if (params) Object.keys(params).forEach(function (k) { text = text.split('{' + k + '}').join(String(params[k])); });
      return text;
    }

    function isMac() {
      try {
        var ua = (typeof navigator !== 'undefined' && (navigator.platform || navigator.userAgent)) || '';
        return /Mac|iPhone|iPad/.test(ua);
      } catch (err) { return false; }
    }

    function hotkeyLabel() {
      return isMac() ? '⌘⇧S' : 'Ctrl+Shift+S';
    }

    // ======================================================================
    // 五、插槽组件
    // ======================================================================

    function useVersion() {
      var pair = React.useState(version);
      var setV = pair[1];
      React.useEffect(function () { return subscribe(function (v) { setV(v); }); }, []);
      return pair[0];
    }

    /** 标题左侧那格的圆点。注意：archived / blank / 有状态点时 DSH 不会挂载本组件。 */
    function LeadingDot(props) {
      useVersion();
      if (!isMarked(props.sessionId)) return null;
      return React.createElement('span', {
        className: 'dsh-__SLUG__-dot',
        'aria-hidden': 'true',
        title: t('mark')
      });
    }

    /** 行「…」菜单里的一行。useMenuOpenState 由插槽自动提供，不需要自己声明。 */
    function MarkMenuItem(props) {
      useVersion();
      var setMenuOpen = props.useMenuOpenState()[1];
      var on = isMarked(props.sessionId);
      return React.createElement(
        menuItemComponent(),
        {
          separatorBefore: true,
          onSelect: function () {
            setMenuOpen(false);
            toggle(props.sessionId);
          }
        },
        on ? t('unmark') : t('mark')
      );
    }

    /** 延迟取 ui-primitives；宿主没装它时退化成原生 button，插件不至于整个挂掉。 */
    var primitives;
    function menuItemComponent() {
      if (primitives === undefined) {
        try { primitives = require('@deepseek-ai/dsh-client-ui-primitives'); } catch (err) { primitives = null; }
      }
      if (primitives && primitives.MenuItemButton) return primitives.MenuItemButton;
      return function FallbackMenuItem(props) {
        return React.createElement('button', { type: 'button', role: 'menuitem', onClick: props.onSelect }, props.children);
      };
    }

    // ======================================================================
    // 六、快捷键与右键
    // ======================================================================

    function isEditable(target) {
      if (!target || !target.tagName) return false;
      var tag = String(target.tagName).toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      return !!target.isContentEditable;
    }

    /** 当前打开的会话 = 侧边栏里 aria-selected="true" 的那一行。 */
    function currentSessionId() {
      if (typeof document === 'undefined' || !document.querySelector) return null;
      return sessionIdOfRow(document.querySelector('[data-row-key^="' + ROW_PREFIX + '"][aria-selected="true"]'));
    }

    function onKeydown(event) {
      if (!event || event.defaultPrevented) return;
      // 输入法组字期间不抢键（Windows 中文输入法下 key 会是 "Process"、keyCode 229）
      if (event.isComposing || event.keyCode === 229) return;
      if (String(event.key || '').toLowerCase() !== HOTKEY.key) return;
      if (HOTKEY.mod && !(event.metaKey || event.ctrlKey)) return;
      if (HOTKEY.shift && !event.shiftKey) return;
      if (isEditable(event.target)) return;
      if (event.preventDefault) event.preventDefault();
      var id = currentSessionId();
      if (id) toggle(id);
    }

    // ======================================================================
    // 七、装载 / 卸载
    // ======================================================================

    function injectStyle() {
      if (document.querySelector('style[data-plugin-css="' + STYLE_TAG_ID + '"]')) return null;
      var tag = document.createElement('style');
      tag.dataset.plugin = '__PKG__';          // 必须自己打标（见 pitfalls B3）
      tag.dataset.pluginCss = STYLE_TAG_ID;
      tag.textContent = CSS;
      document.head.appendChild(tag);
      return tag;
    }

    var scanTimer = null;
    var observer = null;
    var lang = null;

    function scheduleScan() {
      if (scanTimer !== null) return;
      scanTimer = setTimeout(function () { scanTimer = null; annotateRows(); }, 80);
    }

    function startObserver() {
      if (typeof MutationObserver === 'undefined') return null;
      var target = document.body || document.documentElement;
      if (!target) return null;
      observer = new MutationObserver(function (records) {
        var langChanged = false;
        for (var i = 0; i < records.length; i += 1) {
          if (records[i].type === 'attributes' && records[i].attributeName === 'lang') langChanged = true;
        }
        if (langChanged && lang !== currentLang()) { lang = currentLang(); bump(); }
        scheduleScan();
      });
      observer.observe(target, { childList: true, subtree: true });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
      return observer;
    }

    function onStorage(event) {
      if (!event || event.key !== STORAGE_KEY) return;
      loadMarks();
      annotateRows();
      bump();
    }

    function install() {
      lang = currentLang();
      injectStyle();
      loadMarks();
      annotateRows();
      startObserver();
      document.addEventListener('keydown', onKeydown);
      if (typeof window.addEventListener === 'function') window.addEventListener('storage', onStorage);
      // 首帧后再补扫几次：React 挂载 / 会话切换后行节点会被重建
      [120, 600, 2000].forEach(function (delay) {
        var timer = setTimeout(function () { annotateRows(); }, delay);
        deferred.push(function () { clearTimeout(timer); });
      });
      window[GLOBAL_KEY] = {
        get version() { return version; },
        get ids() { return Object.keys(marked); },
        isMarked: isMarked,
        toggle: toggle,
        setMarked: setMarked,
        current: currentSessionId,
        rescan: annotateRows,
        storageKey: STORAGE_KEY,
        hotkey: hotkeyLabel()
      };
    }

    function dispose() {
      deferred.forEach(function (fn) { fn(); });
      deferred = [];
      if (scanTimer !== null) { clearTimeout(scanTimer); scanTimer = null; }
      if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null; }
      if (observer) { observer.disconnect(); observer = null; }
      document.removeEventListener('keydown', onKeydown);
      if (typeof window.removeEventListener === 'function') window.removeEventListener('storage', onStorage);
      var tag = document.querySelector('style[data-plugin-css="' + STYLE_TAG_ID + '"]');
      if (tag && tag.remove) tag.remove();
      if (window[GLOBAL_KEY]) delete window[GLOBAL_KEY];
      listeners.clear();
    }

    /**
     * 装载浏览器侧行为。
     * @param ctx 客户端 root context（`inject: ['slots']` 保证 ctx.slots 存在）。
     */
    function apply(ctx) {
      install();
      ctx.effect(function () { return dispose; }, '__PKG__: styles, row annotations, hotkey');

      ctx.slots.inject('sidebar.session.row.leading', function () {
        return ctx.slots.register(
          { name: 'sidebar.session.row.leading', id: '__PKG__:dot', order: 100 },
          LeadingDot
        );
      });

      ctx.slots.inject('sidebar.workspaces.session.menu.item', function () {
        return ctx.slots.register(
          { name: 'sidebar.workspaces.session.menu.item', id: '__PKG__:menu', order: 350 },
          MarkMenuItem
        );
      });
    }

    exports.apply = apply;
    exports.inject = ['slots'];

    // 测试用内部视图（运行时不会用到）
    exports.__internals = {
      STORAGE_KEY: STORAGE_KEY,
      STYLE_TAG_ID: STYLE_TAG_ID,
      GLOBAL_KEY: GLOBAL_KEY,
      HOTKEY: HOTKEY,
      CSS: CSS,
      STRINGS: STRINGS,
      t: t,
      currentLang: currentLang,
      hotkeyLabel: hotkeyLabel,
      isMarked: isMarked,
      setMarked: setMarked,
      toggle: toggle,
      sessionIdOfRow: sessionIdOfRow,
      annotateRows: annotateRows,
      currentSessionId: currentSessionId,
      onKeydown: onKeydown,
      serialize: serialize,
      parse: parse,
      loadMarks: loadMarks,
      saveMarks: saveMarks,
      getMarked: function () { return marked; },
      setMarkedRaw: function (next) { marked = next; },
      install: install,
      dispose: dispose,
      getVersion: function () { return version; }
    };

    return module.exports;
  }
});
