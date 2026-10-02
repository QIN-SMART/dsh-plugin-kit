# dsh-plugin-kit

Everything needed to take a DSH plugin **from an idea to a published open-source project**, packaged as a reusable **skill + template + tools + pitfall library**.

It is not a plugin. It is a method: **knowledge lives in Markdown, automation in dependency-free Node scripts**, so DSH, Codex, Claude Code and Cursor can all use the same copy.

```
dsh-plugin-kit/
  dsh-plugin-authoring/         ← the skill itself (DSH and Codex symlink the same directory)
    SKILL.md                      seven phases + twelve hard rules + delivery bar
    references/                   contract cheat-sheet · pitfalls · checklists · publishing
    template/                     a 17-file plugin repository skeleton that tests green on generation
    tools/                        scaffolder · cross-host skill validator
    workflow/                     parallel reconnaissance script (DSH workflow)
  share/share.mjs              ← multi-host sharing: one real copy, many entry points
```

## Quick start

```sh
git clone https://github.com/QIN-SMART/dsh-plugin-kit
cd dsh-plugin-kit

# 1) wire it into DSH (watched, no restart needed)
ln -sfn "$PWD/dsh-plugin-authoring" ~/.dsh/skills/dsh-plugin-authoring

# 2) wire it into Codex (same format, same copy)
ln -sfn "$PWD/dsh-plugin-authoring" ~/.codex/skills/dsh-plugin-authoring

# 3) generate a new plugin
node dsh-plugin-authoring/tools/new-plugin.mjs \
  --dir ~/Documents/test/dsh-my-plugin --name dsh-my-plugin \
  --title-en "My Plugin" --desc-en "One line about it" \
  --author <your-github-user>

cd ~/Documents/test/dsh-my-plugin
node --test test/verify.mjs        # 13 assertions pass immediately
```

Then invoke it as `/dsh-plugin-authoring` in DSH or `$dsh-plugin-authoring` in Codex.

## What is inside

| File | Purpose |
|---|---|
| `dsh-plugin-authoring/SKILL.md` | The method: **seven phases** (define → recon → scaffold → implement → test → document → publish) plus twelve hard rules and the delivery bar |
| `references/contracts.md` | DSH client-plugin contract: package shape, ModuleLoader, slot table, stable DOM hooks, design tokens, host-side services |
| `references/pitfalls.md` | The pitfall library — every entry records symptom → cause → correct pattern → how to verify, covering modules and loading, styling, slots, metadata, installation, publishing, collaboration and multi-host sharing |
| `references/checklist.md` | Four checklists: implementation, testing, open-source readiness, post-release ("outsider" install test) |
| `references/publish.md` | Publishing manual: the GitHub REST API path (including bootstrapping an empty repository), the two ways through npm 2FA, and registry propagation delays |
| `template/` | A working skeleton: a minimal but real client plugin with a mock-DOM test suite, CI matrix, bilingual README, icon/locale and publishing scripts |
| `tools/new-plugin.mjs` | Scaffolder: generates the skeleton for a package name and rewrites every identifier |
| `tools/validate-skill.mjs` | Cross-host validator: one SKILL.md must satisfy both DSH and Codex rules (mirrors both real implementations, including the difference between creation-time and load-time validation) |
| `workflow/recon.workflow.js` | A DSH `workflow` script: three parallel reconnaissance lines (contract / platform differences / distribution) in which every subagent writes its findings to disk as it goes |
| `share/share.mjs` | Multi-host sharing: one real copy plus a symlink per host, with an audit that refuses to share skills bound to host-only tools |

## Why it exists

It was extracted from two real plugins rather than invented:

- [`dsh-sidebar-marks`](https://github.com/QIN-SMART/dsh-sidebar-marks) — sidebar conversation marks (row tint, coloured dot, per-conversation title size);
- [`dsh-quote-to-chat`](https://github.com/QIN-SMART/dsh-quote-to-chat) — select reply text to get a floating toolbar (add to chat / ask in a side chat / copy).

Both are published on GitHub and npm, with CI on ubuntu, windows and macos across Node 22 and 24. Every pitfall entry has a real incident behind it: `export default` silently dropping `inject`, DSH's hover styles using the `background` shorthand and resetting `background-image`, slots that step aside for archived or running sessions, GitHub refusing the Git Data API on an empty repository, npm 2FA plus clock skew, and how to recover a lost subagent report from the session log after a transport failure.

## Verify this repository

```sh
# 1) the skill must satisfy both hosts
node dsh-plugin-authoring/tools/validate-skill.mjs dsh-plugin-authoring/

# 2) the template must actually generate a working plugin
#    (a broken template is invisible: it is not code that runs by itself)
node dsh-plugin-authoring/tools/new-plugin.mjs --dir .tmp/dsh-demo --name dsh-demo --desc-en selftest
node --test .tmp/dsh-demo/test/verify.mjs
```

CI runs the same two checks on ubuntu, windows and macos with Node 22 and 24.

## License

MIT — see [LICENSE](LICENSE).
