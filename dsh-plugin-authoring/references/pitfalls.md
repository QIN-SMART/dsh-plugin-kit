# 踩坑库

每条都是实战踩过的：**症状 → 原因 → 正确写法 → 怎么验证**。写作规范：只写有现场证据的条目，不写推测。

---

## A. 模块与加载（写下去就挂的那几条）

### A1 `export default` 会吃掉 `inject`
- **症状**：插件挂不上，日志报 `cannot get property "tools" without inject`（或任何服务读取报错）。
- **原因**：`@deepseek-ai/cordis-plugin-loader` 的 `unwrapExports` 会做 `exports = exports.default ?? exports`，一旦有 default，整个命名空间被替换，具名导出的 `inject` 被丢掉。
- **正确写法**：客户端 bundle 里只做平铺 CJS 导出
  ```js
  exports.apply = apply
  exports.inject = ['slots']
  return module.exports
  ```
  宿主半（ESM）用 `export { apply, inject, name }`，同样不要 default。
- **验证**：单测里断言 `plugin.default === undefined` 且 `[...plugin.inject]` 正确。

### A2 `ModuleLoader.load` 的 id 必须等于包名
- **症状**：浏览器控制台 `loaded without registering … via __ModuleLoader__.load`，插件所有 UI 都不出现。
- **原因**：客户端模块图的 row id 就是包名，注册 key 与之对齐才能 materialize。
- **正确写法**：`window.__ModuleLoader__.load({ id: '你的包名', factory })`，与 `package.json.name` 一字不差。
- **验证**：单测断言 `entry.id === pkg.name`；真实 GUI 里 `window.__<你的调试全局>` 是否存在。

### A3 读未声明的 `ctx.<service>` 会直接抛
- **症状**：`apply()` 抛错，连"不存在的服务名"也抛。
- **原因**：Cordis 对未注入属性读取是严格模式，`?.` 也救不了。
- **正确写法**：需要的服务写进 `inject`；真正可选的用 `ctx.get('name')`，或 `ctx.inject(['name'], scope => …)` 延迟注入（宿主侧 `connection` 就是典型：它在 bundle apply 之后才 provide）。
- **验证**：必须在**真实 cordis Context** 上跑一次 apply，手搓 plain-object ctx 会同时漏掉 A1/A3。

### A4 只用手搓 ctx 做测试 = 假绿
- **症状**：单测全绿，装到真实宿主立刻报 A1 或 A3。
- **原因**：plain-object ctx 没有 Cordis 的严格读取与 loader 的解包逻辑。
- **正确写法**：单测用 `vm` 执行**真实 bundle**、走真实 `__ModuleLoader__.load` 路径，再用桩 `require`（只桩 React 与 ui-primitives）；同时对 `apply(ctx)` 用最小 ctx 桩。
- **验证**：模板里的 `test/verify.mjs` 就是这条路，照抄。

---

## B. 样式与主题

### B1 哈希类名会变，别用它选元素
- **症状**：今天好用的选择器，DSH 一升级就失效。
- **原因**：CSS modules 生成 `YDXeBa_sessionRow` 这种 `<hash>_<local>`，构建一次一个样。
- **正确写法**：只用稳定钩子 —— `div[role="treeitem"][data-row-key="session:<id>"]`、`[data-row-key^="session:"]`、`aria-selected="true"`、`sidebar.session.row.leading` 插槽、`<html lang>`、`body[data-ds-dark-theme]`；行内第 2 个 `span` 是标题（第 1 个永远是插槽格）。
- **验证**：单测断言注入的 CSS 里不出现 `_xxxxx_` 形态的类名。

### B2 `background` 简写会吃掉你的 `background-image`
- **症状**：鼠标一悬停/一选中，插件铺的底色就消失。
- **原因**：DSH 的 hover/选中规则写的是 `background: var(--dsw-alias-interactive-bg-hover)`（简写），它会把 `background-image` 重置为 none。
- **正确写法**：叠加层用 `background-image: linear-gradient(...) !important`；`background-color` 不动，于是 hover 仍能叠加、颜色自然深一档。
- **验证**：真实 DOM 里 `getComputedStyle(row).backgroundImage` 应看到你的 gradient（模板 harness 有这项断言）。

### B3 自己注入的 `<style>` 必须自己打标
- **症状**：插件卸载后样式"还在"，或别的插件卸载时把你的样式一起删了。
- **原因**：loader 在 **factory 返回那一刻**认领所有未打标的 `<style>`；apply 期间新建的不会被认领，可能被后一个 materialize 的插件收走。
- **正确写法**：`tag.dataset.plugin = '<包名>'` + `tag.dataset.pluginCss = '<包名>/style'`，卸载时按 `data-plugin-css` 精确移除。

