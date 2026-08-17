import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const script = join(import.meta.dirname, 'fetch_assets.py');
const candidates = process.platform === 'win32'
  ? [['py', ['-3']], ['python', []], ['python3', []]]
  : [['python3', []], ['python', []]];

for (const [cmd, prefix] of candidates) {
  const probe = spawnSync(cmd, [...prefix, '--version'], { stdio: 'ignore' });
  if (probe.status !== 0) continue;
  const result = spawnSync(cmd, [...prefix, script], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

console.error('Python 3 is required to fetch local reference assets.');
process.exit(1);
