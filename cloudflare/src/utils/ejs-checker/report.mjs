import { sourceLocation } from './source-units.mjs';
const OFFICIAL_URL_RULES=[
  {host:'testingcf.jsdelivr.net',path:/^\/gh\/StageDog\/tavern_resource(?:\/|$)/i},
  {host:'cdn.jsdelivr.net',path:/^\/gh\/StageDog\/tavern_resource(?:\/|$)/i},
  {host:'raw.githubusercontent.com',path:/^\/StageDog\/tavern_resource(?:\/|$)/i},
  {host:'github.com',path:/^\/zonde306\/ST-Prompt-Template(?:\/|$)/i}
];

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
  const candidates=[json&&json.entries,json&&json.data&&json.data.entries,json&&json.world_info&&json.world_info.entries];
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
  if(isRegexScript(json))list=[json];
  else if(Array.isArray(json))list=json.filter(isRegexScript);
  else{
    for(const key of ['regex_scripts','regexScripts','scripts']){
      if(Array.isArray(json&&json[key])){list=json[key].filter(isRegexScript);if(list.length)break}
    }
  }
  if(!list.length)throw new Error('找不到世界书 entries 或正则脚本 replaceString');
  return list.map((value,i)=>({
    id:bookOrder+':'+fileName+':regex:'+i,fileName,bookOrder,entryOrder:i,key:String(i),uid:value.id??i,
    name:value.scriptName||value.name||('Regex '+(i+1)),content:String(value.replaceString||''),
    isPrivate:false,hasEjs:false,sourceType:'regex',symbols:[],findRegex:String(value.findRegex||'')
  }));
}
function findingVisibility(ruleId){
  if(/^L[1-7]$/.test(ruleId)||ruleId==='EJS-PARSE'||ruleId==='FILE'||ruleId==='JS-PARSE'||ruleId==='CHECKER-INTERNAL')return'uploader_detailed';
  if(['M1','M2','M5'].includes(ruleId))return'uploader_generic';
  return'reviewer_only';
}
function finding(ruleId,severity,title,entry,index,detail,suggestion,extra={}){
  const source=extra.sourceText||(entry?entry.rawContent||entry.content:'');
  const pos=entry?sourceLocation(source,index||0):{line:extra.line||1,column:extra.column||1};
  return{ruleId,severity,title,detail,suggestion,visibility:findingVisibility(ruleId),entryId:entry?entry.id:(extra.entryId||''),book:entry?entry.fileName:(extra.book||''),entry:extra.entry??(entry?entry.name:''),uid:extra.uid??(entry?entry.uid:''),line:pos.line,column:pos.column,index:index||0,bookOrder:entry?entry.bookOrder:(extra.bookOrder??999999),entryOrder:entry?entry.entryOrder:(extra.entryOrder??999999),...(extra.relatedEntryIds?{relatedEntryIds:extra.relatedEntryIds}:{})};
}
function collectDirectUrls(content){
  const out=[],absolute=/https?:\/\/[^\s"'<>\\)]+/gi,protocolRelative=/(^|[\s"'(=,])\/\/((?:\[[0-9A-Fa-f:]+\]|(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(?:[^\s"'<>\\)]*)?)/gm;let m;
  while((m=absolute.exec(content))){
    const url=m[0].replace(/[;,\]\}]+$/,'');
    if(/^http:\/\/www\.w3\.org\/(?:2000\/svg|1999\/xlink)$/i.test(url))continue;
    out.push({url,index:m.index});
  }
  while((m=protocolRelative.exec(content))){
    const raw='//'+m[2],url=raw.replace(/[;,\]\}]+$/,''),index=m.index+m[1].length;
    out.push({url,index});
  }
  return out.sort((a,b)=>a.index-b.index);
}
function isIpHost(host){
  const h=host.replace(/^\[|\]$/g,'');if(h.includes(':'))return true;
  const p=h.split('.');return p.length===4&&p.every(x=>/^\d{1,3}$/.test(x)&&Number(x)>=0&&Number(x)<=255);
}
function parseDirectUrl(url){return new URL(String(url).startsWith('//')?'https:'+url:url)}
function isOfficialUrl(url){
  try{const u=parseDirectUrl(url);return OFFICIAL_URL_RULES.some(r=>u.hostname.toLowerCase()===r.host&&r.path.test(u.pathname))}
  catch{return false}
}
function inspectLinks(entry,findings,u2SeenHosts){
  const seen=new Set();
  for(const item of collectDirectUrls(entry.content)){
    let u;try{u=parseDirectUrl(item.url)}catch{continue}
    const host=u.hostname.toLowerCase(),key=u.protocol+'//'+host;
    if(isIpHost(host)){
      if(!seen.has('U4:'+key)){seen.add('U4:'+key);findings.push(finding('U4','warn','外链使用 IP 直连',entry,item.index,item.url,'改用可识别、可审核的 HTTPS 域名；若确有必要，请明确说明用途。'))}
    }else if(u.protocol==='http:'){
      if(!seen.has('U3:'+key)){seen.add('U3:'+key);findings.push(finding('U3','warn','外链使用不安全 HTTP',entry,item.index,item.url,'改成 HTTPS；若目标不支持 HTTPS，不建议把它作为项目依赖。'))}
    }else if(!isOfficialUrl(item.url)){
      if(!u2SeenHosts.has(host)){u2SeenHosts.add(host);findings.push(finding('U2','warn','外链来自未确认的第三方域名',entry,item.index,host,'确认这个域名确实是项目需要的资源来源。相同域名在本次扫描中只提示一次，避免跨条目/文件刷屏。'))}
    }
  }
  const dynamicPatterns=[
    /(?:https?:)?\/\/[^\s"'<>\\)]*(?:\x24\d+|\x24<[A-Za-z][\w]*>)[^\s"'<>\\)]*/gi,
    /(['"])(?:https?:)?\/\/[^'"]*\1\s*\+\s*(?!\s*['"])/gi,
    /`(?:https?:)?\/\/[^`]*\${[^}]+}[^`]*`/gi
  ];
  for(const re of dynamicPatterns){
    let m;while((m=re.exec(entry.content))){
      const key='U5:'+m.index;if(seen.has(key))continue;seen.add(key);
      findings.push(finding('U5','warn','远程资源目标不是固定可审阅集合',entry,m.index,m[0].slice(0,220),'把可能访问的远程资源写成有限、明确的 URL 映射。像 mood → 固定 URL 可以；不要让 $1/$2、命名 capture 或任意变量直接决定远程文件路径。'));
    }
  }
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
  const visible=report.findings.filter(f=>f.visibility!=='reviewer_only').map(f=>{
    if(f.visibility!=='uploader_generic')return f;
    return{
      ruleId:'SCRIPT-RISK',
      severity:'high',
      title:'脚本未通过 Workshop 自动安全规则',
      detail:'请移除 Workshop 不允许的高风险脚本能力后重新提交。具体检测细节只提供给审核员。',
      suggestion:'修改脚本后重新上传。',
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
  if(first.ruleId==='SCRIPT-RISK')return where+'：脚本包含 Workshop 不允许的高风险能力，请修改后重新上传。';
  return where+'：['+first.ruleId+'] '+first.title+'（第 '+first.line+' 行，第 '+first.column+' 列）。'+first.suggestion;
}

export { parseCodeCheckInput, finding, inspectDecorators, inspectLinks, compareFindings, gateStatus, auditStatus, certificationStatus };
