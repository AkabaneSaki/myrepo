import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cloudflareRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wranglerCli = path.join(cloudflareRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const variableName = ['JWT', 'SECRET'].join('_');
const args = [
  wranglerCli,
  'dev',
  '--config',
  'wrangler.local-test.jsonc',
  '--local',
  '--ip',
  '127.0.0.1',
  '--port',
  '8791',
  '--var',
  `${variableName}:cw-local-api-test`,
];

const child = spawn(process.execPath, args, {
  cwd: cloudflareRoot,
  stdio: 'inherit',
  shell: false,
  windowsHide: true,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', code => process.exit(code ?? 0));
