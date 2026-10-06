// Generated from the approved util/ejs-preflight.html rule engine.
// Runtime copy intentionally avoids eval/new Function because Cloudflare Workers disallow dynamic code evaluation.
// Keep semantic rule changes in sync with util/ejs-preflight.html and cloudflare/tests/ejs-preflight-gate.mjs.

const MAX_FILE_BYTES=12*1024*1024;
const WORKSHOP_META_RE=/<%#\s*poem-workshop-meta:v1-start[\s\S]*?poem-workshop-meta:v1-end\s*%>/gi;
const GENERIC_GLOBAL_NAMES=new Set(['data','value','result','state','temp','tmp','config','ctx','context','output','response','item']);
const SENSITIVE_STORAGE_WORDS=new Set(['token','auth','session','password','passwd','secret','cookie','credential','bearer']);
const OFFICIAL_URL_RULES=[
  {host:'testingcf.jsdelivr.net',path:/^\/gh\/StageDog\/tavern_resource(?:\/|$)/i},
  {host:'cdn.jsdelivr.net',path:/^\/gh\/StageDog\/tavern_resource(?:\/|$)/i},
  {host:'raw.githubusercontent.com',path:/^\/StageDog\/tavern_resource(?:\/|$)/i},
  {host:'github.com',path:/^\/zonde306\/ST-Prompt-Template(?:\/|$)/i}
];

