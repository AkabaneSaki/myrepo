import assert from 'node:assert/strict';
import { parseEjs, parseRegex } from '../src/utils/ejs-checker/syntax.mjs';
import { sourceLocation } from '../src/utils/ejs-checker/source-units.mjs';

let assertions = 0;
function valid(source) {
  const parsed = parseEjs(source);
  assert.deepEqual(parsed.errors, [], source);
  assert.deepEqual(parsed.internalErrors, [], source);
  assert.ok(parsed.units[0].ast);
  assertions += 3;
  return parsed;
}

valid('<% const characterName = "艾莉亚"; const text = `a${1 + 2}b`; %>');
valid('<% const {a: renamed = 1, ...rest} = value; const [first, ...others] = items; %>');
valid('<% const re = /[%<>\\/]+/giu; const mixed = `x${(() => ({ y: /x/ }))().y}y`; %>');
valid('<% for await (const item of source) { %><%= await item.name; %><% } %>');
valid('<% if (condition) { %>one<%- result %><% } else { %>two<% } %>');
valid('<% async function run(){ return await getwi("book", "entry"); } class A { #x = 1; static { this.y = 2; } } %>');
valid('<% const x = other?.items?.[0] ?? {}; x.value ??= 1; %>');
valid('<% const embedded = "<%= value %>"; const nested = `<% const y = "<%= z %>"; %>`; %>');
valid('<%# eval("comment"); <%= ignored %> %><%% const = ; %>');
valid('<% // trailing comment %>text<% return; %>');
valid('@@private\r\n@@initial\r\n<% const x = 1; %>');
valid('@@description <%= decorator argument %>\n<% const x = 1; %>');

for (const source of ['<% const x = ; %>', '<% const = 1; %>', '<% { const x = 1 2; } %>', '<%= %>', '<% const x = "unterminated; %>', '<% if (true) { %>']) {
  const parsed = parseEjs(source);
  assert.equal(parsed.errors.length, 1, source);
  assert.equal(parsed.internalErrors.length, 0, source);
  assert.equal(parsed.units[0]?.ast ?? null, null, source);
  assertions += 3;
}
const missingTag = parseEjs('header\n<% const x = 1;');
assert.equal(missingTag.errors[0].index, 7);
assert.equal(missingTag.errors[0].line, 2);
assert.equal(missingTag.errors[0].column, 1);
assert.equal(missingTag.internalErrors.length, 0);
assert.equal(parseEjs(null).internalErrors.length, 1);
assert.equal(parseEjs(null).errors.length, 0);
assertions += 6;
assert.equal(parseRegex('<a href="https://example.org/?x=1&not=2">ok</a>').internalErrors.length, 0);
assert.equal(parseRegex('<script></script>').units[0].ast.type, 'Program');
assert.equal(parseRegex('<template><script>const = 1;</script><img onload="bad("></template>').units.length, 0);
assert.equal(parseRegex('<noscript><script>const = 1;</script></noscript>').units.length, 0);
const svg = parseRegex('<svg><script><![CDATA[eval(1)]]></script></svg>');
assert.deepEqual(svg.errors, []);
assert.deepEqual(svg.internalErrors, []);
assert.equal(svg.units[0].sourceMap.map(svg.units[0].code.indexOf('eval')), '<svg><script><![CDATA['.length);
const escapedScript = parseRegex('<script><!-- <script> </script> -->\n eval(1);</script>');
assert.equal(escapedScript.units.length, 1);
assert.ok(escapedScript.units[0].code.includes('eval(1)'));
assert.equal(escapedScript.errors.length, 0);
assertions += 10;

const mappedSource = '@@private\r\n<%# poem-workshop-meta:v1-start\r\n{}\r\npoem-workshop-meta:v1-end %>\r\n💡<% const x = ; %>';
const mapped = parseEjs(mappedSource);
const semicolon = mappedSource.indexOf(';');
assert.deepEqual({ index: mapped.errors[0].index, line: mapped.errors[0].line, column: mapped.errors[0].column }, sourceLocation(mappedSource, semicolon));
assert.equal(mapped.errors[0].line, 5);
assert.equal(mapped.errors[0].column, 16);
assertions += 3;

const crossTag = valid('<% let count = 0; %>text<% count += 1; %>');
const identifierOffset = crossTag.units[0].code.lastIndexOf('count');
assert.equal(crossTag.units[0].sourceMap.map(identifierOffset), crossTag.units[0].rawContent.lastIndexOf('count'));
assert.equal(crossTag.units[0].sourceMap.isOriginal(identifierOffset), true);
assert.equal(crossTag.units[0].sourceMap.isOriginal(0), false);
assert.equal(crossTag.units[0].wrapperFunction.type, 'FunctionExpression');
assert.equal(crossTag.units[0].wrapperFunction.async, true);
assertions += 5;

