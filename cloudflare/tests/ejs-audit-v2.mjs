import assert from 'node:assert/strict';
import { analyzeProjectCode } from '../src/utils/ejs-preflight.mjs';
import { buildAuditSnapshot, applyAuditBaseline, buildReviewToken } from '../src/utils/ejs-checker/audit.mjs';

const request = 'fetch("https://api.example.com/path?q=one", {method:"POST", headers:{Authorization:"one"},body:"first"});';
const filteredRegex = analyzeProjectCode([{fileName:'regex.json',type:'regex',text:JSON.stringify([{scriptName:'placeholder',findRegex:'x'},{id:'risk',scriptName:'risk',findRegex:'x',replaceString:'<script>fetch("https://api.example.com/data")</script>'}])}]);
assert.ok(filteredRegex.findings.some(item=>item.ruleId==='M4'&&item.entryId==='0:regex.json:regex:1'));
const emptyRegexInput = [{fileName:'regex.json',type:'regex',text:'[]'}];
const emptyRegexReport = analyzeProjectCode(emptyRegexInput);
assert.equal(emptyRegexReport.gate,'accept');
assert.ok((await buildAuditSnapshot(emptyRegexInput,emptyRegexReport)).filesHash);
const code = statement => '<% { '+statement+' } %>';
const input = (contents, fileName='project.json') => [{fileName,type:'worldbook',text:JSON.stringify({entries:Object.fromEntries(contents.map((content,index) => [index,{uid:index+7,comment:'entry-'+index,content}]))})}];
async function scan(contents,fileName) {
  const inputs=input(contents,fileName), report=analyzeProjectCode(inputs);
  return {inputs,report,snapshot:await buildAuditSnapshot(inputs,report)};
}
const previous = await scan([code(request)]);
const accepted = {...previous.snapshot,reviewerId:'reviewer',reviewedAt:'2026-10-05T00:00:00Z',revision:4};
const unchanged = await scan(['\n\n'+code(request.replace('fetch(', 'fetch ('))],'draft-123.json');
assert.notEqual(unchanged.snapshot.filesHash,previous.snapshot.filesHash);
assert.deepEqual(unchanged.snapshot.findings.map(item=>item.fingerprint),previous.snapshot.findings.map(item=>item.fingerprint));
const inherited = applyAuditBaseline(unchanged.report,unchanged.snapshot,accepted);
assert.equal(inherited.audit,'green');
assert.equal(inherited.auditSummary.pending,0);
assert.equal(inherited.certification,'pass');
assert.ok(inherited.auditSummary.accepted > 0);
assert.equal(inherited.gate,unchanged.report.gate);
assert.ok(inherited.findings.filter(item=>item.reviewState).every(item=>item.reviewState === 'accepted'));

for (const [oldValue,newValue] of [['/path','/upload'],['q=one','q=two'],['POST','GET'],['Authorization:"one"','Authorization:"two"'],['body:"first"','body:"second"']]) {
  const changed=await scan([code(request.replace(oldValue,newValue))]);
  const decorated=applyAuditBaseline(changed.report,changed.snapshot,accepted);
  assert.equal(decorated.auditSummary.accepted,0,newValue);
  assert.ok(decorated.auditSummary.changed > 0,newValue);
}
// Referenced values and unrelated entry definitions both invalidate conservatively.
const definitions=await scan([code('const body=globalThis.projectBody; fetch("https://example.com",{body});'),code('globalThis.projectBody="one";')]);
const definitionsEnvelope={...definitions.snapshot,reviewerId:'reviewer',reviewedAt:'today',revision:1};
const alteredDefinitions=await scan([code('const body=globalThis.projectBody; fetch("https://example.com",{body});'),code('globalThis.projectBody="two";')]);
assert.equal(applyAuditBaseline(alteredDefinitions.report,alteredDefinitions.snapshot,definitionsEnvelope).auditSummary.accepted,0);

