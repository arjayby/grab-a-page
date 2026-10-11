import { readFile, readdir, stat } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
async function check(dir) {
  for (const name of await readdir(dir)) {
    const file = path.join(dir, name);
    if ((await stat(file)).isDirectory()) await check(file);
    else if (/\.(js|mjs)$/.test(file)) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    else if (name.endsWith('.json')) JSON.parse(await readFile(file, 'utf8'));
  }
}
await check('extension');
console.log('Extension JavaScript and JSON checks passed.');
