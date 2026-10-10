import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from '../../node_modules/typescript/lib/typescript.js';
import { extractProjectEntries } from '../src/utils/project-content.ts';
import { isCountedProjectDownload } from '../src/utils/download-accounting.ts';

const id = 'regex-test';
const regexKey = 'projects/' + id + '/regex-' + id + '.json';
assert.equal(isCountedProjectDownload(regexKey,id),true);
assert.equal(isCountedProjectDownload('projects/'+id+'/project-'+id+'.json',id),true);
for (const key of [
  'projects/'+id+'/cover.png',
  'projects/'+id+'/regex-other.json',
  'projects/'+id+'/other-regex-'+id+'.json',
  'projects/other/regex-'+id+'.json',
  'projects/'+id+'/nested/regex-'+id+'.json',
]) assert.equal(isCountedProjectDownload(key,id),false,'not a tracked download: '+key);

const [fileRoute, infoRoute, webBridge, hostBridge, worldbook] = await Promise.all([
  'src/index.ts', 'src/endpoints/projects/read.ts', 'src/pages/home/tavern-bridge.ts',
  '../src/CreativeWorkshop/bridge/host.ts', '../src/CreativeWorkshop/services/worldbook.ts',
].map(path => readFile(new URL('../' + path,import.meta.url),'utf8')));
assert.match(fileRoute, /if \(countedProjectFile\) await projectDb\.incrementDownloads/);
assert.ok(fileRoute.indexOf('if (!object)') < fileRoute.indexOf('if (countedProjectFile)'),
  'no count when the R2 JSON does not exist');
assert.match(fileRoute, /countedProjectFile \|\| isPrivateProjectFile[\s\S]*?private, no-store/);

// Execute the real /api/files/* GET handler against isolated mocked D1 and R2.
const routeStart = fileRoute.indexOf("app.get('/api/files/*'");
const routeEnd = fileRoute.indexOf('// ============ 管理员接口', routeStart);
assert.ok(routeStart >= 0 && routeEnd > routeStart);
let fileHandler;
let counted = 0;
let objects = new Set([regexKey, 'projects/'+id+'/project-'+id+'.json','projects/'+id+'/cover.png']);
let projectStatus = 'approved';
const routeSource = ts.transpileModule(fileRoute.slice(routeStart,routeEnd),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}
}).outputText;
vm.runInNewContext(routeSource, {
  app: { get: (path, handler) => { assert.equal(path,'/api/files/*'); fileHandler=handler; } },
  jwt: { extractFromHeader: async () => null },
  projectDb: { incrementDownloads: async () => { counted++; } },
  Headers,Response,URL,console,isCountedProjectDownload,
});
assert.equal(typeof fileHandler,'function');
async function getFile(key) {
  const c = {
    req: { path:'/api/files/'+key,url:'https://workshop.invalid/api/files/'+key,
      header:()=>null },
    env: {
      DB: { prepare:()=>({bind:()=>({first:async()=> ({ author_id:'author',status:projectStatus })})}) },
      R2_BUCKET: { get:async k=> objects.has(k) ? {
        size:2,body:'ok',writeHttpMetadata(headers){headers.set('Content-Type','application/json');}
      } : null },
    },
    json: (value,status)=>new Response(JSON.stringify(value),{status,
      headers:{'Content-Type':'application/json'}}),
  };
  return fileHandler(c);
}
const firstRegexResponse = await getFile(regexKey);
assert.equal(firstRegexResponse.status,200);
assert.equal(counted,1);
assert.equal(firstRegexResponse.headers.get('Cache-Control'),'private, no-store');
assert.equal((await getFile(regexKey)).status,200);
assert.equal(counted,2,'two real Regex requests count twice, not cached away');
assert.equal((await getFile('projects/'+id+'/project-'+id+'.json')).status,200);
assert.equal(counted,3,'worldbook download counting preserved');
const cover=await getFile('projects/'+id+'/cover.png');
assert.equal(cover.status,200);
assert.equal(cover.headers.get('Cache-Control').includes('public'),true);
assert.equal(counted,3,'cover must not count');
objects.delete(regexKey);
assert.equal((await getFile(regexKey)).status,404);
assert.equal(counted,3,'missing R2 object must not count');
objects.add(regexKey);
projectStatus='pending';
assert.equal((await getFile(regexKey)).status,404);
assert.equal(counted,3,'unauthorized private R2 object must not count');
projectStatus='approved';

const installInfo = infoRoute.split('export class ProjectInstallInfo')[1].split('export class ProjectFetch')[0];
assert.match(installInfo,/!project\.download_url && await c\.env\.R2_BUCKET\.head\(regexKey\)/);
assert.match(installInfo,/regexDownloadUrl,/);
assert.doesNotMatch(installInfo,/INSERT|UPDATE|DELETE/i);
assert.match(webBridge, /regexDownloadUrl: installInfo\.regexDownloadUrl/g);
assert.match(hostBridge, /payload\.regexDownloadUrl/g);
assert.match(worldbook,/fetchCreativeWorkshopProjectRegexSource/);

const clientSource = await readFile(new URL('../../src/CreativeWorkshop/services/project-fetch.ts',import.meta.url),'utf8');
const compiled = ts.transpileModule(clientSource,{compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,
}}).outputText;
let calls = 0;
let body = [{ id:'rx1', find_regex:'hello', replace_string:'world' }];
let status = 200;
const module = { exports:{} };
const events=[];
vm.runInNewContext(compiled,{
  module,exports:module.exports,Date,JSON,Object,Map,Set,String,Number,URL,TextEncoder,
  require(specifier){
    if (specifier === './config') return { getCreativeWorkshopUrl:()=> 'https://workshop.invalid' };
    if (specifier === '../../../cloudflare/src/utils/project-content') return { extractProjectEntries };
    throw new Error('unexpected require '+specifier);
  },
  fetch:async (url,options)=>{
    calls++;
    assert.match(String(url),new RegExp('/api/files/'+regexKey.replace(/[.*+?^$()|[\]{}]/g,'\$&')));
    assert.equal(options.cache,'no-store');
    return { ok:status===200,status, text:async()=>JSON.stringify(body) };
  },
},{filename:'project-fetch.ts'});
const url='https://workshop.invalid/api/files/'+regexKey+'?v=1.0.0';
const detail={project:{id,version:'1.0.0'},regexEntriesPreview:[
  {entryKey:'id:rx1',findRegex:'hello',replaceString:'world'}
]};
await module.exports.fetchCreativeWorkshopProjectRegexSource(url,detail,(stage,progress)=>events.push({stage,...progress}));
assert.equal(calls,1,'actual JSON fetched once');
assert.equal(events.at(-1).stage,'validate');
assert.equal(events.some(event => event.stage === 'download' && event.loadedBytes > 0),true);
await module.exports.fetchCreativeWorkshopProjectRegexSource(url,detail);
assert.equal(calls,2,'separate install attempts each download the real file (no cached completion)');
body=[{id:'rx1',find_regex:'hello',replace_string:'malicious'}];
await assert.rejects(module.exports.fetchCreativeWorkshopProjectRegexSource(url,detail),/内容与所选版本不一致/);
status=404;
await assert.rejects(module.exports.fetchCreativeWorkshopProjectRegexSource(url,detail),/404/);
const prior=calls;
await assert.rejects(module.exports.fetchCreativeWorkshopProjectRegexSource(
  'https://other.invalid/api/files/'+regexKey,detail),/下载地址与当前工坊/);
assert.equal(calls,prior,'untrusted URL rejected before network');
console.log('Regex-only download accounting and ST file verification: ok');
