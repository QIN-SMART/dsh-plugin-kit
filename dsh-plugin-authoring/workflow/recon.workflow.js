// DSH workflow 脚本：插件开发前的并行契约侦察。
//
// 用法：把本文件**整个内容**作为 `workflow` 工具的 script 传入，args 形如
//   { "outDir": "/abs/path/to/recon", "plugin": "dsh-my-plugin", "goal": "在侧边栏会话行加一个标记" }
//
// 三条线并行：
//   1. contract     —— 挂载点、插槽、稳定 DOM 钩子、宿主服务
//   2. platform     —— Windows/macOS 桌面版差异（拖拽区、快捷键、输入法、行结构）
//   3. distribution —— 安装/发布路径是否可行（peer 兼容、github:/npm 安装、市场发现）
//
// 关键设计（踩过的坑）：每个子代理**必须边查边把结论写进 outDir 下的文件**，
// 因为一次 transport 错误就会让整轮失败、最终报告永远不落地（见 pitfalls §G1）。
// 返回的 schema 只是索引；真正的产物是文件。

const outDir = (args && args.outDir) || '.recon'
const plugin = (args && args.plugin) || 'the new plugin'
const goal = (args && args.goal) || 'a new DSH client plugin'

const COMMON = `你在为 DSH 插件开发做只读侦察（不要修改任何文件，除非是写你的报告）。
DSH 版本目录通常在 ~/.nvm/versions/node/*/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/ 下；
也可以看 ~/.dsh/profiles/web/node_modules/ 里的第三方插件。
插件目标：${goal}（包名 ${plugin}）。

**重要**：边查边把结论写进文件 ${outDir}/<你的文件名>.md（用 write 工具，先写骨架再逐步补），
不要只在最后一次性汇报——本轮一旦因传输错误失败，未写盘的内容就永久丢失。
报告要写成「结论 + 证据（文件:行号或命令输出）」，不要写推测。最后按 schema 返回摘要。`

phase('侦察')

const lines = [
  {
    key: 'contract',
    file: 'contract.md',
    prompt: `${COMMON}
你的文件名：contract.md
任务：找出这个功能应该挂在哪里、怎么挂。
必须回答：
1. 有没有官方插槽可用？列出候选（名称、形状、owner props、order 竞争），从 dsh-client-ui-slots 的 slot 声明与 dsh-client-ui-sidebar/workspace 的 register 调用里取证。
2. 没有插槽时，有没有稳定的 DOM 钩子（data-*、role、aria-*）？给出选择器与证据。
3. 宿主有没有现成服务/API 可复用（ctx.<service>、rpc、shortcuts、store）？给出调用形态。
4. 有什么降级/边界语义（不渲染、archived、空白会话、多标签页）？`
  },
  {
    key: 'platform',
    file: 'platform.md',
    prompt: `${COMMON}
你的文件名：platform.md
任务：找出 Windows/macOS 桌面版与普通 Web 的差异，以及会踩到哪些坑。
必须回答：
1. [data-windows-titlebar] / [data-platform] 这类平台属性会改变哪些结构（用具体文件:行号取证），会话行本身受影响吗？
2. 打算用的快捷键组合在 DSH 里是否已被占用（去 shortcuts 目录的默认绑定里查物理 code）？Mac/Windows 桌面版的原生拦截会有什么影响？
3. 输入法组字、AltGraph、可编辑元素的守卫，DSH 自己是怎么写的？
4. 浮层/固定定位元素在桌面版要注意什么（窗口拖拽区等）？`
  },
  {
    key: 'distribution',
    file: 'distribution.md',
    prompt: `${COMMON}
你的文件名：distribution.md
任务：确认这个插件能被别人装上、并且能被发现。
必须回答：
1. package.json 需要哪些字段才能通过 DSH 的兼容性检查（evaluatePluginCompatibility 到底比对什么）？写/不写 peerDependencies 的后果。
2. 别人用 github:<user>/<repo> 与 npm 名安装分别会经过什么路径？仓库根是否必须是包根？files 白名单会影响什么？
3. 内置/常见的插件市场是怎么发现插件的（搜索来源、是否按 topic 过滤、排序）？要让插件被搜到，仓库描述/topics/keywords 该怎么写？
4. 有没有已知的发布阻塞点（2FA、空仓库、网络域名差异）？`
  }
]

const results = await parallel(lines.map((line) => () => agent(line.prompt, {
  label: `recon:${line.key}`,
  phase: '侦察',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      file: { type: 'string', description: '写好的报告文件绝对或相对路径' },
      summary: { type: 'string', description: '三五句话的结论摘要' },
      findings: { type: 'array', items: { type: 'string' }, description: '带证据的关键结论' },
      blockers: { type: 'array', items: { type: 'string' }, description: '会让实现翻车的硬约束' }
    },
    required: ['file', 'summary', 'findings', 'blockers']
  }
})))

log(`侦察完成：${results.filter(Boolean).length}/${lines.length} 条线成功`)

return {
  outDir,
  plugin,
  goal,
  lines: results.map((r, i) => r
    ? { key: lines[i].key, ok: true, file: r.file, summary: r.summary, blockers: r.blockers, findings: r.findings }
    : { key: lines[i].key, ok: false, note: '该条线失败——看它是否已经把部分结论写进了 outDir' })
}
