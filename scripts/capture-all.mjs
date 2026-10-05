import { spawnSync } from 'node:child_process';
import path from 'node:path';
import electron from 'electron';

const root = path.resolve(import.meta.dirname, '..');
const captures = [
  ['qa/v04-profile-main', '--capture=qa/v04-main.png'],
  ['qa/v04-profile-small', '--capture=qa/v04-small-980x700.png'],
  ['qa/v04-profile-settings', '--capture=qa/v04-settings.png'],
  ['qa/v04-profile-rule-multi', '--capture=qa/v04-rule-multi.png'],
  ['qa/v04-profile-mail', '--capture=qa/v04-mail.png'],
  ['qa/v04-profile-logs', '--capture=qa/v04-logs.png'],
  ['qa/v04-profile-mini', '--capture-mini=qa/v04-mini-compact.png'],
];

for (const [dataDir, capture] of captures) {
  const result = spawnSync(electron, ['.', '--disable-gpu', `--data-dir=${dataDir}`, capture], { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
