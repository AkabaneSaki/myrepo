import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'config/workshop.json'), 'utf8'));
const stableBundle = await readFile(resolve(root, manifest.client.publicPath), 'utf8');
const stagingBundle = await readFile(resolve(root, manifest.client.stagingPublicPath), 'utf8');
const legacyShim = await readFile(resolve(root, manifest.client.legacyShimPath), 'utf8');

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

assertBundle('stable', stableBundle, manifest.client.stable, manifest.endpoints.production);
assertBundle('staging', stagingBundle, manifest.client.staging, manifest.endpoints.staging);

assert.ok(!stableBundle.includes(manifest.client.staging), 'stable bundle unexpectedly contains staging client version');
assert.ok(!stableBundle.includes(manifest.endpoints.staging), 'stable bundle unexpectedly contains staging endpoint');

const migration = (manifest.client.migrations || []).find(item => item.mode === 'self-rewrite');
assert.ok(migration, 'missing self-rewrite migration for legacy shim');
assert.ok(legacyShim.includes(migration.fromPath), 'legacy shim does not embed migration fromPath');
assert.ok(legacyShim.includes(migration.toPath), 'legacy shim does not embed migration toPath');
assert.ok(legacyShim.includes(manifest.client.stable), 'legacy shim does not embed stable target version');
assert.match(legacyShim, /updateScriptTreesWith/);
assert.match(legacyShim, /getScriptId/);
assert.ok(legacyShim.length < 12 * 1024, 'legacy shim unexpectedly looks like a full Workshop bundle');

const legacyRoot = resolve(root, manifest.client.legacyShimPath.split('/')[0]);
const legacyFiles = (await readdir(legacyRoot, { recursive: true, withFileTypes: true }))
  .filter(entry => entry.isFile())
  .map(entry => relative(root, resolve(entry.parentPath || entry.path, entry.name)).replaceAll('\\', '/'))
  .sort();

assert.deepEqual(
  legacyFiles,
  [manifest.client.legacyShimPath],
  'legacy test-dist tree must contain only the one migration shim',
);

console.log(
  'Workshop bundles verified: stable=' + manifest.client.stable
    + ', minimum=' + manifest.client.minimum
    + ', staging=' + manifest.client.staging
    + ', stablePath=' + manifest.client.publicPath
    + ', legacyShim=' + manifest.client.legacyShimPath,
);
