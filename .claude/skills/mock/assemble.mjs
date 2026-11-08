#!/usr/bin/env node
// Builds docs/mockups/<slug>.html from the fixed shell (docs/mockups/_shell.html) and a folder of fragments.
//   node .claude/skills/mock/assemble.mjs <fragments-dir> <out.html> "<Page Title>"
// Fragments (all optional except body.html):
//   page.css    → inserted into the shell's PAGE CSS block
//   sprite.svg  → extra <symbol> elements appended to the shell's icon sprite
//   body.html   → replaces the shell's <main class="wrap">…</main>
//   page.js     → a second <script> after the shell's fixed stepper script
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [dir, out, title] = process.argv.slice(2);
if (!dir || !out || !title) {
  console.error('usage: assemble.mjs <fragments-dir> <out.html> "<Page Title>"');
  process.exit(1);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const shellPath = join(root, 'docs/mockups/_shell.html');
const read = name => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : '');
let html = readFileSync(shellPath, 'utf8');

const replaceOnce = (pattern, replacement, label) => {
  if (!pattern.test(html)) throw new Error(`shell marker not found: ${label}`);
  html = html.replace(pattern, () => replacement);
};

// The shell's instruction comment is for authors, not readers of a finished page.
html = html.replace(/^<!--[\s\S]*?-->\n/, '');
replaceOnce(/<title>[^<]*<\/title>/, `<title>${title}</title>`, 'title');
replaceOnce(/(\/\* ===== PAGE CSS \(FILL\)[^\n]*\n)/, `$1${read('page.css')}`, 'PAGE CSS');
replaceOnce(/(<symbol id="i-search"[^\n]*\n)/, `$1${read('sprite.svg')}`, 'sprite');
const body = read('body.html');
if (!body.trim()) throw new Error('body.html is required');
replaceOnce(/<main class="wrap">[\s\S]*<\/main>/, body.trim(), 'main');
const js = read('page.js');
if (js.trim()) html = html.trimEnd() + `\n\n<script>\n${js.trim()}\n</script>\n`;
if (/\bFILL\b/.test(html)) console.warn('warning: the page still contains FILL placeholders');
writeFileSync(out, html);
console.log(`wrote ${out}`);