function preserveLines(text){return String(text||'').replace(WORKSHOP_META_RE,m=>'\n'.repeat((m.match(/\n/g)||[]).length))}
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
    const rawContent=String(value.content),parsed=parseDecorators(rawContent),content=preserveLines(rawContent);
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
function lineFromIndex(text,index){return(text.slice(0,Math.max(0,index)).match(/\n/g)||[]).length+1}
function blankRange(chars,start,end){for(let i=start;i<end;i++)if(chars[i]!=='\n')chars[i]=' '}
function ejsCodeMask(content){
  const out=Array.from(content,ch=>ch==='\n'?'\n':' ');let cursor=0;
  while(cursor<content.length){
    const open=content.indexOf('<%',cursor);if(open<0)break;
    if(content.startsWith('<%%',open)){cursor=open+3;continue}
    let pos=open+2,mode='',mark=content[pos]||'';if('=_-#'.includes(mark)){mode=mark;pos++}
    const close=findEjsClose(content,pos);if(close<0)break;
    let end=close;if(content[end-1]==='-'||content[end-1]==='_')end--;
    if(mode!=='#')for(let i=pos;i<end;i++)out[i]=content[i];
    cursor=close+2;
  }
  return out.join('');
}
function looksLikeRegexStart(a,index){
  let j=index-1;while(j>=0&&/\s/.test(a[j]))j--;
  if(j<0)return true;
  if('([{:;,=!?&|+-*%^~<>'.includes(a[j]))return true;
  if(a[j]===')'){
    let depth=1,k=j-1;
    for(;k>=0;k--){if(a[k]===')')depth++;else if(a[k]==='('&&--depth===0)break}
    if(k>=0){
      let p=k-1;while(p>=0&&/\s/.test(a[p]))p--;
      const end=p+1;while(p>=0&&/[A-Za-z_$]/.test(a[p]))p--;
      if(['if','while','for','with','catch','switch'].includes(a.slice(p+1,end).join('')))return true;
    }
  }
  let end=j+1;while(j>=0&&/[A-Za-z_$]/.test(a[j]))j--;
  const word=a.slice(j+1,end).join('');
  return['return','throw','case','delete','void','typeof','instanceof','in','of','yield','await','else','do'].includes(word);
}
function maskStringsAndComments(code){
  const src=code.split(''),out=code.split('');
  const blank=(start,end)=>blankRange(out,start,end);
  const scanQuoted=(start,quote)=>{
    let i=start+1;
    while(i<src.length){
      if(src[i]==='\\'){i=Math.min(src.length,i+2);continue}
      if(src[i]===quote){i++;break}
      i++;
    }
    blank(start,i);return i;
  };
  const scanLineComment=(start)=>{let i=start+2;while(i<src.length&&src[i]!=='\n')i++;blank(start,i);return i};
  const scanBlockComment=(start)=>{
    let i=start+2;while(i<src.length-1&&!(src[i]==='*'&&src[i+1]==='/'))i++;
    i=Math.min(src.length,i+2);blank(start,i);return i;
  };
  const scanRegex=(start)=>{
    let i=start+1,inClass=false,closed=false;
    while(i<src.length){
      if(src[i]==='\\'){i=Math.min(src.length,i+2);continue}
      if(src[i]==='\n')break;
      if(src[i]==='['){inClass=true;i++;continue}
      if(src[i]===']'){inClass=false;i++;continue}
      if(src[i]==='/'&&!inClass){i++;while(i<src.length&&/[A-Za-z]/.test(src[i]))i++;closed=true;break}
      i++;
    }
    if(closed){blank(start,i);return i}
    return start+1;
  };
  let scanJs,scanTemplate;
  scanTemplate=(start)=>{
    blank(start,start+1);let i=start+1;
    while(i<src.length){
      const c=src[i],n=src[i+1];
      if(c==='\\'){const end=Math.min(src.length,i+2);blank(i,end);i=end;continue}
      if(c.charCodeAt(0)===96){blank(i,i+1);return i+1}
      if(c.charCodeAt(0)===36&&n==='{'){
        out[i]=' ';out[i+1]='(';
        const end=scanJs(i+2,true);
        if(end<src.length&&src[end]==='}'){out[end]=')';i=end+1;continue}
        return end;
      }
      blank(i,i+1);i++;
    }
    return i;
  };
  scanJs=(start,untilTemplateClose)=>{
    let i=start,braceDepth=0;
    while(i<src.length){
      const c=src[i],n=src[i+1];
      if(c==='/'&&n==='/'){i=scanLineComment(i);continue}
      if(c==='/'&&n==='*'){i=scanBlockComment(i);continue}
      if(c==='/'&&looksLikeRegexStart(src,i)){const next=scanRegex(i);if(next!==i+1){i=next;continue}}
      if(c==="'"||c==='"'){i=scanQuoted(i,c);continue}
      if(c.charCodeAt(0)===96){i=scanTemplate(i);continue}
      if(untilTemplateClose&&c==='{'){braceDepth++;i++;continue}
      if(untilTemplateClose&&c==='}'){if(braceDepth===0)return i;braceDepth--;i++;continue}
      i++;
    }
    return i;
  };
  scanJs(0,false);
  return out.join('');
}
function findEjsClose(content,start){return content.indexOf('%>',start)}
function matchingClose(text,open,openChar,closeChar){
  let depth=1;
  for(let i=open+1;i<text.length;i++){if(text[i]===openChar)depth++;else if(text[i]===closeChar&&--depth===0)return i}
  return-1;
}
function inForHeader(clean,index){
  let nested=0;
  for(let i=index-1;i>=0;i--){
    if(clean[i]===')'){nested++;continue}
    if(clean[i]!=='(')continue;
    if(nested){nested--;continue}
    return/\bfor(?:\s+await)?\s*$/.test(clean.slice(0,i));
  }
  return false;
}
function functionRanges(clean){
  const ranges=[],seen=new Set(),add=open=>{if(open<0||seen.has(open))return;const close=matchingClose(clean,open,'{','}');if(close>=0){seen.add(open);ranges.push([open+1,close])}};
  const stack=[],control=new Set(['if','for','while','switch','catch','with']);
  for(let i=0;i<clean.length;i++){
    if(clean[i]==='('){stack.push(i);continue}
    if(clean[i]!==')'||!stack.length)continue;
    const openParen=stack.pop();let after=i+1;while(after<clean.length&&/\s/.test(clean[after]))after++;
    if(clean.slice(after,after+2)=='=>'){
      after+=2;while(after<clean.length&&/\s/.test(clean[after]))after++;if(clean[after]==='{')add(after);continue;
    }
    if(clean[after]!=='{')continue;
    let before=openParen-1;while(before>=0&&/\s/.test(clean[before]))before--;
    const prefix=clean.slice(Math.max(0,before-180),before+1),functionLike=/\b(?:async\s+)?function\s*\*?\s*(?:[A-Za-z_$][\w$]*)?$/.test(prefix),methodName=/([A-Za-z_$][\w$]*)\s*$/.exec(prefix);
    if(functionLike||(methodName&&!control.has(methodName[1])))add(after);
  }
  const singleArrow=/\b(?:async\s+)?[A-Za-z_$][\w$]*\s*=>\s*\{/g;let m;
  while((m=singleArrow.exec(clean)))add(m.index+m[0].lastIndexOf('{'));
  return ranges;
}
function insideRanges(index,ranges){return ranges.some(([start,end])=>index>=start&&index<end)}
function trimSpan(text,start,end){
  while(start<end&&/\s/.test(text[start]))start++;
  while(end>start&&/\s/.test(text[end-1]))end--;
  return[start,end];
}
function findTopLevelToken(text,start,end,token){
  let paren=0,bracket=0,brace=0;
  for(let i=start;i<end;i++){
    const c=text[i];
    if(c==='(')paren++;
    else if(c===')')paren=Math.max(0,paren-1);
    else if(c==='[')bracket++;
    else if(c===']')bracket=Math.max(0,bracket-1);
    else if(c==='{')brace++;
    else if(c==='}')brace=Math.max(0,brace-1);
    else if(c===token&&paren===0&&bracket===0&&brace===0)return i;
  }
  return-1;
}
function findTopLevelDefaultEquals(text,start,end){
  let paren=0,bracket=0,brace=0;
  for(let i=start;i<end;i++){
    const c=text[i];
    if(c==='(')paren++;
    else if(c===')')paren=Math.max(0,paren-1);
    else if(c==='[')bracket++;
    else if(c===']')bracket=Math.max(0,bracket-1);
    else if(c==='{')brace++;
    else if(c==='}')brace=Math.max(0,brace-1);
    else if(c==='='&&paren===0&&bracket===0&&brace===0){
      const prev=text[i-1]||'',next=text[i+1]||'';
      if(!/[=<>!+\-*\/%?&|]/.test(prev)&&next!=='='&&next!=='>')return i;
    }
  }
  return-1;
}
function splitTopLevelSpans(text,start,end,separator=','){
  const spans=[];let partStart=start,paren=0,bracket=0,brace=0;
  for(let i=start;i<end;i++){
    const c=text[i];
    if(c==='(')paren++;
    else if(c===')')paren=Math.max(0,paren-1);
    else if(c==='[')bracket++;
    else if(c===']')bracket=Math.max(0,bracket-1);
    else if(c==='{')brace++;
    else if(c==='}')brace=Math.max(0,brace-1);
    else if(c===separator&&paren===0&&bracket===0&&brace===0){spans.push([partStart,i]);partStart=i+1}
  }
  spans.push([partStart,end]);return spans;
}
function findEmptyConditionFor(clean){
  const re=/\bfor\s*\(/g;let m;
  while((m=re.exec(clean))){
    const open=clean.indexOf('(',m.index),close=matchingClose(clean,open,'(',')');if(close<0)continue;
    const spans=splitTopLevelSpans(clean,open+1,close,';');
    if(spans.length===3){const middle=trimSpan(clean,spans[1][0],spans[1][1]);if(middle[0]===middle[1])return{index:m.index,0:clean.slice(m.index,close+1)}}
    re.lastIndex=close+1;
  }
  return null;
}
const JS_IDENTIFIER_RE=/^[$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*$/u;
const JS_IDENTIFIER_SOURCE='[$_\\p{ID_Start}][$_\\u200C\\u200D\\p{ID_Continue}]*';
const JS_IDENTIFIER_CONT_SOURCE='$_\\u200C\\u200D\\p{ID_Continue}';
function isJsIdentifierName(value){return JS_IDENTIFIER_RE.test(value)}
function collectBindingInfo(text,start,end,names,assignmentStarts){
  [start,end]=trimSpan(text,start,end);if(start>=end)return;
  if(text.slice(start,start+3)==='...'){start+=3;[start,end]=trimSpan(text,start,end);if(start>=end)return}
  const eq=findTopLevelDefaultEquals(text,start,end),patternEnd=eq>=0?eq:end;
  let ps=start,pe=patternEnd;[ps,pe]=trimSpan(text,ps,pe);if(ps>=pe)return;
  const simple=text.slice(ps,pe);
  if(isJsIdentifierName(simple)){
    if(names)names.push({name:simple,index:ps});
    if(eq>=0&&assignmentStarts)assignmentStarts.add(ps);
    return;
  }
  if(text[ps]==='{'&&text[pe-1]==='}'){
    for(const span of splitTopLevelSpans(text,ps+1,pe-1)){
      let [s,e]=trimSpan(text,span[0],span[1]);if(s>=e)continue;
      if(text.slice(s,s+3)==='...'){collectBindingInfo(text,s+3,e,names,assignmentStarts);continue}
      const colon=findTopLevelToken(text,s,e,':');
      collectBindingInfo(text,colon>=0?colon+1:s,e,names,assignmentStarts);
    }
    return;
  }
  if(text[ps]==='['&&text[pe-1]===']'){
    for(const span of splitTopLevelSpans(text,ps+1,pe-1))collectBindingInfo(text,span[0],span[1],names,assignmentStarts);
  }
}
function collectBindingDefaultStarts(text,start,end,out){collectBindingInfo(text,start,end,null,out)}
function parameterBindingAssignmentStarts(clean){
  const out=new Set(),stack=[],control=new Set(['if','for','while','switch','catch','with']);
  for(let i=0;i<clean.length;i++){
    const c=clean[i];
    if(c==='('){stack.push(i);continue}
    if(c!==')'||!stack.length)continue;
    const open=stack.pop(),close=i;let after=close+1;
    while(after<clean.length&&/\s/.test(clean[after]))after++;
    let before=open-1;while(before>=0&&/\s/.test(clean[before]))before--;
    const prefix=clean.slice(Math.max(0,before-160),before+1);
    const functionParams=/\b(?:async\s+)?function\s*\*?\s*(?:[A-Za-z_$][\w$]*)?$/.test(prefix);
    const arrowParams=clean.slice(after,after+2)==='=>';
    const methodName=/([A-Za-z_$][\w$]*)\s*$/.exec(prefix);
    const methodParams=clean[after]==='{'&&methodName&&!control.has(methodName[1]);
    if(!functionParams&&!arrowParams&&!methodParams)continue;
    for(const span of splitTopLevelSpans(clean,open+1,close))collectBindingDefaultStarts(clean,span[0],span[1],out);
  }
  return out;
}
function declarationEnd(clean,start){
  let paren=0,bracket=0,brace=0,sawTopLevelEquals=false;
  for(let i=start;i<clean.length;i++){
    const c=clean[i];
    if(c==='('){paren++;continue}
    if(c===')'){if(paren===0&&bracket===0&&brace===0)return i;paren=Math.max(0,paren-1);continue}
    if(c==='['){bracket++;continue}
    if(c===']'){bracket=Math.max(0,bracket-1);continue}
    if(c==='{'){brace++;continue}
    if(c==='}'){if(brace===0&&paren===0&&bracket===0)return i;brace=Math.max(0,brace-1);continue}
    if(paren||bracket||brace)continue;
    if(c===';')return i;
    if(c==='='&&findTopLevelDefaultEquals(clean,i,i+1)===i){sawTopLevelEquals=true;continue}
    if(!sawTopLevelEquals&&(clean.slice(i,i+2)==='of'||clean.slice(i,i+2)==='in')){
      const before=clean[i-1]||' ',after=clean[i+2]||' ';
      if(!/[\w$]/.test(before)&&!/[\w$]/.test(after))return i;
    }
    if(c==='\n'){
      let j=i-1;while(j>=start&&/\s/.test(clean[j]))j--;
      if(j<start||!/[=,([{.+\-*\/%?:&|]/.test(clean[j]))return i;
    }
  }
  return clean.length;
}
function collectDeclarations(clean){
  const out=[],re=/\b(var|let|const)\b/g;let m;
  while((m=re.exec(clean))){
    let prev=m.index-1;while(prev>=0&&/\s/.test(clean[prev]))prev--;
    if(clean[prev]==='.')continue;
    const start=m.index+m[0].length,end=declarationEnd(clean,start),names=[],assignmentStarts=new Set();
    for(const span of splitTopLevelSpans(clean,start,end))collectBindingInfo(clean,span[0],span[1],names,assignmentStarts);
    out.push({kind:m[1],index:m.index,end,names,assignmentStarts});
  }
  return out;
}
function depthMap(clean){
  const depth=new Int32Array(clean.length+1);let d=0;
  for(let i=0;i<clean.length;i++){depth[i]=d;if(clean[i]==='{')d++;else if(clean[i]==='}')d=Math.max(0,d-1)}
  depth[clean.length]=d;return depth;
}
function braceRanges(clean){
  const ranges=[{start:0,end:clean.length}],stack=[];
  for(let i=0;i<clean.length;i++){
    if(clean[i]==='{')stack.push(i);
    else if(clean[i]==='}'&&stack.length){const open=stack.pop();ranges.push({start:open+1,end:i})}
  }
  return ranges;
}
function innermostRange(index,ranges){
  let best=ranges[0]||{start:0,end:Number.MAX_SAFE_INTEGER};
  for(const range of ranges)if(index>=range.start&&index<range.end&&(range.end-range.start)<(best.end-best.start))best=range;
  return best;
}
function findExpressionEnd(clean,start){
  let paren=0,bracket=0,brace=0;
  for(let i=start;i<clean.length;i++){
    const c=clean[i];
    if(c==='(')paren++;
    else if(c===')'){if(paren===0&&bracket===0&&brace===0)return i;paren--}
    else if(c==='[')bracket++;
    else if(c===']'){if(bracket===0&&paren===0&&brace===0)return i;bracket--}
    else if(c==='{')brace++;
    else if(c==='}'){if(brace===0&&paren===0&&bracket===0)return i;brace--}
    else if((c===','||c===';'||c==='\n')&&paren===0&&bracket===0&&brace===0)return i;
  }
  return clean.length;
}
function functionParameterScopes(clean){
  const out=[],stack=[],control=new Set(['if','for','while','switch','with']);
  const add=(paramStart,paramEnd,bodyStart,bodyEnd)=>{
    if(bodyStart<0||bodyEnd<0||bodyEnd<bodyStart)return;
    const names=[];for(const span of splitTopLevelSpans(clean,paramStart,paramEnd))collectBindingInfo(clean,span[0],span[1],names,null);
    out.push({start:bodyStart,end:bodyEnd,paramsStart:paramStart,paramsEnd:paramEnd,names:new Set(names.map(x=>x.name))});
  };
  for(let i=0;i<clean.length;i++){
    if(clean[i]==='('){stack.push(i);continue}
    if(clean[i]!==')'||!stack.length)continue;
    const open=stack.pop(),close=i;let after=close+1;while(after<clean.length&&/\s/.test(clean[after]))after++;
    let before=open-1;while(before>=0&&/\s/.test(clean[before]))before--;
    const prefix=clean.slice(Math.max(0,before-180),before+1);
    const functionParams=/\b(?:async\s+)?function\s*\*?\s*(?:[A-Za-z_$][\w$]*)?$/.test(prefix);
    const arrowParams=clean.slice(after,after+2)==='=>';
    const methodName=/([A-Za-z_$][\w$]*)\s*$/.exec(prefix),method=methodName&&clean[after]==='{'&&!control.has(methodName[1]),catchParams=methodName&&methodName[1]==='catch'&&clean[after]==='{';
    if(arrowParams){
      let body=after+2;while(body<clean.length&&/\s/.test(clean[body]))body++;
      if(clean[body]==='{'){const end=matchingClose(clean,body,'{','}');add(open+1,close,body+1,end)}
      else add(open+1,close,body,findExpressionEnd(clean,body));
    }else if(functionParams||method||catchParams){
      if(clean[after]==='{'){const end=matchingClose(clean,after,'{','}');add(open+1,close,after+1,end)}
    }
  }
  const single=/\b(?:async\s+)?([A-Za-z_$][\w$]*)\s*=>/g;let m;
  while((m=single.exec(clean))){
    let body=m.index+m[0].length;while(body<clean.length&&/\s/.test(clean[body]))body++;
    const end=clean[body]==='{'?matchingClose(clean,body,'{','}'):findExpressionEnd(clean,body);
    out.push({start:clean[body]==='{'?body+1:body,end,paramsStart:m.index,paramsEnd:m.index+m[0].length,names:new Set([m[1]])});
  }
  return out;
}
function forScopeRange(clean,index){
  let nested=0,open=-1;
  for(let i=index-1;i>=0;i--){
    if(clean[i]===')'){nested++;continue}
    if(clean[i]!=='(')continue;
    if(nested){nested--;continue}
    if(/\bfor(?:\s+await)?\s*$/.test(clean.slice(0,i))){open=i;break}
  }
  if(open<0)return null;
  const close=matchingClose(clean,open,'(',')');if(close<0)return null;
  let after=close+1;while(after<clean.length&&/\s/.test(clean[after]))after++;
  if(clean[after]==='{'){const end=matchingClose(clean,after,'{','}');if(end>=0)return{start:open+1,end}}
  return{start:open+1,end:findExpressionEnd(clean,after)};
}
function buildBindingScopes(clean,declarations,namedBindings,fnRanges,braces,paramScopes){
  const scopes=[];
  for(const p of paramScopes)for(const name of p.names)scopes.push({name,start:p.start,end:p.end});
  for(const decl of declarations){
    let scope;
    if(decl.kind==='var'){
      const candidates=fnRanges.filter(([start,end])=>decl.index>=start&&decl.index<end).sort((a,b)=>(a[1]-a[0])-(b[1]-b[0]));
      scope=candidates.length?{start:candidates[0][0],end:candidates[0][1]}:{start:0,end:clean.length};
    }else scope=inForHeader(clean,decl.index)?(forScopeRange(clean,decl.index)||innermostRange(decl.index,braces)):innermostRange(decl.index,braces);
    for(const binding of decl.names)scopes.push({name:binding.name,start:scope.start,end:scope.end});
  }
  for(const binding of namedBindings){const scope=innermostRange(binding.index,braces);scopes.push({name:binding.name,start:scope.start,end:scope.end})}
  return scopes;
}
function isBoundAt(name,index,scopes){return scopes.some(s=>s.name===name&&index>=s.start&&index<s.end)}
function destructuringAssignmentTargets(clean,declarations,paramScopes){
  const out=[];
  for(let i=0;i<clean.length;i++){
    const openChar=clean[i];if(openChar!=='{'&&openChar!=='[')continue;
    if(declarations.some(d=>i>=d.index&&i<=d.end)||paramScopes.some(p=>i>=p.paramsStart&&i<=p.paramsEnd))continue;
    const close=matchingClose(clean,i,openChar,openChar==='{'?'}':']');if(close<0)continue;
    let after=close+1;while(after<clean.length&&/\s/.test(clean[after]))after++;
    if(clean[after]!=='='||clean[after+1]==='='||clean[after+1]==='>')continue;
    const names=[];collectBindingInfo(clean,i,close+1,names,null);out.push(...names);i=close;
  }
  return out;
}
function findTopLevelWord(text,start,end,words){
  let paren=0,bracket=0,brace=0;
  for(let i=start;i<end;i++){
    const c=text[i];
    if(c==='(')paren++;else if(c===')')paren--;else if(c==='[')bracket++;else if(c===']')bracket--;else if(c==='{')brace++;else if(c==='}')brace--;
    if(paren||bracket||brace)continue;
    for(const word of words)if(text.slice(i,i+word.length)===word&&!/[\w$]/.test(text[i-1]||' ')&&!/[\w$]/.test(text[i+word.length]||' '))return i;
  }
  return-1;
}
function forAssignmentTargets(clean){
  const out=[],re=/\bfor(?:\s+await)?\s*\(/g;let m;
  while((m=re.exec(clean))){
    const open=clean.indexOf('(',m.index),close=matchingClose(clean,open,'(',')');if(close<0)continue;
    const split=findTopLevelWord(clean,open+1,close,['of','in']);if(split<0){re.lastIndex=close+1;continue}
    let [start,end]=trimSpan(clean,open+1,split);if(/^(?:var|let|const)\b/.test(clean.slice(start,end))){re.lastIndex=close+1;continue}
    const names=[];collectBindingInfo(clean,start,end,names,null);out.push(...names);re.lastIndex=close+1;
  }
  return out;
}
function templateToJs(content,privateScope=false){
  let out=privateScope?'await (async()=>{\n':'',cursor=0;
  while(cursor<content.length){
    const open=content.indexOf('<%',cursor);if(open<0)break;
    const skipped=content.slice(cursor,open);out+='\n'.repeat((skipped.match(/\n/g)||[]).length);
    if(content.startsWith('<%%',open)){cursor=open+3;continue}
    let pos=open+2,mode='',mark=content[pos]||'';if('=_-#'.includes(mark)){mode=mark;pos++}
    const close=findEjsClose(content,pos);if(close<0)throw new SyntaxError('EJS 标签未闭合：缺少 %>');
    let code=content.slice(pos,close);if(code.endsWith('-')||code.endsWith('_'))code=code.slice(0,-1);
    if(mode==='#')out+='\n'.repeat((code.match(/\n/g)||[]).length);
    else if(mode==='='||mode==='-')out+='\nvoid ('+code+');\n';
    else out+='\n'+code+'\n';
    cursor=close+2;
  }
  if(privateScope)out+='\n})();\n';return out;
}
function compileOnly(code){
  const clean=maskStringsAndComments(String(code||''));
  const stack=[],pairs={')':'(',']':'[','}':'{'};
  for(let i=0;i<clean.length;i++){
    const c=clean[i];
    if(c==='('||c==='['||c==='{')stack.push(c);
    else if(c===')'||c===']'||c==='}'){
      const expected=pairs[c];
      if(stack.pop()!==expected)return 'JavaScript 括号结构不完整或不匹配';
    }
  }
  if(stack.length)return 'JavaScript 括号结构未闭合';
  const declarationAssignmentRe=/\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=(?!=|>)/g;let declarationMatch;
  while((declarationMatch=declarationAssignmentRe.exec(clean))){
    let at=declarationAssignmentRe.lastIndex;
    while(at<code.length){
      if(/\s/.test(code[at])){at++;continue}
      if(code[at]==='/'&&code[at+1]==='/'){at+=2;while(at<code.length&&code[at]!=='\n')at++;continue}
      if(code[at]==='/'&&code[at+1]==='*'){const close=code.indexOf('*/',at+2);at=close<0?code.length:close+2;continue}
      break;
    }
    if(at>=code.length||code[at]===';')return 'JavaScript 变量赋值缺少右侧表达式';
  }
  if(/(?:^|[;{}]\s*)return\s*;\s*[^}\s]/m.test(clean))return null;
  return null;
}
function positionFromIndex(text,index){
  const at=Math.max(0,index||0),line=lineFromIndex(text,at),lineStart=text.lastIndexOf('\n',Math.max(0,at-1))+1;
  return{line,column:at-lineStart+1};
}
function findingVisibility(ruleId){
  if(/^L[1-7]$/.test(ruleId)||ruleId==='EJS-PARSE'||ruleId==='FILE')return'uploader_detailed';
  if(['M1','M2','M5'].includes(ruleId))return'uploader_generic';
  return'reviewer_only';
}
function finding(ruleId,severity,title,entry,index,detail,suggestion,extra={}){
  const source=extra.sourceText||(entry?entry.content:'');
  const pos=entry?positionFromIndex(source,index||0):{line:extra.line||1,column:extra.column||1};
  return{ruleId,severity,title,detail,suggestion,visibility:findingVisibility(ruleId),entryId:entry?entry.id:(extra.entryId||''),book:entry?entry.fileName:(extra.book||''),entry:entry?entry.name:(extra.entry||''),uid:entry?entry.uid:(extra.uid??''),line:pos.line,column:pos.column,index:index||0,bookOrder:entry?entry.bookOrder:(extra.bookOrder??999999),entryOrder:entry?entry.entryOrder:(extra.entryOrder??999999)};
}
function firstMatch(re,text){re.lastIndex=0;return re.exec(text)}
function isMethodDefinitionAt(clean,nameIndex,name){
  const open=clean.indexOf('(',nameIndex+name.length);if(open<0)return false;
  const close=matchingClose(clean,open,'(',')');if(close<0)return false;
  let after=close+1;while(after<clean.length&&/\s/.test(clean[after]))after++;
  if(clean[after]!=='{')return false;
  let before=nameIndex-1;while(before>=0&&/\s/.test(clean[before]))before--;
  if(before<0||clean[before]==='{'||clean[before]===','||clean[before]===';')return true;
  return /\b(?:static|async|get|set)\s*$/.test(clean.slice(Math.max(0,before-30),nameIndex));
}
function firstExecutableNameCall(re,clean,name){
  re.lastIndex=0;let m;
  while((m=re.exec(clean))){
    const offset=m[0].lastIndexOf(name),nameIndex=m.index+Math.max(0,offset);
    if(!isMethodDefinitionAt(clean,nameIndex,name))return m;
  }
  return null;
}
function firstBracketCall(rawCode,clean,bases,names){
  const re=new RegExp("\\b("+bases.join("|")+")\\s*(?:\\?\\.\\s*)?\\[\\s*['\"]("+names.join("|")+")['\"]\\s*\\]\\s*(?:\\?\\.\\s*)?\\(","g");let m;
  while((m=re.exec(rawCode))){if(clean.slice(m.index,m.index+m[1].length)===m[1])return m}
  return null;
}
function isSensitiveStorageKey(key){
  const words=(String(key||'').match(/[A-Z]+(?=[A-Z][a-z]|\b)|[A-Z]?[a-z]+|[0-9]+/g)||[]).map(x=>x.toLowerCase());
  if(words.some(word=>SENSITIVE_STORAGE_WORDS.has(word)))return true;
  return words.some((word,i)=>word==='api'&&words[i+1]==='key')||words.some((word,i)=>(word==='access'||word==='refresh')&&words[i+1]==='key');
}
function hasLeakDocumentation(content,index,name){
  const area=content.slice(Math.max(0,index-700),Math.min(content.length,index+700)).toLowerCase();
  return(/\bintentional\b|\bdeclared\b|故意|刻意|设计行为/.test(area))&&(/\bowner\s*:|归属|负责人|责任/.test(area))&&(/\blifecycle\s*:|生命周期/.test(area))&&(/\bcleanup\s*:|清理|delete\s+(?:globalthis|window)\s*\./.test(area))&&!!name;
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
function executableCodeMask(entry){
  const out=Array.from(entry.content,ch=>ch==='\n'?'\n':' ');
  const copyRange=(body,start)=>{for(let i=0;i<body.length;i++)out[start+i]=body[i]};
  const copy=(mask)=>{for(let i=0;i<mask.length;i++)if(mask[i]!==' '&&mask[i]!=='\n')out[i]=mask[i]};
  if(entry.hasEjs)copy(ejsCodeMask(entry.content));
  const scriptRe=/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi;let m;
  while((m=scriptRe.exec(entry.content))){
    const body=m[1],start=m.index+m[0].indexOf(body);copyRange(body,start);
  }
  const inlineRe=/\bon[a-z][\w:-]*\s*=\s*(['"])([\s\S]*?)\1/gi;
  while((m=inlineRe.exec(entry.content))){
    const body=m[2],start=m.index+m[0].indexOf(body);copyRange(body,start);
  }
  const inlineUnquotedRe=/\bon[a-z][\w:-]*\s*=\s*(?!['"])([^\s"'<>\x60=]+)/gi;
  while((m=inlineUnquotedRe.exec(entry.content))){
    const body=m[1],start=m.index+m[0].indexOf(body);copyRange(body,start);
  }
  const jsUrlRe=/\b(?:href|src)\s*=\s*(['"])\s*javascript\s*:\s*([\s\S]*?)\1/gi;
  while((m=jsUrlRe.exec(entry.content))){
    const body=m[2],start=m.index+m[0].indexOf(body);copyRange(body,start);
  }
  const jsUrlUnquotedRe=/\b(?:href|src)\s*=\s*(?!['"])\s*javascript\s*:\s*([^\s"'<>\x60]+)/gi;
  while((m=jsUrlUnquotedRe.exec(entry.content))){
    const body=m[1],start=m.index+m[0].indexOf(body);copyRange(body,start);
  }
  return out.join('');
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
  const code=maskStringsAndComments(executableCodeMask(entry));
  const unknownCall=/\b(?:fetch|WebSocket|EventSource)\s*(?:\.\s*(?:call|apply)\s*)?\(\s*([A-Za-z_$][\w$]*)/g;let call;
  while((call=unknownCall.exec(code))){
    findings.push(finding('U5','warn','网络目标由运行时变量决定',entry,call.index,call[0],'如果这是固定资源，请改成有限、明确的 URL 映射；如果确实必须动态联网，需要人工确认实际目标范围。'));
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
function inspectSyntax(entry,findings){
  if(!entry.hasEjs)return;let code;
  try{code=templateToJs(entry.content,entry.isPrivate)}catch(err){findings.push(finding('EJS-PARSE','high','EJS 无法解析',entry,0,String(err.message||err),'检查 <% ... %> 标签是否完整闭合。'));return}
  const error=compileOnly(code);if(error)findings.push(finding('EJS-PARSE','high','EJS 无法编译',entry,0,error,'检查括号、引号、花括号以及 EJS 标签内的 JavaScript 语法。'));
}
function inspectLexical(entry,findings){
  entry.symbols=[];
  if(!entry.hasEjs)return;
  const rawMask=ejsCodeMask(entry.content),clean=maskStringsAndComments(rawMask),depth=depthMap(clean),fnRanges=functionRanges(clean),parameterBindings=parameterBindingAssignmentStarts(clean),declarations=collectDeclarations(clean),declarationAssignments=new Set(),topVars=new Map(),braces=braceRanges(clean),paramScopes=functionParameterScopes(clean),namedBindings=[];let m;
  for(const decl of declarations)for(const at of decl.assignmentStarts)declarationAssignments.add(at);

  const fnRe=/\b(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)\s*\(/g;
  while((m=fnRe.exec(clean))){
    const name=m[1];namedBindings.push({name,index:m.index});
    if(depth[m.index]!==0||entry.isPrivate)continue;
    entry.symbols.push({name,index:m.index,type:'function'});
    findings.push(finding('L3','high','顶层函数不符合 Workshop 组合兼容公约',entry,m.index,'函数 '+name+' 暴露在 EJS 顶层。它当前可能正常运行，但若其他项目在同一编译单元使用同名函数，会发生静默覆盖。','把只供本条目使用的函数放进本条目的 { ... } 局部块。若它本来用于跨条目共享，不要依赖顶层函数名；改用项目专属的显式共享命名空间。'));
  }
  const classRe=/\bclass\s+([A-Za-z_$][\w$]*)\b/g;
  while((m=classRe.exec(clean))){
    const name=m[1];namedBindings.push({name,index:m.index});
    if(depth[m.index]!==0||entry.isPrivate)continue;
    entry.symbols.push({name,index:m.index,type:'class'});
    findings.push(finding('L3','high','顶层 class 不符合 Workshop 组合兼容公约',entry,m.index,'class '+name+' 暴露在 EJS 顶层；同名 class 进入同一编译单元会发生词法声明冲突。','把只供本条目使用的 class 放进本条目的 { ... } 局部块；不要把普通顶层 class 当作跨项目共享接口。'));
  }

  for(const decl of declarations){
    if(decl.kind!=='var')continue;
    const label=decl.names.length?decl.names.map(x=>x.name).join(', '):'（未识别绑定）';
    const functionLocal=insideRanges(decl.index,fnRanges)||entry.isPrivate;
    if(functionLocal){
      findings.push(finding('L1','info','检测到局部 var（维护提示）',entry,decl.index,'检测到 var '+label+'。这里已有函数/private 隔离，因此不会作为顶层组合兼容阻断。','新模板仍建议按是否重新赋值选择 const 或 let；不要机械把 var 改成 const。'));
      continue;
    }
    for(const binding of decl.names){
      entry.symbols.push({name:binding.name,index:binding.index,type:'var'});
      if(!topVars.has(binding.name))topVars.set(binding.name,[]);
      topVars.get(binding.name).push(binding.index);
    }
    findings.push(finding('L1','high','顶层 var 不符合 Workshop 组合兼容公约',entry,decl.index,'var '+label+' 使用 EJS 函数作用域；即使写在 { ... } 或 for 块里，也可能与未来同时进入同一编译单元的项目共享/覆盖。','如果这是本条目的临时状态：不再赋值时用 const，会重新赋值时用 let，并放进本条目的 { ... } 局部块。不要机械批量替换。'));
  }
  for(const [name,positions] of topVars){
    if(positions.length>1)findings.push(finding('L1','high','同一条目重复声明同名 var',entry,positions[1],'var '+name+' 在同一个 EJS 函数作用域内重复声明 '+positions.length+' 次；这些声明实际操作的是同一个变量。','只声明一次；后续若确实要修改值，使用普通赋值。若它只是本条目临时状态，同时按公约放入局部 { ... }。'));
  }

  for(const decl of declarations){
    if(decl.kind==='var')continue;
    const top=depth[decl.index]===0&&!entry.isPrivate&&!inForHeader(clean,decl.index);
    if(!top)continue;
    const label=decl.names.length?decl.names.map(x=>x.name).join(', '):'（解构/多声明）';
    for(const binding of decl.names)entry.symbols.push({name:binding.name,index:binding.index,type:decl.kind});
    findings.push(finding('L2','high','顶层 '+decl.kind+' 未局部化（Workshop 公约阻断）',entry,decl.index,decl.kind+' '+label+' 位于 EJS 顶层。它在当前 placement/API 下可能完全正常，但 Workshop 不允许依赖 message、position、depth 或 role 的隔离来获得组合兼容通过。','如果这些变量只供当前条目使用，把相关代码放进一个 { ... } 局部块；for (let/const ...) 的循环头本身已有块作用域，不需要为了消警告改写。'));
  }

  const bindingScopes=buildBindingScopes(clean,declarations,namedBindings,fnRanges,braces,paramScopes);
  const reportGlobal=(base,name,index)=>{
    const documented=hasLeakDocumentation(entry.content,index,name);
    entry.symbols.push({name,index,type:'global'});
    const generic=GENERIC_GLOBAL_NAMES.has(name);
    if(generic){
      findings.push(finding('L5','high','共享全局名称过于通用（公约阻断）',entry,index,base+'.'+name+' 使用常见通用名，未来极易与其他项目或脚本撞名。','跨条目共享必须使用项目专属命名空间。Workshop 集成版应以项目稳定 ID 校验，例如 globalThis.__PW_<PROJECT_ID>__。'));
    }
    findings.push(finding('L4','warn',documented?'已声明的共享全局行为仍需确认':'显式共享全局状态需要确认',entry,index,base+'.'+name+' 会写入浏览器共享全局对象。'+(documented?'附近已有 Owner/Lifecycle/Cleanup 说明，但离线 checker 无法确认这个命名空间是否真正属于当前 Workshop 项目。':'Workshop 公约要求跨条目共享必须显式、项目专属，并说明生命周期与清理方式。'),'如果确实需要跨条目共享：使用项目专属的唯一命名空间，并写清 Owner、Lifecycle、Cleanup；最终 uploader 应用项目稳定 ID 做自动校验。否则改成本条目的局部状态。'));
  };
  const assignOp='(?:\\*\\*=|>>>=|>>=|<<=|\\+=|-=|\\*=|\\/=|%=|&=|\\^=|\\|=|\\?\\?=|&&=|\\|\\|=|=(?!=|>))';
  const dotGlobalRe=new RegExp('\\b(globalThis|window|self)\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*'+assignOp,'g');
  while((m=dotGlobalRe.exec(clean)))reportGlobal(m[1],m[2],m.index);
  const bracketGlobalRe=/\b(globalThis|window|self)\s*\[\s*(['"])([A-Za-z_$][\w$]*)\2\s*\]\s*(?:\*\*=|>>>=|>>=|<<=|\+=|-=|\*=|\/=|%=|&=|\^=|\|=|\?\?=|&&=|\|\|=|=(?!=|>))/g;
  while((m=bracketGlobalRe.exec(rawMask))){
    if(clean.slice(m.index,m.index+m[1].length)===m[1])reportGlobal(m[1],m[3],m.index);
  }

  const reported=new Set();
  const reportImplicit=(name,nameIndex)=>{
    const key=name+'@'+nameIndex;if(reported.has(key)||isBoundAt(name,nameIndex,bindingScopes))return;reported.add(key);
    entry.symbols.push({name,index:nameIndex,type:'implicit'});
    findings.push(finding('L4','high','裸赋值不符合 Workshop 组合兼容公约',entry,nameIndex,name+' 在当前位置没有有效的 let/const/var/参数绑定。真实 ST 环境中，这可能覆盖 EJS 环境值或创建共享全局。','如果只是本条目的临时变量，在正确的局部作用域声明它；如果确实需要跨条目共享，改用项目专属的显式 globalThis 命名空间；不要用裸赋值。'));
    if(GENERIC_GLOBAL_NAMES.has(name))findings.push(finding('L5','high','裸共享名称过于通用',entry,nameIndex,name+' 是常见通用名，一旦形成共享状态非常容易与其他项目撞名。','不要共享这个裸名字；局部化，或使用项目专属的显式共享命名空间。'));
  };
  const bareAssignRe=new RegExp('(^|[^'+JS_IDENTIFIER_CONT_SOURCE+'])('+JS_IDENTIFIER_SOURCE+')\\s*'+assignOp,'gu');
  while((m=bareAssignRe.exec(clean))){
    const name=m[2],nameIndex=m.index+(m[1]?m[1].length:0);let prev=nameIndex-1;while(prev>=0&&/\s/.test(clean[prev]))prev--;
    if(clean[prev]==='.'||clean[prev]==='#'||parameterBindings.has(nameIndex)||declarationAssignments.has(nameIndex))continue;
    reportImplicit(name,nameIndex);
  }
  for(const target of destructuringAssignmentTargets(clean,declarations,paramScopes))reportImplicit(target.name,target.index);
  for(const target of forAssignmentTargets(clean))reportImplicit(target.name,target.index);
  const prefixIncRe=new RegExp('(?:\\+\\+|--)\\s*('+JS_IDENTIFIER_SOURCE+')','gu');
  while((m=prefixIncRe.exec(clean)))reportImplicit(m[1],m.index+m[0].lastIndexOf(m[1]));
  const postfixIncRe=new RegExp('(^|[^'+JS_IDENTIFIER_CONT_SOURCE+'])('+JS_IDENTIFIER_SOURCE+')\\s*(?:\\+\\+|--)','gu');
  while((m=postfixIncRe.exec(clean))){const nameIndex=m.index+(m[1]?m[1].length:0);let prev=nameIndex-1;while(prev>=0&&/\s/.test(clean[prev]))prev--;if(clean[prev]!=='.')reportImplicit(m[2],nameIndex)}
}

function inspectCapabilities(entry,findings){
  const rawCode=executableCodeMask(entry);
  if(!/\S/.test(rawCode))return;
  const clean=maskStringsAndComments(rawCode);

  let m1=firstExecutableNameCall(/\b(?:window|globalThis|self)\s*(?:\?\.\s*|\.\s*)eval\s*\(|(?:^|[^\w$.])eval\s*\(/g,clean,'eval');
  if(!m1)m1=firstMatch(/\(\s*[^,\n()]{0,40},\s*eval\s*\)\s*\(/g,clean);
  if(!m1)m1=firstBracketCall(rawCode,clean,['window','globalThis','self'],['eval']);
  if(!m1)m1=firstMatch(/(?:=|:)\s*(?:(?:window|globalThis|self)\s*(?:\?\.\s*|\.\s*))?eval\b(?!\s*\()/g,clean);
  if(m1)findings.push(finding('M1','high','使用 eval 动态执行代码（公约阻断）',entry,m1.index,m1[0],'Workshop 项目禁止调用、转存或间接使用 eval。这里采用 fail-closed：不要把 eval 包装、别名化或换一种调用方式；请改成固定逻辑。'));

  let m2=firstExecutableNameCall(/\bnew\s+Function\s*\(|\b(?:window|globalThis|self)\s*(?:\?\.\s*|\.\s*)Function\s*\(|(?:^|[^\w$.])Function\s*\(/g,clean,'Function');
  if(!m2)m2=firstBracketCall(rawCode,clean,['window','globalThis','self'],['Function']);
  if(!m2)m2=firstMatch(/(?:=|:)\s*(?:(?:window|globalThis|self)\s*(?:\?\.\s*|\.\s*))?Function\b(?!\s*\()/g,clean);
  if(m2)findings.push(finding('M2','high','使用 Function 构造器动态创建代码（公约阻断）',entry,m2.index,m2[0],'Workshop 项目禁止调用或转存 Function 构造器来生成可执行代码；改用固定函数或明确分支。'));

  let sensitive=firstMatch(/\bdocument\s*(?:\?\.\s*|\.\s*)cookie\b|\bObject\s*\.\s*(?:keys|values|entries)\s*\(\s*(?:window\s*(?:\?\.\s*|\.\s*))?(?:localStorage|sessionStorage)\s*\)|\bfor\s*\([^)]*\bin\s+(?:window\s*(?:\?\.\s*|\.\s*))?(?:localStorage|sessionStorage)\b|\b(?:localStorage|sessionStorage)\s*(?:\?\.\s*|\.\s*)(?:length|key\s*\()/g,clean);
  if(!sensitive){
    const bracketCookie=/\bdocument\s*\[\s*(['"])cookie\1\s*\]/g,b=bracketCookie.exec(rawCode);if(b)sensitive=b;
  }
  if(!sensitive){
    const storage=/\b(?:(?:window|globalThis|self)\s*(?:\?\.\s*|\.\s*))?(?:localStorage|sessionStorage)\s*(?:\?\.\s*|\.\s*)getItem\s*\(/g;let hit;
    while((hit=storage.exec(clean))){
      const tail=rawCode.slice(hit.index,hit.index+220),km=/getItem\s*\(\s*(['"])([^'"]+)\1/.exec(tail);
      if(km&&isSensitiveStorageKey(km[2])){sensitive={index:hit.index,0:km[0]};break}
    }
  }
  if(!sensitive){
    const bracketStorage=/\b(window|globalThis|self)\s*(?:\?\.\s*)?\[\s*['"](localStorage|sessionStorage)['"]\s*\]\s*(?:\?\.\s*|\.\s*)getItem\s*\(/g;let hit;
    while((hit=bracketStorage.exec(rawCode))){
      if(clean.slice(hit.index,hit.index+hit[1].length)!==hit[1])continue;
      const tail=rawCode.slice(hit.index,hit.index+240),km=/getItem\s*\(\s*(['"])([^'"]+)\1/.exec(tail);
      if(km&&isSensitiveStorageKey(km[2])){sensitive={index:hit.index,0:km[0]};break}
    }
  }
  if(!sensitive){
    const directStorage=/\b(?:localStorage|sessionStorage)\s*(?:\?\.\s*|\.\s*)([A-Za-z_$][\w$]*)|\b(?:localStorage|sessionStorage)\s*\[\s*(['"])([^'"]+)\2\s*\]/g;let hit;
    while((hit=directStorage.exec(rawCode))){
      const key=hit[1]||hit[3]||'';if(key&&key!=='getItem'&&key!=='setItem'&&key!=='removeItem'&&isSensitiveStorageKey(key)){sensitive={index:hit.index,0:hit[0]};break}
    }
  }
  if(sensitive)findings.push(finding('M3','warn','访问敏感或大范围浏览器数据，需要审核',entry,sensitive.index,sensitive[0],'这不会自动拒绝上传，但审核员需要确认用途。项目自己的主题、字号等明确本地设置可以使用 localStorage；Cookie、token/API key 类数据或枚举整份存储需要重点检查。'));

  let m4=firstMatch(/\b(?:fetch\s*(?:\.\s*(?:call|apply)\s*)?\(|XMLHttpRequest\b|WebSocket\s*\(|EventSource\s*\(|(?:navigator\s*(?:\?\.\s*|\.\s*))?sendBeacon\s*\()/g,clean);
  if(!m4)m4=firstBracketCall(rawCode,clean,['window','globalThis','self'],['fetch','XMLHttpRequest','WebSocket','EventSource']);
  if(!m4)m4=firstBracketCall(rawCode,clean,['navigator'],['sendBeacon']);
  if(m4)findings.push(finding('M4','warn','检测到主动网络请求 / 数据外发能力，需要审核',entry,m4.index,m4[0],'这不会自动拒绝上传；审核中心应显示完整位置，让 reviewer/LLM 确认请求目标、发送内容与必要性。静态图片/CSS URL 由 U 系列检查。'));

  let m5=firstMatch(/\bwhile\s*\(\s*(?:true|1)\s*\)/g,clean);
  if(!m5)m5=findEmptyConditionFor(clean);
  if(m5)findings.push(finding('M5','high','检测到明显无界循环（公约阻断）',entry,m5.index,m5[0],'必须有清楚可靠的退出方式。Workshop 不负责一般性能优化，只阻断这种明显可能把页面线程或资源打爆的写法。'));

  const hints=[
    ['AH1','发现编码 / 解码式字符串构造',/\b(?:atob|btoa)\s*\(|\bString\s*\.\s*(?:fromCharCode|fromCodePoint)\s*\(/g,'不代表有问题；人工审核时确认结果没有被继续当作代码或隐藏远程目标。'],
    ['AH2','发现动态 / 间接函数调用形状',/\b(?:window|globalThis|self)\s*\[\s*[A-Za-z_$][\w$]*\s*\]\s*\(|\b[A-Za-z_$][\w$]*\s*\.\s*(?:call|apply)\s*\(/g,'机器无法可靠知道最终调用什么；只作为审核中心的黄色提示，不自动拒绝。']
  ];
  for(const [ruleId,title,re,suggestion] of hints){const hit=firstMatch(re,rawCode);if(hit)findings.push(finding(ruleId,'hint',title,entry,hit.index,hit[0].slice(0,180),suggestion))}
  const ejsRewrite=/(?:replace|replaceAll|split|join)\s*\([^\n]{0,180}(?:<%|%>)/g,er=ejsRewrite.exec(rawCode);
  if(er)findings.push(finding('AH3','hint','发现运行时操作 EJS 标记',entry,er.index,er[0].slice(0,180),'不自动判错；请确认它不会把原本的注释/文本重新变成可执行 EJS。'));
  const scriptCreate=/\bcreateElement\s*\(\s*(['"])script\1\s*\)/g,sc=scriptCreate.exec(rawCode);
  if(sc)findings.push(finding('AH4','hint','发现运行时创建 <script>',entry,sc.index,sc[0],'不自动判错；人工审核时确认 script.src / textContent 最终来自哪里，以及是否绕过了正常的 U / M 检查。'));
}

function isProjectNamespaceName(name){return /^__PW_[A-Za-z0-9][A-Za-z0-9_]*__$/.test(name)}
function detectCrossEntryCollisions(entries,findings){
  const map=new Map();
  for(const entry of entries){
    const seen=new Set();
    for(const symbol of entry.symbols){
      const key=symbol.name+':'+symbol.type;
      if(!symbol.name||seen.has(key))continue;seen.add(key);
      if(!map.has(symbol.name))map.set(symbol.name,[]);map.get(symbol.name).push({entry,symbol});
    }
  }
  for(const [name,list] of map){
    const uniqueEntries=new Set(list.map(x=>x.entry.id));
    if(uniqueEntries.size<2)continue;
    if(isProjectNamespaceName(name)&&list.every(x=>x.symbol.type==='global'))continue;
    const a=list[0],f=finding('L6','high','不同条目公开了同一个名称（组合兼容阻断）',a.entry,a.symbol.index,name+' 同时出现在：'+list.map(x=>x.entry.name+' ('+x.symbol.type+')').join(' ↔ ')+'。这些条目当前未必处于同一 EJS compilation unit，但 Workshop 公约不依赖 position/depth/role/API 设置提供隔离；一旦进入同一编译单元，可能编译失败、串值或静默覆盖。','把临时状态局部化。若确实需要跨条目共享，只通过项目专属的显式命名空间共享，不要复用普通顶层名称。');
    f.entry=list.map(x=>x.entry.name).join(' ↔ ');f.uid=list.map(x=>String(x.entry.uid)).join(' ↔ ');f.relatedEntryIds=[...new Set(list.map(x=>x.entry.id))];findings.push(f);
  }
}
function compareFindings(a,b){return a.bookOrder-b.bookOrder||a.entryOrder-b.entryOrder||a.line-b.line||a.ruleId.localeCompare(b.ruleId,'en')}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
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

export function analyzeProjectCode(inputs){
  const books=[],findings=[];
  const source=Array.isArray(inputs)?inputs:[];
  for(let i=0;i<source.length;i++){
    const input=source[i];
    try{books.push(parseCodeCheckInput(input,i))}
    catch(err){
      findings.push(finding('FILE','high','无法读取文件',null,0,String(err?.message||err),'确认这是有效的 SillyTavern 世界书或正则文件。',{book:String(input?.fileName||('upload-'+(i+1)+'.json')),bookOrder:i,entryOrder:-1}));
    }
  }
  const entries=books.flatMap(b=>b.entries),u2SeenHosts=new Set();
  for(const entry of entries){
    inspectDecorators(entry,findings);
    inspectSyntax(entry,findings);
    inspectLexical(entry,findings);
    inspectCapabilities(entry,findings);
    inspectLinks(entry,findings,u2SeenHosts);
  }
  detectCrossEntryCollisions(entries,findings);
  findings.sort(compareFindings);
  return{
    generatedAt:new Date().toISOString(),
    tool:'Poem Workshop EJS / Regex Check',
    standard:'PW-CODE-CHECK-v1',
    certification:certificationStatus(findings),
    gate:gateStatus(findings),
    audit:auditStatus(findings),
    rules:'EJS:L1-L7; COMMON:M1-M5,U2-U5; HINTS:AH1-AH4; EJS-PARSE',
    files:books.map(b=>({fileName:b.fileName,size:b.size,type:b.type,items:b.entries.length,ejsEntries:b.entries.filter(e=>e.hasEjs).length})),
    findings,
  };
}

export function toUploaderCodeCheck(report){
  const visible=(report?.findings||[]).filter(f=>f.visibility!=='reviewer_only').map(f=>{
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
    standard:report?.standard||'PW-CODE-CHECK-v1',
    gate:report?.gate||'accept',
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
