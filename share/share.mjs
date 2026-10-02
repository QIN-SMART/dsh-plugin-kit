#!/usr/bin/env node
// 多宿主共享层管理脚本：把中央目录（默认 ~/agent-shared）的 skills 与 AGENTS.md 镜像到各个 agent 宿主
// （DSH 与 Codex）。核心思路是**软链而不是同步**：一份真身，多个入口。
//
//   node share.mjs status | apply | add <源> | promote <真身> | remove <name> | audit <目录> | sync <目录>
//
// 设计原则：
//   1. 本目录（~/agent-shared）是唯一配置源，宿主目录只是镜像；
//   2. 只创建/替换**软链接**，绝不删除宿主目录里的真实文件或目录（遇到就报 BLOCKED）；
//   3. 完全幂等：重复跑不会有副作用；--dry-run 只打印。
//
// 用法：
//   node share.mjs status               # 现状：每个共享项在两个宿主的状态，以及"宿主独有"的 skill
//   node share.mjs apply [--dry-run]    # 按本目录重建宿主链接
//   node share.mjs add <真身目录>        # 把一个 skill 共享给两个宿主
//   node share.mjs remove <name>        # 取消共享（只删链接）

import { lstat, readdir, readlink, realpath, symlink, unlink, stat, mkdir } from 'node:fs/promises';
import { readFileSync as require$readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const HOME = homedir();
// 中央目录位置：默认 ~/agent-shared，可用 AGENT_SHARED_HOME 覆盖
const HUB = process.env.AGENT_SHARED_HOME ? resolve(process.env.AGENT_SHARED_HOME) : join(HOME, 'agent-shared');
const HUB_SKILLS = join(HUB, 'skills');
const HUB_AGENTS = join(HUB, 'AGENTS.md');

/** 宿主的 skill 根 + 指令文件位置。 */
const HOSTS = [
  { id: 'dsh', skills: join(HOME, '.dsh', 'skills'), agents: join(HOME, '.dsh', 'AGENTS.md') },
  { id: 'codex', skills: join(HOME, '.codex', 'skills'), agents: join(HOME, '.codex', 'AGENTS.md') }
];

// 除宿主 skill 根之外，额外扫描的候选来源（只读，仅用于提示）
const EXTRA_SOURCES = [
  { id: 'codex-memories', dir: join(HOME, '.codex', 'memories', 'skills') }
];

// ---------------------------------------------------------------------------
// Codex 依赖审计：判断一个 skill 能不能在 DSH 里真正干活。
// 依据是逐条读过的正文特征（2026-10-02 实测），不是猜测。
// ---------------------------------------------------------------------------
const CODEX_BOUND_NAMES = new Set([
  // 依赖 Codex artifact 能力（documents / spreadsheets / presentations）
  'documents', 'spreadsheets', 'presentations', 'template-creator', 'pdf',
  // 依赖 Codex 专有工具或应用内概念
  'visualize', 'control-chrome', 'control-in-app-browser', 'excel-live-control',
  'plugin-management', 'pets', 'create-pet', 'update-pet', 'imagegen',
  'openai-docs', 'review-agent', 'skill-creator', 'skill-installer',
  'texlive-runtime-installer',
  // Sites 系列
  'sites-building', 'sites-hosting', 'sites-mcp', 'sites-preview-troubleshooting'
]);
const CODEX_BOUND_SIGNALS = [
  { reason: 'Codex artifact 能力（依赖 Documents/Spreadsheets/Presentations 插件）',
    re: /artifact-template\.json|preinstalled (spreadsheet|document|presentation)|`(documents|spreadsheets|presentations|template-creator):[A-Z]/i },
  { reason: '要求 Codex 专有的 :codex-file-citation 引用语法', re: /:codex-file-citation/ },
  { reason: '依赖 Codex 专有工具（imagegen / Sites / MCP / 浏览器 / 电脑操作）',
    re: /\b(image_?gen|sites|mcp server|unified-computer-use|computer_use|control-chrome|in-app browser)\b/i },
  { reason: 'ChatGPT Work 应用内概念（pets）', re: /\b(pets?|ChatGPT Work)\b/ },
  { reason: 'Excel 桌面实时控制', re: /\bExcel\b/ },
  { reason: 'Codex 内置 skill 自引用', re: /\b(openai-docs|skill-installer|skill-creator|plugin-management|review-agent)\b/ }
];
// 少见的例外：正文提到 Codex 但实际只跑本地脚本，可以移植
const PORTABLE_OVERRIDE = new Set(['latex-compile', 'latex-doctor', 'write-like-me']);

/** @returns {{verdict:'portable'|'codex-bound', reason?:string}} */
function classify(name, text) {
  if (PORTABLE_OVERRIDE.has(name)) return { verdict: 'portable' };
  if (CODEX_BOUND_NAMES.has(name)) return { verdict: 'codex-bound', reason: '名称在已知的 Codex 专有清单里' };
  for (const signal of CODEX_BOUND_SIGNALS) {
    if (signal.re.test(text)) return { verdict: 'codex-bound', reason: signal.reason };
  }
  return { verdict: 'portable' };
}

const DRY = process.argv.includes('--dry-run');
// --adopt：当宿主位置是**真实文件**时，先备份成 <path>.pre-shared-<日期> 再改用软链。
// 默认不开：宁可 BLOCKED 也不动用户已有的真实文件。
const ADOPT = process.argv.includes('--adopt');
const C = {
  ok: (s) => `\u001b[32m${s}\u001b[0m`,
  bad: (s) => `\u001b[31m${s}\u001b[0m`,
  dim: (s) => `\u001b[2m${s}\u001b[0m`,
  bold: (s) => `\u001b[1m${s}\u001b[0m`
};

async function kindOf(path) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) return 'symlink';
    if (info.isDirectory()) return 'dir';
    if (info.isFile()) return 'file';
    return 'other';
  } catch {
    return 'absent';
  }
}

/** 链接是否指向 expect（用 realpath 比较，容忍中间软链）。 */
async function linkState(path, expect) {
  const kind = await kindOf(path);
  if (kind === 'absent') return { state: 'missing', kind };
  if (kind !== 'symlink') return { state: 'blocked', kind };
  const target = await readlink(path);
  const raw = resolve(join(path, '..'), target);
  const [gotReal, wantReal] = await Promise.all([
    realpath(raw).catch(() => raw),
    realpath(expect).catch(() => expect)
  ]);
  if (gotReal === wantReal) return { state: 'ok', kind, target };
  const broken = !existsSync(raw);
  return { state: broken ? 'broken' : 'drift', kind, target, broken };
}

async function link(path, expect, label) {
  const current = await linkState(path, expect);
  if (current.state === 'ok') {
    console.log(`  ${C.ok('=')} ${label} ${C.dim('已正确')}`);
    return true;
  }
  if (current.state === 'blocked') {
    if (current.kind === 'file' && ADOPT) {
      const stamp = new Date().toISOString().slice(0, 10);
      const backup = `${path}.pre-shared-${stamp}`;
      if (DRY) {
        console.log(`  ${C.dim('~')} ${label} 备份为 ${backup} 后改用软链 ${C.dim('(--dry-run)')}`);
        return true;
      }
      const { rename } = await import('node:fs/promises');
      await rename(path, backup);
      await symlink(expect, path);
      console.log(`  ${C.ok('+')} ${label} 原文件备份为 ${backup}，已改用软链`);
      return true;
    }
    console.log(`  ${C.bad('!')} ${label} 目标已存在且不是软链接（${current.kind}）——BLOCKED（要接管请加 --adopt）`);
    return false;
  }
  const verb = current.state === 'missing' ? '新建' : current.state === 'broken' ? '修复断链' : '纠正指向';
  if (DRY) {
    console.log(`  ${C.dim('~')} ${label} ${verb} -> ${expect} ${C.dim('(--dry-run)')}`);
    return true;
  }
  await mkdir(join(path, '..'), { recursive: true });
  if (current.state !== 'missing') await unlink(path);
  await symlink(expect, path);
  console.log(`  ${C.ok('+')} ${label} ${verb} -> ${expect}`);
  return true;
}

async function hubSkills() {
  try {
    const entries = await readdir(HUB_SKILLS, { withFileTypes: true });
    const out = [];
    for (const entry of entries) {
      const full = join(HUB_SKILLS, entry.name);
      const real = await realpath(full).catch(() => null);
      out.push({ name: entry.name, path: full, real, broken: !real });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

async function hostOnly(host) {
  let entries = [];
  try {
    entries = await readdir(host.skills, { withFileTypes: true });
  } catch {
    return [];
  }
  const shared = new Set((await hubSkills()).map((s) => s.name));
  const out = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (shared.has(entry.name)) continue;
    const info = await lstat(join(host.skills, entry.name)).catch(() => null);
    if (info?.isSymbolicLink()) continue; // 指向别处的链接，不当作"宿主独有"
    const hasSkill = existsSync(join(host.skills, entry.name, 'SKILL.md')) ||
      existsSync(join(host.skills, `${entry.name}.md`));
    if (hasSkill) out.push(entry.name);
  }
  return out;
}

/** 递归找 root 下的所有 skill 目录（含 SKILL.md 的目录）。 */
async function findSkills(root) {
  const out = [];
  async function walk(dir, depth) {
    if (depth > 6) return;
    let entries = [];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    if (existsSync(join(dir, 'SKILL.md'))) { out.push(dir); return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      await walk(join(dir, entry.name), depth + 1);
    }
  }
  await walk(resolve(root.replace(/^~/, HOME)), 0);
  return out;
}

async function cmdAudit(root) {
  if (!root) {
    console.error('用法：node share.mjs audit <包含 skill 的目录>');
    process.exit(2);
  }
  const dirs = await findSkills(root);
  if (!dirs.length) {
    console.error(`${root} 下没找到任何 SKILL.md`);
    process.exit(2);
  }
  const portable = [];
  const bound = [];
  for (const dir of dirs) {
    const name = basename(dir);
    const text = readFileSyncSafe(join(dir, 'SKILL.md'));
    const verdict = classify(name, text);
    (verdict.verdict === 'portable' ? portable : bound).push({ name, dir, reason: verdict.reason });
  }
  portable.sort((a, b) => a.name.localeCompare(b.name));
  bound.sort((a, b) => a.name.localeCompare(b.name));
  console.log(C.bold(`\n可移植（${portable.length}）——不依赖 Codex 专有工具`));
  for (const item of portable) console.log(`  ${C.ok('✓')} ${item.name}`);
  console.log(C.bold(`\n依赖 Codex（${bound.length}）——不同步`));
  for (const item of bound) console.log(`  ${C.dim('×')} ${item.name.padEnd(34)} ${C.dim(item.reason)}`);
  console.log(C.dim(`\n同步可移植的那些：node ${join(HUB, 'bin', 'share.mjs')} sync ${root}`));
  console.log('');
}

async function cmdSync(root) {
  if (!root) {
    console.error('用法：node share.mjs sync <包含 skill 的目录> [--force]');
    process.exit(2);
  }
  const force = process.argv.includes('--force');
  const dirs = await findSkills(root);
  let added = 0;
  let skipped = 0;
  for (const dir of dirs) {
    const name = basename(dir);
    const verdict = classify(name, readFileSyncSafe(join(dir, 'SKILL.md')));
    if (verdict.verdict === 'codex-bound' && !force) {
      console.log(`  ${C.dim('×')} 跳过 ${name} —— ${verdict.reason}`);
      skipped += 1;
      continue;
    }
    const entry = join(HUB_SKILLS, name);
    if (!existsSync(entry) && !DRY) {
      const real = await realpath(dir).catch(() => dir);
      await symlink(real, entry);
    }
    console.log(`  ${C.ok('+')} 共享 ${name}`);
    added += 1;
  }
  console.log(`\n新增 ${added} 个，跳过 ${skipped} 个依赖 Codex 的。`);
  await cmdApply();
}

function readFileSyncSafe(path) {
  try { return require$readFileSync(path); } catch { return ''; }
}

async function cmdStatus() {
  console.log(C.bold(`\n指令文件`));
  const skills = await hubSkills();
  console.log(`  真身 ${HUB_AGENTS} ${existsSync(HUB_AGENTS) ? C.ok('存在') : C.bad('缺失')}`);
  for (const host of HOSTS) {
    const state = await linkState(host.agents, HUB_AGENTS);
    const tag = { ok: C.ok('ok'), missing: C.bad('缺失'), broken: C.bad('断链'), drift: C.bad('指向别处'), blocked: C.bad('被真实文件占位') }[state.state];
    console.log(`  ${host.id.padEnd(6)} ${host.agents}  ${tag}`);
  }

  console.log(C.bold(`\n共享 skill（${skills.length}）`));
  for (const skill of skills) {
    const heads = [skill.broken ? C.bad('真身断链') : C.dim(skill.real)];
    for (const host of HOSTS) {
      const state = await linkState(join(host.skills, skill.name), skill.path);
      const tag = {
        ok: C.ok('ok'), missing: C.bad('缺失'), broken: C.bad('断链'),
        drift: C.bad('指向别处'),
        blocked: state.kind === 'dir' ? C.bad('真身在宿主里') : C.bad('被占位')
      }[state.state];
      heads.push(`${host.id}:${tag}`);
    }
    console.log(`  ${skill.name.padEnd(24)} ${heads.join('  ')}`);
  }

  console.log(C.bold(`\n宿主独有（未共享）`));
  const sharedNames = new Set(skills.map((s) => s.name));
  for (const host of HOSTS) {
    const only = await hostOnly(host);
    console.log(`  ${host.id}: ${only.length ? only.join(', ') : C.dim('（无）')}`);
    if (only.length) {
      only.forEach((name) => console.log(C.dim(`     → node ${join(HUB, 'bin', 'share.mjs')} add ${join(host.skills, name)}`)));
    }
  }
  for (const source of EXTRA_SOURCES) {
    let entries = [];
    try {
      entries = (await readdir(source.dir, { withFileTypes: true })).filter((e) => !e.name.startsWith('.'));
    } catch {
      continue;
    }
    const pending = [];
    for (const entry of entries) {
      if (sharedNames.has(entry.name)) continue;
      if (existsSync(join(source.dir, entry.name, 'SKILL.md'))) pending.push(entry.name);
    }
    if (pending.length) {
      console.log(`  ${source.id}: ${pending.join(', ')}`);
      pending.forEach((name) => console.log(C.dim(`     → node ${join(HUB, 'bin', 'share.mjs')} add ${join(source.dir, name)}`)));
    }
  }
  console.log('');
}

async function cmdApply() {
  console.log(C.bold(`\n指令文件`));
  let ok = true;
  for (const host of HOSTS) {
    ok = (await link(host.agents, HUB_AGENTS, `${host.id.padEnd(6)} ${host.agents}`)) && ok;
  }
  console.log(C.bold(`\n共享 skill`));
  for (const skill of await hubSkills()) {
    if (skill.broken) {
      console.log(`  ${C.bad('!')} ${skill.name} 真身断链（${skill.path}）——先在 hub 里修好，跳过`);
      ok = false;
      continue;
    }
    for (const host of HOSTS) {
      ok = (await link(join(host.skills, skill.name), skill.path, `${host.id.padEnd(6)} ${join(host.skills, skill.name)}`)) && ok;
    }
  }
  console.log(ok ? C.ok('\n完成。') : C.bad('\n有项目被跳过，见上面的 ! 行。'));
  console.log('');
  if (!DRY) await cmdStatus();
  return ok;
}

async function cmdAdd(source) {
  if (!source) {
    console.error('用法：node share.mjs add <skill 真身目录>');
    process.exit(2);
  }
  const real = await realpath(resolve(source.replace(/^~/, HOME))).catch(() => null);
  if (!real) {
    console.error(`找不到 ${source}`);
    process.exit(2);
  }
  if (!existsSync(join(real, 'SKILL.md'))) {
    console.error(`${real} 里没有 SKILL.md —— 不是一个 skill 目录`);
    process.exit(2);
  }
  const name = basename(real);
  const entry = join(HUB_SKILLS, name);
  if (!DRY && !existsSync(entry)) await symlink(real, entry);
  console.log(`${DRY ? '(dry-run) ' : ''}hub: ${entry} -> ${real}`);
  await cmdApply();
}

/**
 * promote：把"真身还在宿主目录里"的 skill 搬进 hub，再由 hub 镜像回两个宿主。
 * 之后这个 skill 只有一份真身（在 hub 里），两个宿主都是软链。
 */
async function cmdPromote(source) {
  if (!source) {
    console.error('用法：node share.mjs promote <宿主里的真实 skill 目录>');
    process.exit(2);
  }
  const from = resolve(source.replace(/^~/, HOME));
  const kind = await kindOf(from);
  if (kind !== 'dir') {
    console.error(`${from} 不是真实目录（${kind}）——promote 只处理"真身还在宿主里"的情况`);
    process.exit(2);
  }
  if (!existsSync(join(from, 'SKILL.md'))) {
    console.error(`${from} 里没有 SKILL.md`);
    process.exit(2);
  }
  const name = basename(from);
  const into = join(HUB_SKILLS, name);
  console.log(`搬迁：${from}\n   -> ${into}`);
  if (DRY) {
    console.log('(dry-run，未做任何改动)');
    return;
  }
  const existing = await kindOf(into);
  if (existing === 'symlink') await unlink(into);
  else if (existing !== 'absent') {
    console.error(`${into} 已存在且不是软链（${existing}），中止以免覆盖`);
    process.exit(2);
  }
  const { rename } = await import('node:fs/promises');
  await rename(from, into);
  console.log(`✓ 真身已迁入 hub`);
  await cmdApply();
}

async function cmdRemove(name) {
  if (!name) {
    console.error('用法：node share.mjs remove <name>');
    process.exit(2);
  }
  for (const host of HOSTS) {
    const path = join(host.skills, name);
    const state = await kindOf(path);
    if (state === 'symlink') {
      if (!DRY) await unlink(path);
      console.log(`${DRY ? '(dry-run) ' : ''}删除 ${path}`);
    }
  }
  const entry = join(HUB_SKILLS, name);
  if ((await kindOf(entry)) === 'symlink') {
    if (!DRY) await unlink(entry);
    console.log(`${DRY ? '(dry-run) ' : ''}删除 ${entry}（真身不动）`);
  }
  console.log('完成。');
}

const [command = 'status', arg] = process.argv.slice(2).filter((a) => a !== '--dry-run' && a !== '--adopt');
switch (command) {
  case 'status': await cmdStatus(); break;
  case 'apply': process.exit((await cmdApply()) ? 0 : 1); break;
  case 'add': await cmdAdd(arg); break;
  case 'promote': await cmdPromote(arg); break;
  case 'audit': await cmdAudit(arg); break;
  case 'sync': await cmdSync(arg); break;
  case 'remove': await cmdRemove(arg); break;
  default:
    console.error(`未知命令：${command}（可用：status / apply / add / remove）`);
    console.error('可用命令：status / apply / add <源> / promote <宿主真身> / remove <name>');
    console.error('          audit <目录>（审计 Codex 依赖）/ sync <目录>（只同步可移植的，--force 全同步）');
    console.error('可选：--dry-run 只看不改；apply --adopt 接管宿主位置的真实**文件**（先备份）');
    process.exit(2);
}
