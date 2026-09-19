import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = relativePath => readFile(resolve(root, relativePath), 'utf8');
const manifest = JSON.parse(await read('config/workshop.json'));

const stableSemver = /^\d+\.\d+\.\d+$/;
const stagingSemver = /^\d+\.\d+\.\d+-dev$/;

assert.match(manifest.client.stable, stableSemver);
assert.match(manifest.client.minimum, stableSemver);
assert.match(manifest.client.staging, stagingSemver);
assert.match(manifest.client.publicPath, /^dist\/.+\.js$/);
assert.match(manifest.client.stagingPublicPath, /^dist\/.+\.js$/);
assert.match(manifest.client.legacyShimPath, /^test-dist\/.+\.js$/);
assert.ok(Array.isArray(manifest.client.migrations));

for (const migration of manifest.client.migrations) {
  assert.match(migration.beforeVersion, stableSemver);
  assert.equal(migration.toPath, manifest.client.publicPath);
  if (migration.mode === 'self-rewrite') {
    assert.equal(migration.fromPath, manifest.client.legacyShimPath);
  }
}

for (const url of [
  manifest.endpoints.production,
  manifest.endpoints.staging,
  ...(manifest.endpoints.stagingAliases || []),
  manifest.release.cdnBase,
]) {
  assert.equal(new URL(url).protocol, 'https:');
}

const files = {
  version: await read('src/CreativeWorkshop/version.ts'),
  clientConfig: await read('src/CreativeWorkshop/services/config.ts'),
  webpack: await read('webpack.config.cjs'),
  app: await read('cloudflare/src/pages/home/app.ts'),
  layout: await read('cloudflare/src/pages/home/render/layout.ts'),
  modals: await read('cloudflare/src/pages/home/modals.ts'),
  bridge: await read('cloudflare/src/pages/home/tavern-bridge.ts'),
  legacyBuilder: await read('scripts/build-workshop-legacy-shim.mjs'),
  bundleCheck: await read('scripts/check-workshop-bundles.mjs'),
};

assert.match(files.version, /__CREATIVE_WORKSHOP_CLIENT_VERSION__/);
assert.doesNotMatch(files.version, /['"]\d+\.\d+\.\d+(?:-[^'"]+)?['"]/);
assert.match(files.clientConfig, /__CREATIVE_WORKSHOP_DEFAULT_URL__/);

assert.match(files.webpack, /config\/workshop\.json/);
assert.match(files.webpack, /workshopConfig\.client\.stable/);
assert.match(files.webpack, /workshopConfig\.client\.staging/);
assert.match(files.webpack, /workshopConfig\.client\.publicPath/);
assert.match(files.webpack, /workshopConfig\.client\.stagingPublicPath/);

assert.match(files.app, /config\/workshop\.json/);
assert.match(files.app, /WORKSHOP_CONFIG/);
assert.match(files.layout, /WORKSHOP_CONFIG\.client\.stable/);
assert.match(files.layout, /WORKSHOP_CONFIG\.client\.minimum/);
assert.doesNotMatch(files.layout, /WORKSHOP_RELEASE_VERSION/);

assert.match(files.modals, /WORKSHOP_CONFIG\.client\.migrations/);
assert.match(files.bridge, /WORKSHOP_CONFIG\.scriptDependencies/);
assert.match(files.bridge, /WORKSHOP_MINIMUM_CLIENT_VERSION/);

assert.match(files.legacyBuilder, /manifest\.client\.legacyShimPath/);
assert.match(files.legacyBuilder, /migration\.fromPath/);
assert.match(files.legacyBuilder, /migration\.toPath/);
assert.match(files.bundleCheck, /manifest\.client\.publicPath/);
assert.match(files.bundleCheck, /manifest\.client\.stagingPublicPath/);
assert.match(files.bundleCheck, /manifest\.client\.legacyShimPath/);

const managedValues = [
  manifest.client.stable,
  manifest.client.minimum,
  manifest.client.staging,
  manifest.client.publicPath,
  manifest.client.stagingPublicPath,
  manifest.client.legacyShimPath,
  manifest.endpoints.production,
  manifest.endpoints.staging,
  ...(manifest.endpoints.stagingAliases || []),
  ...(manifest.scriptDependencies || []).flatMap(item => [item.key, item.displayName, item.latestVersion]),
];

for (const [fileName, source] of Object.entries({
  version: files.version,
  clientConfig: files.clientConfig,
  app: files.app,
  layout: files.layout,
  modals: files.modals,
  bridge: files.bridge,
})) {
  for (const value of managedValues) {
    assert.ok(!source.includes(value), `${fileName} duplicates managed config value: ${value}`);
  }
}

console.log(
  'Workshop config source-of-truth check: ok'
  + ` stable=${manifest.client.stable}`
  + ` minimum=${manifest.client.minimum}`
  + ` staging=${manifest.client.staging}`,
);
