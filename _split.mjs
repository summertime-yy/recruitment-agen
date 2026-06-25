import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dirname, '.push_tmp', 'payload.json');

const data = JSON.parse(readFileSync(TMP, 'utf8'));

mkdirSync(join(__dirname, '.push_tmp', 'batches'), { recursive: true });

const BATCH_SIZE = 15;
for (let i = 0; i < data.length; i += BATCH_SIZE) {
  const batch = data.slice(i, i + BATCH_SIZE);
  writeFileSync(join(__dirname, '.push_tmp', 'batches', `batch_${Math.floor(i/BATCH_SIZE)}.json`), JSON.stringify(batch));
  console.log(`Batch ${Math.floor(i/BATCH_SIZE)}: ${batch.length} files, ${JSON.stringify(batch).length} bytes`);
}
console.log('Total batches:', Math.ceil(data.length / BATCH_SIZE));