### B4 深色主题靠 `body[data-ds-dark-theme]`
- **症状**：深色下颜色刺眼或看不清。
- **正确写法**：把主题差写进 CSS（`body[data-ds-dark-theme] …`），把「浅色值/深色值」写成元素上的自定义属性（如 `--x-color-light` / `--x-color-dark`），切主题纯 CSS 完成，不用重绘。
- **加分项**：同一个不透明度在深色下显得更淡，自动加一档（例：浅色 10% ↔ 深色 14%）。

---

## C. 插槽与 DOM

### C1 插槽会"让位"，不要假设它总在渲染
- **症状**：对话在跑或已归档时，插件在 leading 格里的圆点消失，整条标记像丢了。
- **原因**：`sidebar.session.row.leading` 的渲染条件是 `!archived && !blank && 主状态 idle`；有状态点时渲染的是 DSH 自己的状态点。
- **正确写法**：关键信息走**行级标记**（给行元素打 `data-*` + 注入样式），插槽只放装饰性元素；两者组合，降级后信息仍在。
- **验证**：单测覆盖「archived 行 / 有状态点行」仍然被标注。

### C2 插槽 props 很少，别指望拿到上下文
- 例：`sidebar.session.row.leading` 只给 `{ sessionId }`；菜单项 slot 给 `{ sessionId, displayTitle, useMenuOpenState }`（后者由 slot 级 inject face 自动提供，不需要自己声明）。
- 需要更多信息就自己按 id 去取（`localStorage`/自己的 store）或用框架 hooks。

### C3 浮动面板在桌面版会被窗口拖拽区吃掉点击
- **症状**：Windows/macOS 桌面版，点面板顶部那条没反应（像被拖窗口）。
- **原因**：桌面版标题栏区域是 `-webkit-app-region: drag`。
- **正确写法**：浮层（面板 + 遮罩）显式声明 `-webkit-app-region: no-drag`（DSH 自己的浮层控件也这么写）。

### C4 中文输入法组字期间会误触快捷键
- **症状**：开着输入法按快捷键弹出面板。
- **正确写法**：`onKeydown` 里 `if (event.isComposing || event.keyCode === 229) return;`（与 DSH `observeComposition` 的守卫一致），并且跳过可编辑元素。
- **验证**：单测断言 `isComposing` 与 `keyCode=229` 都不触发。

### C5 平台分支要两侧都测
- **症状**：`isMac()` 分支（`⌘⇧M` vs `Ctrl+Shift+M`）从没被执行过，"CI 覆盖 Windows"名不副实。
- **正确写法**：mock 里让 `navigator.platform` 可参数化，分别以 `MacIntel` / `Win32` 载入真实产物，断言两条路径都能打开面板、提示文案正确。
- **顺带事实**（2026-10 实测）：`Ctrl+Shift+M` 未被 DSH 占用（全库绑定键空间无 `KeyM`，保留键只有 C/V/X/Z/Y/Q/H）；`[data-windows-titlebar]` 只影响侧边栏外壳与宽度，不影响会话行结构。

---

## D. 插件列表里的显示元数据

### D1 插件列表只显示包名 + 英文兜底
- **症状**：别人的插件显示「中文名 + 中文描述 + 自定义图标」，你的只有 `你的包名` 和 package.json 里的英文描述。
- **原因**：缺 `icon`、`locale/*.json`、`exports["./locale/*.json"]` 三件套。
- **正确写法**：
  ```json
  "icon": "./icon.svg",
  "exports": { "./locale/*.json": "./locale/*.json" }
  ```
  `locale/zh.json`、`locale/en.json` 各写 `{"meta":{"title":"…","description":"…"}}`（en 是解析锚点，同目录所有 `.json` 按文件名当语言 id）。
- **验证**：用 DSH 自己的读取器（在 dsh 安装目录下 import `readPluginMeta`，parentURL 指向当前 profile 的 `package.json`）应返回 `title:{en,zh}` 与 `icon: data:…` 且无 `error`。

### D2 新加的 `./locale/*.json` 出口要重启 dsh web 才生效
- **症状**：图标已经是新的，标题却还是包名、描述还是英文。
- **原因**：Node 的 ESM 解析器按目录缓存了那份 package.json（含 exports 表）；宿主进程在启动时已经解析过这个包，之后新增的出口不会重新读。
- **正确写法**：改完出口重启一次 dsh web（本地开发）；对外发布时本来就会重启，无影响。

---

## E. 安装与版本

