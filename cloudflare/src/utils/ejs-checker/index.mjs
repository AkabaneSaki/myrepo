import { parseEjs, parseRegex, parseWorldbookHtml } from './syntax.mjs';
import { inspectAstPolicy, inspectSymbolCollisions } from './policy.mjs';
import { inspectCapabilities } from './capabilities.mjs';
import { inspectApiUsage } from './api-catalogue.mjs';
import { syntaxFindings } from './syntax-findings.mjs';
import { CHECK_POLICY_VERSION } from './policy-config.mjs';
import { CHECKER_LIMITS, createParseBudget } from './limits.mjs';
import { parseCodeCheckInput, finding, inspectDecorators, inspectLinks, compareFindings, gateStatus, auditStatus, certificationStatus } from './report.mjs';

export const CHECKER_VERSION = Object.freeze({
  engine:'v2',
  policyVersion:CHECK_POLICY_VERSION,
  parserCompatibility:'EJS 3.1.9 / ST nested tags; Acorn 8.18.0; HTML parse5 8.0.1',
});

function analyze(inputs, server) {
  const books=[],findings=[];
  const add=(entry,record)=>findings.push(finding(record.ruleId,record.severity,record.title,entry,record.index,record.detail,record.suggestion,record.extra));
  for(const [bookOrder,input] of (Array.isArray(inputs)?inputs:[]).entries()) {
    try { books.push(parseCodeCheckInput(input,bookOrder)); }
    catch(error) {
      findings.push(finding('FILE','high','无法读取文件',null,0,String(error.message),'确认这是有效的世界书或正则文件，然后重新选择。',{book:String(input?.fileName??''),bookOrder,entryOrder:-1}));
    }
  }
  const entries=books.flatMap(book=>book.entries);
  const budget = createParseBudget();
  const limitFinding = (entry, detail) => findings.push(finding('CHECKER-LIMIT','high','内容超过本次检查的处理上限',entry,0,detail,'请减少本次提交的内容，或拆分过大的条目；重复提交相同内容仍无法通过。'));
  if (entries.length > CHECKER_LIMITS.entries) limitFinding(entries[0], '一次检查最多处理 2000 条内容。请减少本次提交的条目。');
  if (entries.reduce((sum, entry) => sum + entry.content.length, 0) > CHECKER_LIMITS.totalCharacters) limitFinding(entries[0], '一次检查的正文总计最多 200 万个字符。请减少本次提交的内容。');
  const oversized = entries.find(entry => entry.content.length > CHECKER_LIMITS.entryCharacters);
  if (oversized) limitFinding(oversized, '单条内容最多 30 万个字符。请拆分这个过大的条目。');
  const admitted = !findings.some(item => item.ruleId === 'CHECKER-LIMIT');
  for(const entry of admitted ? entries : []) {
    inspectDecorators(entry,findings);
    const ejs=entry.sourceType==='worldbook'&&entry.hasEjs?parseEjs(entry.content,{privateScope:entry.isPrivate,budget}):{units:[],errors:[],internalErrors:[]};
    const html=ejs.internalErrors.length ? {units:[],errors:[],internalErrors:[]} : entry.sourceType==='regex'||!entry.hasEjs?parseRegex(entry.content,budget):parseWorldbookHtml(entry,ejs,budget);
    for(const record of syntaxFindings(entry,ejs))add(entry,record);
    for(const record of syntaxFindings({...entry,sourceType:'regex'},html))add(entry,record);
    if ([...ejs.internalErrors,...html.internalErrors].some(error => error.kind === 'limit')) break;
    const parsed={units:[...ejs.units,...html.units],errors:[...ejs.errors,...html.errors],internalErrors:[...ejs.internalErrors,...html.internalErrors]};
    const policy=inspectAstPolicy(entry,parsed);
    entry.symbols=policy.symbols;
    for(const record of policy.findings)add(entry,record);
    if (server) {
      for(const record of inspectCapabilities(entry,parsed))add(entry,record);
      for(const record of inspectApiUsage(entry,parsed))add(entry,record);
      inspectLinks(entry,findings,parsed);
    }
  }
  for(const record of inspectSymbolCollisions(entries))add(record.entry,record);
  findings.sort(compareFindings);
  return {
    generatedAt:new Date().toISOString(),tool:'Poem Workshop EJS / Regex Check',standard:'PW-CODE-CHECK-v1',...CHECKER_VERSION,phase:server?'server':'local',
    gate:gateStatus(findings),audit:auditStatus(findings),certification:certificationStatus(findings),
    rules:server?'EJS:L1-L7; COMMON:M1-M5,U2-U5; API:API1-API2; HINTS:AH1-AH4; EJS-PARSE,JS-PARSE,CHECKER-INTERNAL,CHECKER-LIMIT':'EJS:L1-L7; EJS-PARSE,JS-PARSE,CHECKER-INTERNAL,CHECKER-LIMIT',
    files:books.map(book=>({fileName:book.fileName,size:book.size,type:book.type,items:book.entries.length,ejsEntries:book.entries.filter(entry=>entry.hasEjs).length})),findings,
  };
}

export function analyzeProjectCodeV2(inputs) { return analyze(inputs, true); }
export function analyzeLocalProjectCode(inputs) { return analyze(inputs, false); }
