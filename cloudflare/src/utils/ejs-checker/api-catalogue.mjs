import { buildScopes, resolveBinding } from './scope.mjs';

// Behavioural facts checked against the pinned upstream documentation/source.
// This catalogue is advisory: env, define(), SharedDefines and extension events
// can add/replace context names. Unknown functions are never rejected.
export const API_SOURCE = Object.freeze({
  repository: 'https://github.com/zonde306/ST-Prompt-Template',
  commit: 'd6f520d149aba146305b0b781ddd691d449c28d2',
  reference: 'docs/reference_cn.md',
  implementation: 'src/function/ejs.ts',
  features: 'docs/features_cn.md',
});

const api = (asynchronous, minimumArguments, signatures, availability = 'template context') =>
  Object.freeze({ asynchronous, minimumArguments, signatures: Object.freeze(signatures), availability });
const variableRead = api(false, 1, ['key, options?']);
const variableWrite = api(false, 2, ['key, value, options?'], 'template context; preparation writes depend on dryRun');
const worldRead = api(true, 1, ['title, data?', 'lorebook, title, data?']);
const worldActivate = api(true, 1, ['title, force?', 'lorebook, title, force?']);

export const API_CATALOGUE = Object.freeze({
  getvar: variableRead,
  getLocalVar: variableRead,
  getGlobalVar: variableRead,
  getMessageVar: variableRead,
  setvar: variableWrite,
  setLocalVar: variableWrite,
  setGlobalVar: variableWrite,
  setMessageVar: variableWrite,
  getwi: worldRead,
  getWorldInfo: worldRead,
  activewi: worldActivate,
  activateWorldInfo: worldActivate,
  execute: api(true, 1, ['cmd']),
  getqr: api(true, 2, ['name, label, data?']),
  getQuickReply: api(true, 2, ['name, label, data?']),
  getWorldInfoData: api(true, 1, ['name']),
  getWorldInfoActivatedData: api(true, 2, ['name, keyword, condition?']),
  evalTemplate: api(true, 1, ['content, data?, options?']),
  define: api(false, 2, ['name, value, merge?']),
});

// Availability is evidence for future phase-aware checks, not a whitelist.
// Calling getwi can supply world_info even outside a generate decorator.
export const API_CONTEXT_FIELDS = Object.freeze({
  runType: Object.freeze({ values: Object.freeze(['generate', 'preparation', 'render', 'render_permanent']), mayBeUndefined: true }),
  world_info: Object.freeze({ availability: 'generate decorators and nested worldbook reads; additional env may supply it' }),
  generateBuffer: Object.freeze({ availability: 'generate decorators' }),
  generateData: Object.freeze({ availability: 'generate decorators' }),
});

const PROMISE_MEMBERS = new Set(['then', 'catch', 'finally']);

function propertyName(node) {
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string') return node.property.value;
  return null;
}

function stringOperand(node) {
  return (node.type === 'Literal' && typeof node.value === 'string') || node.type === 'TemplateLiteral';
}

function consumesUnresolvedValue(node, parents) {
  // Optional chaining adds a ChainExpression, without awaiting the result.
  let value = node;
  let parent = parents.get(value);
  while (parent?.type === 'ChainExpression') {
    value = parent;
    parent = parents.get(value);
  }
  if (parent?.type === 'MemberExpression' && parent.object === value) {
    const name = propertyName(parent);
    return name !== null && !PROMISE_MEMBERS.has(name);
  }
  if (parent?.type === 'BinaryExpression' && parent.operator === '+') {
    return stringOperand(parent.left === value ? parent.right : parent.left);
  }
  return parent?.type === 'TemplateLiteral' && parent.expressions.includes(value);
}

/** Inspect only definite local API misuse; never execute or resolve templates. */
export function inspectApiUsage(entry, parsed) {
  if (entry.sourceType === 'regex') return [];
  const records = [];
  for (const unit of parsed.units) {
    if (!unit.ast || unit.kind !== 'ejs') continue;
    const scopes = buildScopes(unit);
    const parents = new WeakMap(scopes.nodes.map(({ node, parent }) => [node, parent]));
    for (const { node, scope } of scopes.nodes) {
      if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier') continue;
      if (!unit.sourceMap.isOriginal(node.callee.start)) continue;
      const name = node.callee.name;
      const spec = Object.hasOwn(API_CATALOGUE, name) ? API_CATALOGUE[name] : null;
      if (!spec || resolveBinding(scope, name)) continue;
      const index = unit.sourceMap.map(node.callee.start);
      if (spec.asynchronous && consumesUnresolvedValue(node, parents)) {
        records.push({
          ruleId: 'API1', severity: 'warn', visibility: 'reviewer_only',
          title: '读取结果前可能少了等待', index,
          detail: `${name} 会稍后返回结果；这里直接把尚未完成的读取当成文字或已读取的内容使用。`,
          suggestion: `先用 await 等待 ${name} 返回，再读取其中的内容或拼接文字。若已在 .then 中处理结果，请保留该方式。`,
        });
      }
      if (!node.arguments.some(argument => argument.type === 'SpreadElement') && node.arguments.length < spec.minimumArguments) {
        records.push({
          ruleId: 'API2', severity: 'warn', visibility: 'reviewer_only',
          title: '调用时可能漏填了内容', index,
          detail: `${name} 的这次调用只填了 ${node.arguments.length} 项；该用法至少需要 ${spec.minimumArguments} 项。`,
          suggestion: `检查 ${name} 括号内是否填齐了要读取或设置的内容。若这个同名函数由其他扩展提供，请按该扩展的用法确认。`,
        });
      }
    }
  }
  return records;
}