### E1 不写 `@deepseek-ai/*` peer = 兼容性检查永远通过
- **症状**：写了 `^0.1.x` 的 peer，在 DSH 0.2 上被 fail-closed 拒绝并回滚。
- **原因**：`evaluatePluginCompatibility` 只比对 `@deepseek-ai/dsh*` peer；0.x 上 `^` 锁次版本号（`^0.1.7-rc.2` ≡ `>=0.1.7-rc.2 <0.2.0`）。没有 `peerDependencies` 字段则直接通过。
- **做法**：本地 UI 插件不需要声明 DSH peer；实在要声明用 `^0.1.7-rc.2 || ^0.2.0-rc.1`。

### E2 新装插件：宿主会就地重组，但浏览器要刷新
- **判定**：认证后请求首页，出现 `<link rel="preload" as="script" href="plugins/??…<包名>/client.js&rev=…">` 才算宿主已组合。**未认证时 /api 与 /plugins 一律 401/404，不能当成"路由不存在"的证据**（要带 cookie 做对照）。
- **例外**：极少数情况下 profile 未触发重组，重启 dsh web 才生效；排查看 `~/.dsh/dsh-web.launchd.err.log` 有没有 `<id> (<pkg>): Error:`。

### E3 `minimumReleaseAge` 不会拦住发布当天的新包
- **症状**：以为 pnpm 11 的 24 小时门槛会让刚发布的版本装不上。
- **实测**：对**首次添加**的依赖，pnpm 会自动把该版本写进 profile 的 `minimumReleaseAgeExclude`（打印 `Added 1 entry to minimumReleaseAgeExclude`）并安装 —— 实测发布后 3.2 秒装上。只有显式 `minimumReleaseAgeStrict: true` 才会真拦，那时钉版本即可。

---

## F. 发布（GitHub / npm）

### F1 空仓库不能用 Git Data API
- **症状**：`POST /repos/:o/:r/git/blobs` → `409 {"message":"Git Repository is empty."}`。
- **原因**：GitHub 要求仓库先有一次提交。
- **正确写法**：先用 **Contents API**（`PUT /repos/:o/:r/contents/<任一文件>`）落一个文件完成引导，再走 blobs → tree(带 `base_tree`) → commit → PATCH ref。`tools/publish-to-github.mjs` 已内置。

### F2 本机 `github.com` 时通时断，`api.github.com` 稳定
- **现象**：`gh auth login`（设备码/浏览器流程走 `github.com/login/*`）会卡住甚至超时；而 `api.github.com` 200/0.4s。
- **做法**：发布走 REST API（建仓库/推文件/打 tag/建 Release 全在 api 域）；`git push` 尽量别依赖。
- **排查**：`curl -m 8 -o /dev/null -w '%{http_code}' https://api.github.com/` 与 `https://github.com/` 对比。

### F3 tag 要在提交推上去之后再打，且要检查指向
- **症状**：`v0.1.0` 停在旧提交上（Release 也跟着旧）。
- **做法**：先 PATCH ref 更新 main，再创建 tag；tag 已存在且指向不同 sha 时用 `--force-tag` 删除重建（Release 随 tag 名自动跟随）。**别在第一次推送前打 tag**。

### F4 npm 2FA：OTP 还是 bypass 令牌
- **症状**：`npm publish` 报 `403 … Two-factor authentication or granular access token with bypass 2fa enabled is required`。
- **原因**：账号 2FA 为 `auth-and-writes` 时，发布必须带一次性码或使用开启 "Bypass 2FA" 的 **Granular Access Token**。
- **另一个坑**：本机时钟偏差（实测快 14 秒）会让 TOTP 被判失效 —— `--otp` 被拒 → npm 又弹窗要码 → 再次失败（`EOTP`）。先对齐系统时间，或用密码管理器/手机上的验证器取码。
- **推荐**：建 **Granular token + Bypass 2FA**，勾 `Read and write (publish and stage)`；**首次发布新包时必须选 "All packages"**（包还不存在，选不了具体包），等它上架后再回来收窄。
- **注意**：npm 已宣布 2027-01 起移除 bypass-2FA 令牌的直接发布能力，届时要迁到 stage-only 或 Trusted Publishing。

### F5 npm 新版本有传播延迟
- **现象**：`npm publish` 成功后立刻查 registry 仍是旧版本（实测前 40 秒还是 0.1.0，第 60 秒才出现 0.1.1），日志里有 `Your package is being processed`。
- **做法**：发布后轮询 `https://registry.npmjs.org/<pkg>` 的 `dist-tags.latest`，别马上断言失败。

---

## G. 协作与流程

