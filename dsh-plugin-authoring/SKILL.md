---
name: dsh-plugin-authoring
description: 从想法到开源上架的 DSH（DeepSeek Harness）插件开发流水线：客户端插件契约、模板仓库骨架、验收清单、发布脚本（GitHub REST API / npm）与踩坑库。用户说「写一个 DSH 插件」「给 DSH 加个功能/按钮/面板/外观」「把插件开源到 GitHub」「发布到 npm」，或要改动已有插件的行为、外观、安装方式时使用。
metadata:
  hosts: dsh, codex, claude-code, cursor
  note: frontmatter 只用 DSH 与 Codex 允许字段的交集（name/description/metadata/license/allowed-tools），whenToUse 属于 DSH 专有、会让 Codex 的校验器拒收
---

# DSH 插件开发流水线

一套经过完整实战（`dsh-sidebar-marks`：本地开发 → 真实 GUI 验证 → GitHub 开源 → npm 发布 → CI 全绿）的流程与素材库。
本文件是主指令；细节在 `references/`，可复制的骨架在 `template/`，工具在 `tools/`。

**这份 skill 与宿主无关**：内容全是 Markdown + 零依赖 Node 脚本，DSH（`~/.dsh/skills/`）与 Codex（`~/.codex/skills/`，格式相同）可以同时软链同一份目录。对 DSH 不熟悉的 agent 只要读 `references/`，就等价于掌握了 DSH 的客户端契约。生成出来的插件仓库还会自带 `AGENTS.md`，把这份上下文随代码一起带走。

```
dsh-plugin-authoring/
  SKILL.md                  ← 你在读的这份（流程 + 硬规则）
  references/
    contracts.md            ← DSH 客户端插件契约速查（加载器/插槽/样式/主题）
    pitfalls.md             ← 踩坑库（每条都带当年踩的现场与正确写法）
    checklist.md            ← 四个验收清单：实现 / 测试 / 开源 / 上架后
    publish.md              ← 发布手册（GitHub REST API + npm 2FA 的坑）
  template/                 ← 一个新插件仓库的骨架（可构建、可测试、可发布）
  tools/
    new-plugin.mjs          ← 脚手架：按包名从 template 生成新插件
    publish-to-github.mjs   ← 用 REST API 建仓库/推文件/打 tag/建 Release
    real-ui-check.mjs       ← CDP 驱动真实 DSH WebUI 做端到端检查并截图
  workflow/
    recon.workflow.js       ← DSH workflow 脚本：并行侦察契约 / Windows / 分发路径
```

## 七个阶段

**0. 定义插件（先问清，别急着写代码）**
- 它给用户新增什么能力？入口在哪（侧边栏行菜单 / 快捷键 / 右键 / 设置页 / 主面板）？
- 数据存哪（无状态 / localStorage / 宿主配置）？默认行为是否「与原生界面完全一致」？
- 只要一句产品描述就能开工；**外观类插件必须先出可交互样例让用户选**（见 `visualize` skill），选定再落地。

**1. 契约侦察（10 分钟，别靠猜）**
- 读 `references/contracts.md` 打底；要动侧边栏/会话/消息等具体 DOM，必须去真实包里取证（`~/.nvm/.../@deepseek-ai/dsh-*`）。
- 需要并行深挖时跑 `workflow/recon.workflow.js`（契约 / Windows / 分发三条线，各自把结论写进文件再返回——见踩坑 §协作）。
- 关键问题：挂载点在哪个插槽或哪个稳定 DOM 钩子？会不会被状态覆盖/归档降级？宿主有没有现成服务（`ctx.slots` / `ctx.shortcuts` / `ctx.get(...)`）？

**2. 脚手架**
```sh
node tools/new-plugin.mjs --dir ~/Documents/test/dsh-my-plugin --name dsh-my-plugin \
  --title-zh "我的插件" --title-en "My Plugin" --desc-zh "一句话说明" --desc-en "One line" \
  --author <你的 GitHub 用户名>
```
生成即包含：`package.json`（无 `@deepseek-ai/*` peer → 兼容性检查直接通过）、`cordis.patch.yml`、惰性 host 半、客户端 bundle、mock-DOM 自测、CI 矩阵、双语 README、LICENSE、图标、locale、发布与真实界面检查脚本。

**3. 实现**
- 所有浏览器侧行为写进 `lib/client.js`（lazy-CJS：顶层只注册 factory，副作用留在 `apply()`）。
- 硬规则见下节；改动前先翻 `references/pitfalls.md` 对应条目。
- 想动整行/整块的样式，优先「给行元素打 `data-*` + 注入样式表」，而不是去改 DSH 的类名。

