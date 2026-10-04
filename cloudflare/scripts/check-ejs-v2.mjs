import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tests = ['ejs-contract-v1', 'ejs-syntax-v2', 'ejs-syntax-report-v2', 'ejs-policy-v2', 'ejs-capabilities-v2', 'ejs-engine-v2', 'ejs-api-v2', 'ejs-source-map-regression-v2', 'ejs-preflight-gate'];
for (const test of tests) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL(`../tests/${test}.mjs`, import.meta.url))], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