### G1 长调研子代理会被一次传输错误整轮吞掉
- **症状**：`DeepSeek Messages transport failed`（TRANSPORT）或 `tool input is invalid JSON`（MALFORMED_RESPONSE）→ 整轮失败，子代理的最终报告永远不落地。
- **预防**：给长任务下指令时要求**边查边把结论写进工作区文件**，不要只在最后一次性汇报。
- **抢救**：子代理会话在 `~/.dsh/sessions/<workspace-slug>/<sessionId>/session.v4.jsonl.zstd`，是**多帧 zstd 拼接**（`zstdDecompressSync` 只解第一帧，要按 magic `28 B5 2F FD` 切帧逐帧解）；解出的 JSONL 里 `assistant/message` 的 `data.message.content[]` 带 reasoning 文本，结论基本都能捞回来。

### G2 截图与示例数据会泄露隐私
- **症状**：真实界面截图里带着真实会话标题/路径，一提交就公开了。
- **做法**：README 用**合成数据**的 demo 截图；真实界面截图放进仓库外的目录，并把文件名写进 `.gitignore`；提交前 `grep` 一遍本机路径与敏感字符串。

### G3 文档里的数字会过期
- **症状**：README 写着「22 个用例」，加了两个用例就变成谎言。
- **做法**：正文别写用例数量，用 CI 徽章表达实时状态；准确数字只写在版本化的 `CHANGELOG.md` 里。


---

## H. 桌面壳细节（2026-10-02 用 workflow 侦察复核，含文件:行号证据）

### H1 桌面版（macOS/Windows）的 DOM keydown 不会进 DSH 的命令表
- **证据**：`dsh-client-shortcuts/lib/client.js:809` 的 `if (native) return;`，`native` 在 `:1886` 判定（macOS/Windows 桌面 + `window.dshDesktop`）。
- **含义**：桌面版快捷键走原生 IPC，**插件把快捷键注册进 DSH 命令表不会有 DOM 效果**；反过来，插件自己挂 `document.addEventListener('keydown')` 仍然收得到浏览器事件（我们的做法），但在桌面版可能被 Electron accelerator 抢先，也可能与原生绑定冲突。
- **建议**：优先 `ctx.shortcuts.register`（把控制权交给宿主），自挂 DOM 监听时要提供关闭开关并写进文档。推荐组合：`primary+shift+KeyE`（`KeyE` 未被任何内置命令占用；`KeyA/B/F/K/N/O/P/R/T/W` 已占，`KeyC/V/X/Z/Y/Q/H` 被 `bindingIssue` 判为保留位）。

### H2 IME 守卫要带 "ended" 标志
- **证据**：DSH 官方导出 `observeComposition`（`dsh-client-ui-primitives/lib/index.js:3589-3620`）：`composing || ended || event.isComposing || event.keyCode === 229`。
- `ended` 用来吃掉「组字结束那一下迟到的 keydown」；只判 `isComposing` 会漏掉这一拍。可编辑元素判定用官方写法：`element?.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""], .xterm')`。

### H3 视口级浮层的 no-drag 有两面性
- **证据**：Windows 顶部有一条横贯全窗的 drag 伪元素带（`dsh-client-ui-layout/lib/client.js:73`，高度 `--dsh-windows-titlebar-height`，该变量只由桌面壳写成行内 style，普通 Web 下不存在 → `parseFloat` 得 `NaN`）；第三方插件 `dsh-better-sidebar` 的实测 issue：视口大小的 body 直接子元素会**取消整条窗口拖拽带**（#772「window drags worked once, then stopped」），而缺 `no-drag` 会让点击被吞（#103/#111）。
- **正确写法**：模态浮层（打开期间不希望拖窗口）用容器 `-webkit-app-region: no-drag` 即可，但必须保证**关闭时把浮层节点移除**，否则拖拽带永久失效；若希望浮层存在期间窗口仍可拖动，则改宿主的写法：容器 `-webkit-app-region: initial !important` + 内部交互元素逐个 `no-drag`（两种写法不要混用）。

### H4 `sidebar.session.row.leading` 还会被"状态点"顶掉
- **证据**：`dsh-client-ui-workspace/lib/client.js:1622` 是三元表达式——`showStatus` 为真时渲染 `SessionStatusDots`，插件注册的 leading 组件根本不挂载（不只是 archived/blank）。
- **对策同上**：行级标记兜底。顺带：`sidebar.session.row.hover` 在 `:1471` 无条件渲染（archived 行也有），要做"hover 显示明细"就用它。

