import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFile(resolve(root, path), 'utf8');
const manifest = JSON.parse(await read('config/workshop.json'));

const stableSemver = /^\d+\.\d+\.\d+$/;
const stagingSemver = /^\d+\.\d+\.\d+-dev\d+$/;
const publicBundlePath = /^dist\/[A-Za-z0-9._/-]+\.js$/;

function parseStable(value) {
  assert.match(value, stableSemver, `Expected stable X.Y.Z, got ${value}`);
  return value.split('.').map(Number);
}

function compareStable(left, right) {
  const a = parseStable(left);
  const b = parseStable(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return 0;
}

assert.ok(manifest?.client, 'Missing client config');
assert.match(manifest.client.stable, stableSemver);
assert.match(manifest.client.minimum, stableSemver);
assert.match(manifest.client.staging, stagingSemver);
assert.match(manifest.client.publicPath, publicBundlePath, 'client.publicPath must be a JS file under dist/');
assert.match(manifest.client.stagingPublicPath, publicBundlePath, 'client.stagingPublicPath must be a JS file under dist/');
assert.match(manifest.client.legacyShimPath, /^test-dist\/[A-Za-z0-9._/-]+\.js$/, 'client.legacyShimPath must be the compatibility shim under test-dist/');
assert.notEqual(manifest.client.publicPath, manifest.client.stagingPublicPath, 'stable and staging public paths must differ');
assert.ok(compareStable(manifest.client.minimum, manifest.client.stable) <= 0, 'client.minimum cannot be newer than client.stable');

const migrations = Array.isArray(manifest.client.migrations) ? manifest.client.migrations : [];
for (const migration of migrations) {
  assert.match(migration.beforeVersion, stableSemver, 'client migration beforeVersion must be X.Y.Z');
  assert.ok(migration.fromPath && migration.toPath && migration.message, 'client migration requires fromPath, toPath and message');
  assert.ok(['self-rewrite'].includes(migration.mode), 'unsupported client migration mode');
  assert.equal(migration.toPath, manifest.client.publicPath, 'client migration toPath must point at the current stable publicPath');
  if (migration.mode === 'self-rewrite') assert.equal(migration.fromPath, manifest.client.legacyShimPath, 'self-rewrite migration must start at legacyShimPath');
  assert.ok(compareStable(migration.beforeVersion, manifest.client.stable) <= 0, 'client migration cannot target a future stable version');
}

assert.ok(manifest?.endpoints, 'Missing endpoint config');
for (const [name, value] of Object.entries({
  production: manifest.endpoints.production,
  staging: manifest.endpoints.staging,
})) {
  const url = new URL(value);
  assert.equal(url.protocol, 'https:', `${name} endpoint must use HTTPS`);
}
for (const value of manifest.endpoints.stagingAliases || []) {
  assert.equal(new URL(value).protocol, 'https:', 'staging alias must use HTTPS');
}

assert.ok(manifest?.release?.repository, 'Missing release.repository');
assert.equal(new URL(manifest.release.cdnBase).protocol, 'https:', 'release.cdnBase must use HTTPS');

const dependencies = Array.isArray(manifest.scriptDependencies) ? manifest.scriptDependencies : [];
const dependencyKeys = new Set();
for (const dependency of dependencies) {
  assert.ok(dependency.key, 'script dependency key is required');
  assert.ok(dependency.displayName, `displayName is required for ${dependency.key}`);
  assert.match(dependency.latestVersion, stableSemver, `latestVersion must be X.Y.Z for ${dependency.key}`);
  assert.ok(!dependencyKeys.has(dependency.key), `duplicate script dependency key: ${dependency.key}`);
  dependencyKeys.add(dependency.key);
}

const files = {
  version: await read('src/CreativeWorkshop/version.ts'),
  clientConfig: await read('src/CreativeWorkshop/services/config.ts'),
  stagingEntry: await read('src/CreativeWorkshop/staging.ts'),
  webpack: await read('webpack.config.cjs'),
  packageJson: await read('package.json'),
  legacyBuilder: await read('scripts/build-workshop-legacy-shim.mjs'),
  bundleCheck: await read('scripts/check-workshop-bundles.mjs'),
  homeApp: await read('cloudflare/src/pages/home/app.ts'),
  layout: await read('cloudflare/src/pages/home/render/layout.ts'),
  modal: await read('cloudflare/src/pages/home/modal/core.ts'),
  bridge: await read('cloudflare/src/pages/home/tavern-bridge.ts'),
  workerIndex: await read('cloudflare/src/index.ts'),
  runtimeLimits: await read('cloudflare/src/config/runtime-limits.ts'),
  homeApi: await read('cloudflare/src/pages/home/api.ts'),
  projectsAssetsEndpoint: await read('cloudflare/src/endpoints/projects/assets.ts'),
  projectsWriteEndpoint: await read('cloudflare/src/endpoints/projects/write.ts'),
  siteSettingsEndpoint: await read('cloudflare/src/endpoints/site-settings.ts'),
  types: await read('cloudflare/src/types.ts'),
  versionUtil: await read('cloudflare/src/utils/version.js'),
  agents: await read('AGENTS.md'),
  workflow: await read('docs/GIT-WORKFLOW.md'),
  releaseSop: await read('docs/WORKSHOP-RELEASE-SOP.md'),
  readme: await read('README.md'),
  configReadme: await read('config/README.md'),
};

assert.match(files.version, /__CREATIVE_WORKSHOP_CLIENT_VERSION__/);
assert.doesNotMatch(files.version, /['"]\d+\.\d+\.\d+(?:-[^'"]+)?['"]/);
assert.match(files.clientConfig, /__CREATIVE_WORKSHOP_DEFAULT_URL__/);
assert.match(files.webpack, /config\/workshop\.json/);
assert.match(files.webpack, /workshopConfig\.client\.stable/);
assert.match(files.webpack, /workshopConfig\.client\.staging/);
assert.match(files.webpack, /workshopConfig\.client\.publicPath/);
assert.match(files.webpack, /workshopConfig\.client\.stagingPublicPath/);
assert.doesNotMatch(files.webpack, /test-dist/);
assert.match(files.packageJson, /build-workshop-legacy-shim\.mjs/);
assert.match(files.legacyBuilder, /manifest\.client\.legacyShimPath/);
assert.match(files.legacyBuilder, /migration\.fromPath/);
assert.match(files.legacyBuilder, /migration\.toPath/);
assert.doesNotMatch(files.legacyBuilder, /test-dist\/CreativeWorkshop\/index\.js|dist\/CreativeWorkshop\/index\.js/);
assert.match(files.bundleCheck, /manifest\.client\.publicPath/);
assert.match(files.bundleCheck, /manifest\.client\.stagingPublicPath/);
assert.match(files.bundleCheck, /manifest\.client\.legacyShimPath/);
assert.match(files.homeApp, /config\/workshop\.json/);
assert.match(files.layout, /WORKSHOP_CONFIG\.client\.stable/);
assert.match(files.layout, /WORKSHOP_CONFIG\.client\.minimum/);
assert.match(files.modal, /WORKSHOP_CONFIG\.client\.migrations/);
assert.match(files.bridge, /WORKSHOP_CONFIG\.scriptDependencies/);
assert.match(files.workerIndex, /workshopConfig\.endpoints\.staging/);
assert.match(files.homeApi, /WORKSHOP_LIMITS\.projectUploadBytes/);
assert.match(files.homeApi, /WORKSHOP_LIMITS\.projectUploadLabel/);
assert.match(files.projectsAssetsEndpoint, /WORKSHOP_LIMITS\.projectUploadBytes/);
assert.match(files.projectsAssetsEndpoint, /WORKSHOP_LIMITS\.coverRequestOverheadBytes/);
assert.match(files.projectsWriteEndpoint, /LEGACY_PROJECT_VERSION_BASE/);
assert.match(files.siteSettingsEndpoint, /WORKSHOP_LIMITS\.bannerUploadBytes/);
assert.match(files.siteSettingsEndpoint, /WORKSHOP_LIMITS\.bannerUploadLabel/);
assert.match(files.types, /LEGACY_PROJECT_VERSION_BASE/);
assert.match(files.versionUtil, /LEGACY_PROJECT_VERSION_BASE\s*=\s*['"]1\.0\.0['"]/);
assert.doesNotMatch(files.homeApi, /10\s*\*\s*1024\s*\*\s*1024|最大\s*10MB/);
assert.doesNotMatch(files.projectsAssetsEndpoint, /10\s*\*\s*1024\s*\*\s*1024|version:\s*['"]1\.0\.0['"]/);
assert.doesNotMatch(files.projectsWriteEndpoint, /version:\s*['"]1\.0\.0['"]/);
assert.doesNotMatch(files.siteSettingsEndpoint, /8\s*\*\s*1024\s*\*\s*1024|8 MB or smaller/);
assert.doesNotMatch(files.types, /default\(['"]1\.0\.0['"]\)/);

const forbiddenValues = [
  manifest.client.stable,
  manifest.client.minimum,
  manifest.client.staging,
  manifest.client.publicPath,
  manifest.client.stagingPublicPath,
  manifest.endpoints.production,
  manifest.endpoints.staging,
  ...(manifest.endpoints.stagingAliases || []),
  ...migrations.flatMap(item => [item.beforeVersion, item.fromPath, item.toPath, item.message]),
  ...dependencies.flatMap(item => [item.key, item.displayName, item.latestVersion]),
];

const forbiddenTargets = [
  ['src/CreativeWorkshop/version.ts', files.version],
  ['src/CreativeWorkshop/services/config.ts', files.clientConfig],
  ['src/CreativeWorkshop/staging.ts', files.stagingEntry],
  ['cloudflare/src/pages/home/render/layout.ts', files.layout],
  ['cloudflare/src/pages/home/modal/core.ts', files.modal],
  ['cloudflare/src/pages/home/tavern-bridge.ts', files.bridge],
  ['cloudflare/src/index.ts', files.workerIndex],
  ['README.md', files.readme],
];

for (const [path, source] of forbiddenTargets) {
  for (const value of forbiddenValues) {
    assert.ok(!source.includes(value), `${path} duplicates managed value "${value}" from config/workshop.json`);
  }
}

assert.doesNotMatch(files.agents, /Current stable production line:\s*`\d+\.\d+\.\d+`/);
assert.doesNotMatch(files.agents, /Current feature-development line:\s*`\d+\.\d+\.\d+-dev\d+`/);
assert.doesNotMatch(files.workflow, /owner main \/ production\s*=\s*\d+\.\d+\.\d+/);
assert.doesNotMatch(files.workflow, /origin\/staging\s*=\s*\d+\.\d+\.\d+-dev\d+/);

for (const [path, source] of [
  ['AGENTS.md', files.agents],
  ['docs/GIT-WORKFLOW.md', files.workflow],
  ['docs/WORKSHOP-RELEASE-SOP.md', files.releaseSop],
  ['config/README.md', files.configReadme],
]) {
  for (const value of forbiddenValues) {
    assert.ok(!source.includes(value), `${path} repeats live managed value "${value}"; reference config/workshop.json instead`);
  }
}

console.log('Workshop config source-of-truth check: ok');
