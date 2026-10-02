#!/usr/bin/env node
// 跨宿主 skill 校验器：同一份 SKILL.md 要同时被 DSH 与 Codex 接受。
//
// 规则来源（都是真实实现，不是猜测）：
//   · Codex: ~/.codex/skills/.system/skill-creator/scripts/quick_validate.py
//   · DSH  : @deepseek-ai/dsh-skill-filesystem 的 README（Skill format / Roots and priority）
//
// 用法：
//   node tools/validate-skill.mjs <skill 目录或 SKILL.md 路径> [--host dsh|codex|both]
//
// 退出码 0 = 通过；1 = 有宿主会拒收（会打印具体原因）。

import { readFileSync, existsSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// 规则表
// ---------------------------------------------------------------------------

const CODEX_ALLOWED_KEYS = new Set(['name', 'description', 'license', 'allowed-tools', 'metadata']);
const CODEX_MAX_NAME = 64;
const CODEX_MAX_DESCRIPTION = 1024;

/**
 * DSH 加载时的真实规则（读 dsh-skill-filesystem/lib/index.js 得来）：
 *   · 只**致命**拒绝 legacy camelCase 调用策略键，抛错并丢弃整个 skill；
 *   · 其他未知键一律忽略（不报错），所以带 Codex 专有键（如 argument-hint）的 skill 照样能被 DSH 加载。
 */
const DSH_FATAL_LEGACY_KEYS = {
  disableModelInvocation: 'disable-model-invocation',
  modelInvocable: 'disable-model-invocation',
  userInvocable: 'user-invocable'
};
const DSH_KNOWN_KEYS = new Set([
  'name', 'description', 'whenToUse', 'metadata', 'disable-model-invocation', 'user-invocable'
]);

/** 简易 YAML frontmatter 解析（只支持顶层 key: value 与一层缩进 map）。 */
function parseFrontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return { error: '没有以 --- 开头的 YAML frontmatter' };
  const data = {};
  let current = null;
  for (const raw of m[1].split('\n')) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    const indented = /^\s+\S/.test(raw);
    const kv = /^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(raw);
    if (!kv) continue;
    const [, key, value] = kv;
    if (indented && current) {
      data[current][key] = value.replace(/^["']|["']$/g, '');
      continue;
    }
    current = key;
    if (value.trim() === '') data[key] = {};
    else data[key] = value.replace(/^["']|["']$/g, '');
  }
  return { data, body: text.slice(m[0].length) };
}

function checkCodex(fm, body, dirName) {
  const problems = [];
  const unexpected = Object.keys(fm).filter((k) => !CODEX_ALLOWED_KEYS.has(k));
  if (unexpected.length) {
    problems.push(`frontmatter 含 Codex 不认识的键 ${unexpected.join(', ')}（允许：${[...CODEX_ALLOWED_KEYS].join(', ')}）`);
  }
  const name = typeof fm.name === 'string' ? fm.name : '';
  if (!name) problems.push('缺少 name');
  else {
    if (!/^[a-z0-9-]+$/.test(name)) problems.push(`name "${name}" 必须是小写字母/数字/连字符`);
    if (name.startsWith('-') || name.endsWith('-') || name.includes('--')) problems.push('name 不能以连字符开头/结尾，也不能有连续连字符');
    if (name.length > CODEX_MAX_NAME) problems.push(`name 超过 ${CODEX_MAX_NAME} 字符`);
    if (dirName && dirName !== name) problems.push(`目录名 "${dirName}" 与 name "${name}" 不一致（Codex 按目录名定位）`);
  }
  const desc = typeof fm.description === 'string' ? fm.description.trim() : '';
  if (!desc) problems.push('缺少 description');
  else {
    if (desc.includes('<') || desc.includes('>')) problems.push('description 不能含尖括号 < >');
    if (desc.length > CODEX_MAX_DESCRIPTION) problems.push(`description 超过 ${CODEX_MAX_DESCRIPTION} 字符`);
    if (desc.startsWith('[TODO:')) problems.push('description 还是 TODO 占位符');
  }
  if (hasTodoOutsideFence(body)) problems.push('正文里有未完成的 [TODO:] 占位符（代码块外）');
  return problems;
}

function checkDsh(fm, dirName, notes = []) {
  const problems = [];
  for (const [legacy, canonical] of Object.entries(DSH_FATAL_LEGACY_KEYS)) {
    if (Object.hasOwn(fm, legacy)) {
      problems.push(`frontmatter 用了 DSH 会**致命拒绝**的旧键 "${legacy}"（会导致整个 skill 被丢弃），改用 "${canonical}"`);
    }
  }
  if (typeof fm.name !== 'string' || !fm.name) problems.push('缺少 name');
  if (typeof fm.description !== 'string' || !fm.description) problems.push('缺少 description');
  if (dirName && typeof fm.name === 'string' && dirName !== fm.name) {
    problems.push(`目录名 "${dirName}" 与 name "${fm.name}" 不一致（DSH 按目录发现）`);
  }
  const ignored = Object.keys(fm).filter((k) => !DSH_KNOWN_KEYS.has(k) && !(k in DSH_FATAL_LEGACY_KEYS));
  if (ignored.length) {
    notes.push(`DSH 会忽略这些它不认识的键：${ignored.join(', ')}（不影响加载）`);
  }
  for (const key of ['disable-model-invocation', 'user-invocable']) {
    const value = fm[key];
    if (value === undefined || typeof value === 'object') continue;
    const text = String(value).toLowerCase();
    if (!['true', 'false', 'yes', 'no', 'on', 'off', '1', '0'].includes(text)) {
      problems.push(`${key} 的值 "${value}" 不是 DSH 接受的布尔写法（true/false/yes/no/on/off/1/0）`);
    }
  }
  return problems;
}

function hasTodoOutsideFence(body) {
  let fence = null;
  let fenceLength = 0;
  for (const line of body.split('\n')) {
    const f = /^[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/.exec(line);
    if (f) {
      if (fence === null) { fence = f[1][0]; fenceLength = f[1].length; }
      else if (f[1][0] === fence && f[1].length >= fenceLength && !f[2].trim()) { fence = null; fenceLength = 0; }
      continue;
    }
    if (fence === null && /^[ ]{0,3}\[TODO:[^\n]*\][ \t]*$/.test(line)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

const target = process.argv[2];
if (!target) {
  console.error('用法：node tools/validate-skill.mjs <skill 目录 | SKILL.md> [--host dsh|codex|both]');
  process.exit(2);
}
const hostArg = process.argv.indexOf('--host');
const host = hostArg === -1 ? 'both' : process.argv[hostArg + 1];

let file = resolve(target);
if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'SKILL.md');
if (!existsSync(file)) {
  console.error(`找不到 ${file}`);
  process.exit(2);
}
const text = readFileSync(file, 'utf8');
const parsed = parseFrontmatter(text);
if (parsed.error) {
  console.error(`✗ ${parsed.error}：${file}`);
  process.exit(1);
}
const dirName = basename(dirname(file));
const fm = parsed.data;

const codexProblems = checkCodex(fm, parsed.body, dirName);
const notes = [];
const dshProblems = checkDsh(fm, dirName, notes);

console.log(`skill : ${fm.name || '(无名)'}`);
console.log(`文件  : ${file}`);
console.log(`目录  : ${dirName}`);
console.log(`键    : ${Object.keys(fm).join(', ') || '(空)'}`);
console.log(`描述  : ${(typeof fm.description === 'string' ? fm.description : '').length} 字符`);
console.log();

let failed = false;
const report = (label, problems, enabled) => {
  if (!enabled) return;
  if (problems.length === 0) {
    console.log(`✓ ${label}：通过`);
  } else {
    failed = true;
    console.log(`✗ ${label}：${problems.length} 处问题`);
    problems.forEach((p) => console.log(`   - ${p}`));
  }
};
report('Codex 创作时校验（quick_validate.py 的严格键集合）', codexProblems, host === 'both' || host === 'codex');
report('DSH 加载时校验（只致命拒绝 legacy camelCase 键）', dshProblems, host === 'both' || host === 'dsh');
if (notes.length) {
  console.log('\n说明（不影响通过）：');
  notes.forEach((n) => console.log(`   · ${n}`));
}

if (failed) {
  console.log('\n提示：两处严格度不同 —— Codex 的 **创作时** 校验器只认 name/description/license/allowed-tools/metadata，');
  console.log('      而两个宿主的 **加载时** 都宽容（DSH 只致命拒绝 userInvocable/disableModelInvocation 这类旧键）。');
  console.log('      要写一份两边都不挑的 skill，frontmatter 只用 name + description（+ metadata）最稳。');
  process.exit(1);
}
console.log('\n✓ 两个宿主都会接受这份 skill');
