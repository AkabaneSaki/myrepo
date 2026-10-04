import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {analyzeProjectCode as v1} from './fixtures/ejs-checker-v1.mjs';
import {analyzeProjectCodeV2 as v2} from '../src/utils/ejs-checker/index.mjs';
import {contractCases,inputFor} from './ejs-contract-v1.mjs';
import {makeFixtureEntries} from './fixtures/coworker-embedded.mjs';
import {astDifferentialCases} from './fixtures/ejs-ast-differential-cases.mjs';

const snapshotPath=process.env.EJS_STAGING_CORPUS??new URL('../../.ai-bridge/ejs-checker-v2/staging-corpus.json',import.meta.url);
const regressionPath=process.env.EJS_REGRESSION??'C:/Users/kcwan/Downloads/命定之诗与黄昏之歌v4.3.json';
const snapshot=JSON.parse(fs.readFileSync(snapshotPath,'utf8'));
const realText=fs.readFileSync(regressionPath,'utf8');
assert.equal(crypto.createHash('sha256').update(realText).digest('hex'),'12fa41ced8bbae2ff761e713d33b9881f181fa797bf158bd67937ece0a4b1b97');
const groups=[
  ...contractCases.map(([name,content])=>({id:'contract:'+name,name,inputs:inputFor(name,content)})),
  ...astDifferentialCases.map(([name,content,reason,type])=>({id:'ast:'+name,name,reason,inputs:type==='regex'?[{fileName:name+'.json',type,text:JSON.stringify([{id:'1',findRegex:'x',replaceString:content}])}]:inputFor(name,content)})),
  {id:'coworker-embedded',name:'20 embedded coworker fixtures',inputs:[{fileName:'coworker.json',type:'worldbook',text:JSON.stringify({entries:makeFixtureEntries()})}]},
  {id:'real-55',name:'命定之诗与黄昏之歌v4.3',inputs:[{fileName:'real-55.json',type:'worldbook',text:realText}]},
  ...['<% { const x=1 2; } %>','<% { const = 1; } %>','<% { const x = /* empty */ ; } %>','<% { %>','<% const x=1;'].map((content,i)=>({id:'broken:'+i,name:'intentionally broken '+i,inputs:inputFor('broken'+i,content)})),
  ...snapshot.projects,
];
const fingerprint=report=>report.findings.map(f=>[f.entryId,f.ruleId,f.severity]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
const rows=[];let syntax55=0;
const decisions=JSON.parse(fs.readFileSync(new URL('./fixtures/ejs-differential-decisions.json',import.meta.url),'utf8'));
const reviewed=new Set();
for(const project of groups){
  const before=v1(project.inputs),after=v2(project.inputs);
  if(after.findings.some(f=>f.ruleId==='CHECKER-INTERNAL'))throw new Error(`Internal checker failure: ${project.id}`);
  if(project.id==='real-55'){
    syntax55=after.findings.filter(f=>f.ruleId==='EJS-PARSE').length;
    assert.equal(syntax55,0);assert.equal(after.files[0].ejsEntries,55);assert.ok(after.findings.some(f=>/^L/.test(f.ruleId)));
  }
  if(project.id.startsWith('broken:'))assert.ok(after.findings.some(f=>f.ruleId==='EJS-PARSE'));
  const changed=JSON.stringify(fingerprint(before))!==JSON.stringify(fingerprint(after))||before.gate!==after.gate||before.audit!==after.audit;
  const ids=[...new Set([...before.findings,...after.findings].map(f=>f.entryId))];
  const differences=ids.map(entryId=>({entryId,entry:[...before.findings,...after.findings].find(f=>f.entryId===entryId)?.entry,
    v1:before.findings.filter(f=>f.entryId===entryId),v2:after.findings.filter(f=>f.entryId===entryId)}))
    .filter(row=>JSON.stringify(row.v1.map(f=>[f.ruleId,f.severity]).sort())!==JSON.stringify(row.v2.map(f=>[f.ruleId,f.severity]).sort()));
  rows.push({project:project.id,name:project.name,sha256:project.sha256??crypto.createHash('sha256').update(JSON.stringify(project.inputs)).digest('hex'),
    reason:project.reason,
    v1:{gate:before.gate,audit:before.audit},v2:{gate:after.gate,audit:after.audit},changed,differences,
    files:after.files,findings:after.findings});
  const row=rows.at(-1);
  if(changed){
    const signature=crypto.createHash('sha256').update(JSON.stringify([row.v1,row.v2,row.differences.map(d=>[d.entryId,fingerprint({findings:d.v1}),fingerprint({findings:d.v2})])])).digest('hex');
    const decision=decisions.find(d=>d.project===project.id&&d.sha256===row.sha256&&d.signature===signature);
    assert.ok(decision?.expected&&decision.reason,`Unexplained difference: ${project.id}`);
    row.reason=decision.reason;row.expected=true;reviewed.add(project.id);
    for(const difference of row.differences){difference.changed=true;difference.reason=decision.reason;difference.expected=true;}
  }else{row.reason='发现和门禁状态未变化。';row.expected=true;}
}
assert.equal(reviewed.size,decisions.length,'A reviewed difference disappeared; re-audit required.');
const report={generatedAt:new Date().toISOString(),snapshotOrigin:snapshot.origin,snapshotCapturedAt:snapshot.capturedAt,coverage:snapshot.coverage,
  summary:{projects:rows.length,stagingProjects:snapshot.projects.length,changed:rows.filter(r=>r.changed).length,verdictChanges:rows.filter(r=>r.v1.gate!==r.v2.gate||r.v1.audit!==r.v2.audit).length,regression55ParseErrors:syntax55},rows};
fs.writeFileSync(new URL('../../.ai-bridge/ejs-checker-v2/differential.json',import.meta.url),JSON.stringify(report,null,2));
const delivery={...report,summary:{...report.summary,unexplainedDifferences:0},rows:rows.map(({findings,...row})=>row)};
fs.writeFileSync(new URL('../../docs/ejs-checker-v2-differential.json',import.meta.url),JSON.stringify(delivery,null,2));
console.log(JSON.stringify(report.summary));
for(const row of rows.filter(r=>r.changed))console.log(JSON.stringify({project:row.project,name:row.name,before:row.v1,after:row.v2,differences:row.differences.map(d=>({entryId:d.entryId,entry:d.entry,v1:d.v1.reduce((m,f)=>(m[f.ruleId]=(m[f.ruleId]??0)+1,m),{}),v2:d.v2.reduce((m,f)=>(m[f.ruleId]=(m[f.ruleId]??0)+1,m),{})}))}));
