import assert from 'node:assert/strict';
import { homePublishCheckScript } from '../src/pages/home/publish-check.ts';

const parser = new Function('escapeHtml', homePublishCheckScript +
  '; return { parseOriginalBaselineItem, buildOriginalBaselineTree };')(
    value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
  );
const items = [
  {id:'wb-main',kind:'worldbook',displayName:'[本体][设定]王都'},
  {id:'wb-system',kind:'worldbook',displayName:'[本体][变量]➡️系统'},
  {id:'wb-addon',kind:'worldbook',displayName:'[DLC]自定义内容'},
  {id:'rx-main',kind:'regex',displayName:'显示修饰规则'},
  {id:'rx-another',kind:'regex',displayName:'行为覆盖'},
  {id:'not-original',kind:'unsupported',displayName:'不能选择'},
];
const selected = new Set(['rx-main','wb-main']);
const result = parser.buildOriginalBaselineTree(items, selected);
assert.equal(result.visibleCount,3,'two original Regex and one non-system original worldbook');
assert.match(result.html,/原版世界书/);
assert.match(result.html,/原版正则/);
assert.match(result.html,/显示修饰规则/);
assert.match(result.html,/data-original-entry-id="rx-main" checked/);
assert.match(result.html,/data-original-entry-id="wb-main" checked/);
assert.doesNotMatch(result.html,/DLC.*自定义内容/);
assert.doesNotMatch(result.html,/➡️系统/);

const filtered = parser.buildOriginalBaselineTree(items, selected, {query:'显示修饰'});
assert.equal(filtered.visibleCount,1);
assert.match(filtered.html,/显示修饰规则/);
const reveal = parser.buildOriginalBaselineTree(items, selected, {showSystem:true});
assert.equal(reveal.visibleCount,4);
assert.match(reveal.html,/➡️系统/);
assert.equal(parser.parseOriginalBaselineItem({id:'rx-a',kind:'regex',displayName:' untagged '}).title,'untagged');
const tagged = parser.parseOriginalBaselineItem({id:'rx-tag',kind:'regex',displayName:'[本体][显示]渲染器'});
assert.equal(tagged.title,'渲染器');
assert.deepEqual(tagged.path,['原版正则','显示']);

assert.equal(parser.parseOriginalBaselineItem({id:'bad',kind:'worldbook',displayName:'not original'}),null);
console.log('publish original worldbook/Regex picker smoke: ok');
