import { Parser, tokenizer } from 'acorn';
import { buildEjsUnit, buildRegexUnits, sourceLocation, TemplateSyntaxError } from './source-units.mjs';
import { CHECKER_LIMITS, CheckerLimitError, createParseBudget } from './limits.mjs';

const ACORN_OPTIONS = Object.freeze({ ecmaVersion: 'latest', locations: true, ranges: true });

function internalError(error) {
  if (error instanceof CheckerLimitError || error instanceof RangeError) {
    return { kind: 'limit', message: error instanceof CheckerLimitError ? error.message : '代码嵌套过深，检查无法完成。请减少嵌套层数或拆分这段代码。' };
  }
  return { kind: 'internal', message: '代码检查暂时无法完成，请稍后重试。', cause: String(error?.message ?? error) };
}

function parseUnit(unit, budget) {
  const options = { ...ACORN_OPTIONS, sourceType: unit.sourceType };
  unit.ast = null;
  unit.wrapperFunction = null;
  unit.tokens = [];
  try {
    if (unit.code.length > CHECKER_LIMITS.javaScriptCharacters) throw new CheckerLimitError('单段脚本超过 20 万个字符，无法完成检查。请把这段脚本拆成较小的部分。');
    if (++budget.units > CHECKER_LIMITS.codeUnits) throw new CheckerLimitError('一次检查最多处理 500 段脚本。请减少本次提交的脚本数量。');
    let nodes = 0;
    const countNode = () => {
      if (++nodes > CHECKER_LIMITS.astNodesPerUnit || ++budget.nodes > CHECKER_LIMITS.astNodes) {
        throw new CheckerLimitError('脚本包含过多代码步骤，无法完成检查。请减少本次提交的脚本，或简化这段代码。');
      }
    };
    const BoundedParser = Parser.extend(Base => class extends Base {
      finishNode(...args) { countNode(); return super.finishNode(...args); }
      finishNodeAt(...args) { countNode(); return super.finishNodeAt(...args); }
    });
    unit.ast = BoundedParser.parse(unit.code, { ...options, onToken: unit.tokens });
    if (unit.wrapped) unit.wrapperFunction = unit.ast.body[0].expression;
    return null;
  } catch (error) {
    if (error instanceof SyntaxError && error.message.startsWith('Not enough stack space to parse input')) {
      return internalError(new CheckerLimitError('代码嵌套过深，检查无法完成。请减少嵌套层数或拆分这段代码。'));
    }
    if (!(error instanceof SyntaxError) || !Number.isInteger(error.pos)) return internalError(error);
    const mapped = unit.sourceMap.location(error.pos);
    unit.mappedError = { kind: 'syntax', ...mapped, message: error.message.replace(/ \(\d+:\d+\)$/, ''), generatedIndex: error.pos, unitKind: unit.kind };
    // The parser's onToken prefix is reliable evidence. Continue tokenization
    // only to a lexical failure; this is not an AST and never a successful parse.
    unit.tokens = [];
    try {
      const stream = tokenizer(unit.code, options);
      for (;;) {
        const token = stream.getToken();
        unit.tokens.push(token);
        if (token.type.label === 'eof') break;
      }
    } catch (tokenError) {
      if (!(tokenError instanceof SyntaxError)) return internalError(tokenError);
    }
    return unit.mappedError;
  }
}

function parseUnits(units, budget = createParseBudget()) {
  const result = { units, errors: [], internalErrors: [] };
  for (const unit of units) {
    const error = parseUnit(unit, budget);
    if (error?.kind === 'syntax') result.errors.push(error);
    else if (error) {
      result.internalErrors.push(error);
      if (error.kind === 'limit') break;
    }
  }
  return result;
}

export function parseEjs(rawContent, options = {}) {
  try {
    return parseUnits([buildEjsUnit(rawContent, options)], options.budget);
  } catch (error) {
    if (error instanceof TemplateSyntaxError) return { units: [], errors: [{ kind: 'syntax', ...sourceLocation(rawContent, error.index), message: error.message, unitKind: 'ejs' }], internalErrors: [] };
    return { units: [], errors: [], internalErrors: [internalError(error)] };
  }
}

export function parseRegex(rawContent, budget) {
  try {
    return parseUnits(buildRegexUnits(rawContent), budget);
  } catch (error) {
    return { units: [], errors: [], internalErrors: [internalError(error)] };
  }
}
