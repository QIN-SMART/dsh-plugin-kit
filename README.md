# dsh-plugin-kit

把「写一个 DSH 插件，从想法到开源上架」固化成可复用的 **skill + 模板 + 工具 + 踩坑库**。

不是一个插件，是一套方法：**知识在 Markdown 里，自动化在零依赖 Node 脚本里**，所以 DSH、Codex、Claude Code、Cursor 都能用同一份。

```
dsh-plugin-kit/
  dsh-plugin-authoring/         ← skill 本体（DSH 与 Codex 都软链这一份）
    SKILL.md                      七个阶段 + 12 条硬规则 + 交付标准
    references/                   契约速查 · 踩坑库 · 验收清单 · 发布手册
    template/                     一个新插件仓库的骨架（17 个文件，生成即全绿）
    tools/                        脚手架 · 跨宿主校验器
    workflow/                     并行侦察脚本（DSH workflow）
  share/share.mjs              ← 多宿主共享层管理（一份真身，多个入口）
```

## 快速开始

```sh
git clone https://github.com/QIN-SMART/dsh-plugin-kit
cd dsh-plugin-kit

# 1) 接入 DSH（热监听，免重启）
ln -sfn "$PWD/dsh-plugin-authoring" ~/.dsh/skills/dsh-plugin-authoring

# 2) 接入 Codex（格式相同，可共用同一份）
ln -sfn "$PWD/dsh-plugin-authoring" ~/.codex/skills/dsh-plugin-authoring

# 3) 生成一个新插件
node dsh-plugin-authoring/tools/new-plugin.mjs \
  --dir ~/Documents/test/dsh-my-plugin --name dsh-my-plugin \
  --title-zh "我的插件" --title-en "My Plugin" \
  --desc-zh "一句话中文说明" --desc-en "One line in English" \
  --author <你的 GitHub 用户名>

cd ~/Documents/test/dsh-my-plugin
node --test test/verify.mjs        # 生成即全绿（13 项，不用改任何东西）
```

之后在 DSH 里用 `/dsh-plugin-authoring` 调用这套方法，在 Codex 里用 `$dsh-plugin-authoring`。

## 里面有什么

| 文件 | 作用 |
|---|---|
| `dsh-plugin-authoring/SKILL.md` | 主指令：**七个阶段**（定义 → 侦察 → 脚手架 → 实现 → 自测 → 文档 → 发布）+ 12 条硬规则 + 交付标准 |
| `references/contracts.md` | DSH 客户端插件契约速查：包结构、ModuleLoader、插槽表、稳定 DOM 钩子、设计令牌、宿主侧能力 |
| `references/pitfalls.md` | **踩坑库**：每条都写全「症状 → 原因 → 正确写法 → 怎么验证」，覆盖模块与加载、样式、插槽、元数据、安装、发布、协作、多宿主共享 |
| `references/checklist.md` | 四张验收清单：实现 / 测试 / 开源就绪 / 上架后（"外人视角"真装一次） |
| `references/publish.md` | 发布手册：GitHub REST API 路径（含空仓库引导）、npm 2FA 的两种活法、发布后传播延迟 |
| `template/` | 能跑、能测、能发的插件骨架：真实可用的最小客户端插件 + mock-DOM 自测 + CI 矩阵 + 双语 README + 图标/locale + 发布脚本 |
| `tools/new-plugin.mjs` | 脚手架：按包名生成骨架并替换所有标识符（自动跳过 `.tmp` / `node_modules` 残留） |
| `tools/validate-skill.mjs` | 跨宿主校验器：同一份 SKILL.md 要同时通过 DSH 与 Codex 的规则（**照抄两边真实实现**，含"创作时校验"与"加载时校验"的区别） |
| `workflow/recon.workflow.js` | DSH `workflow` 脚本：并行三路侦察（契约 / 平台差异 / 分发路径），每个子代理边查边写结论 |
| `share/share.mjs` | 多宿主共享层：一份真身 + 每个宿主一条软链，还能审计"依赖宿主专有工具的 skill 不该共享" |

