import assert from 'node:assert/strict';
import { analyzeProjectCodeV2 } from '../src/utils/ejs-checker/index.mjs';
import { toUploaderCodeCheck, formatUploaderCodeCheckError } from '../src/utils/ejs-checker/report.mjs';
import { inspectCharInfoManagedV2Block, trustedAssetHosts, trustedCharInfoManagedMediaBlock, trustedStaticMediaUrl } from '../src/utils/ejs-checker/policy-config.mjs';

const check=(source,type='worldbook')=>analyzeProjectCodeV2([{fileName:'policy.json',type,text:JSON.stringify(type==='regex'?{id:'script',scriptName:'media',findRegex:'x',replaceString:source}:{entries:{1:{uid:1,comment:'media',content:source}}})}]);
const ejs=source=>check('@@private\n<% { '+source+' } %>');
const rules=report=>report.findings.map(finding=>finding.ruleId);
let count=0;
function noAssetReview(report){assert.equal(rules(report).some(rule=>['M4','U2','U3','U4','U5'].includes(rule)),false,JSON.stringify(report.findings));count++;}
function makeCurrentCharInfoManagedBlock(mediaUrls = ['https://i.ibb.co/YTpkjhVt/file-00000000e0bc81fda16e63b1a9c1ba24.png']) {
  const profile = {
    characterName: 'Test',
    avatarUrl: 'https://files.catbox.moe/avatar.png',
    coverUrl: 'https://i.ibb.co/demo/cover.webp',
    raceColor: '#A9DBC3',
    tierColor: '#B7D9E8',
    entranceQuote: '',
    gallery: [{ title: '主立绘', sources: mediaUrls }],
  };
  return [
    '<%# char-info-ejs-builder:start:v2 %>',
    '<%_',
    '{',
    '  const profile = ' + JSON.stringify(profile, null, 2) + ';',
    '  const npcName = profile.characterName;',
    '  const statusGalleryExtensions = [".png", ".jpg", ".jpeg", ".webp", ".avif"];',
    '  const statusGalleryImages = profile.gallery.flatMap(image => {',
    '    const candidates = [...image.sources, ...(image.thumbnail ? [image.thumbnail] : [])];',
    '    const url = candidates.find(value => {',
    '      try {',
    '        const pathname = new URL(value).pathname.toLowerCase();',
    '        return statusGalleryExtensions.some(extension => pathname.endsWith(extension));',
    '      } catch { return false; }',
    '    }) ?? "";',
    '    return url ? [{ title: image.title, url }] : [];',
    '  });',
    '  setLocalVar(`char_info.profiles[${JSON.stringify(npcName)}]`, {',
    '    schema_version: 2,',
    '    ...(profile.coverUrl ? { cover_url: profile.coverUrl } : {}),',
    '    gallery: profile.gallery.map(image => ({ title: image.title, sources: image.sources, ...(image.thumbnail ? { thumbnail: image.thumbnail } : {}) })),',
    '  });',
    '  if (profile.avatarUrl) {',
    '    setLocalVar(`status.externalAvatars.partners[${JSON.stringify(npcName)}].url`, profile.avatarUrl);',
    '  }',
    '  setLocalVar(`status.externalGalleries.partners[${JSON.stringify(npcName)}].images`, statusGalleryImages);',
    '}',
    '_%>',
    '<%# char-info-ejs-builder:end:v2 %>',
  ].join('\n');
}
assert.deepEqual(trustedAssetHosts,['files.catbox.moe','i.ibb.co']);count++;
noAssetReview(ejs('const profile = {avatarUrl:"https://files.catbox.moe/a.png", gallery:[{sources:["https://files.catbox.moe/a.mp4"]}]};'));
noAssetReview(ejs('const image = "https://i.ibb.co/album/a.webp"; const video = "https://files.catbox.moe/a.webm";'));
noAssetReview(ejs('video.src = "https://files.catbox.moe/a.mp4";'));
noAssetReview(check('<img src="https://files.catbox.moe/a.png"><video src="https://i.ibb.co/a.mp4"></video>','regex'));
noAssetReview(check('<div style="background:url(https://files.catbox.moe/a.png)"></div>','regex'));
const charInfoTrusted=makeCurrentCharInfoManagedBlock();
const charInfoIndex=charInfoTrusted.indexOf('profile.gallery.map');
const charInfoInspection=inspectCharInfoManagedV2Block(charInfoTrusted,charInfoIndex);
assert.ok(charInfoInspection);assert.ok(charInfoInspection.mediaUrls.includes('https://i.ibb.co/YTpkjhVt/file-00000000e0bc81fda16e63b1a9c1ba24.png'));count+=2;
assert.equal(trustedCharInfoManagedMediaBlock(charInfoTrusted,charInfoIndex),true);count++;
const charInfoTrustedReport=check(charInfoTrusted);
assert.equal(charInfoTrustedReport.findings.some(finding=>finding.ruleId==='AH2'&&finding.riskEvidence?.usage==='media'),false,JSON.stringify(charInfoTrustedReport.findings));
assert.equal(rules(charInfoTrustedReport).some(rule=>['U2','U3','U4','U5'].includes(rule)),false,JSON.stringify(charInfoTrustedReport.findings));count+=2;
const charInfoMixed=makeCurrentCharInfoManagedBlock(['https://i.ibb.co/YTpkjhVt/file-00000000e0bc81fda16e63b1a9c1ba24.png','https://untrusted.example/portrait.png']);
assert.equal(trustedCharInfoManagedMediaBlock(charInfoMixed,charInfoMixed.indexOf('profile.gallery.map')),false);
const charInfoMixedReport=check(charInfoMixed);
assert.ok(charInfoMixedReport.findings.some(finding=>finding.ruleId==='U2'||(finding.ruleId==='AH2'&&finding.riskEvidence?.usage==='media')),JSON.stringify(charInfoMixedReport.findings));count+=2;
const charInfoInjected=charInfoTrusted.replace('\n}\n_%>','\n  const injectedImage = document.createElement("img");\n  injectedImage.src = runtimeTarget;\n}\n_%>');
const charInfoInjectedReport=check(charInfoInjected);
assert.ok(charInfoInjectedReport.findings.some(finding=>finding.ruleId==='AH2'&&finding.riskEvidence?.usage==='media'&&String(finding.riskEvidence?.expression||'').includes('runtimeTarget')),JSON.stringify(charInfoInjectedReport.findings));count++;

