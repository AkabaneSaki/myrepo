import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from '../../node_modules/typescript/lib/typescript.js';

const original = await readFile(new URL('../../src/CreativeWorkshop/services/project-fetch.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(original, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
} }).outputText;
const encoder = new TextEncoder();
async function checkStream(withLength) {
  let variables = {};
  let calls = 0;
  const events = [];
  const source = JSON.stringify([{ uid: 1, content: 'sample DLC entry' }]);
  const bytes = encoder.encode(source);
  const segments = [bytes.slice(0, 10), bytes.slice(10, 19), bytes.slice(19)];
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module, exports: module.exports, Date, JSON, Object, Number, Map, Set, String, TextDecoder,
    _: {
      get: (obj, key) => String(key).split('.').reduce((v, part) => v?.[part], obj),
      isObject: v => v !== null && typeof v === 'object',
      isString: v => typeof v === 'string',
      pickBy: (obj, pred) => Object.fromEntries(Object.entries(obj).filter(([, v]) => pred(v))),
      set(obj, path, value) { const bits = path.split('.'); let target = obj;
        for (const bit of bits.slice(0,-1)) target = target[bit] ||= {};
        target[bits.at(-1)] = value; },
    },
    getVariables: () => structuredClone(variables),
    updateVariablesWith: updater => { variables = updater(structuredClone(variables)); },
    getScriptId: () => 'test',
    require(id) {
      if (id === './config') return { getCreativeWorkshopUrl: () => 'https://workshop.invalid' };
      throw Error('unexpected require ' + id);
    },
    fetch: async () => {
      calls++;
      let i = 0;
      return {
        ok: true, status: 200,
        headers: { get: key => key === 'content-length' && withLength ? String(bytes.byteLength) : null },
        body: { getReader: () => ({ read: async () => i < segments.length
          ? { done: false, value: segments[i++] }
          : { done: true } }) },
      };
    },
  }, { filename:'project-fetch.ts' });
  const detail = { project: { id:'p1', version:'1.0.0', downloadUrl:'https://workshop.invalid/source.json' } };
  const first = await module.exports.fetchCreativeWorkshopProjectWorldbookSource(detail, (stage, data) => events.push({ stage, ...data }));
  assert.equal(first.length, 1);
  assert.equal(first[0].content, 'sample DLC entry');
  assert.equal(events.filter(e => e.loadedBytes > 0).length > 0, true);
  const last = events.filter(e => e.loadedBytes > 0).at(-1);
  assert.equal(last.loadedBytes, bytes.length);
  if (withLength) assert.equal(last.totalBytes, bytes.length, 'percent only when full length is accurate');
  else assert.equal(last.totalBytes, undefined, 'unknown server length cannot be a fake percentage');
  await module.exports.fetchCreativeWorkshopProjectWorldbookSource(detail, (stage, data) => events.push({ stage, ...data }));
  assert.equal(calls, 1, 'completed matching JSON can be reused without another HTTP request');
  assert.equal(events.at(-1).source, 'cache');
}
await checkStream(true);
await checkStream(false);
console.log('CreativeWorkshop streaming bytes, unknown size, cache progress: ok');
