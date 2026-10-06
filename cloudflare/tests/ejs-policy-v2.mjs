import assert from 'node:assert/strict';
import { parse } from 'acorn';
import { inspectAstPolicy, inspectSymbolCollisions } from '../src/utils/ejs-checker/policy.mjs';
import { parseEjs } from '../src/utils/ejs-checker/syntax.mjs';

function inspect(code, options = {}) {
  const prefix = '(async function(){void 0;\n', suffix = '\n});';
  const ast = parse(prefix + code + suffix, { ecmaVersion: 'latest' });
  const wrapperFunction = ast.body[0].expression;
  const unit = { kind: 'ejs', ast, wrapperFunction,
    sourceMap: { map: offset => offset - prefix.length,
      isOriginal: offset => offset >= prefix.length && offset < prefix.length + code.length } };
  const entry = { id: options.id ?? 'one', name: options.id ?? 'one', uid: 1,
    rawContent: code, sourceType: options.sourceType ?? 'worldbook', isPrivate: options.isPrivate ?? false };
  const result = inspectAstPolicy(entry, { units: [unit] });
  return { ...result, entry: { ...entry, symbols: result.symbols } };
}
const rule = (result, id, severity) => result.findings.filter(item => item.ruleId === id && (!severity || item.severity === severity));
const noHigh = result => assert.equal(result.findings.some(item => item.severity === 'high'), false);

// var is function-scoped even inside ordinary blocks/loop heads; actual functions isolate it.
const topVar = inspect('{ var first; } for(var second of []) {}');
assert.equal(rule(topVar, 'L1', 'high').length, 2);
assert.deepEqual(topVar.symbols.map(item => item.name), ['first', 'second']);
const localVar = inspect('{ const helper = function(){ var local; }; const arrow = () => { var inner; }; }');
assert.equal(rule(localVar, 'L1', 'info').length, 2);
noHigh(localVar);
assert.equal(rule(inspect('var repeated; var repeated;'), 'L1', 'high').length, 3);
assert.equal(rule(inspect('var isolated;', { isPrivate: true }), 'L1', 'info').length, 1);

const declarations = inspect('const {source: alias, nested: [deep], ...rest} = {}; let one, two;');
assert.equal(rule(declarations, 'L2').length, 2);
assert.deepEqual(declarations.symbols.map(item => item.name), ['alias','deep','rest','one','two']);
noHigh(inspect('{ let local; local=1; } for(let count=0;count<1;count++){} for(const item of []){}'));
assert.equal(rule(inspect('const helper = function named(){}; let Maker = class Named {};'), 'L3').length, 0);
assert.equal(rule(inspect('function publicHelper(){} class PublicClass{}'), 'L3').length, 2);
noHigh(inspect('{ function blockHelper(){} class BlockClass{} }'));
noHigh(inspect('const local=1; function helper(){} class Maker{}', { isPrivate: true }));

const assignments = inspect('unknown=1; compound+=2; ++before; after--; ({a: destructured, ...remaining}={}); [arrayTarget]=[]; for(loopTarget of []){}');
assert.deepEqual(rule(assignments, 'L4', 'high').map(item => assignments.entry.rawContent.slice(item.index).match(/^\w+/)[0]),
  ['unknown','compound','before','after','destructured','remaining','arrayTarget','loopTarget']);
noHigh(inspect('{ local=1; let local; } { hoisted=1; var hoisted; }', { isPrivate: true }));
assert.equal(rule(inspect('{ let local; } local=1;'), 'L4', 'high').length, 1);
assert.equal(rule(inspect('for(let count of []){} count=1;'), 'L4', 'high').length, 1);
assert.equal(rule(inspect('{ const helper = ({a: local}, ...rest) => { local++; rest=[]; unbound=1; }; }'), 'L4', 'high').length, 1);
noHigh(inspect('{ const obj={method({value}, extra=1){value++;extra++;}}; try{}catch({message}){message="";} }'));
assert.equal(rule(inspect('{const helper=(x=(bodyVar=1))=>{var bodyVar;};}'), 'L4', 'high').length, 1);
assert.equal(rule(inspect('{const helper=function selfName(){selfName=1;};} selfName=2;'), 'L4', 'high').length, 1);
assert.equal(rule(inspect('{const Maker=class SelfClass { method(){SelfClass=1;} };} SelfClass=2;'), 'L4', 'high').length, 1);
assert.equal(rule(inspect('{const Maker=class SelfClass extends (SelfClass=Parent) {}; }'), 'L4', 'high').length, 0);

