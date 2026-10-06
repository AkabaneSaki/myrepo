import { parseFragment } from 'parse5';
import { buildScopes, resolveBinding } from './scope.mjs';
import { inspectCharInfoManagedV2Block, trustedStaticMediaUrl } from './policy-config.mjs';
import { firstAttributeLocations } from './source-units.mjs';

const OFFICIAL_URL_RULES = [
  { host:'testingcf.jsdelivr.net', path:/^\/gh\/StageDog\/tavern_resource(?:\/|$)/i },
  { host:'cdn.jsdelivr.net', path:/^\/gh\/StageDog\/tavern_resource(?:\/|$)/i },
  { host:'raw.githubusercontent.com', path:/^\/StageDog\/tavern_resource(?:\/|$)/i },
  { host:'github.com', path:/^\/zonde306\/ST-Prompt-Template(?:\/|$)/i }
];
const GLOBALS = new Set(['window','globalThis','self']);
const NETWORK_NAMES = new Set(['fetch','XMLHttpRequest','WebSocket','EventSource']);
const MEDIA_KEYS = /^(?:avatar(?:url)?|image(?:url)?|img(?:url)?|video(?:url)?|poster|portrait|thumbnail|cover(?:url)?|background(?:url)?|gallery)$/i;
const MEDIA_GROUPS = /^(?:gallery|images|videos|avatars|sources)$/i;

export function propertyName(node) {
  if (node?.type !== 'MemberExpression' && node?.type !== 'Property') return null;
  const property = node.type === 'Property' ? node.key : node.property;
  if (!node.computed && property.type === 'Identifier') return property.name;
  return property.type === 'Literal' && typeof property.value === 'string' ? property.value : null;
}

export function expressionEvidence(node) {
  return JSON.stringify(node, (key,value) => ['start','end','loc','range','raw'].includes(key) ? undefined : typeof value === 'bigint' ? String(value) : value);
}

function product(left, right, join) {
  if (!left || !right || left.length * right.length > 64) return null;
  return [...new Set(left.flatMap(a => right.map(b => join(a,b))))];
}

export function staticStringValues(node, analysis, scope, visited = new Set()) {
  if (!node || visited.has(node)) return null;
  visited = new Set(visited).add(node);
  if (node.type === 'ChainExpression') return staticStringValues(node.expression,analysis,scope,visited);
  if (node.type === 'Literal') return typeof node.value === 'string' ? [node.value] : null;
  if (node.type === 'TemplateLiteral') {
    let values = [node.quasis[0].value.cooked];
    for (let i=0;i<node.expressions.length;i++) values=product(values,staticStringValues(node.expressions[i],analysis,scope,visited),(a,b)=>a+b+node.quasis[i+1].value.cooked);
    return values;
  }
  if (node.type === 'BinaryExpression' && node.operator === '+') return product(staticStringValues(node.left,analysis,scope,visited),staticStringValues(node.right,analysis,scope,visited),(a,b)=>a+b);
  if (node.type === 'ConditionalExpression') {
    const left=staticStringValues(node.consequent,analysis,scope,visited),right=staticStringValues(node.alternate,analysis,scope,visited);
    return left && right ? [...new Set([...left,...right])] : null;
  }
  if (node.type === 'Identifier') {
    const binding=resolveBinding(scope,node.name)?.[0];
    if (binding?.kind !== 'const') return null;
    const declaration=analysis.nodes.find(item=>item.node.type==='VariableDeclarator' && item.node.id === binding.node);
    return declaration ? staticStringValues(declaration.node.init,analysis,declaration.scope,visited) : null;
  }
  if (node.type === 'NewExpression' && node.callee.type === 'Identifier' && node.callee.name === 'URL' && !resolveBinding(scope,'URL')) {
    const paths=staticStringValues(node.arguments[0],analysis,scope,visited),bases=node.arguments[1] ? staticStringValues(node.arguments[1],analysis,scope,visited) : [''];
    if (!paths || !bases) return null;
    try { return product(paths,bases,(path,base)=>base ? new URL(path,base).href : new URL(path).href); } catch { return null; }
  }
  if (node.type === 'MemberExpression' && node.object.type === 'Identifier') {
    const binding=resolveBinding(scope,node.object.name)?.[0];
    if (binding?.kind !== 'const') return null;
    const declaration=analysis.nodes.find(item=>item.node.type==='VariableDeclarator' && item.node.id === binding.node);
    if (!declaration) return null;
    const mutated=analysis.nodes.some(item=>['AssignmentExpression','UpdateExpression'].includes(item.node.type) && (()=> {
      let target=item.node.left ?? item.node.argument;
      while(target?.type==='MemberExpression')target=target.object;
      return target?.type==='Identifier' && resolveBinding(item.scope,target.name)?.[0]===binding;
    })());
    if (mutated) return null;
    const init=declaration.node.init, name=propertyName(node);
    const values=init?.type==='ObjectExpression' ? init.properties.filter(item=>item.type==='Property' && item.kind==='init' && (!name || propertyName(item)===name)).map(item=>item.value) : init?.type==='ArrayExpression' ? init.elements : null;
    if (!values?.length) return null;
    const possible=values.map(value=>staticStringValues(value,analysis,declaration.scope,visited));
    return possible.every(Boolean) ? [...new Set(possible.flat())] : null;
  }
  return null;
}

