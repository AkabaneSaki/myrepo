import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from '../../node_modules/typescript/lib/typescript.js';

async function compile(relativePath) {
  const source = await readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
}

function loadCommonJs(compiled, context, filename) {
  const module = { exports: {} };
  vm.runInNewContext(compiled, { ...context, module, exports: module.exports }, { filename });
  return module.exports;
}

const identityApi = loadCommonJs(
  await compile('src/CreativeWorkshop/services/install-identity.ts'),
  { JSON, String, Number, Object, Array, Error },
  'install-identity.ts',
);

const reconcileApi = loadCommonJs(
  await compile('src/CreativeWorkshop/services/worldbook-reconcile.ts'),
  {
    require(specifier) {
      if (specifier === './install-identity') return identityApi;
      throw new Error(`Unexpected require: ${specifier}`);
    },
    Set,
  },
  'worldbook-reconcile.ts',
);
const { reconcileCreativeWorkshopWorldbookEntries } = reconcileApi;

const oldProjectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const newProjectId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const oldEntry = {
  uid: 42,
  name: '[DLC][角色][WS]角色设定',
  comment: '角色设定',
  content: 'old',
  extra: {
    cw_project_id: oldProjectId,
    cw_project_name_display: '仍存在的项目',
    cw_entry_key: oldProjectId + ':entry-1',
  },
};

const desired = [{
  stableKey: newProjectId + ':entry-1',
  legacyKey: newProjectId + ':0',
  sourceName: '角色设定',
  payload: {
    name: '[DLC][角色][WS]角色设定',
    comment: '角色设定',
    content: 'new',
    extra: {
      cw_project_id: newProjectId,
      cw_project_name_display: '仍存在的项目',
      cw_entry_key: newProjectId + ':entry-1',
    },
  },
}];

{
  const result = reconcileCreativeWorkshopWorldbookEntries(
    [structuredClone(oldEntry)],
    structuredClone(desired),
    newProjectId,
    { projectName: '仍存在的项目', legacyProjectName: oldProjectId, pruneMissing: true },
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].uid, 42, 'confirmed stale-ID rebind should preserve the existing worldbook UID');
  assert.equal(result[0].content, 'new');
  assert.equal(result[0].extra.cw_project_id, newProjectId);
  assert.equal(result[0].extra.cw_entry_key, newProjectId + ':entry-1');
}

{
  const result = reconcileCreativeWorkshopWorldbookEntries(
    [structuredClone(oldEntry)],
    structuredClone(desired),
    newProjectId,
    { projectName: '仍存在的项目', pruneMissing: true },
  );
  assert.equal(result.length, 2, 'without an explicit legacy alias, a same-name stale entry must not be silently rebound');
  assert.ok(result.some(entry => entry.extra?.cw_project_id === oldProjectId));
  assert.ok(result.some(entry => entry.extra?.cw_project_id === newProjectId));
}

console.log('CreativeWorkshop stale project-id rebind smoke: ok');