### H5 折叠态与分组折叠会让行消失
- 侧边栏折叠：macOS 宽度 0、整列隐藏（`layout/client.js:240-241`）；Windows 折叠时 `panelList/regionArea/footArea` 全部 `display:none`（`sidebar/client.js:91`）。
- 分组默认只渲染 5 行（`COLLAPSED_SESSION_LIMIT=5`，`workspace/lib/client.js:2119`），其余进 `[data-row-key^="overflow:"]`。
- 退出动画的克隆行会 `removeAttribute('data-row-key')` 并 `inert`（`:1727-1729`），搜索结果行没有 `data-row-key`（`:1499-1503`）→ 扫描时不要把它们当会话行。

> 完整的复核报告（含逐条 `文件:行号`）见 `.tmp/recon/{contract,platform,distribution}.md`（由 `workflow/recon.workflow.js` 生成，`.tmp/` 不入库）。


---

## I. 多宿主共享（DSH + Codex）

### I1 「创建时校验」比「加载时校验」严得多，别拿前者当后者
- **现场**：Codex 的 `skill-creator` 里有个 `quick_validate.py`，只认 `name/description/license/allowed-tools/metadata`，多一个键就报错；于是最初以为 Codex 会自动沉淀出的那几个 skill（带 `argument-hint`）是"非法"的。
- **实测**：那些 skill 在 Codex 里一直正常工作；而 DSH 的实现（`dsh-skill-filesystem/lib/index.js:850-869`）**只致命拒绝** legacy camelCase 键（`userInvocable` / `disableModelInvocation` / `modelInvocable`，抛错并丢弃整个 skill），其他未知键**一律忽略**。所以带 `argument-hint` 的 skill 在 DSH 里也能正常加载。
- **正确写法**：判断"能不能共享"要看**加载时**规则；要写两边都不挑的新 skill，frontmatter 只用 `name` + `description`（+ `metadata`）最稳。

### I2 共享用软链，别用复制
- 一份真身（任选一个中央目录，例如 `~/agent-skills/<name>`）+ 每个宿主一条软链（`~/.dsh/skills/`、`~/.codex/skills/`），"同步"这个问题直接消失。本仓库的 `share/share.mjs` 就是干这件事的。
- 项目级 `AGENTS.md`/`CLAUDE.md` 两个宿主**原生就读同一个文件**，不需要任何处理；只有用户级的两份要软链到同一真身。
- 注意：DSH 读 `$DSH_HOME/AGENTS.md` 用的是 `stat()` + `isFile()`（**跟随软链**，见 `dsh-agent-instructions/lib/index.js:416-418`），所以软链安全。
- 反向坑：如果某个 skill 的真身还留在宿主目录里，hub 只是反向指向它，概念上就乱了 —— 用"搬迁进 hub"的方式把它扶正（本工具的 `promote`）。

### I3 记忆层不能靠软链
- DSH：`~/.mnemon/runtime/{MEMORY.md,USER.md}` 是**投影**，写入必须走 mnemon 工具；Codex：`~/.codex/memories/` 是它自己浓缩出来的（`memories_1.sqlite` 还有活进程持有 WAL）。
- 直接改这些文件会被下一次浓缩覆盖，甚至损坏数据库 → 记忆只能"读出来 → 只抽可移植事实 → 用各自正规路径写回"。


### I4 跨宿主同步 skill 前必须先审计"宿主依赖"
- **现场**：Codex 的 skill 列表看着有几十个，但绝大多数**搬过去也不能用**：
  - `artifact-template-*`（20 个）正文写的是"identify the prompt-advertised preinstalled spreadsheet capability"，依赖 Codex 的 Documents/Spreadsheets/Presentations 插件；
  - `pdf` 强制要求 Codex 专有的 `:codex-file-citation{...}` 引用语法；
  - Sites / MCP / Chrome / 电脑操作 / Excel 实时控制 / pets 依赖宿主专有工具；
  - `openai-docs`、`skill-creator`、`skill-installer`、`plugin-management` 是宿主内置能力的自引用。
- **做法**：同步前跑一次依赖审计（本工具 `share.mjs audit <目录>`），按"正文里的工具/命名空间引用"分类，只同步可移植的；`sync` 默认跳过依赖方，`--force` 才全量。
- **教训**：skill 是**指令**，它假设的工具集是宿主的。跨宿主复制的正确单位是"知识"（写作风格、LaTeX 编译流程、PDF 处理步骤），不是"绑定宿主工具的操作手册"。
- **反向检查**：审计后仍需人工确认可移植者是否真的有依赖 —— 例：`latex-compile` 正文提到 Codex，但实际只跑本地 `python3 scripts/compile_latex.py`，可用；这类要显式列进白名单。