function globalObject(node,scope) {
  if(node?.type==='Identifier')return GLOBALS.has(node.name)&&!resolveBinding(scope,node.name);
  return node?.type==='MemberExpression'&&['window','self','globalThis','top','parent'].includes(propertyName(node))&&globalObject(node.object,scope);
}
export function networkCapability(node,analysis,scope,visited=new Set()) {
  if(node?.type==='ChainExpression')node=node.expression;
  if(node?.type==='Identifier'&&NETWORK_NAMES.has(node.name)&&!resolveBinding(scope,node.name))return node.name;
  if(node?.type==='MemberExpression'&&NETWORK_NAMES.has(propertyName(node))&&globalObject(node.object,scope))return propertyName(node);
  if(node?.type!=='Identifier'||visited.has(node))return null;
  visited=new Set(visited).add(node);
  const binding=resolveBinding(scope,node.name)?.[0];
  const declaration=binding?analysis.nodes.find(item=>item.node.type==='VariableDeclarator'&&item.node.id===binding.node):null;
  return declaration?networkCapability(declaration.node.init,analysis,declaration.scope,visited):null;
}
function locationObject(node,scope) {
  return node?.type==='Identifier' ? node.name==='location'&&!resolveBinding(scope,'location') : node?.type==='MemberExpression'&&propertyName(node)==='location'&&globalObject(node.object,scope);
}
function navigationTarget(node,scope) {
  if(node.type==='CallExpression') {
    const callee=node.callee.type==='ChainExpression'?node.callee.expression:node.callee;
    if(callee.type==='Identifier'&&callee.name==='open'&&!resolveBinding(scope,'open'))return{argument:node.arguments[0],action:'open'};
    if(callee.type==='MemberExpression'&&propertyName(callee)==='open'&&globalObject(callee.object,scope))return{argument:node.arguments[0],action:'window.open'};
    if(callee.type==='MemberExpression'&&['assign','replace'].includes(propertyName(callee))&&locationObject(callee.object,scope))return{argument:node.arguments[0],action:'location.'+propertyName(callee)};
  }
  if(node.type==='AssignmentExpression'&&((node.left.type==='MemberExpression'&&propertyName(node.left)==='href'&&locationObject(node.left.object,scope))||locationObject(node.left,scope)))return{argument:node.right,action:'location.href'};
  return null;
}
function mediaContext(node,scope,parentByNode,analysis) {
  let current=node;
  while (current) {
    const parent=parentByNode.get(current);
    if (!parent) break;
    if (parent.type==='Property') {
      const key=propertyName(parent);
      if(MEDIA_KEYS.test(key??'')||MEDIA_GROUPS.test(key??''))return true;
    }
    if(parent.type==='VariableDeclarator'&&parent.id.type==='Identifier'&&MEDIA_KEYS.test(parent.id.name))return true;
    if(parent.type==='AssignmentExpression'&&parent.right===current) {
      const target=parent.left, key=propertyName(target);
      if(MEDIA_KEYS.test(key??'')||(target.type==='Identifier'&&MEDIA_KEYS.test(target.name)))return true;
      if(key==='src') {
        if(target.object.type==='Identifier'&&/^(?:img|image|video|avatar|poster)$/i.test(target.object.name))return true;
        const binding=target.object.type==='Identifier'?resolveBinding(scope,target.object.name)?.[0]:null;
        const declaration=binding?analysis.nodes.find(item=>item.node.type==='VariableDeclarator'&&item.node.id===binding.node):null;
        const init=declaration?.node.init;
        if(init?.type==='CallExpression'&&propertyName(init.callee)==='createElement'&&['img','video','source'].includes(init.arguments[0]?.value))return true;
      }
    }
    if(['CallExpression','NewExpression','FunctionExpression','ArrowFunctionExpression','FunctionDeclaration'].includes(parent.type))break;
    current=parent;
  }
  return false;
}

