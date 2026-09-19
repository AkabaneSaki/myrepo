import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'config/workshop.json'), 'utf8'));
const target = String(process.argv[2] || 'all').trim();

assert.ok(['release', 'staging', 'all'].includes(target), 'usage: check-workshop-bundles.mjs <release|staging|all>');

function escapeRegex(value) {
  return String(value).replace(/[.*+?^$()|[\]{}\\]/g, '\\$&');
}

function assertBundle(label, source, expectedVersion, expectedEndpoint) {
  assert.match(
    source,
    new RegExp('CREATIVE_WORKSHOP_CLIENT_VERSION\\s*=\\s*["\\\']' + escapeRegex(expectedVersion) + '["\\\']'),
    label + ' bundle does not embed expected client version ' + expectedVersion,
  );
  assert.match(
    source,
    new RegExp('DEFAULT_CREATIVE_WORKSHOP_URL\\s*=\\s*["\\\']' + escapeRegex(expectedEndpoint) + '["\\\']'),
    label + ' bundle does not embed expected endpoint ' + expectedEndpoint,
  );
}

async function verifyRelease() {
  const stableBundle = await readFile(resolve(root, manifest.client.publicPath), 'utf8');
  const legacyShim = await readFile(resolve(root, manifest.client.legacyShimPath), 'utf8');

  assertBundle('stable', stableBundle, manifest.client.stable, manifest.endpoints.production);
  assert.ok(!stableBundle.includes(manifest.client.staging), 'stable bundle unexpectedly contains staging client version');
  assert.ok(!stableBundle.includes(manifest.endpoints.staging), 'stable bundle unexpectedly contains staging endpoint');

  const migration = (manifest.client.migrations || []).find(item => item.mode === 'self-rewrite');
  assert.ok(migration, 'missing self-rewrite migration for compatibility endpoint');
  assert.ok(legacyShim.includes(migration.fromPath), 'compatibility shim does not embed migration fromPath');
  assert.ok(legacyShim.includes(migration.toPath), 'compatibility shim does not embed migration toPath');
  assert.ok(legacyShim.includes(manifest.client.stable), 'compatibility shim does not embed stable target version');
  assert.match(legacyShim, /updateScriptTreesWith/);
  assert.match(legacyShim, /getScriptId/);
  assert.ok(legacyShim.length < 12 * 1024, 'compatibility shim unexpectedly looks like a full Workshop bundle');

  const compatibilityRoot = resolve(root, manifest.client.legacyShimPath.split('/')[0]);
  const compatibilityFiles = (await readdir(compatibilityRoot, { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile())
    .map(entry => relative(root, resolve(entry.parentPath || entry.path, entry.name)).replaceAll('\\', '/'))
    .sort();

  assert.deepEqual(
    compatibilityFiles,
    [manifest.client.legacyShimPath],
    'historical compatibility tree must contain only the one migration shim',
  );

  console.log(
    'Workshop release artifacts verified: stable=' + manifest.client.stable
      + ', minimum=' + manifest.client.minimum
      + ', stablePath=' + manifest.client.publicPath
      + ', compatibilityPath=' + manifest.client.legacyShimPath,
  );
}

async function verifyStaging() {
  const stagingBundle = await readFile(resolve(root, manifest.client.stagingPublicPath), 'utf8');
  assertBundle('staging', stagingBundle, manifest.client.staging, manifest.endpoints.staging);
  console.log(
    'Workshop staging artifact verified: staging=' + manifest.client.staging
      + ', stagingPath=' + manifest.client.stagingPublicPath,
  );
}

if (target === 'release' || target === 'all') await verifyRelease();
if (target === 'staging' || target === 'all') await verifyStaging();
