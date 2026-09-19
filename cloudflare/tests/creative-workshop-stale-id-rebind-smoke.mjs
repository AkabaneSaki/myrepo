import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from '../../node_modules/typescript/lib/typescript.js';

const source = await readFile(new URL('../../src/CreativeWorkshop/services/worldbook-reconcile.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
}).outputText;

const module = { exports: {} };
vm.runInNewContext(compiled, { module, exports: module.exports, Set }, { filename: 'worldbook-reconcile.ts' });
const { reconcileCreativeWorkshopWorldbookEntries } = module.exports;

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
    name: '[WS][DLC][角色]角色设定',
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
  assert.equal(result[0].name, '[WS][DLC][角色]角色设定');
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
