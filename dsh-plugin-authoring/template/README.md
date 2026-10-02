# __PKG__

__DESC_ZH__

[English](README_EN.md) · 零运行时依赖 · 自测零依赖（`node --test`）

![verify](https://github.com/__AUTHOR__/__PKG__/actions/workflows/verify.yml/badge.svg)

## 安装

```sh
# 从 GitHub 装（推荐）
dsh plugin --profile web add github:__AUTHOR__/__PKG__

# 从 npm 装（发布后）
dsh plugin --profile web add __PKG__
```

装完刷新一次浏览器页面即可，不需要重启 dsh web。

开发本仓库时用本地链接（路径换成你自己的克隆位置）：

```sh
git clone https://github.com/__AUTHOR__/__PKG__
dsh plugin --profile web add "link:$PWD/__PKG__"
```

## 怎么用

<!-- 列出入口：行「…」菜单 / 快捷键 / 右键 / 设置页 -->

| 入口 | 操作 |
|---|---|
| 行「…」菜单 | 悬停会话行 →「…」→ **标记** |
| 快捷键 | `⌘⇧S`（Windows/Linux `Ctrl+Shift+S`）切换当前会话 |
| 右键 | 直接右键任意会话行 |

## 有什么效果

<!-- 截图放 docs/ 里，用合成数据 -->

## 实现要点

- 标记走**行级属性**（`[data-row-key^="session:"]` + 注入样式），不依赖会随版本变化的 CSS-module 哈希类名。
- 标题左侧的圆点走官方插槽 `sidebar.session.row.leading`；该格在对话运行中/已归档时不渲染，所以关键信息放在行级标记里兜底。
- 数据存 `localStorage['__PKG__.v1']`，多标签页用 `storage` 事件同步。
- 面板/文案跟随 DSH 界面语言（中文 / English）。

## 验证

```sh
node --test test/verify.mjs          # 全部用例，无依赖
```

浏览器侧：`node tools/real-ui-check.mjs --port 3080` 用 CDP 驱动真实 GUI 做冒烟检查并截图。
运行时自检：DevTools 里 `window.__GLOBAL__`。

## 发布（维护者）

```sh
GH_TOKEN=<PAT，需 repo + workflow scope> npm run publish:github -- --release
npm publish
```

细节见仓库根 `../references/publish.md`（或 DSH 的 `dsh-plugin-authoring` skill）。

## 卸载

```sh
dsh plugin --profile web remove __PKG__
```

## License

MIT — 见 [LICENSE](LICENSE)。
