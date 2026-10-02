# 验收清单

复制到 issue/PR 里逐条打勾。带 `$` 的是可直接跑的命令。

## ① 实现

- [ ] `lib/client.js` 顶层只有 `__ModuleLoader__.load`，所有副作用在 `apply()` 里
- [ ] 平铺导出 `exports.apply` / `exports.inject`，没有 `export default`（踩坑 A1）
- [ ] `load({ id })` 与 `package.json.name` 一致（A2）
- [ ] 读到的每个 `ctx.<service>` 都写进了 `inject`（A3）
- [ ] 只使用稳定钩子（`data-row-key` / 插槽名 / `aria-selected` / `<html lang>`），无哈希类名（B1）
- [ ] 叠加样式 `!important`，注入样式表打了 `data-plugin` / `data-plugin-css`（B2/B3）
- [ ] 深色主题有单独色值；桌面版浮层有 `-webkit-app-region: no-drag`（B4/C3）
- [ ] 快捷键跳过输入法与可编辑元素（C4）
- [ ] 宿主插槽"让位"时有行级兜底（C1）
- [ ] `ctx.effect` 的 dispose 清理：observer / 定时器 / 样式表 / 监听 / 浮层 / 调试全局（A.硬规则 10）
- [ ] 未标记/未启用的对象**一个字节都不动**（默认与原生一致）

## ② 测试

- [ ] `$ node --test test/verify.mjs` 全绿，且用例覆盖：
  模块形状、注册、幂等、清除、未命中对象零改动、降级（archived/有状态点）、序列化往返、坏数据与旧版字段、跨标签页 storage、dispose、CSS 无哈希类名
- [ ] 平台分支两侧都测（`navigator.platform` 参数化：MacIntel / Win32），提示文案与快捷键路径都断言（C5）
- [ ] 输入法/边界：`isComposing`、`keyCode 229`、可编辑元素、无选中目标
- [ ] `$ node tools/real-ui-check.mjs` 在真实 GUI 上跑通并留截图
- [ ] 截图里的会话名是**合成数据**（G2）

## ③ 开源就绪

- [ ] `LICENSE`（MIT 等）、`CHANGELOG.md`、`README.md` + `README_EN.md`
- [ ] README 安装段落只写对外方式（`github:user/repo`、npm 包名）；本机绝对路径只出现在"开发本仓库时"且是占位符
- [ ] README 顶部有 CI 徽章；**正文不写用例数量**（G3）
- [ ] `.github/workflows/verify.yml`：`ubuntu/windows/macos × Node 22/24` 跑自测 + 清单校验
- [ ] `icon.svg` + `locale/{en,zh}.json` + `exports["./locale/*.json"]`（D1）
- [ ] `package.json` 有 `repository` / `homepage` / `bugs` / `author` / `keywords` / `engines`
- [ ] `.gitignore` 挡住临时目录与**真实界面截图**（G2）
- [ ] `$ grep -rn "/Users/\|/home/" --exclude-dir=.git .` 无本机路径
- [ ] `$ npm pack --dry-run` 看 `files` 白名单：只带运行时需要的（README/LICENSE/CHANGELOG/图标/locale/client/host/patch）

## ④ 上架后（外人视角）

- [ ] GitHub：`main` 与本地一致；tag 指向最新提交；Release 正文来自 CHANGELOG 对应版本（F3）
- [ ] CI 在 push 后触发且**全绿**（含两个 windows job）
- [ ] npm：`curl -s https://registry.npmjs.org/<pkg> | jq .dist-tags.latest` 是刚发的版本（F5：可能有 1 分钟延迟）
- [ ] registry 元数据正确：description / license / repository / keywords / readme 无本机路径
- [ ] **在临时目录按用户会用的那条命令真装一次**：
  - `$ mkdir /tmp/t && cd /tmp/t && npm init -y && pnpm add <pkg>`（或 `dsh plugin --profile web add github:<user>/<repo>`）
  - 检查 `node_modules/<pkg>/{package.json,lib/client.js,locale/zh.json,icon.svg,cordis.patch.yml}` 齐全
- [ ] 需要的话在真实 DSH 里装一次：`dsh plugin --profile web add <spec>` → 刷新页面 → 功能可见 → 卸载后 UI 干净
