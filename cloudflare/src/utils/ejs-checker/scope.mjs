// Bindings belong to actual JavaScript scopes; the parser's EJS wrapper is excluded.
export function patternTargets(pattern) {
  if (!pattern) return [];
  switch (pattern.type) {
    case 'Identifier':
    case 'MemberExpression': return [pattern];
    case 'RestElement': return patternTargets(pattern.argument);
    case 'AssignmentPattern': return patternTargets(pattern.left);
    case 'ArrayPattern': return pattern.elements.flatMap(patternTargets);
    case 'ObjectPattern': return pattern.properties.flatMap(property =>
      patternTargets(property.type === 'RestElement' ? property.argument : property.value));
    default: return [];
  }
}

export function astChildren(node) {
  const children = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === 'parent') continue;
    if (Array.isArray(value)) {
      for (const child of value) if (child && typeof child.type === 'string') children.push(child);
    } else if (value && typeof value.type === 'string') children.push(value);
  }
  return children;
}

export function buildScopes(unit) {
  const root = { kind: 'root', parent: null, bindings: new Map() };
  const nodes = [], declarations = [], namedDeclarations = [];
  const nodeScopes = new WeakMap();
  const childScope = (kind, parent) => ({ kind, parent, bindings: new Map() });
  const bind = (scope, target, kind) => {
    for (const node of patternTargets(target)) {
      if (node.type !== 'Identifier') continue;
      if (!scope.bindings.has(node.name)) scope.bindings.set(node.name, []);
      scope.bindings.get(node.name).push({ name: node.name, node, kind });
    }
  };
  const varScope = scope => {
    while (!['root', 'function-body', 'static'].includes(scope.kind)) scope = scope.parent;
    return scope;
  };
  const visit = (node, scope, parent = null) => {
    if (!node) return;
    if (node === unit.wrapperFunction) {
      for (const statement of node.body.body) visit(statement, root, node.body);
      return;
    }
    nodeScopes.set(node, scope);
    nodes.push({ node, scope, parent });
    switch (node.type) {
      case 'ImportDeclaration':
        for (const specifier of node.specifiers) bind(scope, specifier.local, 'import');
        return;
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression': {
        if (node.type === 'FunctionDeclaration' && node.id) {
          bind(scope, node.id, 'function');
          namedDeclarations.push({ node, scope, kind: 'function', binding: node.id });
        }
        const params = childScope('function-params', scope);
        if (node.type === 'FunctionExpression' && node.id) bind(params, node.id, 'function-name');
        for (const parameter of node.params) bind(params, parameter, 'parameter');
        for (const parameter of node.params) visit(parameter, params, node);
        const body = childScope('function-body', params);
        if (node.body.type === 'BlockStatement') {
          nodeScopes.set(node.body, body);
          nodes.push({ node: node.body, scope: body, parent: node });
          for (const statement of node.body.body) visit(statement, body, node.body);
        } else visit(node.body, body, node);
        return;
      }
      case 'ClassDeclaration':
      case 'ClassExpression': {
        if (node.type === 'ClassDeclaration' && node.id) {
          bind(scope, node.id, 'class');
          namedDeclarations.push({ node, scope, kind: 'class', binding: node.id });
        }
        const inner = childScope('class', scope);
        if (node.id) bind(inner, node.id, 'class-name');
        visit(node.superClass, inner, node);
        visit(node.body, inner, node);
        return;
      }
      case 'VariableDeclaration': {
        const targetScope = node.kind === 'var' ? varScope(scope) : scope;
        const bindings = node.declarations.flatMap(declaration => patternTargets(declaration.id))
          .filter(binding => binding.type === 'Identifier');
        for (const declaration of node.declarations) bind(targetScope, declaration.id, node.kind);
        declarations.push({ node, scope, targetScope, bindings });
        break;
      }
      case 'BlockStatement':
      case 'SwitchStatement':
      case 'StaticBlock': {
        // Switch discriminants are evaluated outside the switch's lexical scope.
        if (node.type === 'SwitchStatement') visit(node.discriminant, scope, node);
        const inner = childScope(node.type === 'StaticBlock' ? 'static' : 'block', scope);
        for (const child of astChildren(node)) {
          if (node.type === 'SwitchStatement' && child === node.discriminant) continue;
          visit(child, inner, node);
        }
        return;
      }
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement': {
        const inner = childScope('loop', scope);
        for (const child of astChildren(node)) visit(child, inner, node);
        return;
      }
      case 'CatchClause': {
        const inner = childScope('catch', scope);
        bind(inner, node.param, 'catch');
        visit(node.param, inner, node);
        visit(node.body, inner, node);
        return;
      }
    }
    for (const child of astChildren(node)) visit(child, scope, node);
  };
  if (unit.ast) visit(unit.ast, root);
  return { root, nodes, nodeScopes, declarations, namedDeclarations };
}

export function resolveBinding(scope, name) {
  for (let current = scope; current; current = current.parent) {
    if (current.bindings.has(name)) return current.bindings.get(name);
  }
  return null;
}

export function isFunctionLocal(scope) {
  for (let current = scope; current; current = current.parent) {
    if (['function-params', 'function-body', 'static'].includes(current.kind)) return true;
  }
  return false;
}
