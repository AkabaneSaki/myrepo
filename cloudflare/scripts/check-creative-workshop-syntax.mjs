import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const files = [
  '../../src/CreativeWorkshop/index.ts',
  '../../src/CreativeWorkshop/bridge/host.ts',
  '../../src/CreativeWorkshop/services/diff.ts',
  '../../src/CreativeWorkshop/services/install-registry.ts',
  '../../src/CreativeWorkshop/services/install-state.ts',
  '../../src/CreativeWorkshop/services/project-fetch.ts',
  '../../src/CreativeWorkshop/services/regex.ts',
  '../../src/CreativeWorkshop/services/worldbook.ts',
  '../../src/CreativeWorkshop/services/worldbook-normalize.ts',
].map(path => fileURLToPath(new URL(path, import.meta.url)));

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || `Syntax check failed: ${file}\n`);
    process.exit(result.status ?? 1);
  }
}

console.log(`CreativeWorkshop syntax OK (${files.length} files)`);