function isCharInfoGalleryMapCall(node) {
  if(node?.type!=='CallExpression')return false;
  const callee=node.callee?.type==='ChainExpression'?node.callee.expression:node.callee;
  if(callee?.type!=='MemberExpression'||propertyName(callee)!=='map')return false;
  const gallery=callee.object;
  const callback=node.arguments?.[0];
  return gallery?.type==='MemberExpression'
    && propertyName(gallery)==='gallery'
    && gallery.object?.type==='Identifier'
    && gallery.object.name==='profile'
    && callback?.type==='ArrowFunctionExpression'
    && callback.params?.length===1
    && callback.params[0]?.type==='Identifier'
    && callback.params[0].name==='image';
}

function isGeneratedCharInfoMediaNode(node,parentByNode) {
  if(isCharInfoGalleryMapCall(node))return true;
  if(node?.type!=='MemberExpression'||node.object?.type!=='Identifier'||node.object.name!=='image'||!['sources','thumbnail'].includes(propertyName(node)))return false;
  let current=node;
  while(current) {
    const parent=parentByNode.get(current);
    if(!parent)return false;
    if(parent.type==='ArrowFunctionExpression')return parent.params?.[0]?.type==='Identifier'
      && parent.params[0].name==='image'
      && isCharInfoGalleryMapCall(parentByNode.get(parent))
      && parentByNode.get(parent)?.arguments?.[0]===parent;
    if(['FunctionExpression','FunctionDeclaration'].includes(parent.type))return false;
    current=parent;
  }
  return false;
}

function directUrls(content) {
  const items=[];const pattern=/(?:https?:\/\/|\/\/)(?:\[[0-9a-f:]+\]|(?:[a-z0-9-]+\.)+[a-z0-9-]+)(?:[^\s"'<>\\)\]]*)/gi;let match;
  while((match=pattern.exec(content)))items.push({url:match[0].replace(/[;,\]}]+$/,''),index:match.index,end:pattern.lastIndex});
  return items;
}
function sourceUrlCandidates(content,limit=12) { return [...new Set(directUrls(content).map(item=>item.url))].slice(0,limit); }
function parsedUrl(value) { try { return new URL(value.startsWith('//')?'https:'+value:value); } catch { return null; } }
function external(value) { const url=parsedUrl(value);return url&&['http:','https:'].includes(url.protocol); }
function ipHost(host) {return host.includes(':')||/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);}

