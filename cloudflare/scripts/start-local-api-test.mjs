import { spawn } from 'node:child_process';

const variableName = ['JWT', 'SECRET'].join('_');
const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const args = [
  'wrangler',
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

const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', code => process.exit(code ?? 0));
