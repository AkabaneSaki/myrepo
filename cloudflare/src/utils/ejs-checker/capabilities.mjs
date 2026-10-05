import { buildScopes, resolveBinding } from './scope.mjs';
import { expressionEvidence, networkCapability, propertyName, staticStringValues } from './links.mjs';
import { CHECK_POLICY_VERSION } from './policy-config.mjs';

const GLOBALS = new Set(['window','globalThis','self']);
const SENSITIVE_WORDS = new Set(['token','auth','session','password','passwd','secret','cookie','credential','bearer']);
function memberName(node) {
  if (node?.type !== 'MemberExpression') return null;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  return literalString(node.property);
}
function literalString(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && !node.expressions.length) return node.quasis[0].value.cooked;
  return null;
}
function unwrap(node) { return node?.type === 'ChainExpression' ? node.expression : node; }
function globalObject(node, scope) {
  node = unwrap(node);
  if (node?.type === 'Identifier') return GLOBALS.has(node.name) && !resolveBinding(scope,node.name);
  return node?.type === 'MemberExpression' && ['window','globalThis','self','top','parent','frames'].includes(memberName(node)) && globalObject(node.object,scope);
}
function builtin(node, names, scope) {
  node = unwrap(node);
  if (node?.type === 'Identifier') return names.has(node.name) && !resolveBinding(scope, node.name) ? node.name : null;
  if (node?.type !== 'MemberExpression' || !globalObject(node.object,scope)) return null;
  const name = memberName(node);
  return names.has(name) ? name : null;
}
function reference(node, parent) {
  if (!parent) return true;
  if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return false;
  if (['Property','MethodDefinition','PropertyDefinition'].includes(parent.type)
      && parent.key === node && !parent.computed && !parent.shorthand) return false;
  if (['LabeledStatement','BreakStatement','ContinueStatement'].includes(parent.type) && parent.label === node) return false;
  if (['ImportSpecifier','ImportDefaultSpecifier','ImportNamespaceSpecifier','ExportSpecifier'].includes(parent.type)) return false;
  return true;
}
function sensitiveKey(key) {
  const words = (String(key).match(/[A-Z]+(?=[A-Z][a-z]|\b)|[A-Z]?[a-z]+|[0-9]+/g) ?? []).map(word => word.toLowerCase());
  return words.some(word => SENSITIVE_WORDS.has(word))
    || words.some((word, i) => word === 'api' && words[i+1] === 'key')
    || words.some((word, i) => (word === 'access' || word === 'refresh') && words[i+1] === 'key');
}
const STORAGE = new Set(['localStorage','sessionStorage']);
const URL_NETWORK = new Set(['fetch','WebSocket','EventSource']);
const EVAL = new Set(['eval']), FUNCTION = new Set(['Function']);

function xhrRequest(node,analysis,scope) {
  if(node.type!=='CallExpression'||node.callee.type!=='MemberExpression'||memberName(node.callee)!=='send')return null;
  const object=node.callee.object;if(object.type!=='Identifier')return null;
  const binding=resolveBinding(scope,object.name)?.[0];
  const declaration=binding?analysis.nodes.find(item=>item.node.type==='VariableDeclarator'&&item.node.id===binding.node):null;
  if(declaration?.node.init?.type!=='NewExpression'||builtin(declaration.node.init.callee,new Set(['XMLHttpRequest']),declaration.scope)!=='XMLHttpRequest')return null;
  const open=analysis.nodes.findLast(item=>item.node.type==='CallExpression'&&memberName(item.node.callee)==='open'&&item.node.callee.object?.type==='Identifier'&&resolveBinding(item.scope,item.node.callee.object.name)?.[0]===binding&&item.node.start<node.start);
  return{method:literalString(open?.node.arguments[0])??'dynamic',target:open?staticStringValues(open.node.arguments[1],analysis,open.scope):null};
}

