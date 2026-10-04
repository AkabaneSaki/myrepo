import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Read only the staging site's public project APIs. No installs, uploads or edits.
const origin = 'https://workshop-test.uika.cc.cd';
const destination = new URL('../../.ai-bridge/ejs-checker-v2/staging-corpus.json', import.meta.url);
async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Corpus fetch failed: ${response.status} ${url}`);
  return response.json();
}
const projects = [];
let complete = false;
for (let page=0; page<20; page++) {
  const result = await getJson(`${origin}/api/projects?page=${page}&pageSize=50&sort=published`);
  projects.push(...result.projects);
  if (!result.hasMore) { complete=true; break; }
}
if (!complete) throw new Error('Public corpus exceeds the API pagination limit; audit is incomplete.');
const snapshots = [];
for (let i=0; i<projects.length; i+=3) {
  const batch = await Promise.all(projects.slice(i,i+3).map(async project => {
    const detail = await getJson(`${origin}/api/projects/${encodeURIComponent(project.id)}`);
    const p=detail.project;
    const inputs=[];
    const worldbooks=detail.worldbookEntriesPreview??p.worldbookEntriesPreview??[];
    const regex=detail.regexEntriesPreview??p.regexEntriesPreview??[];
    if (worldbooks.length) inputs.push({fileName:`${project.id}-worldbook.json`,type:'worldbook',text:JSON.stringify({entries:worldbooks})});
    if (regex.length) inputs.push({fileName:`${project.id}-regex.json`,type:'regex',text:JSON.stringify(regex)});
    return {id:project.id,name:project.name,version:project.version,updatedAt:project.updatedAt,inputs,sha256:crypto.createHash('sha256').update(JSON.stringify(inputs)).digest('hex')};
  }));
  snapshots.push(...batch);
}
const snapshot={origin,capturedAt:new Date().toISOString(),coverage:'All publicly listed approved staging projects; private/pending projects are excluded.',projects:snapshots};
await fs.mkdir(path.dirname(destination.pathname.replace(/^\/(\w:)/,'$1')),{recursive:true});
await fs.writeFile(destination,JSON.stringify(snapshot,null,2));
console.log(JSON.stringify({origin,projects:snapshots.length,files:snapshots.flatMap(p=>p.inputs).length,output:destination.pathname}));
