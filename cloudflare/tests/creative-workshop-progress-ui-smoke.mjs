import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const file = await readFile(new URL('../src/pages/home/tavern-bridge.ts', import.meta.url), 'utf8');
const start = file.indexOf('const pendingDlcTransfers = new Map();');
const end = file.indexOf('const SCRIPT_DEPENDENCY_REGISTRY = new Map(', start);
assert.ok(start >= 0 && end > start);
const secondStart = file.indexOf('function bindDlcProgress(task, requestId) {', end);
const secondEnd = file.indexOf('function handleBridgeMessage(event) {', secondStart);
assert.ok(secondStart > end && secondEnd > secondStart);
const code = file.slice(start, end) + file.slice(secondStart, secondEnd);
function fakeElement() {
  const item = { textContent:'', hidden:false, style:{}, className:'', children:[], onclick:null,
    classList: { add() {}, toggle() {} },
    replaceChildren() { this.children = []; },
    appendChild(child) { this.children.push(child); } };
  return item;
}
const overlays = [];
const copied = [];
const context = {
  Map, Set, Object, Math, Number, String, navigator: { clipboard: { writeText: async text => { copied.push(text); } } },
  document: { createElement: fakeElement },
  showToast() {},
  openModal(html, title) {
    const elements = new Map();
    const overlay = { isConnected:true, title, html,
      classList: { add() {} },
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, fakeElement());
        return elements.get(selector);
      } };
    overlays.push(overlay);
    return overlay;
  },
};
const api = vm.runInNewContext(code + '\n({startDlcProgress,bindDlcProgress,advanceDlcProgress,completeDlcProgress,failLocalDlcProgress})', context, {
  filename:'tavern-bridge-progress.js',
});
const task = api.startDlcProgress('p1', 'update');
api.bindDlcProgress(task, 'request-A');
assert.equal(task.overlay.querySelector('[data-dlc-phase]').textContent, '排队等待');
assert.equal(api.advanceDlcProgress('request-wrong', { projectId:'p1', phase:'download' }), false);
assert.equal(api.advanceDlcProgress('request-A', { projectId:'other', phase:'download' }), false);
assert.equal(api.advanceDlcProgress('request-A', { projectId:'p1', phase:'download', loadedBytes:512, totalBytes:1024 }), true);
assert.match(task.overlay.querySelector('[data-dlc-detail]').textContent, /50%/);
assert.equal(api.advanceDlcProgress('request-A', { projectId:'p1', phase:'not_a_phase' }), false);
api.advanceDlcProgress('request-A', { projectId:'p1', phase:'install' });
api.advanceDlcProgress('request-A', { projectId:'p1', phase:'remove_old' });
const labels = task.overlay.querySelector('[data-dlc-steps]').children.map(el => el.textContent);
assert.equal(labels.some(label => label.includes('删除旧版')), true);
assert.equal(api.completeDlcProgress('request-A', { projectId:'p1', phase:'remove_old',
  errorCode:'CW-U-060', message:'staged worldbook validation error' }, true), true);
assert.equal(task.overlay.querySelector('[data-dlc-code]').textContent, 'CW-U-060');
assert.match(task.overlay.querySelector('[data-dlc-message]').textContent, /validation error/);
assert.equal(task.overlay.querySelector('[data-dlc-request]').textContent, 'request-A');
assert.equal(task.overlay.querySelector('[data-dlc-error]').hidden, false);
assert.equal(api.advanceDlcProgress('request-A', { projectId:'p1', phase:'final_verify' }), false,
  'late messages after a failure cannot overwrite the visible error');
task.overlay.querySelector('[data-dlc-copy]').onclick();
await Promise.resolve();
assert.match(copied[0], /CW-U-060.*request-A/);
const next = api.startDlcProgress('p1', 'install');
api.bindDlcProgress(next, 'request-B');
api.advanceDlcProgress('request-B', { projectId:'p1', phase:'download', loadedBytes:64 });
assert.doesNotMatch(next.overlay.querySelector('[data-dlc-detail]').textContent, /%/,
  'a missing Content-Length must not show an invented percentage');
assert.equal(api.completeDlcProgress('request-B', { projectId:'p1' }), true);
assert.equal(next.overlay.querySelector('[data-dlc-phase]').textContent, '安装完整性验收通过');
console.log('CreativeWorkshop request-scoped progress modal and diagnostic copy: ok');
