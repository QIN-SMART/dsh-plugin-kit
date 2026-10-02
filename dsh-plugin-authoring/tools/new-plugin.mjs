#!/usr/bin/env node
// 脚手架：从 skill/template 生成一个新插件包。
//
// 用法：
//   node tools/new-plugin.mjs --dir ~/Documents/test/dsh-my-plugin --name dsh-my-plugin \
//     --title-zh "我的插件" --title-en "My Plugin" \
//     --desc-zh "一句话中文说明" --desc-en "One line in English" \
//     --author QIN-SMART
//
// 生成后：cd <dir> && node --test test/verify.mjs 应当立刻全绿。

import { cpSync, existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = resolve(HERE, '..', 'template');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  if (!next || next.startsWith('--')) {
    console.error(`--${name} 需要一个值`);
    process.exit(2);
  }
  return next;
}

const target = arg('dir');
const name = arg('name');
if (!target || !name) {
  console.error(`用法：
  node tools/new-plugin.mjs --dir <目标目录> --name <包名> [--id <entryId>] \\
    [--title-zh 中文名] [--title-en English name] [--desc-zh 中文说明] [--desc-en English description] \\
    [--author <GitHub 用户名>]`);
  process.exit(2);
}

const valid = /^[a-z0-9][a-z0-9._-]*$/.test(name);
if (!valid) {
  console.error(`包名不合法：${name}（只允许小写字母、数字、- . _，且以字母数字开头）`);
  process.exit(2);
}

const dir = resolve(target.replace(/^~/, process.env.HOME || '~'));
const id = arg('id', name);
const slug = name.replace(/^dsh-/, '');
const globalName = '__dsh' + slug.split(/[-._]+/).filter(Boolean)
  .map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
const titleZh = arg('title-zh', slug);
const titleEn = arg('title-en', slug);
const descZh = arg('desc-zh', `${titleZh}：DSH 插件`);
const descEn = arg('desc-en', `${titleEn}: a DSH plugin`);
const author = arg('author', process.env.USER || 'your-github-user');
const year = String(new Date().getFullYear());
const force = process.argv.includes('--force');

if (existsSync(dir) && readdirSync(dir).length > 0 && !force) {
  console.error(`目标目录已存在且非空：${dir}\n（要覆盖请加 --force）`);
  process.exit(2);
}

const REPLACEMENTS = {
  __PKG__: name,
  __ID__: id,
  __SLUG__: slug,
  __GLOBAL__: globalName,
  __TITLE_ZH__: titleZh,
  __TITLE_EN__: titleEn,
  __DESC_ZH__: descZh,
  __DESC_EN__: descEn,
  __AUTHOR__: author,
  __YEAR__: year
};

// 跳过临时产物：模板目录里可能残留 .tmp（例如 real-ui-check 的 Chrome profile）、
// node_modules 或 .DS_Store，它们不该出现在新仓库里（也不该让 cpSync 因被占用而报 ENOENT）。
const SKIP = new Set(['.tmp', 'node_modules', '.git', '.DS_Store']);
mkdirSync(dir, { recursive: true });
cpSync(TEMPLATE, dir, {
  recursive: true,
  filter: (src) => !SKIP.has(src.split(sep).pop())
});

/** 递归替换占位符（只改文本文件）。 */
function substitute(current) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const full = join(current, entry.name);
    if (entry.isDirectory()) { substitute(full); continue; }
    if (/\.(png|jpg|jpeg|webp|gif|ico|woff2?)$/i.test(entry.name)) continue;
    let text = readFileSync(full, 'utf8');
    let touched = false;
    for (const [key, value] of Object.entries(REPLACEMENTS)) {
      if (text.includes(key)) { text = text.split(key).join(value); touched = true; }
    }
    if (touched) writeFileSync(full, text);
  }
}
substitute(dir);

// cordis.patch.yml 里 yml 缩进无关；把 CLI 传入的相对路径统一成绝对路径方便打印
const shown = dir.split(sep).join('/');
console.log(`✓ 已生成插件 ${name}`);
console.log(`  目录      : ${shown}`);
console.log(`  entry id  : ${id}`);
console.log(`  调试全局  : window.${globalName}`);
console.log(`  localStorage key: ${name}.v1`);
console.log(`
下一步：
  1. cd ${shown}
  2. node --test test/verify.mjs                 # 应当立刻全绿（不用改任何东西）
  3. 改 lib/client.js 与 test/verify.mjs 实现你的功能
  4. node tools/real-ui-check.mjs --global ${globalName}   # 真实 GUI 冒烟 + 截图
  5. git init && git add -A && git commit -m "feat: ${name}"
  6. GH_TOKEN=<PAT> npm run publish:github -- --release && npm publish
`);
