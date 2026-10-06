const base = 'https://poemofdestinycreativeworkshop-master-staging.johnjohnson67076.workers.dev';

const listRes = await fetch(`${base}/api/projects?page=0&pageSize=20&sort=published`);
if (!listRes.ok) throw new Error(`project list HTTP ${listRes.status}: ${await listRes.text()}`);
const list = await listRes.json();
if (!Array.isArray(list.projects)) throw new Error('project list payload missing projects[]');
console.log(`project list OK: total=${list.total}, returned=${list.projects.length}`);

if (list.projects[0]?.id) {
  const detailRes = await fetch(`${base}/api/projects/${encodeURIComponent(list.projects[0].id)}`);
  if (!detailRes.ok) throw new Error(`project detail HTTP ${detailRes.status}: ${await detailRes.text()}`);
  const detail = await detailRes.json();
  const wb = Array.isArray(detail.worldbookEntriesPreview) ? detail.worldbookEntriesPreview.length : -1;
  const rx = Array.isArray(detail.regexEntriesPreview) ? detail.regexEntriesPreview.length : -1;
  console.log(`project detail OK: id=${list.projects[0].id}, worldbookPreview=${wb}, regexPreview=${rx}`);
}

console.log('Master Worker HTTP smoke OK');