**4. 自测 + 真实界面验证**
```sh
node --test test/verify.mjs                 # 必须全绿，且覆盖降级/清理/边界
node tools/real-ui-check.mjs --help         # CDP 驱动真实 GUI：打标记 → 截图 → 断言
```
- 单测跑在**真实产物**上（真 factory + 最小 DOM 桩），不是手搓 plain-object ctx。
- 真实 GUI 检查是"敢交付"的分界线；截图里的会话名会泄露隐私，用合成数据。

**5. 文档与展示**
- 双语 README（`README.md` + `README_EN.md`）、`CHANGELOG.md`、`LICENSE`、CI 徽章。
- 安装段落只写**对外**方式（`github:user/repo`、`npm` 名），本机绝对路径只能出现在"开发本仓库时"和占位符里。

**6. 发布**
```sh
GH_TOKEN=<PAT> npm run publish:github -- --release     # 建仓库/推文件/打 tag/建 Release
npm publish                                            # 需要 2FA OTP 或 bypass-2FA 令牌
```
细节与失败处置见 `references/publish.md`。

**7. 上架后验收（"外人视角"）**
在临时目录用**用户会用的那条命令**真装一次：`pnpm add <pkg>@<ver>` 或 `dsh plugin --profile web add github:<user>/<repo>`，并检查包内文件齐全、registry 元数据正确、CI 全绿。

## 硬规则（违反必翻车，逐条都有现场）

1. **`__ModuleLoader__.load({id})` 的 id 必须等于 `package.json` 的 name**，否则浏览器侧永远不 materialize。
2. **模块只做平铺导出** `exports.apply / exports.inject`，**不要 `export default`**：loader 的 `unwrapExports` 会用 default 替换整个命名空间，`inject` 静默丢失。
3. **凡读 `ctx.<service>` 必须先写进 `inject`**；可选依赖用 `ctx.get('name')` 或 `ctx.inject([...], cb)` 延迟注入。手搓 plain-object ctx 的测试会同时漏掉这两条。
4. **插件必须是一条 enabled 的 Loader entry**（`dsh.bundle.patch` + profile 的 `dsh.profile.bundles`）；host 半可以惰性，但不能没有。
5. **不要依赖 CSS-module 哈希类名**（`YDXeBa_sessionRow` 之类每次构建都变）。用 `[data-row-key^="session:"]`、`aria-selected`、插槽名、`<html lang>`、`body[data-ds-dark-theme]` 这些稳定钩子。
6. **DSH 的 hover/选中用 `background` 简写**，会重置 `background-image`；插件的叠加层必须 `!important`（`background-color` 不受影响，所以 hover 依然可见）。
7. **自己注入的 `<style>` 必须打 `data-plugin` / `data-plugin-css`**：loader 只在 factory 返回那一刻认领未打标的样式，apply 期间新建的否则可能被别的插件"认领"并在其卸载时删掉。
8. **宿主插槽有降级语义**：例如 `sidebar.session.row.leading` 在 archived / blank / 有状态点时根本不渲染 —— 关键信息不要只放在插槽里，行级标记要用行属性兜底。
9. **桌面版浮层要 `-webkit-app-region: no-drag`**（关闭时务必移除浮层节点，否则拖拽带永久失效）；**快捷键要躲开输入法组字**（`isComposing || keyCode === 229`，官方守卫还带一个 `ended` 标志）；**桌面版 DOM keydown 不会进 DSH 命令表**（`shortcuts/client.js:809` 的 `if (native) return`），快捷键优先用 `ctx.shortcuts.register`。
10. **清理要彻底**：`ctx.effect` 返回的 dispose 里断开 observer、清定时器、摘样式表、撤监听、关浮层、删调试全局。
11. **对外元数据三件套**：`icon`、`exports["./locale/*.json"]`、`locale/{en,zh}.json`（`meta.title/description`）—— 缺了插件列表就只剩包名和英文兜底。
12. **提交前扫一遍隐私**：截图/日志/示例数据里不能有真实会话名、路径、token。

## 交付标准（过不了不算完）

- `node --test` 全绿，且用例覆盖：模块形状、注册、幂等、清除、降级、序列化往返、坏数据、跨标签页、dispose、CSS 无哈希类名。
- 真实 GUI 里亲手（或 CDP）验证过一次，并留下截图。
- 仓库：LICENSE + 双语 README + CHANGELOG + `.github/workflows/verify.yml`（ubuntu/windows/macos × Node 22/24）+ `.gitignore`。
- 发布后：registry/GitHub 元数据正确，且**在临时目录按用户命令装成功过一次**。
- 完整清单见 `references/checklist.md`。