const html = '<!-- <script>const = 1;</script> -->' +
  '<style>p:before{content:"<script>bad</script>"}</style>' +
  '<script type="application/json">{"message":"<% not EJS %>"}</script>' +
  '<script>const text = "<img onclick=evil()>"; const x = 1;</script>' +
  '<script type="module">import x from "package"; await x();</script>' +
  '<button onclick="return eval(&quot;x&quot;)">go</button>' +
  '<img onload=handler()>' +
  '<a href="javascript&colon;eval&lpar;&#34;x&#34;&rpar;">go</a>';
const regex = parseRegex(html);
assert.deepEqual(regex.errors, []);
assert.deepEqual(regex.internalErrors, []);
assert.deepEqual(regex.units.map(unit => unit.kind), ['script', 'module', 'event', 'event', 'javascript-url']);
assert.equal(regex.units.some(unit => unit.kind === 'ejs'), false);
assertions += 4;
const event = regex.units.find(unit => unit.kind === 'event');
const evalOffset = event.code.indexOf('eval');
assert.equal(event.sourceMap.map(evalOffset), html.indexOf('eval(&quot;'));
assert.equal(event.sourceMap.isOriginal(evalOffset), true);
const url = regex.units.find(unit => unit.kind === 'javascript-url');
assert.ok(url.code.includes('eval("x")'));
assert.equal(url.sourceMap.map(url.code.indexOf('(')), html.indexOf('&lpar;'));
assert.equal(url.sourceMap.isOriginal(url.code.indexOf('(')), true);
assertions += 5;

assert.equal(parseRegex('<script>await fetch("x")</script>').errors.length, 1);
assert.equal(parseRegex('<script type="module">await fetch("x")</script>').errors.length, 0);
assert.equal(parseRegex('<button onclick="await fetch(1)">').errors.length, 1);
assert.equal(parseRegex('<a href="javascript:return 1">').errors.length, 1);
assert.equal(parseRegex('<script type="module">with(x){}</script>').errors.length, 1);
assert.equal(parseRegex('<script>with(x){}</script>').errors.length, 0);
assert.equal(parseRegex('<button onclick="valid()" onclick="const = 1">').errors.length, 0);
assertions += 7;
assert.equal(parseRegex('<script src="https://cdn.example/x.js">const = 1;</script>').units.length, 0);
assert.equal(parseRegex('<script src>const = 1;</script>').units.length, 0);
assert.equal(parseRegex('<script type="text/javascript1.5">eval(1)</script>').units.length, 1);
assert.equal(parseRegex('<script language="jscript">eval(1)</script>').units.length, 1);
assert.equal(parseRegex('<script language="vbscript">not javascript</script>').units.length, 0);
assert.equal(parseRegex('<script type="text/javascript; charset=utf-8">not javascript</script>').units.length, 0);
assertions += 6;

const regexMappedSource = '💡\r\n<button onclick="const x = &#59;">';
const regexMapped = parseRegex(regexMappedSource);
assert.deepEqual({ index: regexMapped.errors[0].index, line: regexMapped.errors[0].line, column: regexMapped.errors[0].column }, sourceLocation(regexMappedSource, regexMappedSource.indexOf('&#59;')));
assert.equal(parseRegex('<script>{</script>suffix').errors[0].index, '<script>{'.length);
assertions += 2;

// These capabilities are replaced with throwing sentinels. Only parsing occurs:
// no global assignment, network request, getter invocation or code constructor.
const originalEval = globalThis.eval;
const originalFunction = globalThis.Function;
const originalFetch = globalThis.fetch;
let sideEffects = 0;
const forbidden = () => { sideEffects++; throw new Error('uploaded source was executed'); };
globalThis.eval = forbidden;
globalThis.Function = forbidden;
globalThis.fetch = forbidden;
try {
  valid('<% globalThis.__pwSyntaxExecuted = true; eval("side effect"); Function("return 1"); await fetch("https://invalid.example"); throw new Error("executed"); %>');
  assert.equal(parseRegex('<script>globalThis.__pwSyntaxExecuted = true; eval("side effect");</script>').errors.length, 0);
  assert.equal(sideEffects, 0);
  assert.equal(globalThis.__pwSyntaxExecuted, undefined);
  assertions += 3;
} finally {
  globalThis.eval = originalEval;
  globalThis.Function = originalFunction;
  globalThis.fetch = originalFetch;
}

console.log(`ejs-syntax-v2: ${assertions} assertions passed`);