function infiniteHeaderTokens(unit) {
  const tokens = unit.tokens ?? [], found = [];
  for (let i=0;i<tokens.length;i++) {
    const token = tokens[i], label = token.type.label;
    if (!['while','for'].includes(label) || !unit.sourceMap.isOriginal(token.start) || tokens[i+1]?.type.label !== '(') continue;
    let depth=1, close=-1;
    for (let j=i+2;j<tokens.length;j++) {
      const current = tokens[j].type.label;
      if (current === '(') depth++;
      if (current === ')' && --depth === 0) { close=j;break; }
      // Other token types do not change parenthesis depth.
      if (current !== ')') depth += 0;
    }
    if (close < 0 || !unit.sourceMap.isOriginal(tokens[close].start)) continue;
    const header = tokens.slice(i+2,close);
    if (header.some(item => !unit.sourceMap.isOriginal(item.start))) continue;
    if (label === 'while') {
      let inner = header;
      while (inner[0]?.type.label === '(' && inner.at(-1)?.type.label === ')') inner=inner.slice(1,-1);
      if (inner.length === 1 && (inner[0].type.label === 'true' || (inner[0].type.label === 'num' && inner[0].value === 1))) found.push(token);
    } else {
      const semicolons=[];let parens=0, brackets=0, braces=0;
      for (let j=0;j<header.length;j++) {
        const current=header[j].type.label;
        if (current === '(') parens++; else if (current === ')') parens--;
        else if (current === '[') brackets++; else if (current === ']') brackets--;
        else if (current === '{' || current === '${') braces++; else if (current === '}') braces--;
        else if (current === ';' && parens === 0 && brackets === 0 && braces === 0) semicolons.push(j);
      }
      if (semicolons.length === 2 && semicolons[1] === semicolons[0]+1) found.push(token);
    }
  }
  return found;
}

