import { parse, tokenizer } from 'acorn';
import { buildEjsUnit, buildRegexUnits, sourceLocation, TemplateSyntaxError } from './source-units.mjs';

const ACORN_OPTIONS = Object.freeze({ ecmaVersion: 'latest', locations: true, ranges: true });

function internalError(error) {
  return { kind: 'internal', message: '代码检查暂时无法完成，请稍后重试。', cause: String(error?.message ?? error) };
}

function parseUnit(unit) {
  const options = { ...ACORN_OPTIONS, sourceType: unit.sourceType };
  unit.ast = null;
  unit.wrapperFunction = null;
  unit.tokens = [];
  try {
    unit.ast = parse(unit.code, { ...options, onToken: unit.tokens });
    if (unit.wrapped) unit.wrapperFunction = unit.ast.body[0].expression;
    return null;
  } catch (error) {
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

function parseUnits(units) {
  const result = { units, errors: [], internalErrors: [] };
  for (const unit of units) {
    const error = parseUnit(unit);
    if (error?.kind === 'syntax') result.errors.push(error);
    else if (error) result.internalErrors.push(error);
  }
  return result;
}

export function parseEjs(rawContent, options = {}) {
  try {
    return parseUnits([buildEjsUnit(rawContent, options)]);
  } catch (error) {
    if (error instanceof TemplateSyntaxError) return { units: [], errors: [{ kind: 'syntax', ...sourceLocation(rawContent, error.index), message: error.message, unitKind: 'ejs' }], internalErrors: [] };
    return { units: [], errors: [], internalErrors: [internalError(error)] };
  }
}

export function parseRegex(rawContent) {
  try {
    return parseUnits(buildRegexUnits(rawContent));
  } catch (error) {
    return { units: [], errors: [], internalErrors: [internalError(error)] };
  }
}
