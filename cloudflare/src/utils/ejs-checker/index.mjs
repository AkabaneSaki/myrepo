import { parseEjs, parseRegex } from './syntax.mjs';
import { inspectAstPolicy, inspectSymbolCollisions } from './policy.mjs';
import { inspectCapabilities } from './capabilities.mjs';
import { inspectApiUsage } from './api-catalogue.mjs';
import { syntaxFindings } from './syntax-findings.mjs';
import { CHECK_POLICY_VERSION } from './policy-config.mjs';
import { parseCodeCheckInput, finding, inspectDecorators, inspectLinks, compareFindings, gateStatus, auditStatus, certificationStatus } from './report.mjs';

export const CHECKER_VERSION = Object.freeze({
  engine:'v2',
  policyVersion:CHECK_POLICY_VERSION,
  parserCompatibility:'EJS 3.1.9 / ST nested tags; Acorn 8.18.0; HTML parse5 8.0.1',
});

function worldbookHtml(entry, parsed) {
  const ranges = parsed.units.find(unit=>unit.kind==='ejs')?.templateRanges;
  if (!ranges) return {units:[],errors:[],internalErrors:[]};
  const chars = entry.content.split('');
  for (const range of ranges) {
    for (let i=range.start;i<range.end;i++) if(chars[i]!=='\n'&&chars[i]!=='\r')chars[i]=' ';
    if(range.mode==='='||range.mode==='-')chars[range.start]='0';
  }
  const html = parseRegex(chars.join(''));
  // EJS output inside a script/attribute can generate arbitrary JavaScript.
  // Its final syntax is unknowable without running the template. Check the
  // actual EJS AST and fully static HTML units; never invent an author error.
  const staticUnits=html.units.filter(unit=>!unit.codeRanges.some(codeRange=>ranges.some(range=>range.mode!=='#'&&range.start<codeRange.originalEnd&&range.end>codeRange.originalStart)));
  return {units:staticUnits,errors:staticUnits.flatMap(unit=>unit.mappedError?[unit.mappedError]:[]),internalErrors:html.internalErrors};
}

export function analyzeProjectCodeV2(inputs) {
  const books=[],findings=[];
  const add=(entry,record)=>findings.push(finding(record.ruleId,record.severity,record.title,entry,record.index,record.detail,record.suggestion,record.extra));
  for(const [bookOrder,input] of (Array.isArray(inputs)?inputs:[]).entries()) {
    try { books.push(parseCodeCheckInput(input,bookOrder)); }
    catch(error) {
      findings.push(finding('FILE','high','无法读取文件',null,0,String(error.message),'确认这是有效的世界书或正则文件，然后重新选择。',{book:String(input?.fileName??''),bookOrder,entryOrder:-1}));
    }
  }
  const entries=books.flatMap(book=>book.entries);
  for(const entry of entries) {
    inspectDecorators(entry,findings);
    const ejs=entry.sourceType==='worldbook'&&entry.hasEjs?parseEjs(entry.content,{privateScope:entry.isPrivate}):{units:[],errors:[],internalErrors:[]};
    const html=entry.sourceType==='regex'||!entry.hasEjs?parseRegex(entry.content):worldbookHtml(entry,ejs);
    for(const record of syntaxFindings(entry,ejs))add(entry,record);
    for(const record of syntaxFindings({...entry,sourceType:'regex'},html))add(entry,record);
    const parsed={units:[...ejs.units,...html.units],errors:[...ejs.errors,...html.errors],internalErrors:[...ejs.internalErrors,...html.internalErrors]};
    const policy=inspectAstPolicy(entry,parsed);
    entry.symbols=policy.symbols;
    for(const record of policy.findings)add(entry,record);
    for(const record of inspectCapabilities(entry,parsed))add(entry,record);
    for(const record of inspectApiUsage(entry,parsed))add(entry,record);
    inspectLinks(entry,findings,parsed);
  }
  for(const record of inspectSymbolCollisions(entries))add(record.entry,record);
  findings.sort(compareFindings);
  return {
    generatedAt:new Date().toISOString(),tool:'Poem Workshop EJS / Regex Check',standard:'PW-CODE-CHECK-v1',...CHECKER_VERSION,
    gate:gateStatus(findings),audit:auditStatus(findings),certification:certificationStatus(findings),
    rules:'EJS:L1-L7; COMMON:M1-M5,U2-U5; API:API1-API2; HINTS:AH1-AH4; EJS-PARSE,JS-PARSE,CHECKER-INTERNAL',
    files:books.map(book=>({fileName:book.fileName,size:book.size,type:book.type,items:book.entries.length,ejsEntries:book.entries.filter(entry=>entry.hasEjs).length})),findings,
  };
}