export function inspectCapabilities(entry, parsed) {
  const findings=[], seen=new Set();
  if (parsed.internalErrors?.length) return findings;
  const raw=String(entry.rawContent ?? entry.content ?? '');
  const add = (unit, node, ruleId, severity, title, suggestion, detail, evidence={}) => {
    const index=unit.sourceMap.map(node.start);
    const key=ruleId+':'+index;if(seen.has(key))return;seen.add(key);
    findings.push({ ruleId, severity, title, index,
      detail: detail ?? raw.slice(index, Math.max(index+1, unit.sourceMap.map(node.end))).slice(0,220), suggestion,
      extra:{riskEvidence:{action:ruleId,expression:expressionEvidence(node),policyVersion:CHECK_POLICY_VERSION,...evidence}} });
  };
  const reportInfinite = (unit,node) => add(unit,node,'M5','high','检测到明显无界循环（公约阻断）',
    '必须有清楚可靠的退出方式。Workshop 不负责一般性能优化，只阻断这种明显可能把页面线程或资源打爆的写法。');
  for (const unit of parsed.units ?? []) {
    if (!unit.ast) {
      for (const token of infiniteHeaderTokens(unit)) reportInfinite(unit,token);
      continue;
    }
    const analysis=buildScopes(unit),{nodes}=analysis;
    for (const { node,scope,parent } of nodes) {
      if (!unit.sourceMap.isOriginal(node.start)) continue;
      if (node.type === 'ObjectPattern') {
        const source = parent?.type === 'VariableDeclarator' && parent.id === node ? parent.init : parent?.type === 'AssignmentExpression' && parent.left === node ? parent.right : null;
        if (globalObject(source,scope)) for (const property of node.properties) {
          if (property.type !== 'Property') continue;
          const key = property.computed ? literalString(property.key) : property.key.name ?? literalString(property.key);
          if (key === 'eval') add(unit,property,'M1','high','使用 eval 动态执行代码（公约阻断）','Workshop 项目禁止调用、转存或间接使用 eval；请改成固定逻辑。');
          if (key === 'Function') add(unit,property,'M2','high','使用 Function 构造器动态创建代码（公约阻断）','Workshop 项目禁止调用或转存 Function 构造器；请改用固定函数或明确分支。');
        }
      }
      if (reference(node,parent) && builtin(node,EVAL,scope)) add(unit,node,'M1','high','使用 eval 动态执行代码（公约阻断）',
        'Workshop 项目禁止调用、转存或间接使用 eval。不要把 eval 包装、别名化或换一种调用方式；请改成固定逻辑。');
      if (reference(node,parent) && builtin(node,FUNCTION,scope)) add(unit,node,'M2','high','使用 Function 构造器动态创建代码（公约阻断）',
        'Workshop 项目禁止调用或转存 Function 构造器来生成可执行代码；改用固定函数或明确分支。');

      const name=memberName(node);
      let sensitive=false;
      if (node.type === 'MemberExpression') {
        if (name === 'cookie' && builtin(node.object,new Set(['document']),scope)) sensitive=true;
        if (builtin(node.object,STORAGE,scope)
            && (name === 'length' || name === 'key' || (name && !['getItem','setItem','removeItem'].includes(name) && sensitiveKey(name)))) sensitive=true;
      }
      if (node.type === 'ForInStatement' && builtin(node.right,STORAGE,scope)) sensitive=true;
      if (node.type === 'CallExpression') {
        const callee=unwrap(node.callee), method=memberName(callee);
        if (method === 'getItem' && builtin(callee.object,STORAGE,scope)) {
          const key=literalString(node.arguments[0]);
          if (key !== null && sensitiveKey(key)) sensitive=true;
        }
        if (['keys','values','entries'].includes(method) && builtin(callee.object,new Set(['Object']),scope) && builtin(node.arguments[0],STORAGE,scope)) sensitive=true;
      }
      if (sensitive) add(unit,node,'M3','warn','访问敏感或大范围浏览器数据，需要审核',
        '这不会自动拒绝上传，但审核员需要确认用途。项目自己的主题、字号等明确本地设置可以使用 localStorage；Cookie、token/API key 类数据或枚举整份存储需要重点检查。');

      if (node.type === 'WhileStatement' && node.test.type === 'Literal' && (node.test.value === true || node.test.value === 1)) reportInfinite(unit,node);
      if (node.type === 'ForStatement' && node.test === null) reportInfinite(unit,node);
      if (!['CallExpression','NewExpression'].includes(node.type)) continue;
      const callee=unwrap(node.callee), method=memberName(callee);
      const indirect=['call','apply'].includes(method);
      const network=networkCapability(callee,analysis,scope) || (indirect ? networkCapability(callee.object,analysis,scope) : null);
      const beacon=builtin(callee,new Set(['sendBeacon']),scope)
        || (method === 'sendBeacon' && builtin(callee.object,new Set(['navigator']),scope));
      const xhr=xhrRequest(node,analysis,scope);
      if ((network && network !== 'XMLHttpRequest') || beacon || xhr) {
        let argument=node.arguments[0];if(method==='call')argument=node.arguments[1];else if(method==='apply')argument=node.arguments[1]?.elements?.[0];
        const target=xhr?.target??staticStringValues(argument,analysis,scope);
        const options=node.arguments[1]?.type==='ObjectExpression'?node.arguments[1]:null;
        const requestMethod=options?.properties.find(property=>propertyName(property)==='method')?.value;
        add(unit,node,'M4','warn','检测到主动网络通信，需要审核',
          '这不会自动拒绝上传；请由审核员确认请求目标、发送内容与功能需要。可信静态媒体来源也不豁免主动网络调用。',undefined,
          {action:xhr?'XMLHttpRequest.send':network??'sendBeacon',target:target??'dynamic',method:xhr?.method??(beacon?'POST':literalString(requestMethod)??'GET'),usage:'network'});
      }
      if (URL_NETWORK.has(network)) {
        let argument=node.arguments[0], uncertainApply=false;
        if (method === 'call') argument=node.arguments[1];
        else if (method === 'apply') {
          const argumentsArray=node.arguments[1];
          if (argumentsArray?.type === 'ArrayExpression') argument=argumentsArray.elements[0];
          else { argument=argumentsArray;uncertainApply=true; }
        }
        if (!staticStringValues(argument,analysis,scope) || uncertainApply) add(unit,node,'U5','warn','网络目标由运行时变量决定',
          '如果这是固定资源，请改成有限、明确的 URL 映射；如果确实必须动态联网，需要人工确认实际目标范围。',undefined,{action:network,target:'dynamic',usage:'network'});
      }
      if (builtin(callee,new Set(['atob','btoa']),scope)
          || (['fromCharCode','fromCodePoint'].includes(method) && builtin(callee.object,new Set(['String']),scope))) add(unit,node,'AH1','hint','发现编码 / 解码式字符串构造',
        '不代表有问题；人工审核时确认结果没有被继续当作代码或隐藏远程目标。');
      if (indirect || (callee.type === 'MemberExpression' && callee.computed && memberName(callee) === null
          && globalObject(callee.object,scope))) add(unit,node,'AH2','hint','发现动态 / 间接函数调用形状',
        '机器无法可靠知道最终调用什么；只作为审核中心的黄色提示，不自动拒绝。');
      if (['replace','replaceAll','split','join'].includes(method)
          && node.arguments.some(argument => {const value=literalString(argument);return value !== null && (value.includes('<%') || value.includes('%>'));})) add(unit,node,'AH3','hint','发现运行时操作 EJS 标记',
        '不自动判错；请确认它不会把原本的注释/文本重新变成可执行 EJS。');
      if ((method === 'createElement' || (callee.type === 'Identifier' && callee.name === 'createElement' && !resolveBinding(scope,callee.name)))
          && literalString(node.arguments[0]) === 'script') add(unit,node,'AH4','hint','发现运行时创建 <script>',
        '不自动判错；人工审核时确认 script.src / textContent 最终来自哪里，以及是否绕过了正常的 U / M 检查。');
    }
  }
  return findings;
}