for(const source of [
  'window.open("https://files.catbox.moe/a.png");',
  'location.href = "https://i.ibb.co/a.png";',
  'location.assign("https://files.catbox.moe/a.mp4");',
  'location.replace("https://files.catbox.moe/a.png");',
]){const report=ejs(source);assert.ok(rules(report).includes('U2'));assert.equal(rules(report).includes('M4'),false);count+=2;}
for(const markup of ['<a href="https://files.catbox.moe/a.png">go</a>','[go](https://files.catbox.moe/a.png)']){assert.ok(rules(check(markup,'regex')).includes('U2'));count++;}
noAssetReview(check('![image](https://files.catbox.moe/a.png)','regex'));
for(const source of ['const profile = { avatarUrl:"http://files.catbox.moe/a.png" };','const profile = { avatarUrl:"https://sub.files.catbox.moe/a.png" };','const profile = {avatarUrl:"https://files.catbox.moe/a.js"};','const profile = {avatarUrl:"https://files.catbox.moe/"};']){assert.ok(rules(ejs(source)).some(rule=>['U2','U3'].includes(rule)));count++;}
assert.equal(trustedStaticMediaUrl('https://files.catbox.moe.evil.org/a.png','media'),false);
assert.equal(trustedStaticMediaUrl('https://u:p@files.catbox.moe/a.png','media'),false);
assert.equal(trustedStaticMediaUrl('//files.catbox.moe/a.png','media'),false);count+=3;
for(const source of [
  'fetch("https://files.catbox.moe/a.png");',
  'fetch("https://files.catbox.moe/upload", {method:"POST",body:data});',
  'fetch("https://files.catbox.moe/a.png", {headers:{Authorization:token}});',
  'const request = fetch; request("https://files.catbox.moe/a.png");',
  'const xhr = new XMLHttpRequest(); xhr.open("POST","https://files.catbox.moe/upload"); xhr.send(data);',
]){assert.ok(rules(ejs(source)).includes('M4'));count++;}
assert.equal(rules(ejs('const urls = ["https://api.example/data"]; const type = XMLHttpRequest;')).includes('M4'),false);count++;
const finiteNavigation=ejs('const a="https://exa"; const b="mple.com/path"; window.open(a+b);');
assert.ok(finiteNavigation.findings.some(finding=>finding.ruleId==='U2'&&finding.riskEvidence?.target==='https://example.com/path'));
assert.equal(finiteNavigation.findings.some(finding=>finding.riskEvidence?.usage==='navigation'&&finding.ruleId==='AH2'),false);count+=2;
const fixedResource=ejs('const host="example.com"; const resource="https://"+host+"/tool.js";');
assert.equal(fixedResource.findings.filter(finding=>finding.ruleId==='U2').length,1);
assert.equal(fixedResource.findings.find(finding=>finding.ruleId==='U2').riskEvidence.target,'https://example.com/tool.js');count+=2;
assert.ok(ejs('window.open(runtimeTarget);').findings.some(finding=>finding.ruleId==='AH2'&&finding.riskEvidence?.usage==='navigation'));count++;
noAssetReview(ejs('const urls = {one:"https://files.catbox.moe/a.png",two:"https://files.catbox.moe/b.png"}; image.src = urls[mood];'));
for(const source of ['const img=document.createElement("img"); img.src=runtimeTarget;','const profile={avatarUrl:runtimeTarget};']) {
  const report=ejs(source),hint=report.findings.find(finding=>finding.ruleId==='AH2'&&finding.riskEvidence?.usage==='media');
  assert.ok(hint);assert.match(hint.detail,/最终图片或视频地址由运行时内容决定/);assert.match(hint.riskEvidence?.expression || '',/runtimeTarget/);assert.deepEqual(hint.riskEvidence?.candidates,[]);assert.equal(hint.line,2);
  assert.equal(report.gate,'accept');assert.equal(report.audit,'yellow');assert.equal(rules(report).includes('M4'),false);count+=8;
}
const mediaCandidate=ejs('const fallback="https://files.catbox.moe/fallback.png"; const profile={avatarUrl:runtimeTarget};');
const mediaCandidateHint=mediaCandidate.findings.find(finding=>finding.ruleId==='AH2'&&finding.riskEvidence?.usage==='media');
assert.ok(mediaCandidateHint);assert.deepEqual(mediaCandidateHint.riskEvidence?.candidates,[]);count+=2;
for(const source of ['const img=document.createElement("img"); img.src="https://files.catbox.moe/a.png";','const profile={avatarUrl:"https://i.ibb.co/a.png"};','const urls = {one:"https://files.catbox.moe/a.png",two:"https://files.catbox.moe/b.png"}; image.src = urls[mood];','const runtimeUrl=runtimeTarget;']) {
  const report=ejs(source);assert.equal(report.findings.some(finding=>finding.ruleId==='AH2'&&finding.riskEvidence?.usage==='media'),false);count++;
}
const dynamic=ejs('const profile = {avatarUrl:`https://files.catbox.moe/${name}.png`};');
assert.ok(rules(dynamic).includes('U5'));count++;
assert.ok(rules(check('<img src="https://files.catbox.moe/$<mood>.png">','regex')).includes('U5'));count++;
const multiple=ejs('fetch("https://api.example/first"); fetch("https://api.example/second", {method:"POST",body:data});');
assert.equal(multiple.findings.filter(finding=>finding.ruleId==='M4').length,2);
assert.ok(multiple.findings.filter(finding=>finding.ruleId==='M4').every(finding=>finding.riskEvidence?.expression));
assert.equal(multiple.findings.filter(finding=>finding.ruleId==='U2').length,2);count+=3;
const uploader=toUploaderCodeCheck(multiple);
assert.equal(uploader.findings.filter(finding=>finding.ruleId==='SCRIPT-REVIEW').length,2);
assert.equal(JSON.stringify(uploader).includes('api.example'),false);
assert.equal(JSON.stringify(uploader).includes('riskEvidence'),false);count+=3;
for(const [source,word] of [['eval(code);','eval()'],['new Function(code);','动态创建函数'],['while(true){}','循环']]){
  const report=ejs(source),visible=toUploaderCodeCheck(report);
  assert.equal(report.gate,'accept');
  assert.equal(report.audit,'yellow');
  assert.ok(visible.findings.some(finding=>finding.ruleId==='SCRIPT-RISK'&&finding.title.includes(word)&&finding.line===2));
  assert.equal(/"M[125]"/.test(JSON.stringify(visible)),false);
  assert.equal(formatUploaderCodeCheckError(report), '');count+=4;
}
assert.ok(rules(ejs('globalThis.utils = {};')).includes('L5'));count++;
const reusedAsset=ejs('const avatarUrl="https://files.catbox.moe/a.png"; fetch(avatarUrl,{method:"POST",body:data});');
assert.ok(reusedAsset.findings.some(finding=>finding.ruleId==='U2'&&finding.riskEvidence?.usage==='network'));
assert.ok(rules(reusedAsset).includes('M4'));count+=2;
const duplicateMarkup='<a href="https://example.org/first" href="https://evil.org/second">go</a>';
const duplicate=check(duplicateMarkup,'regex').findings.find(finding=>finding.ruleId==='U2');
assert.equal(duplicate.riskEvidence.target,'https://example.org/first');
assert.equal(duplicate.index,duplicateMarkup.indexOf('href'));count+=2;
console.log(`ejs-policy-assets: ${count} assertions passed`);
