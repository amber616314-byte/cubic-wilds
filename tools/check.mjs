import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const files = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js') || p.endsWith('.mjs')) files.push(p);
  }
}
walk(join(root, 'src'));
walk(join(root, 'tools'));

let failed = false;
for (const file of files) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed = true;
    console.error(`Syntax check failed: ${relative(root, file)}`);
    console.error(r.stderr || r.stdout);
  }
}

const html = readFileSync(join(root, 'index.html'), 'utf8');
for (const forbidden of ['gui/title/minecraft.png', 'gui/title/mojang.png']) {
  if (html.includes(forbidden)) {
    failed = true;
    console.error(`Branding check failed: index.html still references ${forbidden}`);
  }
}

if (failed) process.exit(1);
console.log(`OK: ${files.length} JavaScript files passed syntax checks and public branding checks.`);
