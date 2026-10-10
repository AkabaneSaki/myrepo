import assert from 'node:assert/strict';
import { analyzeProjectCode } from '../src/utils/ejs-preflight.mjs';

const scan = (content,type='worldbook') => analyzeProjectCode([{fileName:'review.json',type,text:JSON.stringify(type==='worldbook'?{entries:{1:{uid:1,comment:'review',content}}}:[{id:'r1',scriptName:'review',replaceString:content}])}]);
for (const [content,rule] of [
  ['<% { const {eval: run}=globalThis;run("1+1"); } %>','M1'],
  ['<% { let run; ({["eval"]:run}=window); } %>','M1'],
  ['<% { const {Function:make = ()=>{}}=self; } %>','M2'],
  ['<% { globalThis.window.eval("1"); } %>','M1'],
  ['<% { window.window.Function("return 1")(); } %>','M2'],
  ['<% { window.top.eval("1"); } %>','M1'],
]) {
  const report=scan(content);
  assert.equal(report.gate,'accept',content);
  assert.equal(report.audit,'yellow',content);
  assert.ok(report.findings.some(item=>item.ruleId===rule),content);
}
assert.ok(scan('<script>const {Function:make}=window;make("return 1")()</script>','regex').findings.some(item=>item.ruleId==='M2'));
for (const content of [
  '<% { const window={eval(){},Function(){}}; const {eval:run,Function:make}=window;run();make(); } %>',
  '<% { const globalThis={window:{eval(){}}}; globalThis.window.eval(); } %>',
  '<% { const object={eval(){}}; const {eval:run}=object;run(); } %>',
]) assert.ok(!scan(content).findings.some(item=>['M1','M2'].includes(item.ruleId)),content);
const meta='<%# poem-workshop-meta:v1-start\n{"url":"https://metadata-only.example.com/a"}\npoem-workshop-meta:v1-end %>\n';
assert.equal(scan(meta+'普通正文').audit,'green');
const link=scan(meta+'正文：https://outside-meta.example.com/a').findings.find(item=>item.ruleId==='U2');
assert.equal(link.line,4);
assert.equal(link.column,4);
assert.match(link.detail,/outside-meta/);
console.log('Review regressions: destructured/global-chain capabilities and metadata link positions: ok');
assert.equal(scan('<div only="ordinary text" once="no thanks" oncustom="not javascript"></div>','regex').gate,'accept');
assert.equal(scan('<div onmessage="not javascript" onbegin="not javascript"></div>','regex').gate,'accept');
for (const html of ['<button onclick="eval(1)">x</button>','<div onpointerdown="eval(1)">x</div>','<svg><animate onbegin="eval(1)" /></svg>']) assert.ok(scan(html,'regex').findings.some(item=>item.ruleId==='M1'),html);
