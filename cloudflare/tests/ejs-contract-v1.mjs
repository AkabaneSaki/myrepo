import assert from 'node:assert/strict';
import { analyzeProjectCode, toUploaderCodeCheck } from './fixtures/ejs-checker-v1.mjs';

export const contractCases = [
  ['local', '<% { const own = 1; } %>', []],
  ['var in block', '<% { var own = 1; } %>', ['L1']],
  ['var in function', '<% { function local() { var own = 1; } } %>', ['L1']],
  ['top lexical', '<% let first = 1, second = 2; %>', ['L2']],
  ['for lexical', '<% for (let i=0; i<2; i++) {} %>', []],
  ['top function', '<% function shared() {} %>', ['L3']],
  ['top class', '<% class Shared {} %>', ['L3']],
  ['function value', '<% const helper = () => 1; %>', ['L2']],
  ['implicit', '<% own = 1; %>', ['L4']],
  ['generic implicit', '<% state = 1; %>', ['L4', 'L5']],
  ['explicit', '<% globalThis.__PW_DEMO__ = {}; %>', ['L4']],
  ['generic explicit', '<% window.state = 1; %>', ['L4', 'L5']],
  ['private', '@@private\n<% const own = 1; %>', []],
  ['invalid private', '\n@@private\n<% const own = 1; %>', ['L2', 'L7']],
  ['eval', '<% { eval("1"); } %>', ['M1']],
  ['constructor', '<% { new Function("return 1"); } %>', ['M2']],
  ['sensitive', '<% { localStorage.getItem("auth_token"); } %>', ['M3']],
  ['own setting', '<% { localStorage.getItem("font_size"); } %>', []],
  ['network', '<% { fetch("/own"); } %>', ['M4']],
  ['loop', '<% { for(;;) {} } %>', ['M5']],
  ['hint', '<% { atob("MQ=="); } %>', ['AH1']],
  ['true syntax error', '<% { const bad = ; } %>', ['EJS-PARSE']],
];

export function inputFor(name, content) {
  return [{fileName: name+'.json', type: 'worldbook', text: JSON.stringify({entries:{0:{uid:0,comment:name,content}}})}];
}

for (const [name, content, expected] of contractCases) {
  const report = analyzeProjectCode(inputFor(name, content));
  assert.deepEqual(report.findings.map(f=>f.ruleId).sort(), expected.toSorted(), name);
  const high = report.findings.some(f=>f.severity==='high');
  assert.equal(report.gate, high?'reject':'accept', name);
  assert.equal(report.audit, high?'not_applicable':report.findings.some(f=>['warn','hint'].includes(f.severity))?'yellow':'green', name);
  const visible = toUploaderCodeCheck(report).findings;
  assert.ok(visible.every(f=>/^L[1-7]$|^(EJS-PARSE|SCRIPT-RISK|FILE)$/.test(f.ruleId)), name);
}
const privateVar=analyzeProjectCode(inputFor('private-var','@@private\n<% var own=1; %>'));
assert.equal(privateVar.findings[0].severity,'info');
assert.equal(privateVar.gate,'accept');
const hint=analyzeProjectCode(inputFor('hint','<% { atob("MQ=="); } %>'));
assert.equal(hint.certification,'pass');
assert.equal(hint.audit,'yellow');
const collision=analyzeProjectCode([{fileName:'collision.json',type:'worldbook',text:JSON.stringify({entries:{0:{uid:0,content:'<% const same=1; %>'},1:{uid:1,content:'<% const same=2; %>'}}})}]);
assert.ok(collision.findings.some(f=>f.ruleId==='L6'));
const regex=analyzeProjectCode([{fileName:'regex.json',type:'regex',text:JSON.stringify([{id:'1',scriptName:'regex',findRegex:'x',replaceString:'<script>const state=1; eval("1")</script>'}])}]);
assert.deepEqual(regex.findings.map(f=>f.ruleId),['M1']);
console.log('Frozen v1 contract: 22 cases + severity, visibility, collision, regex: ok');
