import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from '../../node_modules/typescript/lib/typescript.js';

const read = async path => readFile(new URL('../' + path, import.meta.url), 'utf8');
const manager = await read('src/pages/home/installed-manager.ts');
const compiled = ts.transpileModule(manager, {compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020
}}).outputText;
const module = {exports:{}};
new Function('module','exports',compiled)(module,module.exports);
const script = module.exports.homeInstalledManagerScript;
const escapeHtml = text => String(text ?? '').replace(/[&<>"]/g, ch =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));
const projectId = 'example-installed-dlc';
const mock = {
  currentUser:{id:'user'},
  projects:[{id:projectId,name:'安全 DLC',likesCount:99,downloadsCount:382,version:'9.8.7'}],
  myProjects:[],
  subsMap:new Map([[projectId,{subscribed:true}]]),
  installedManagerTab:'installed',
  tavern: {
    connected:true,installedProjectsLoaded:true,installedProjectsComplete:true,
    installedManagerTransferSupported:true,
    installedRemoteProjectMap:new Map(),
    installedProjects:[{projectId,worldbookName:'CardMain',name:'安全 DLC',entryCount:2,
      regexCount:1,localVersion:'9.8.7',worldbookBound:true}],
    pendingProjectActions:new Map(),
    unreadableWorldbookNames:[],scannedWorldbookNames:['CardMain','CardExtra','GlobalOne','ChatBook'],
    worldbooks:{primary:'CardMain',additional:['CardExtra'],available:['CardMain','CardExtra','GlobalOne','ChatBook','Archive'],global:['GlobalOne'],chat:'ChatBook'},
  },
};
const render = new Function('state','escapeHtml',script + String.fromCharCode(10) + 'return renderInstalledManagerPage;')(mock,escapeHtml);
const installed = render();
assert.match(installed,/我的工坊/);
assert.match(installed,/已安装 DLC/);
assert.match(installed,/新建附加世界书/);
assert.doesNotMatch(installed,/已订阅|取消订阅/);
assert.match(installed,/扫描范围/);
assert.match(installed,/CardMain/);
assert.match(installed,/data-installed-transfer/);
assert.match(installed,/data-installed-uninstall/);
assert.match(installed,/迁移/);
assert.doesNotMatch(installed,/382|9\.8\.7|99/,'player-facing manager omits stats and version');
mock.tavern.worldbooks.additional=[];
mock.tavern.worldbooks.available=['CardMain','Archive'];
mock.tavern.scannedWorldbookNames=['CardMain'];
assert.doesNotMatch(render(),/data-installed-transfer[^>]+disabled/,'unbound destination remains eligible');
mock.tavern.worldbooks.additional=['CardExtra'];
mock.tavern.worldbooks.available=['CardMain','CardExtra','GlobalOne','ChatBook','Archive'];
mock.tavern.scannedWorldbookNames=['CardMain','CardExtra','GlobalOne','ChatBook'];
assert.doesNotMatch(render(),/已订阅/);
mock.installedManagerTab='scan';
const scan=render();
for(const role of ['角色主世界书','角色附加世界书','全局世界书','聊天世界书'])
  assert.match(scan,new RegExp(role));
mock.tavern.unreadableWorldbookNames=['ChatBook'];
mock.tavern.installedProjectsComplete=false;
mock.installedManagerTab='installed';
const partial=render();
assert.match(partial,/扫描.*不完整/);
assert.match(partial,/迁移暂时禁用/);
assert.match(partial,/data-installed-transfer[^>]+disabled/);
mock.tavern.installedProjectsComplete=true;
mock.tavern.installedManagerTransferSupported=false;
assert.match(render(),/data-installed-transfer[^>]+disabled/);
mock.tavern.installedManagerTransferSupported=true;
mock.tavern.installedProjects=[{projectId,worldbookName:null,name:'只有 Regex',entryCount:0,regexCount:1}];
assert.match(render(),/角色 Regex/);
assert.match(render(),/data-installed-transfer[^>]+disabled/);
const [layout, actions, bridge, host, scanState, protocol] = await Promise.all([
  read('src/pages/home/render/layout.ts'),read('src/pages/home/app/actions.ts'),
  read('src/pages/home/tavern-bridge.ts'),
  readFile(new URL('../../src/CreativeWorkshop/bridge/host.ts',import.meta.url),'utf8'),
  readFile(new URL('../../src/CreativeWorkshop/services/install-state.ts',import.meta.url),'utf8'),
  readFile(new URL('../../src/CreativeWorkshop/bridge/protocol.ts',import.meta.url),'utf8'),
]);
assert.doesNotMatch(layout,/installedProjectsToggle/,'desktop filter toggle removed');
assert.match(layout,/desktopInstalledManagerBtn/);
assert.match(layout,/renderInstalledManagerPage/);
assert.match(actions,/bindInstalledManagerActions/);
assert.match(bridge,/requestInstalledWorldbookTransfer/);
assert.match(bridge,/scannedWorldbookNames/);
assert.match(host,/transferCreativeWorkshopInstalledWorldbook/);
assert.match(host,/actionType !== 'bridge:transfer-installed-worldbook'\) await migrateCreativeWorkshopLegacyRegexRecords/);
assert.match(scanState,/scannedWorldbookNames/);
assert.match(protocol,/bridge:transfer-installed-worldbook/);
assert.match(protocol,/bridge:create-additional-worldbook/);
assert.match(host,/createCreativeWorkshopAdditionalWorldbook/);
assert.match(bridge,/movedOutsideScan/);
assert.match(scanState,/!currentlyBound.has\(recordedBook\)/);
console.log('dedicated installed manager render + safe transfer bridge contract: ok');
