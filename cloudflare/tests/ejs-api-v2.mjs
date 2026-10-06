import assert from 'node:assert/strict';
import { parseEjs, parseRegex } from '../src/utils/ejs-checker/syntax.mjs';
import { API_CATALOGUE, API_CONTEXT_FIELDS, API_SOURCE, inspectApiUsage } from '../src/utils/ejs-checker/api-catalogue.mjs';

const check = content => {
  const parsed = parseEjs(content);
  assert.deepEqual(parsed.errors, [], content);
  assert.deepEqual(parsed.internalErrors, [], content);
  return inspectApiUsage({ sourceType: 'worldbook', content }, parsed);
};
const ids = content => check(content).map(record => record.ruleId);

assert.equal(API_SOURCE.commit, 'd6f520d149aba146305b0b781ddd691d449c28d2');
for (const name of ['getvar', 'setvar', 'getLocalVar', 'getGlobalVar', 'getMessageVar', 'setLocalVar', 'setGlobalVar', 'setMessageVar']) {
  assert.equal(API_CATALOGUE[name].asynchronous, false, name);
}
for (const name of ['getwi', 'getWorldInfo', 'activewi', 'activateWorldInfo']) assert.equal(API_CATALOGUE[name].asynchronous, true, name);
assert.ok(API_CONTEXT_FIELDS.runType.values.includes('render_permanent'));

assert.deepEqual(ids('<% getvar("x"); setvar("x", 1); getLocalVar("x").a; %>'), []);
assert.deepEqual(ids('<% const x = (await getwi("entry")).length; %>'), []);
assert.deepEqual(ids('<% return getwi("entry"); %>'), []);
assert.deepEqual(ids('<% async function f() { return getwi("entry"); } %>'), []);
assert.deepEqual(ids('<% await Promise.all([getwi("entry"), activewi("entry")]); %>'), []);
assert.deepEqual(ids('<% getwi("entry").then(x => x.length).catch(() => "").finally(() => {}); %>'), []);
assert.deepEqual(ids('<% getwi("entry")["then"](x => x); %>'), []);
assert.deepEqual(ids('<% getwi("book", "entry", {}); activewi("entry", true); %>'), []);
assert.deepEqual(ids('<% customExtensionApi().content; futureApi(); %>'), []);
assert.deepEqual(ids('<% const getwi = () => "x"; getwi().length; %>'), []);
assert.deepEqual(ids('<% function f(getwi) { return getwi().length; } %>'), []);
assert.deepEqual(ids('<% getwi().length; function getwi() { return "x"; } %>'), []);
assert.deepEqual(ids('<% try {} catch (getwi) { getwi().length; } %>'), []);
assert.deepEqual(ids('<% function f({ getwi }) { return getwi().length; } %>'), []);
assert.deepEqual(ids('<% getwi(...args); setvar(...args); %>'), []);
assert.deepEqual(ids('<% if (typeof generateBuffer !== "undefined") print(generateBuffer); %>'), []);
assert.deepEqual(ids('<% getwi("entry")[customProperty]; %>'), []);

assert.deepEqual(ids('<% getwi("entry").length; %>'), ['API1']);
assert.deepEqual(ids('<% activewi("entry").content; %>'), ['API1']);
assert.deepEqual(ids('<% getWorldInfo("entry")?.length; %>'), ['API1']);
assert.deepEqual(ids('<% "prefix" + getwi("entry"); %>'), ['API1']);
assert.deepEqual(ids('<% `${getwi("entry")}`; %>'), ['API1']);
assert.deepEqual(ids('<% getwi(); setvar("x"); getvar(); %>'), ['API2', 'API2', 'API2']);
assert.deepEqual(ids('<% { const getwi = () => "x"; getwi().length; } getwi("entry").length; %>'), ['API1']);
assert.deepEqual(inspectApiUsage({ sourceType: 'regex' }, parseRegex('<script>getwi().length;</script>')), []);

const located = check('😀\r\n<% getwi("entry").length; %>')[0];
assert.equal(located.index, 7);
assert.equal(located.severity, 'warn');
assert.equal(located.visibility, 'reviewer_only');
assert.ok(!located.ruleId.includes('PARSE'));
console.log('EJS v2 API catalogue checks passed.');
