import { sourceLocation } from './source-units.mjs';
import { inspectExternalLinks } from './links.mjs';

function parseDecorators(content){
  const src=String(content||''),decorators=[],validStarts=new Set();let cursor=0;
  if(src.startsWith('@@')&&!src.startsWith('@@@')){
    while(cursor<src.length&&src.startsWith('@@',cursor)&&!src.startsWith('@@@',cursor)){
      let end=src.indexOf('\n',cursor);if(end<0)end=src.length;
      const rawLine=src.slice(cursor,end).replace(/\r$/,'');
      decorators.push({text:rawLine.trim(),index:cursor});validStarts.add(cursor);
      if(end===src.length){cursor=end;break}
      cursor=end+1;
    }
  }
  const invalidDecorators=[],re=/^@@(?!@)[^\r\n]*/gm;let m;
  while((m=re.exec(src)))if(!validStarts.has(m.index))invalidDecorators.push({text:m[0].trim(),index:m.index});
  const names=decorators.map(x=>x.text.split(/\s+/,1)[0]);
  return{decorators,isPrivate:names.includes('@@private'),invalidDecorators};
}
function worldbookEntries(json){
  const candidates=[json&&json.entries,json&&json.data&&json.data.entries,json&&json.world_info&&json.world_info.entries,json&&json.character_book&&json.character_book.entries,json&&json.data&&json.data.character_book&&json.data.character_book.entries,json&&json.characterBook&&json.characterBook.entries,json&&json.data&&json.data.characterBook&&json.data.characterBook.entries];
  return candidates.find(x=>x&&(typeof x==='object'||Array.isArray(x)));
}
function extractEntries(json,fileName,bookOrder){
  const raw=worldbookEntries(json);
  if(!raw||(typeof raw!=='object'&&!Array.isArray(raw)))throw new Error('找不到世界书 entries');
  const list=Array.isArray(raw)?raw.map((v,i)=>[String(i),v]):Object.entries(raw),out=[];let order=0;
  for(const [key,value] of list){
    if(!value||typeof value!=='object'||typeof value.content!=='string')continue;
    const rawContent=String(value.content),parsed=parseDecorators(rawContent),content=rawContent;
    out.push({id:bookOrder+':'+fileName+':'+key,fileName,bookOrder,entryOrder:order++,key,uid:value.uid??key,name:value.comment||value.name||('Entry '+key),rawContent,content,isPrivate:parsed.isPrivate,decoratorIssues:parsed.invalidDecorators,hasEjs:content.includes('<%'),sourceType:'worldbook',symbols:[]});
  }
  return out;
}
function isRegexScript(value){
  return !!value&&typeof value==='object'&&typeof value.replaceString==='string'&&(typeof value.findRegex==='string'||typeof value.scriptName==='string'||typeof value.id==='string');
}
function extractRegexScripts(json,fileName,bookOrder){
  let list=[];
  if(isRegexScript(json))list=[[0,json]];
  else if(Array.isArray(json)){
    if(!json.length)return [];
    list=json.map((value,index)=>[index,value]).filter(([,value])=>isRegexScript(value));
  }
  else{
    if(json&&typeof json==='object'&&json.entries&&typeof json.entries==='object'&&!Object.keys(json.entries).length)return [];
    for(const key of ['regex_scripts','regexScripts','scripts']){
      if(Array.isArray(json&&json[key])){list=json[key].map((value,index)=>[index,value]).filter(([,value])=>isRegexScript(value));if(list.length)break}
    }
  }
  if(!list.length)throw new Error('找不到世界书 entries 或正则脚本 replaceString');
  return list.map(([i,value])=>({
    id:bookOrder+':'+fileName+':regex:'+i,fileName,bookOrder,entryOrder:i,key:String(i),uid:value.id??i,
    name:value.scriptName||value.name||('Regex '+(i+1)),content:String(value.replaceString||''),
    isPrivate:false,hasEjs:false,sourceType:'regex',symbols:[],findRegex:String(value.findRegex||'')
  }));
}
function findingVisibility(ruleId){
  if(/^L[1-7]$/.test(ruleId)||ruleId==='EJS-PARSE'||ruleId==='FILE'||ruleId==='JS-PARSE'||ruleId==='CHECKER-INTERNAL'||ruleId==='CHECKER-LIMIT')return'uploader_detailed';
  if(['M1','M2','M5'].includes(ruleId))return'uploader_generic';
  return'reviewer_only';
}
function finding(ruleId,severity,title,entry,index,detail,suggestion,extra={}){
  const source=extra.sourceText||(entry?entry.rawContent||entry.content:'');
  const pos=entry?sourceLocation(source,index||0):{line:extra.line||1,column:extra.column||1};
  return{ruleId,severity,title,detail,suggestion,visibility:findingVisibility(ruleId),entryId:entry?entry.id:(extra.entryId||''),book:entry?entry.fileName:(extra.book||''),entry:extra.entry??(entry?entry.name:''),uid:extra.uid??(entry?entry.uid:''),line:pos.line,column:pos.column,index:index||0,bookOrder:entry?entry.bookOrder:(extra.bookOrder??999999),entryOrder:entry?entry.entryOrder:(extra.entryOrder??999999),...(extra.relatedEntryIds?{relatedEntryIds:extra.relatedEntryIds}:{}),...(extra.riskEvidence?{riskEvidence:extra.riskEvidence}:{})};
}
function inspectLinks(entry,findings,parsed){
  for(const record of inspectExternalLinks(entry,parsed))findings.push(finding(record.ruleId,record.severity,record.title,entry,record.index,record.detail,record.suggestion,record.extra));
}
function inspectDecorators(entry,findings){
  if(entry.sourceType!=='worldbook'||!entry.decoratorIssues||!entry.decoratorIssues.length)return;
  const issue=entry.decoratorIssues[0],privateInvalid=entry.decoratorIssues.some(x=>x.text.split(/\s+/,1)[0]==='@@private');
  const count=entry.decoratorIssues.length;
  findings.push(finding('L7','high','Decorator 位置 / 结构错误（Workshop 公约阻断）',entry,issue.index,
    (privateInvalid?'检测到未处于合法开头 decorator 区的 @@private。该 entry 不会获得 private scope 豁免；':'检测到未处于合法开头连续区域的 decorator。')+
    (count>1?' 本条目共有 '+count+' 个位置错误的 decorator。':'')+
    ' ST-Prompt-Template 只从 entry 的第一个字符开始连续解析 decorator；前导空行、EJS/metadata、普通文本，或 decorator 区中间被空行/正文打断，都会让后面的 decorator 失效。',
    '把所有需要生效的 @@... decorator 移到 entry 的真实第一行并连续排列，中间不要插入空行、EJS、HTML 或普通文本。先修 L7，再重新检查 L1–L6；位置错误的 @@private 不得作为隔离依据。',
    {sourceText:entry.rawContent||entry.content}));
}
function compareFindings(a,b){return a.bookOrder-b.bookOrder||a.entryOrder-b.entryOrder||a.line-b.line||a.ruleId.localeCompare(b.ruleId,'en')}
function gateStatus(findings){return findings.some(f=>f.severity==='high')?'reject':'accept'}
function auditStatus(findings){
  if(gateStatus(findings)==='reject')return'not_applicable';
  return findings.some(f=>f.severity==='warn'||f.severity==='hint')?'yellow':'green';
}
function certificationStatus(findings){
  if(findings.some(f=>f.severity==='high'))return'fail';
  if(findings.some(f=>f.severity==='warn'))return'review';
  return'pass';
}

