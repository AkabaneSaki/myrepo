import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from '../../node_modules/typescript/lib/typescript.js';

async function loadTypeScript(path, globals = {}) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, ...globals });
  return exports;
}

const manifest = JSON.parse(await readFile(new URL('../../config/workshop.json', import.meta.url), 'utf8'));
const beautifier = manifest.scriptDependencies.find(item => item.publicPath === 'dist/AutoDialogueBeautifier/index.js');
assert.equal(beautifier.latestVersion, manifest.client.stable);
const scripts = [
  ['old', '2.0.14', beautifier.publicPath],
  ['current', beautifier.latestVersion, beautifier.publicPath],
  ['ahead', '99.0.0', beautifier.publicPath],
  ['floating', 'main', beautifier.publicPath],
  ['workshop', '2.2.0', manifest.client.publicPath],
].map(([id, version, path]) => ({
  type: 'script', id, name: id, enabled: true,
  content: `import 'https://testingcf.jsdelivr.net/gh/Akabanesaki/myrepo@${version}/${path}'`,
}));
scripts.push({
  type: 'script', id: 'manager', name: 'manager', enabled: true,
  content: "import 'https://cdn.jsdelivr.net/gh/uikawinwing/CharInfo-Manager@0.3.3/index.js'",
});
const client = await loadTypeScript('../../src/CreativeWorkshop/services/script-dependency.ts', {
  URL,
  getScriptTrees: ({ type }) => type === 'character' ? scripts : [],
});
const snapshot = client.listCreativeWorkshopScriptDependencies();
assert.equal(snapshot.supported, true);
const bridge = await loadTypeScript('../src/pages/home/tavern-bridge.ts');
const modal = await loadTypeScript('../src/pages/home/modal/core.ts');

function run(config) {
  const context = vm.createContext({
    WORKSHOP_CONFIG: config, state: { tavern: {} }, URL,
    window: { addEventListener() {} }, renderApp() {},
    escapeHtml: value => String(value),
  });
  vm.runInContext(bridge.homeTavernBridgeScript + modal.homeModalCoreScript
    + '\nglobalThis.sync = syncScriptDependenciesFromBridge;'
    + '\nglobalThis.summary = getScriptDependencyHealthSummary;'
    + '\nopenModal = html => html;'
    + '\nglobalThis.reminder = openScriptDependencyHealthModal;', context);
  context.sync(snapshot);
  return context;
}

const context = run(manifest);
const health = context.summary();
assert.deepEqual(Array.from(health.outdated, item => item.scriptId).sort(), ['manager', 'old']);
assert.equal(health.items.find(item => item.scriptId === 'current').status, 'current');
assert.equal(health.items.find(item => item.scriptId === 'ahead').status, 'ahead');
assert.equal(health.uncertain.length, 1);
assert.ok(!health.items.some(item => item.scriptId === 'workshop'), 'Workshop must not be mistaken for AutoDialogueBeautifier');
assert.ok(context.reminder().includes(beautifier.displayName));
assert.ok(context.reminder().includes(beautifier.latestVersion));

const changed = structuredClone(manifest);
changed.scriptDependencies.find(item => item.publicPath === beautifier.publicPath).latestVersion = '3.4.5';
assert.ok(run(changed).reminder().includes('3.4.5'), 'Reminder must follow configuration rather than a hardcoded release');
console.log('Script dependency update smoke PASS: old import, current/ahead versions, case-insensitive repository, artifact isolation, and configuration-driven reminder.');
