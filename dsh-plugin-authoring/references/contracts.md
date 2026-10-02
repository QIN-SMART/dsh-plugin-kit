# DSH 客户端插件契约速查

面向 0.2.0-rc.1 实测；升级后请以 `~/.nvm/.../node_modules/@deepseek-ai/dsh*/`（或用户安装目录）里的实际代码为准。

## 1. 一个插件包长什么样

```
package.json          name / version / icon / exports / dsh.bundle / dsh.client
cordis.patch.yml      - insert: [{ id: <entryId>, name: <包名> }]
index.mjs             host 半（可以惰性，但必须有，否则浏览器半边不会被扫描）
lib/client.js         window.__ModuleLoader__.load({ id: '<包名>', factory })  ← 全部浏览器行为
locale/en.json        {"meta":{"title","description"}}   ← 插件列表显示用（en 是锚点）
locale/zh.json
icon.svg              相对路径、≤256 KiB、必须在包目录内
test/verify.mjs       自测（node --test，零依赖）
```

`package.json` 关键字段：

```json
{
  "name": "dsh-my-plugin",
  "type": "module",
  "main": "index.mjs",
  "icon": "./icon.svg",
  "exports": {
    ".": "./index.mjs",
    "./client": "./lib/client.js",
    "./locale/*.json": "./locale/*.json",
    "./package.json": "./package.json"
  },
  "dsh": {
    "manifestVersion": 1,
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web" }
  },
  "engines": { "node": "^22.19.0 || >=24" }
}
```

- **不要写 `@deepseek-ai/*` peerDependencies**：`evaluatePluginCompatibility` 只比对这类 peer，不写就直接通过（见踩坑 E1）。
- `dsh.client` 合法字段只有 `platform`（必填）、`inject`、`external`、`immediately`；**客户端半的路径来自 `exports["./client"]`**，不是 `dsh.client` 里的字段。
- 仓库根就是包根（`package.json` 在第一层），这样 `github:user/repo` 才装得上。

## 2. 客户端 bundle 的形状（lazy-CJS）

```js
window.__ModuleLoader__.load({
  id: 'dsh-my-plugin',           // 必须 === package.json.name
  factory: (require) => {
    var module = { exports: {} }; var exports = module.exports;
    // require 白名单（平台 seed 表）：react、react/jsx-runtime、react-dom、react-dom/client、
    // @deepseek-ai/cordis、@deepseek-ai/dsh-client-store、@deepseek-ai/dsh-client-ui-slots、
    // @deepseek-ai/dsh-client-ui-primitives、@deepseek-ai/dsh-client-ui-dockkit
    var React = require('react');

    function apply(ctx) { /* 所有副作用在这里 */ }
    exports.apply = apply;
    exports.inject = ['slots'];   // 凡要读 ctx.slots 就必须声明
    return module.exports;
  }
});
```

- **顶层只允许注册 factory**；任何 DOM 操作、定时器、观察者都放进 `apply()`。
- **不要 `export default`**（踩坑 A1）。
- 卸载：`ctx.effect(function () { return dispose; }, 'label')` —— 返回值才是清理函数。

## 3. 插槽（注册 UI 的官方通道）

```js
ctx.slots.inject('sidebar.session.row.leading', function () {
  return ctx.slots.register(
    { name: 'sidebar.session.row.leading', id: 'my-plugin:dot', order: 100 },
    Component
  );
});
```

| 插槽 | 形状 | owner props | 备注 |
|---|---|---|---|
| `sidebar.session.row.leading` | list | `{ sessionId }` | 标题左侧 16×20 格；**archived / blank / 有状态点时不渲染** |
| `sidebar.workspaces.session.menu.item` | list | `{ sessionId, displayTitle, useMenuOpenState }` | 行「…」菜单里一行；`useMenuOpenState()` 自动可用 |
| `sidebar.workspaces.session.row.action` | list | `{ sessionId, displayTitle }` | 行尾悬停按钮（只在 hover 时可见） |
| `sidebar.session.row.hover` | list | `{ sessionId }` | 行 hover 卡片里的一段 |
| `shell.overlay` | list | — | 全局浮层（对话框等） |

- `order` 升序；官方菜单项已占用 100(pin)/200(rename)/300(fork)/400(archive)。插进它们中间就用 350 这种值。
- `id` 复用已发布的 id 会替换该 cell。
- 组件重渲染靠自己订阅（`useState` + 订阅集合），别指望宿主 store。

## 4. 稳定 DOM 钩子

| 用途 | 选择器 |
|---|---|
| 会话行 | `div[role="treeitem"][data-row-key="session:<id>"]`（前缀匹配 `[data-row-key^="session:"]`） |
| 当前打开的会话 | `[data-row-key^="session:"][aria-selected="true"]` |
| 行内标题 | 行元素的第 2 个 `span`（第 1 个永远是插槽格） |
| 深色主题 | `body[data-ds-dark-theme]` |
| 界面语言 | `document.documentElement.lang`（由 `dsh-client-locale` 写入） |
| 工作区行 | `[data-row-key^="workspace:"]`（不要误标） |

**禁止**使用 CSS-module 哈希类名（`YDXeBa_sessionRow`、`_4BEzFa_*` 之类）。

## 5. 样式与令牌

- 颜色、圆角、间距一律用 DSH 设计令牌：`--dsw-alias-label-primary/secondary/tertiary/caption`、`--dsw-alias-interactive-bg-hover`、`--dsw-alias-border-l2/l3`、`--dsw-radius-sm/md/lg`、`--dsw-alias-state-business-primary`、`--dsw-specific-sidebar-fill`。
- 深色主题 = `body[data-ds-dark-theme]` 覆盖同名令牌。
- 行几何（会话行）：高 32px、`padding: 0 8px`、`border-radius: 12px`、标题 14px/20px、时间 10px。
- 叠加层必须 `!important`（踩坑 B2）；注入的 `<style>` 必须自己打 `data-plugin`（踩坑 B3）。

## 6. 宿主侧（host half）常用能力

- 惰性 host 半（只 `ctx.logger.info(...)`）足够让浏览器半边被加载。
- 持久化：客户端用 `localStorage`（官方同类插件同款）；要跨浏览器就加一个 `.volatile()` 的 entry `Config`，客户端用 `ctx.configForms.get('<entryId>')` 读写。
- 需要宿主路由/文件：`ctx.inject(['connection'], s => s.effect(() => s.connection.rpc.handle(channel, handler)))`（客户端 `ctx.connection.rpc.call`）。**不要**在 apply 里一次性 `ctx.get('connection')` 判断——它在 bundle apply 之后才 provide。
- 快捷键：本仓库用 document 级 keydown（简单、可移植）；要进 DSH 快捷键目录则用 `ctx.shortcuts.registerFixed` + `observeFixedInput`。

## 7. 版本与兼容

- 运行时版本：`@deepseek-ai/dsh` 的 `package.json.version`（0.2.0-rc.1）。
- 兼容性检查只看 `@deepseek-ai/dsh`/`@deepseek-ai/dsh-*` 的 peer，`peerDependencies` 缺失即通过。
- `engines.dsh` 目前只是声明，没有读取方。