const globals = inspect('globalThis.projectState={}; window["projectState"]++; [self.projectState]=[]; for(window.projectState of []){} globalThis.__PW_demo__.count=1;');
assert.equal(rule(globals, 'L4', 'warn').length, 5);
assert.equal(rule(globals, 'L4', 'high').length, 0);
assert.deepEqual(globals.symbols.map(item => item.name), ['projectState','projectState','projectState','projectState','__PW_demo__']);
noHigh(inspect('{ const window={}; window.state=1; const self={}; self.data++; const globalThis={}; globalThis.result=2; }'));
assert.equal(inspect('{ const window={}; window.state=1; }').findings.length, 0);
assert.equal(rule(inspect('state=1; globalThis.data=1; window["result"]++;'), 'L5', 'high').length, 3);
assert.equal(rule(inspect('globalThis[key]=1;'), 'L4', 'warn').length, 1);
assert.equal(rule(inspect('/* declared Owner: test Lifecycle: test Cleanup: test */ globalThis.projectState={};'), 'L4')[0].title, '已声明的共享全局行为仍需确认');

// Data and member names never become declarations or writes by substring matching.
noHigh(inspect('{ const text="var state; leaked=1"; const re=/const data=1; var result/; const obj={value:1}; obj.value++; }'));
const emoji = inspect('/* 😀 */\n{ accidental=1; }');
assert.equal(rule(emoji, 'L4')[0].index, emoji.entry.rawContent.indexOf('accidental'));
assert.equal(inspect('var ignored; globalThis.state=1;', { sourceType: 'regex' }).findings.length, 0);
assert.deepEqual(inspectAstPolicy({ sourceType: 'worldbook' }, { units: [{ kind: 'ejs', ast: null }] }), { findings: [], symbols: [] });

const one = inspect('const shared=1;', { id: 'one' }).entry;
const two = inspect('function shared(){}', { id: 'two' }).entry;
const collisions = inspectSymbolCollisions([one, two]);
assert.equal(collisions.length, 1);
assert.deepEqual(collisions[0].extra.relatedEntryIds, ['one','two']);
const namespaceOne = inspect('globalThis.__PW_demo__={};', { id: 'one' }).entry;
const namespaceTwo = inspect('globalThis.__PW_demo__.field=1;', { id: 'two' }).entry;
assert.equal(inspectSymbolCollisions([namespaceOne, namespaceTwo]).length, 0);
const lexicalNamespace = inspect('const __PW_demo__={};', { id: 'three' }).entry;
assert.equal(inspectSymbolCollisions([namespaceOne, lexicalNamespace]).length, 1);
assert.equal(inspectSymbolCollisions([one, one]).length, 0);
assert.equal(inspectSymbolCollisions([one, { ...two, sourceType: 'regex' }]).length, 0);

// Tags together form one scope; generated output expressions cannot create bindings.
const template = '<%# metadata 😀 %>\r\n<% { const bound=1; %>text<%= bound %><% bound=2; } %>\r\n<%= leaked=1 %>';
const parsedTemplate = parseEjs(template);
assert.deepEqual(parsedTemplate.errors, []);
const templateResult = inspectAstPolicy({ sourceType: 'worldbook', rawContent: template }, parsedTemplate);
assert.equal(rule(templateResult, 'L4', 'high').length, 1);
assert.equal(rule(templateResult, 'L4')[0].index, template.indexOf('leaked'));
assert.equal(rule(templateResult, 'L2').length, 0);
const privateTemplate = '@@private\n<% var isolated; const local=1; function helper(){} %>';
const privateResult = inspectAstPolicy({ sourceType: 'worldbook', rawContent: privateTemplate, isPrivate: true }, parseEjs(privateTemplate, { privateScope: true }));
assert.equal(rule(privateResult, 'L1', 'info').length, 1);
noHigh(privateResult);
console.log('EJS v2 AST scope + L1-L6 policy: ok');
