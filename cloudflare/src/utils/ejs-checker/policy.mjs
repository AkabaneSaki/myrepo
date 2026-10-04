import { buildScopes, isFunctionLocal, patternTargets, resolveBinding } from './scope.mjs';

export const GENERIC_GLOBAL_NAMES = new Set(['data','value','result','state','temp','tmp','config','ctx','context','output','response','item']);
const GLOBAL_BASES = new Set(['globalThis', 'window', 'self']);

function hasLeakDocumentation(content, index) {
  const area = content.slice(Math.max(0, index - 700), Math.min(content.length, index + 700)).toLowerCase();
  return /\bintentional\b|\bdeclared\b|故意|刻意|设计行为/.test(area)
    && /\bowner\s*:|归属|负责人|责任/.test(area)
    && /\blifecycle\s*:|生命周期/.test(area)
    && /\bcleanup\s*:|清理|delete\s+(?:globalthis|window)\s*\./.test(area);
}

function propertyName(member) {
  if (!member.computed && member.property.type === 'Identifier') return member.property.name;
  if (member.computed && member.property.type === 'Literal' && typeof member.property.value === 'string') return member.property.value;
  if (member.computed && member.property.type === 'TemplateLiteral' && member.property.expressions.length === 0) return member.property.quasis[0].value.cooked;
  return null;
}

function sharedGlobal(target, scope) {
  if (target.type !== 'MemberExpression') return null;
  let first = target;
  while (first.object.type === 'MemberExpression') first = first.object;
  if (first.object.type !== 'Identifier' || !GLOBAL_BASES.has(first.object.name)
      || resolveBinding(scope, first.object.name)) return null;
  return { base: first.object.name, name: propertyName(first), node: first };
}

// Finding records use original input offsets. The report adapter owns visibility/formatting.
export function inspectAstPolicy(entry, parsed) {
  const findings = [], symbols = [], topVars = new Map(), reported = new Set();
  if (entry.sourceType === 'regex') return { findings, symbols };
  const content = String(entry.rawContent ?? entry.content ?? '');
  const add = (ruleId, severity, title, index, detail, suggestion, extra) => {
    findings.push({ ruleId, severity, title, index, detail, suggestion, ...(extra ? { extra } : {}) });
  };
  for (const unit of parsed.units ?? []) {
    if (unit.kind !== 'ejs' || !unit.ast) continue;
    const analysis = buildScopes(unit);
    const original = node => unit.sourceMap.isOriginal(node.start);
    const at = node => unit.sourceMap.map(node.start);
    for (const declaration of analysis.namedDeclarations) {
      const { node, scope, kind, binding } = declaration;
      if (!original(node) || scope.kind !== 'root' || entry.isPrivate) continue;
      const index = at(node), name = binding.name;
      symbols.push({ name, index, type: kind });
      if (kind === 'function') add('L3', 'high', '顶层函数不符合 Workshop 组合兼容公约', index,
        '函数 '+name+' 暴露在 EJS 顶层。它当前可能正常运行，但若其他项目在同一编译单元使用同名函数，会发生静默覆盖。',
        '把只供本条目使用的函数放进本条目的 { ... } 局部块。若它本来用于跨条目共享，不要依赖顶层函数名；改用项目专属的显式共享命名空间。');
      else add('L3', 'high', '顶层 class 不符合 Workshop 组合兼容公约', index,
        'class '+name+' 暴露在 EJS 顶层；同名 class 进入同一编译单元会发生词法声明冲突。',
        '把只供本条目使用的 class 放进本条目的 { ... } 局部块；不要把普通顶层 class 当作跨项目共享接口。');
    }
    for (const declaration of analysis.declarations) {
      const { node, scope, targetScope, bindings } = declaration;
      if (!original(node)) continue;
      const index = at(node), label = bindings.map(binding => binding.name).join(', ');
      if (node.kind === 'var') {
        if (entry.isPrivate || isFunctionLocal(scope)) {
          add('L1', 'info', '检测到局部 var（维护提示）', index,
            '检测到 var '+label+'。这里已有函数/private 隔离，因此不会作为顶层组合兼容阻断。',
            '新模板仍建议按是否重新赋值选择 const 或 let；不要机械把 var 改成 const。');
          continue;
        }
        for (const binding of bindings) {
          const bindingIndex = at(binding);
          symbols.push({ name: binding.name, index: bindingIndex, type: 'var' });
          if (!topVars.has(binding.name)) topVars.set(binding.name, []);
          topVars.get(binding.name).push(bindingIndex);
        }
        add('L1', 'high', '顶层 var 不符合 Workshop 组合兼容公约', index,
          'var '+label+' 使用 EJS 函数作用域；即使写在 { ... } 或 for 块里，也可能与未来同时进入同一编译单元的项目共享/覆盖。',
          '如果这是本条目的临时状态：不再赋值时用 const，会重新赋值时用 let，并放进本条目的 { ... } 局部块。不要机械批量替换。');
      } else if (targetScope.kind === 'root' && !entry.isPrivate) {
        for (const binding of bindings) symbols.push({ name: binding.name, index: at(binding), type: node.kind });
        add('L2', 'high', '顶层 '+node.kind+' 未局部化（Workshop 公约阻断）', index,
          node.kind+' '+label+' 位于 EJS 顶层。它在当前 placement/API 下可能完全正常，但 Workshop 不允许依赖 message、position、depth 或 role 的隔离来获得组合兼容通过。',
          '如果这些变量只供当前条目使用，把相关代码放进一个 { ... } 局部块；for (let/const ...) 的循环头本身已有块作用域，不需要为了消警告改写。');
      }
    }
    const reportWrite = (target, scope) => {
      if (!original(target)) return;
      const index = at(target), key = target.type+'@'+index;
      if (reported.has(key)) return;
      reported.add(key);
      const global = sharedGlobal(target, scope);
      if (global) {
        const name = global.name, display = global.base + (name === null ? '[运行时名称]' : '.'+name);
        if (name !== null) symbols.push({ name, index, type: 'global' });
        if (GENERIC_GLOBAL_NAMES.has(name)) add('L5', 'high', '共享全局名称过于通用（公约阻断）', index,
          display+' 使用常见通用名，未来极易与其他项目或脚本撞名。',
          '跨条目共享必须使用项目专属命名空间。Workshop 集成版应以项目稳定 ID 校验，例如 globalThis.__PW_<PROJECT_ID>__。');
        const documented = hasLeakDocumentation(content, index);
        add('L4', 'warn', documented ? '已声明的共享全局行为仍需确认' : '显式共享全局状态需要确认', index,
          display+' 会写入浏览器共享全局对象。'+(documented ? '附近已有 Owner/Lifecycle/Cleanup 说明，但离线 checker 无法确认这个命名空间是否真正属于当前 Workshop 项目。' : 'Workshop 公约要求跨条目共享必须显式、项目专属，并说明生命周期与清理方式。'),
          '如果确实需要跨条目共享：使用项目专属的唯一命名空间，并写清 Owner、Lifecycle、Cleanup；最终 uploader 应用项目稳定 ID 做自动校验。否则改成本条目的局部状态。');
      } else if (target.type === 'Identifier' && !resolveBinding(scope, target.name)) {
        const name = target.name;
        symbols.push({ name, index, type: 'implicit' });
        add('L4', 'high', '裸赋值不符合 Workshop 组合兼容公约', index,
          name+' 在当前位置没有有效的 let/const/var/参数绑定。真实 ST 环境中，这可能覆盖 EJS 环境值或创建共享全局。',
          '如果只是本条目的临时变量，在正确的局部作用域声明它；如果确实需要跨条目共享，改用项目专属的显式 globalThis 命名空间；不要用裸赋值。');
        if (GENERIC_GLOBAL_NAMES.has(name)) add('L5', 'high', '裸共享名称过于通用', index,
          name+' 是常见通用名，一旦形成共享状态非常容易与其他项目撞名。',
          '不要共享这个裸名字；局部化，或使用项目专属的显式共享命名空间。');
      }
    };
    for (const { node, scope } of analysis.nodes) {
      let targets = [];
      if (node.type === 'AssignmentExpression') targets = patternTargets(node.left);
      else if (node.type === 'UpdateExpression') targets = patternTargets(node.argument);
      else if ((node.type === 'ForInStatement' || node.type === 'ForOfStatement') && node.left.type !== 'VariableDeclaration') targets = patternTargets(node.left);
      for (const target of targets) reportWrite(target, scope);
    }
  }
  for (const [name, positions] of topVars) {
    if (positions.length > 1) add('L1', 'high', '同一条目重复声明同名 var', positions[1],
      'var '+name+' 在同一个 EJS 函数作用域内重复声明 '+positions.length+' 次；这些声明实际操作的是同一个变量。',
      '只声明一次；后续若确实要修改值，使用普通赋值。若它只是本条目临时状态，同时按公约放入局部 { ... }。');
  }
  return { findings, symbols };
}

