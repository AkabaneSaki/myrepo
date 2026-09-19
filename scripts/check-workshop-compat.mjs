import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'config/workshop.json'), 'utf8'));
const shim = await readFile(resolve(root, manifest.client.legacyShimPath), 'utf8');

const migration = (manifest.client.migrations || []).find(item => item.mode === 'self-rewrite');
assert.ok(migration, 'missing self-rewrite migration');

const scriptId = 'compat-test-script';
const oldImport = `import '${manifest.release.cdnBase}/${manifest.release.repository}@${manifest.client.stable}/${migration.fromPath}'`;
const expectedImport = `import '${manifest.release.cdnBase}/${manifest.release.repository}@${manifest.client.stable}/${migration.toPath}'`;

let trees = [{
  type: 'script',
  id: scriptId,
  name: 'Creative Workshop compatibility test',
  enabled: true,
  content: oldImport,
  info: '',
  button: { enabled: false, buttons: [] },
  data: {},
}];

const notices = [];
const context = {
  console,
  Promise,
  setTimeout,
  clearTimeout,
  globalThis: null,
  getScriptId: () => scriptId,
  getScriptTrees: ({ type }) => type === 'global' ? trees : [],
  updateScriptTreesWith: async (updater, { type }) => {
    assert.equal(type, 'global');
    trees = await updater(trees);
    return trees;
  },
  toastr: {
    success: message => notices.push(['success', message]),
    warning: message => notices.push(['warning', message]),
    error: message => notices.push(['error', message]),
  },
};
context.globalThis = context;

vm.createContext(context);
vm.runInContext(shim, context);
await new Promise(resolvePromise => setTimeout(resolvePromise, 20));

assert.equal(trees[0].content, expectedImport, 'compatibility endpoint failed to rewrite the historical import to the canonical dist path');
assert.ok(notices.some(([kind]) => kind === 'success'), 'compatibility endpoint did not report successful migration');

console.log('Workshop historical compatibility endpoint self-rewrite: ok');
