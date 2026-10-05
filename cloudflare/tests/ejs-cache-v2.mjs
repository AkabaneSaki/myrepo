import assert from 'node:assert/strict';
import { analyzeProjectCodeCached } from '../src/utils/ejs-checker/cache.mjs';

const inputs = [{ fileName: 'repeat.json', type: 'worldbook', text: JSON.stringify({ entries: [{ uid: 1, comment: '缓存', content: '<% eval("1") %>' }] }) }];
const initial = await analyzeProjectCodeCached(inputs);
assert.equal(initial.gate, 'reject');
const repeat = await analyzeProjectCodeCached(inputs);
assert.equal(repeat.generatedAt, initial.generatedAt);
assert.deepEqual(repeat, initial);
repeat.findings.length = 0;
assert.deepEqual(await analyzeProjectCodeCached(inputs), initial, 'callers cannot mutate a cached verdict');
const renamed = await analyzeProjectCodeCached([{ ...inputs[0], fileName: 'other.json' }]);
assert.equal(renamed.findings[0].book, 'other.json');
const safe = await analyzeProjectCodeCached([{ ...inputs[0], text: JSON.stringify({ entries: [{ uid: 1, content: '普通正文' }] }) }]);
assert.equal(safe.gate, 'accept');
console.log('EJS same-payload cache checks passed');
