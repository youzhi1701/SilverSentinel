import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['src', 'scripts'];
const extensions = new Set(['.js', '.cjs', '.mjs']);

function collect(folder, out = []) {
  if (!fs.existsSync(folder)) return out;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) collect(full, out);
    else if (extensions.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

const files = roots.flatMap(root => collect(root)).sort();
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}
if (failed) process.exit(1);
console.log(`Syntax check passed: ${files.length} files`);
