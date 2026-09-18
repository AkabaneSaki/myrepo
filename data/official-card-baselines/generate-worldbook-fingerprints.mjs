import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const sourceDir = process.argv[2];
const explicitOutputPath = process.argv[3];
if (!sourceDir) {
  console.error('Usage: node data/official-card-baselines/generate-worldbook-fingerprints.mjs <machine-source-directory> [output-json]');
  process.exit(1);
}

const manifestPath = path.join(sourceDir, 'manifest.json');
const worldbookPath = path.join(sourceDir, 'worldbook.json');
const outputPath = explicitOutputPath || path.join(sourceDir, 'worldbook-fingerprints.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const worldbook = JSON.parse(fs.readFileSync(worldbookPath, 'utf8'));
const entries = Array.isArray(worldbook.entries) ? worldbook.entries : Object.values(worldbook.entries || {});

const normalizeText = value => String(value ?? '').replace(/\r\n/g, '\n').trim();
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

const fingerprints = entries
  .filter(entry => normalizeText(entry?.comment || entry?.name).startsWith('[DLC]'))
  .map(entry => {
    const canonical = {
      name: normalizeText(entry.comment || entry.name),
      content: normalizeText(entry.content),
    };

    return {
      source_entry_id: entry.id ?? null,
      name: canonical.name,
      fingerprint: sha256(JSON.stringify(canonical)),
      content_sha256: sha256(canonical.content),
    };
  });

const duplicateNames = fingerprints
  .map(entry => entry.name)
  .filter((name, index, names) => names.indexOf(name) !== index);
if (duplicateNames.length) {
  throw new Error(`Duplicate official DLC baseline names: ${[...new Set(duplicateNames)].join(', ')}`);
}

const output = {
  format: 'poem-workshop-official-worldbook-fingerprints',
  format_version: 2,
  character_version: manifest.character_version || null,
  source_png_sha256: manifest.source_png_sha256 || null,
  fingerprint_fields: ['name', 'content'],
  count: fingerprints.length,
  entries: fingerprints,
};

fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${fingerprints.length} fingerprints to ${outputPath}`);