## 七阶段流水线

| 阶段 | 做什么 | 工具 |
|---|---|---|
| 0 定义 | 一句话产品描述；外观类插件先出可交互样例让人选 | `visualize` |
| 1 侦察 | 挂载点在哪个插槽/稳定钩子？会不会降级？平台差异？ | `references/contracts.md`、`workflow/recon.workflow.js` |
| 2 脚手架 | 生成骨架 | `tools/new-plugin.mjs` |
| 3 实现 | 全部行为写进 `lib/client.js`；硬规则逐条对照踩坑库 | — |
| 4 验证 | 离线断言 + 真实 GUI 端到端（CDP 驱动、留截图） | `node --test`、`tools/real-ui-check.mjs` |
| 5 文档 | 双语 README、CHANGELOG、CI 徽章；安装段落只写对外方式 | `references/checklist.md` |
| 6 发布 | GitHub（REST API，绕开时通时断的 github.com）+ npm | `tools/publish-to-github.mjs`、`references/publish.md` |
| 7 验收 | 在临时目录按用户命令真装一次 | `references/checklist.md` |

## 多宿主共享（一份真身，多个入口）

DSH 读 `~/.dsh/skills`，Codex 读 `~/.codex/skills`，格式相同 —— 所以**软链**就够了，不需要任何同步：

```sh
# 中央目录（默认 ~/agent-shared，可用 AGENT_SHARED_HOME 覆盖）
node share/share.mjs add ~/Documents/test/dsh-plugin-kit/dsh-plugin-authoring
node share/share.mjs status          # 链接对不对、有没有断链、哪些 skill 还没共享
node share/share.mjs audit <目录>    # 审计一批 skill：哪些依赖宿主专有工具（不该共享）
node share/share.mjs sync  <目录>    # 只同步可移植的那些
```

它还会提醒你 `~/.dsh/AGENTS.md` 与 `~/.codex/AGENTS.md` 是否指向同一份真身（项目级 `AGENTS.md` 两个宿主本来就共用同一个文件，不需要处理）。

> 记忆层**不适用**软链方案：两边都是「数据库 + 自动生成的 markdown 投影」，直接改会被各自的浓缩流程覆盖或损坏 —— 只能走"读出来 → 只抽可移植事实 → 用各家正规写入路径写回"的桥接脚本。

## 它从哪来

不是凭空写的，是从两个真实插件里长出来的：

- [`dsh-sidebar-marks`](https://github.com/QIN-SMART/dsh-sidebar-marks) —— 侧边栏对话标记（整行淡色底 + 行尾彩点 + 独立字号）；
- [`dsh-quote-to-chat`](https://github.com/QIN-SMART/dsh-quote-to-chat) —— 选中回复文字 → 浮动工具条（添加到对话 / 侧边提问 / 复制）。

两个都已在 GitHub 与 npm 发布，CI 覆盖 ubuntu / windows / macos × Node 22 / 24。踩坑库里的每一条都有真实现场，包括 `export default` 会静默吃掉 `inject`、DSH 的 hover 用 `background` 简写会重置 `background-image`、插槽会"让位"、空仓库不能用 Git Data API 建 blob、npm 2FA 与系统时钟偏差、以及长任务子代理被传输错误整轮吞掉后如何从会话日志里捞回结论。

## 验证这个仓库

```sh
# 1) skill 本身要同时被两个宿主接受
node dsh-plugin-authoring/tools/validate-skill.mjs dsh-plugin-authoring/

# 2) 模板必须真的能生成、能跑（模板坏了没人会发现，因为它不是被直接执行的代码）
node dsh-plugin-authoring/tools/new-plugin.mjs --dir .tmp/dsh-demo --name dsh-demo --desc-zh 自检
node --test .tmp/dsh-demo/test/verify.mjs
```

CI 会在 ubuntu / windows / macos × Node 22 / 24 上跑同样的两件事。

## License

MIT — 见 [LICENSE](LICENSE)。