export function inspectExternalLinks(entry,parsed) {
  const source=String(entry.rawContent??entry.content??''), targets=[],hints=[],covered=[],seen=new Set();
  const addTarget=(value,index,usage,action,expression='')=>{
    if(!external(value))return;
    const key=index+'|'+value+'|'+usage;if(seen.has(key))return;seen.add(key);
    targets.push({value,index,usage,action,expression});
  };
  for(const unit of parsed.units??[]) {
    if(!unit.ast)continue;
    const analysis=buildScopes(unit),parents=new WeakMap(analysis.nodes.map(item=>[item.node,item.parent]));
    const navigation=new Set(),networkCalls=new Set(),mediaValues=new Set();
    for(const {node,scope,parent} of analysis.nodes) {
      if(!unit.sourceMap.isOriginal(node.start)||!parent||!((parent.type==='AssignmentExpression'&&parent.right===node)||(parent.type==='Property'&&parent.value===node)||(parent.type==='VariableDeclarator'&&parent.init===node))||!mediaContext(node,scope,parents,analysis))continue;
      const values=staticStringValues(node,analysis,scope);
      if(values)for(const value of values){mediaValues.add(value);addTarget(value,unit.sourceMap.map(node.start),'media','resource',expressionEvidence(node));}
      else if(!['ObjectExpression','ArrayExpression','Literal','FunctionExpression','ArrowFunctionExpression'].includes(node.type)
          && !(node.type==='CallExpression'&&propertyName(node.callee)==='createElement')
          && !(node.type==='NewExpression'&&node.callee.type==='Identifier'&&node.callee.name==='Image'&&!resolveBinding(scope,'Image'))) {
        const index=unit.sourceMap.map(node.start);
        const charInfoBlock=inspectCharInfoManagedV2Block(source,index);
        const candidates=charInfoBlock?.mediaUrls?.length?charInfoBlock.mediaUrls:sourceUrlCandidates(source);
        if(charInfoBlock&&isGeneratedCharInfoMediaNode(node,parents)&&candidates.length&&candidates.every(value=>trustedStaticMediaUrl(value,'media')))continue;
        hints.push({ruleId:'AH2',severity:'hint',title:'媒体来源需要人工确认',index,detail:'最终图片或视频地址由运行时内容决定，自动检查无法确定实际会加载哪个地址。',suggestion:candidates.length?'请核对下方 URL 候选与这段媒体逻辑的实际用途；如果候选与实际地址不同，请 Creator 说明最终来源。':'当前条目没有可直接读出的 URL。请 Creator 提供实际图片/视频地址或来源规则后再确认。',extra:{riskEvidence:{action:'resource',usage:'media',target:'dynamic',expression:expressionEvidence(node),candidates}}});
      }
    }
    for(const {node,scope} of analysis.nodes) {
      if(!unit.sourceMap.isOriginal(node.start))continue;
      if(['CallExpression','NewExpression'].includes(node.type)) {
        const callee=node.callee.type==='ChainExpression'?node.callee.expression:node.callee;
        const method=propertyName(callee),network=networkCapability(callee,analysis,scope)||(['call','apply'].includes(method)?networkCapability(callee.object,analysis,scope):null);
        if(['fetch','WebSocket','EventSource'].includes(network)) {
          networkCalls.add(node);
          const argument=method==='call'?node.arguments[1]:method==='apply'?node.arguments[1]?.elements?.[0]:node.arguments[0];
          const values=staticStringValues(argument,analysis,scope);
          if(values)for(const value of values)addTarget(value,unit.sourceMap.map(node.start),'network',network,expressionEvidence(node));
          covered.push({start:unit.sourceMap.map(node.start),end:unit.sourceMap.map(node.end)});
        }
      }
      const target=navigationTarget(node,scope);
      if(!target)continue;
      navigation.add(node);
      const values=staticStringValues(target.argument,analysis,scope),index=unit.sourceMap.map(node.start),expression=expressionEvidence(node);
      covered.push({start:unit.sourceMap.map(node.start),end:unit.sourceMap.map(node.end)});
      if(values)for(const value of values)addTarget(value,index,'navigation',target.action,expression);
      else hints.push({ruleId:'AH2',severity:'hint',title:'外部跳转目标需要人工确认',index,detail:'代码会尝试打开或跳转到运行时决定的位置。',suggestion:'请向审核员说明跳转目标及其用途；这条提示本身不代表违规。',extra:{riskEvidence:{action:target.action,usage:'navigation',target:'dynamic',expression}}});
    }
    for(const {node,scope} of analysis.nodes) {
      if(!unit.sourceMap.isOriginal(node.start)||!['Literal','TemplateLiteral','BinaryExpression'].includes(node.type))continue;
      const parent=parents.get(node);
      if((parent?.type==='BinaryExpression'&&parent.operator==='+')||parent?.type==='TemplateLiteral')continue;
      let ancestor=node,usage=mediaContext(node,scope,parents,analysis)?'media':'unknown';
      while((ancestor=parents.get(ancestor))) {
        if(navigation.has(ancestor)){usage='navigation';break;}
        if(networkCalls.has(ancestor)){usage='network';break;}
      }
      if(usage==='navigation'||usage==='network')continue;
      const values=staticStringValues(node,analysis,scope),index=unit.sourceMap.map(node.start);
      covered.push({start:index,end:unit.sourceMap.map(node.end)});
      if(!values&&['TemplateLiteral','BinaryExpression'].includes(node.type)&&/(?:https?:)?\/\//.test(unit.code.slice(node.start,node.end)))hints.push({ruleId:'U5',severity:'warn',title:'远程目标由运行时内容决定',index,detail:source.slice(index,unit.sourceMap.map(node.end)),suggestion:'请提供所有可能访问的目标，或向审核员说明动态目标的来源和用途。',extra:{riskEvidence:{action:'resource',usage,target:'dynamic',expression:expressionEvidence(node)}}});
      if(values)for(const value of values){
        if(external(value))addTarget(value,index,usage==='unknown'&&mediaValues.has(value)?'media':usage,'resource',expressionEvidence(node));
        else for(const url of directUrls(value))addTarget(url.url,index+url.index,usage,'resource',expressionEvidence(node));
      }
    }
  }
  const chars=source.split('');
  for(const range of parsed.units.find(unit=>unit.kind==='ejs')?.templateRanges??[])for(let i=range.start;i<range.end;i++)if(chars[i]!=='\r'&&chars[i]!=='\n')chars[i]=' ';
  const html=parseFragment(chars.join(''),{sourceCodeLocationInfo:true}), pending=[...html.childNodes];
  while(pending.length){
    const node=pending.shift();
    if(!node.tagName)continue;
    const locations=firstAttributeLocations(source,node.sourceCodeLocation?.startTag);
    for(const attribute of node.attrs??[]) {
      const location=locations.get(attribute.prefix?attribute.prefix+':'+attribute.name:attribute.name);if(!location)continue;
      if(!['href','src','poster','srcset','action','formaction'].includes(attribute.name))continue;
      const media=(attribute.name==='src'&&['img','video','source','audio'].includes(node.tagName))||attribute.name==='poster'||(attribute.name==='srcset'&&['img','source'].includes(node.tagName));
      const usage=media?'media':['href','action','formaction'].includes(attribute.name)?'navigation':'unknown';
      covered.push({start:location.startOffset,end:location.endOffset});
      if(attribute.name!=='srcset'&&external(attribute.value))addTarget(attribute.value,location.startOffset,usage,node.tagName+'.'+attribute.name);
      else for(const item of directUrls(attribute.value))addTarget(item.url,location.startOffset,usage,node.tagName+'.'+attribute.name);
    }
    if(node.tagName!=='template')pending.push(...(node.childNodes??[]));
  }
  const markdown=/(!?)\[[^\]\r\n]*\]\((https?:\/\/[^\s)]+|\/\/[^\s)]+)(?:\s+"[^"]*")?\)/gi;let match;
  while((match=markdown.exec(source))){covered.push({start:match.index,end:markdown.lastIndex});addTarget(match[2],match.index,match[1]?'media':'navigation',match[1]?'markdown.image':'markdown.link');}
  const raw=source.replace(/<%#\s*poem-workshop-meta:v1-start[\s\S]*?poem-workshop-meta:v1-end\s*%>/gi,value=>value.replace(/[^\r\n]/g,' '));
  for(const item of directUrls(raw))if(!covered.some(range=>item.index>=range.start&&item.index<range.end)&&!parsed.units.some(unit=>unit.codeRanges.some(range=>item.index>=range.originalStart&&item.index<range.originalEnd))) {
    const before=source.slice(Math.max(0,item.index-12),item.index),usage=/url\(\s*['"]?$/.test(before)?'media':'unknown';
    addTarget(item.url,item.index,usage,'resource');
  }
  const findings=[...hints];
  for(const target of targets){
    const url=parsedUrl(target.value),dynamic=/\$\d+|\$<[^>]+>|\$\{/.test(target.value);
    if(/^http:\/\/www\.w3\.org\/(?:2000\/svg|1999\/xlink)$/i.test(target.value))continue;
    const extra={riskEvidence:{action:target.action,usage:target.usage,target:target.value,expression:target.expression}};
    if(dynamic)findings.push({ruleId:'U5',severity:'warn',title:'远程目标包含运行时替换内容',index:target.index,detail:target.value,suggestion:'请提供所有可能访问的目标，或向审核员说明动态目标的来源和用途。',extra});
    if(!dynamic&&trustedStaticMediaUrl(target.value,target.usage))continue;
    const official=OFFICIAL_URL_RULES.some(rule=>url.hostname.toLowerCase()===rule.host&&rule.path.test(url.pathname));
    const ruleId=ipHost(url.hostname)?'U4':url.protocol==='http:'?'U3':official?null:'U2';
    if(ruleId)findings.push({ruleId,severity:'warn',title:ruleId==='U4'?'外部目标使用 IP 地址':ruleId==='U3'?'外部目标使用 HTTP':'外部目标需要确认来源',index:target.index,detail:target.value,suggestion:target.usage==='navigation'?'请向审核员说明用户将被带往哪里，以及为什么需要这个跳转。':'请确认这个目标是项目需要的资源来源；这条提示本身不代表违规。',extra});
  }
  return findings;
}