export function inspectSymbolCollisions(entries) {
  const map = new Map(), findings = [];
  for (const entry of entries) {
    if (entry.sourceType === 'regex') continue;
    const seen = new Set();
    for (const symbol of entry.symbols ?? []) {
      const key = symbol.name+':'+symbol.type;
      if (!symbol.name || seen.has(key)) continue;
      seen.add(key);
      if (!map.has(symbol.name)) map.set(symbol.name, []);
      map.get(symbol.name).push({ entry, symbol });
    }
  }
  for (const [name, list] of map) {
    if (new Set(list.map(item => item.entry.id)).size < 2) continue;
    if (/^__PW_[A-Za-z0-9][A-Za-z0-9_]*__$/.test(name) && list.every(item => item.symbol.type === 'global')) continue;
    findings.push({ entry: list[0].entry, ruleId: 'L6', severity: 'high',
      title: '不同条目公开了同一个名称（组合兼容阻断）', index: list[0].symbol.index,
      detail: name+' 同时出现在：'+list.map(item => item.entry.name+' ('+item.symbol.type+')').join(' ↔ ')+'。这些条目当前未必处于同一 EJS compilation unit，但 Workshop 公约不依赖 position/depth/role/API 设置提供隔离；一旦进入同一编译单元，可能编译失败、串值或静默覆盖。',
      suggestion: '把临时状态局部化。若确实需要跨条目共享，只通过项目专属的显式命名空间共享，不要复用普通顶层名称。',
      extra: { entry: list.map(item => item.entry.name).join(' ↔ '), uid: list.map(item => String(item.entry.uid)).join(' ↔ '), relatedEntryIds: [...new Set(list.map(item => item.entry.id))] } });
  }
  return findings;
}