const differentPolicy={...accepted,policyVersion:accepted.policyVersion+'old'};
assert.equal(applyAuditBaseline(previous.report,previous.snapshot,differentPolicy).auditSummary.accepted,0);
assert.ok(applyAuditBaseline(previous.report,previous.snapshot,differentPolicy).auditSummary.changed > 0);
const differentEngine=await buildAuditSnapshot(previous.inputs,{...previous.report,engine:'future-engine'});
assert.notEqual(differentEngine.policyVersion,previous.snapshot.policyVersion);
const removed=await scan([code('void 0;')]);
assert.equal(applyAuditBaseline(removed.report,removed.snapshot,accepted).auditSummary.removed,previous.snapshot.findings.length);

const rejected=await scan([code(request+'eval("1");')]);
assert.equal(rejected.report.gate,'accept');
assert.equal(rejected.report.audit,'yellow');
const humanApproval={...rejected.snapshot,reviewerId:'reviewer',reviewedAt:'today',revision:1};
const approved=applyAuditBaseline(rejected.report,rejected.snapshot,humanApproval);
assert.equal(approved.gate,'accept');
assert.equal(approved.audit,'green');
assert.equal(approved.findings.find(item=>item.ruleId==='M1').reviewState,'accepted');
const changedRisk=await scan([code(request+'eval("2");')]);
assert.equal(applyAuditBaseline(changedRisk.report,changedRisk.snapshot,humanApproval).audit,'yellow');
assert.equal(applyAuditBaseline({...previous.report,gate:'reject'},previous.snapshot,accepted).gate,'reject');

// Every occurrence has a separate key even if the same rule repeats in one entry.
const firstRisk=previous.report.findings.find(item=>item.ruleId==='M4');
const duplicates=await buildAuditSnapshot(previous.inputs,{...previous.report,findings:[firstRisk,{...firstRisk,index:firstRisk.index+1}]});
assert.equal(duplicates.findings.length,2);
assert.notEqual(duplicates.findings[0].key,duplicates.findings[1].key);
assert.notEqual(duplicates.findings[0].fingerprint,duplicates.findings[1].fingerprint);
const sameName=await scan([code(request)],'totally-different.json');
assert.equal(sameName.snapshot.filesHash,previous.snapshot.filesHash);
assert.deepEqual(sameName.snapshot.findings.map(item=>item.fingerprint),previous.snapshot.findings.map(item=>item.fingerprint));
assert.notEqual(await buildReviewToken(previous.snapshot,4),await buildReviewToken(previous.snapshot,5));
assert.notEqual(await buildReviewToken(previous.snapshot,4),await buildReviewToken(unchanged.snapshot,4));

const htmlInput = html => [{fileName:'regex.json',type:'regex',text:JSON.stringify([{id:'stable-regex',scriptName:'test',replaceString:html}])}];
async function htmlScan(html) {
  const inputs=htmlInput(html),report=analyzeProjectCode(inputs);
  return {report,snapshot:await buildAuditSnapshot(inputs,report)};
}
const html=await htmlScan('<button onclick="fetch(\'https://example.com/a\')">点击</button><script>fetch("https://example.com/b")</script>');
const htmlFormat=await htmlScan('\n<button onclick="fetch (\'https://example.com/a\')">点击</button>\n<script>\nfetch ("https://example.com/b")\n</script>');
const byKey = snapshot => Object.fromEntries(snapshot.findings.map(item=>[item.key,item.fingerprint]));
assert.deepEqual(byKey(html.snapshot),byKey(htmlFormat.snapshot));
assert.equal(applyAuditBaseline(htmlFormat.report,htmlFormat.snapshot,{...html.snapshot,reviewerId:'reviewer',reviewedAt:'today',revision:1}).auditSummary.accepted,html.snapshot.findings.length);
const literalChange=await scan([code(request.replace('body:"first"','body:"first\\n"'))]);
assert.notEqual(literalChange.snapshot.findings[0].fingerprint,previous.snapshot.findings[0].fingerprint);
assert.ok(!JSON.stringify(previous.snapshot).includes('body:"first"'));
console.log('Audit snapshots/inheritance: semantic coverage, per-risk keys and hard gate preservation: ok');
