import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { regenerateOfficialHashesAtomically } from '../server/officialHashes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');

export function runFetchRosstat({ asOf = new Date().toISOString().slice(0, 10), download = false } = {}) {
  const args = [path.join(__dirname, 'collect_rosstat.py'), '--as-of', asOf];
  if (download) args.push('--download');
  const stdout = execFileSync('python3', args, { cwd: rootDir, encoding: 'utf8' });
  const hashes = regenerateOfficialHashesAtomically(dataDir);
  return {
    summary: JSON.parse(stdout.trim()),
    hashes,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const asOf = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || new Date().toISOString().slice(0, 10);
  const download = process.argv.includes('--download');
  const res = runFetchRosstat({ asOf, download });
  console.log(JSON.stringify(res, null, 2));
}
