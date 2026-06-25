import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { resolve, relative, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = __dirname;
const TMP = join(cwd, '.push_tmp');
const IGNORE = new Set(['node_modules', 'dist', '.git', '_push_helper.mjs', '_split.mjs', '.push_tmp']);

function walk(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walk(full));
    } else {
      const rel = relative(cwd, full).replace(/\\/g, '/');
      results.push({ rel, full });
    }
  }
  return results;
}

const files = walk(cwd);
const result = [];
let errCount = 0;

for (const { rel, full } of files) {
  try {
    const content = readFileSync(full, 'utf8');
    result.push({ path: rel, content });
  } catch (e) {
    try {
      const buf = readFileSync(full);
      result.push({ path: rel, content: buf.toString('base64'), encoding: 'base64' });
    } catch (e2) {
      errCount++;
      console.error('Error reading:', rel, e2.message);
    }
  }
}

const payload = JSON.stringify(result);
writeFileSync(join(TMP, 'payload.json'), payload);
console.log('Files: ' + result.length + ', Errors: ' + errCount + ', Payload: ' + payload.length + ' bytes');