function parseCodeCheckInput(input, bookOrder){
  const fileName=String(input?.fileName||('upload-'+(bookOrder+1)+'.json'));
  const text=String(input?.text??'');
  const type=input?.type==='regex'?'regex':'worldbook';
  const json=JSON.parse(text);
  const entries=type==='worldbook'
    ? extractEntries(json,fileName,bookOrder)
    : extractRegexScripts(json,fileName,bookOrder);
  return{fileName,size:new TextEncoder().encode(text).byteLength,bookOrder,type,entries};
}

export function toUploaderCodeCheck(report){
  if(!report || !Array.isArray(report.findings) || !['accept','reject'].includes(report.gate))throw new TypeError('代码检查未完成，不能继续提交。');
  const visible=report.findings.filter(f=>f.visibility!=='reviewer_only'||['M3','M4'].includes(f.ruleId)).map(f=>{
    if(['M3','M4'].includes(f.ruleId))return{ruleId:'SCRIPT-REVIEW',severity:'warn',title:'这段脚本需要额外审核',detail:'上传可以继续。审核员会进一步确认这段脚本的用途与影响；这条提示不代表违规。',suggestion:'如审核员需要补充说明，请介绍这项功能为何必要。',visibility:'uploader_generic',book:f.book||'',entry:f.entry||'',uid:f.uid??'',line:f.line||1,column:f.column||1};
    if(f.visibility!=='uploader_generic')return f;
    const behavior={
      M1:{title:'检测到动态代码执行 eval()',detail:'这段代码使用或保存了 eval 能力，可能执行运行时生成的代码，工坊不接受。',suggestion:'请改为明确的函数调用或固定逻辑，再重新上传。'},
      M2:{title:'检测到动态创建函数',detail:'这段代码使用或保存了通过 Function(...) 动态生成函数的能力，工坊不接受。',suggestion:'请改用普通函数或明确的分支逻辑，再重新上传。'},
      M5:{title:'检测到可能无法自行结束的循环',detail:'这段循环没有明确的结束条件，可能导致页面卡死。',suggestion:'请设置清楚可靠的结束条件，再重新上传。'},
    }[f.ruleId];
    return{
      ruleId:'SCRIPT-RISK',
      severity:'high',
      ...behavior,
      visibility:'uploader_generic',
      book:f.book||'',
      entry:f.entry||'',
      uid:f.uid??'',
      line:f.line||1,
      column:f.column||1,
    };
  });
  return{
    standard:report.standard,
    engine:report.engine,
    parserCompatibility:report.parserCompatibility,
    gate:report.gate,
    findings:visible,
  };
}

export function formatUploaderCodeCheckError(report){
  const uploader=toUploaderCodeCheck(report);
  if(uploader.gate!=='reject')return '';
  const first=uploader.findings.find(f=>f.severity==='high');
  if(!first)return '文件没有通过自动检查，请修改脚本后重新上传。';
  const where=first.entry ? '「'+first.entry+'」' : (first.book ? '「'+first.book+'」' : '文件');
  if(first.ruleId==='SCRIPT-RISK')return where+'：'+first.title+'（第 '+first.line+' 行，第 '+first.column+' 列）。'+first.suggestion;
  return where+'：['+first.ruleId+'] '+first.title+'（第 '+first.line+' 行，第 '+first.column+' 列）。'+first.suggestion;
}

export { parseCodeCheckInput, finding, inspectDecorators, inspectLinks, compareFindings, gateStatus, auditStatus, certificationStatus };
