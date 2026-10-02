# dsh-plugin-kit — agent 约定

这是 **DSH 插件开发工具包**：把「一个新 DSH 插件从想法到开源上架」的流程固化成 skill + 模板 + 工具 + 踩坑库。
成型于 `dsh-sidebar-marks` 的实战。

## 布局

| 路径 | 作用 |
|---|---|
| `dsh-plugin-authoring/SKILL.md` | 主指令（七个阶段 + 12 条硬规则 + 交付标准），宿主无关：DSH 与 Codex 都软链这一份 |
| `dsh-plugin-authoring/references/` | `contracts.md`（DSH 客户端契约速查）、`pitfalls.md`（37 条踩坑现场）、`checklist.md`（四张验收清单）、`publish.md`（发布手册） |
| `dsh-plugin-authoring/template/` | 新插件骨架（17 个文件，含它自己的 `AGENTS.md`） |
| `dsh-plugin-authoring/tools/` | `new-plugin.mjs`（脚手架）、`validate-skill.mjs`（跨宿主校验）、`publish-to-github.mjs`、`real-ui-check.mjs` |
| `dsh-plugin-authoring/workflow/` | `recon.workflow.js`（DSH workflow 脚本：并行侦察） |
| `tools/publish-to-github.mjs` | 本仓库自己的发布脚本（按自身位置推导仓库根；模板里那份是给新插件用的副本） |
| `share/share.mjs` | 多宿主共享层管理（软链而非同步；含"依赖宿主专有工具的 skill 不该共享"的审计） |
| `.github/workflows/verify.yml` | CI：双宿主 skill 校验 + 模板生成并自测 + 仓库卫生（禁本机绝对路径） |
| `.tmp/` | 自检产物（已 gitignore） |

## 改这个包时的规矩

1. **改了 `SKILL.md` 必须跑跨宿主校验** —— 两个宿主的 frontmatter 白名单不同，`whenToUse` 是 DSH 专有、会让 Codex 直接拒收整个 skill：
   ```sh
   node dsh-plugin-authoring/tools/validate-skill.mjs dsh-plugin-authoring/
   ```
2. **改了 `template/` 必须重新生成一次并跑测试**（模板坏了没人会发现，因为它不是被直接执行的代码）：
   ```sh
   node dsh-plugin-authoring/tools/new-plugin.mjs --dir .tmp/dsh-demo --name dsh-demo --desc-zh 自检
   cd .tmp/dsh-demo && node --test test/verify.mjs      # 期望 pass 13 / fail 0
   ```
3. 新增踩坑时，`references/pitfalls.md` 的每条都要写全「症状 → 原因 → 正确写法 → 怎么验证」，**不写推测**；有 `文件:行号` 的优先。
4. 模板里**不要留 `.tmp`、`node_modules`、`.DS_Store`**（脚手架会过滤，但别指望它兜底）。
5. 文档里的用例数量别写死（会过期），用 CI 徽章或"跑一遍看"表达。

## 相关位置

- DSH 安装：`~/.nvm/versions/node/v24.19.0/lib/node_modules/@deepseek-ai/dsh`
- skill 接入：`~/.dsh/skills/dsh-plugin-authoring` 与 `~/.codex/skills/dsh-plugin-authoring`（都是指向本目录 `dsh-plugin-authoring/` 的软链接）
- 用户级约定：`~/.dsh/AGENTS.md`、`~/.codex/AGENTS.md`
- 已上线示例插件：`~/Documents/test/dsh-sidebar-marks/plugin`（GitHub: QIN-SMART/dsh-sidebar-marks，npm: dsh-sidebar-marks）
