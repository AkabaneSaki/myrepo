import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';

const manifest = JSON.parse(await readFile(new URL('../config/workshop.json', import.meta.url), 'utf8'));
const rules = JSON.parse(await readFile(new URL('../regex.json', import.meta.url), 'utf8'));
const useBundle = process.argv.includes('--bundle');
const source = await readFile(new URL(useBundle
  ? '../dist/AutoDialogueBeautifier/index.js'
  : '../src/AutoDialogueBeautifier/index.ts', import.meta.url), 'utf8');
const code = useBundle ? source : ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;

const dalianName = '命定核心-妲丽安对话美化';
const lilithName = '命定核心-莉莉丝对话美化';
const dalianMessage = '<dalian name="妲丽安" mood="通常">「晚上好。」</dalian>';

async function start({ names = [], message = dalianMessage, core, existing = {}, choice = 1, onPopup, failVariableWrite = false } = {}) {
  let variables = { adaptive_regex_names: [...names], 系统核心: core };
  let currentMessage = message;
  const scopedRules = structuredClone({ character: [], global: [], preset: [], ...existing });
  let chatId = 'first-chat';
  let ready;
  const events = new Map();
  const timers = new Map();
  const fetches = [];
  const errors = [];
  const notices = [];
  const popups = [];
  const buttons = [];
  const writes = [];
  let timerId = 0;
  const window = {};
  const context = {
    exports: {},
    require: () => manifest,
    window,
    console: { info() {}, warn() {}, error: (...args) => errors.push(args.map(String).join(' ')) },
    toastr: {
      error: message => errors.push(message),
      info: message => notices.push(message),
      warning: message => notices.push(message),
      success: message => notices.push(message),
    },
    _: { escape: value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]) },
    SillyTavern: {
      getCurrentChatId: () => chatId,
      characterId: '0',
      characters: [{ avatar: 'test-character.png' }],
      getPresetManager: () => ({ getSelectedPresetName: () => 'test-preset' }),
      POPUP_TYPE: { TEXT: 1 },
      POPUP_RESULT: { AFFIRMATIVE: 1, CANCELLED: null, CUSTOM1: 2, CUSTOM2: 3 },
      callGenericPopup: async (html, type, input, options) => {
        popups.push({ html, options });
        if (onPopup) await onPopup({ changeChat: () => { chatId = 'different-chat'; } });
        return choice;
      },
    },
    appendInexistentScriptButtons: values => buttons.push(...values),
    getButtonEvent: name => `button:${name}`,
    $: value => {
      if (typeof value === 'function') ready = value();
      return { on: (event, callback) => events.set(event, callback) };
    },
    fetch: async url => {
      fetches.push(url);
      return { ok: true, json: async () => structuredClone(rules) };
    },
    getVariables: () => variables,
    insertOrAssignVariables: values => {
      if (failVariableWrite) throw new Error('Chat variable write failed');
      Object.assign(variables, values);
    },
    replaceVariables: values => { variables = values; },
    getChatMessages: () => currentMessage === null ? [] : [{ message: currentMessage }],
    getTavernRegexes: option => structuredClone(scopedRules[option.type]),
    updateTavernRegexesWith: async (update, option) => {
      const updated = update(structuredClone(scopedRules[option.type]));
      for (const rule of updated) assert.ok(Array.isArray(rule.trim_strings), 'TavernHelper requires trim_strings to be an array');
      writes.push(option.type);
      scopedRules[option.type] = structuredClone(updated);
      return updated;
    },
    tavern_events: { MESSAGE_RECEIVED: 'message', CHAT_CHANGED: 'chat' },
    eventOn: (event, callback) => events.set(event, callback),
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id),
  };
  vm.runInNewContext(code, context);
  await ready;
  assert.deepEqual(errors, [], 'Initialization must not silently fail');
  assert.equal(fetches.length, 1, 'Load the rule catalogue before registering rules');
  assert.ok(fetches[0].endsWith(`@${manifest.client.stable}/regex.json`));
  assert.ok(buttons.some(button => button.name === '强制更新美化' && button.visible));
  return {
    names: () => scopedRules.character.map(rule => rule.script_name),
    rules: () => structuredClone(scopedRules),
    variables: () => structuredClone(variables),
    popups, notices, writes,
    async forceUpdate({ expectFailure = false } = {}) {
      await events.get('button:强制更新美化')();
      if (expectFailure) assert.ok(errors.length > 0, 'A failed operation must report failure');
      else assert.deepEqual(errors, [], 'Manual update must not silently fail');
    },
    async unload() { await events.get('pagehide')(); },
    async scan(message) {
      currentMessage = message;
      await events.get('message')(42);
    },
    async changeChat(names, message) {
      variables = { adaptive_regex_names: [...names], 系统核心: core };
      currentMessage = message;
      await events.get('chat')('another-chat');
      for (const [id, callback] of timers) {
        timers.delete(id);
        await callback();
      }
      assert.deepEqual(errors, [], 'Chat initialization must not silently fail');
    },
  };
}

const empty = await start();
assert.ok(empty.names().includes(dalianName), 'A new chat must install the rule matching Dalian dialogue');

