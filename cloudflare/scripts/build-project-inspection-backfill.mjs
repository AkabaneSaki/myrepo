import { writeFile } from 'node:fs/promises';

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const baseUrl = String(readArg('--base-url') || '').replace(/\/$/, '');
const output = readArg('--output');
if (!baseUrl || !output) {
  console.error('Usage: node scripts/build-project-inspection-backfill.mjs --base-url <url> --output <file.sql>');
  process.exit(2);
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

const projects = [];
for (let page = 0; ; page += 1) {
  const result = await fetchJson(`${baseUrl}/api/projects?page=${page}&pageSize=100&sort=published`);
  projects.push(...(Array.isArray(result.projects) ? result.projects : []));
  if (!result.hasMore) break;
}

const rows = [];
let ejsCount = 0;
let artworkCount = 0;
for (const project of projects) {
  const detail = await fetchJson(`${baseUrl}/api/projects/${encodeURIComponent(project.id)}`);
  const entries = [
    ...(Array.isArray(detail.worldbookEntriesPreview) ? detail.worldbookEntriesPreview : []),
    ...(Array.isArray(detail.regexEntriesPreview) ? detail.regexEntriesPreview : []),
  ];
  const hasEjs = entries.some(entry => Boolean(entry?.hasEjs));
  const hasCharacterArtwork = entries.some(entry => Boolean(entry?.hasCharacterArtwork));
  if (hasEjs) ejsCount += 1;
  if (hasCharacterArtwork) artworkCount += 1;
  const id = String(project.id).replaceAll("'", "''");
  rows.push(`UPDATE projects SET has_ejs = ${hasEjs ? 1 : 0}, has_character_artwork = ${hasCharacterArtwork ? 1 : 0} WHERE id = '${id}' AND is_published = 1;`);
}

const sql = [...rows, ''].join('
');
await writeFile(output, sql, 'utf8');
console.log(`inspection backfill SQL ready: ${projects.length} published projects; EJS=${ejsCount}; artwork=${artworkCount}; ${output}`);
