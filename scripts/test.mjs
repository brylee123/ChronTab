import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const files = readdirSync('tests')
  .filter((name) => name.endsWith('.test.js'))
  .sort()
  .map((name) => 'tests/' + name);
const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  env: { ...process.env, TZ: 'America/New_York' },
});
if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