const saved = await start({ names: [lilithName] });
assert.ok(saved.names().includes(lilithName), 'Keep rules already detected in this chat');
assert.ok(saved.names().includes(dalianName),
  'A chat with saved Lilith names must still detect and install the current Dalian dialogue rule');

await empty.changeChat([lilithName], dalianMessage);
assert.ok(empty.names().includes(dalianName), 'Switching chats must scan current dialogue as well as saved names');

const noMessages = await start({ names: [lilithName], message: null });
assert.ok(noMessages.names().includes(lilithName), 'A chat without messages must still restore saved rules');

function installed(name, overrides = {}) {
  const rule = rules.find(rule => rule.scriptName === name);
  return {
    id: rule?.id ?? name, script_name: name, enabled: true,
    find_regex: 'outdated', replace_string: 'outdated', trim_strings: [], ...overrides,
  };
}

const lilith = installed(lilithName);
const unrelated = installed('普通文本整理');
const dalians = rules.filter(rule => rule.scriptName.startsWith('命定核心-妲丽安'));

for (const choice of [1, 2, 3]) {
  const runtime = await start({
    core: '妲丽安', names: [lilithName, dalianName], message: null, choice,
    existing: { character: [lilith, unrelated, installed(dalianName, { enabled: false })], global: [lilith], preset: [lilith] },
  });
  await runtime.forceUpdate();
  const result = runtime.rules();
  for (const target of dalians) {
    const found = result.character.filter(rule => rule.id === target.id);
    assert.equal(found.length, 1, 'Force update must replace existing rules without duplicates');
    assert.equal(found[0].enabled, true);
    assert.equal(found[0].replace_string, target.replaceString, 'Reinstall the current catalogue content');
  }
  assert.deepEqual(result.character.find(rule => rule.id === unrelated.id), unrelated, 'Leave unrelated rules untouched');
  for (const scope of ['character', 'global', 'preset']) {
    const found = result[scope].find(rule => rule.id === lilith.id);
    if (choice === 1) assert.deepEqual(found, lilith, 'Keep must leave every listed rule unchanged');
    else if (choice === 2) assert.deepEqual(found, { ...lilith, enabled: false }, 'Disable must preserve rule content');
    else assert.equal(found, undefined, 'Remove must delete only listed rules');
  }
  assert.equal(runtime.popups.length, 1);
  assert.ok(['角色卡', '全局', '预设'].every(scope => runtime.popups[0].html.includes(scope)));
  assert.ok(runtime.popups[0].html.includes(lilithName));
  assert.deepEqual(runtime.writes, choice === 1 ? ['character'] : ['character', 'global', 'preset'], 'Batch each affected scope once');

  const lilithDialogue = '<lilith name="莉莉丝" mood="开心">晚上好。</lilith>';
  await runtime.scan(lilithDialogue);
  assert.deepEqual(runtime.rules(), result, 'Automatic scanning must respect the selected core and the manual conflict choice');
  await runtime.unload();
  assert.deepEqual(runtime.rules(), result, 'Unloading must not remove manually updated or explicitly retained/disabled rules');
}

for (const config of [
  { choice: null },
  { choice: 3, onPopup: ({ changeChat }) => changeChat() },
]) {
  const runtime = await start({ core: '妲丽安', names: [lilithName], message: null, existing: { character: [lilith] }, ...config });
  const before = runtime.rules();
  const variablesBefore = runtime.variables();
  await runtime.forceUpdate();
  assert.deepEqual(runtime.rules(), before, 'Cancel or chat switch while choosing must not change any rules');
  assert.deepEqual(runtime.variables(), variablesBefore, 'Cancel must not change the saved rule names');
  assert.deepEqual(runtime.writes, []);
}

for (const core of [undefined, '不支持的系统']) {
  const runtime = await start({ core, message: null });
  await runtime.forceUpdate();
  assert.deepEqual(runtime.writes, [], 'Missing or unmatched system core must not modify rules');
  assert.equal(runtime.popups.length, 0);
  assert.ok(runtime.notices.length > 0, 'Explain what the user needs to check');
}

const fromChatVariable = await start({ core: '妲丽安', message: null });
await fromChatVariable.forceUpdate();
assert.deepEqual(fromChatVariable.names().sort(), dalians.map(rule => rule.scriptName).sort(), 'Install all matching rules from the chat variable without needing a matching message');
assert.equal(fromChatVariable.popups.length, 0, 'No conflict needs no extra confirmation');

const abigail = await start({ core: '阿比盖尔核心-里', message: null });
await abigail.forceUpdate();
assert.ok(abigail.names().includes('命定核心-阿比盖尔美化-里(二选一)'));
assert.ok(abigail.names().includes('命定核心-阿比奖励技能'));
assert.ok(!abigail.names().includes('命定核心-阿比盖尔美化-表(二选一)'), 'Keep mutually exclusive core variants separate');

const writeFailure = await start({ core: '妲丽安', message: null, failVariableWrite: true });
await writeFailure.forceUpdate({ expectFailure: true });
assert.ok(!writeFailure.notices.some(message => message.includes('已更新')), 'Never report success when saving the rule list fails');

console.log(`AutoDialogueBeautifier ${useBundle ? 'bundle' : 'source'} smoke PASS: initialization, chat-variable force update, replace existing content, keep/disable/remove across scopes, cancel, chat switch, unload, and unmatched cores.`);
