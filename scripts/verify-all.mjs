import { spawnSync } from 'node:child_process';
for (const file of ['test-gates.mjs', 'verify-e2e.mjs', 'verify-browser.mjs']) {
  const result = spawnSync(process.execPath, ['scripts/' + file], { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) { process.exitCode = result.status || 1; break; }
}
