import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = relativePath => readFile(resolve(root, relativePath), 'utf8');
const manifest = JSON.parse(await read('config/workshop.json'));
const rootPackage = JSON.parse(await read('package.json'));
const workerPackage = JSON.parse(await read('cloudflare/package.json'));

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
  workerIndex: await read('cloudflare/src/index.ts'),
  legacyBuilder: await read('scripts/build-workshop-legacy-shim.mjs'),
  bundleCheck: await read('scripts/check-workshop-bundles.mjs'),
  compatCheck: await read('scripts/check-workshop-compat.mjs'),
  masterWorkerCheck: await read('cloudflare/scripts/check-master-worker.mjs'),
  agents: await read('AGENTS.md'),
  workflow: await read('docs/GIT-WORKFLOW.md'),
  releaseSop: await read('docs/WORKSHOP-RELEASE-SOP.md'),
  configReadme: await read('config/README.md'),
  readme: await read('README.md'),
  bundleWorkflow: await read('.github/workflows/bundle.yaml'),
  cloudflareWorkflow: await read('.github/workflows/cloudflare-checks.yaml'),
};

assert.match(files.version, /__CREATIVE_WORKSHOP_CLIENT_VERSION__/);
assert.doesNotMatch(files.version, /['"]\d+\.\d+\.\d+(?:-[^'"]+)?['"]/);
assert.match(files.clientConfig, /__CREATIVE_WORKSHOP_DEFAULT_URL__/);

assert.match(files.webpack, /config\/workshop\.json/);
assert.match(files.webpack, /workshopConfig\.client\.stable/);
assert.match(files.webpack, /workshopConfig\.client\.staging/);
assert.match(files.webpack, /workshopConfig\.client\.publicPath/);
assert.match(files.webpack, /workshopConfig\.client\.stagingPublicPath/);
assert.match(files.webpack, /--env target=stable or --env target=staging/);
assert.doesNotMatch(files.webpack, /module\.exports\s*=\s*\[/);

assert.equal(rootPackage.scripts.build, 'pnpm build:release');
assert.match(rootPackage.scripts['build:release'], /build:stable.*build:compat/);
assert.match(rootPackage.scripts['build:staging'], /target=staging/);
assert.match(rootPackage.scripts['build:stable'], /target=stable/);
assert.match(rootPackage.scripts['build:all'], /build:release.*build:staging/);
assert.match(rootPackage.scripts['check:workshop-release'], /check-workshop-bundles\.mjs release.*check-workshop-compat\.mjs/);
assert.match(rootPackage.scripts['check:workshop-staging'], /check-workshop-bundles\.mjs staging/);

assert.equal(workerPackage.scripts.deploy, undefined, 'cloudflare/package.json must not expose a raw production/staging deploy shortcut');
assert.equal(workerPackage.scripts['check:production'], undefined, 'cloudflare/package.json must not expose a misleading production deploy dry-run shortcut');
assert.ok(
  !Object.values(workerPackage.scripts).some(value => /wrangler\s+deploy(?!\s+--dry-run)/.test(String(value))),
  'cloudflare/package.json must not expose raw wrangler deploy through npm scripts',
);

assert.match(files.app, /config\/workshop\.json/);
assert.match(files.app, /WORKSHOP_CONFIG/);
assert.match(files.layout, /WORKSHOP_CONFIG\.client\.stable/);
assert.match(files.layout, /WORKSHOP_CONFIG\.client\.minimum/);
assert.doesNotMatch(files.layout, /WORKSHOP_RELEASE_VERSION/);

assert.match(files.modals, /WORKSHOP_CONFIG\.client\.migrations/);
assert.match(files.bridge, /WORKSHOP_CONFIG\.scriptDependencies/);
assert.match(files.bridge, /WORKSHOP_MINIMUM_CLIENT_VERSION/);
assert.match(files.workerIndex, /config\/workshop\.json/);
assert.match(files.workerIndex, /WORKSHOP_STAGING_HOSTS/);
assert.match(files.workerIndex, /workshopConfig\.endpoints\.staging/);

assert.match(files.legacyBuilder, /manifest\.client\.legacyShimPath/);
assert.match(files.legacyBuilder, /migration\.fromPath/);
assert.match(files.legacyBuilder, /migration\.toPath/);
assert.match(files.bundleCheck, /manifest\.client\.publicPath/);
assert.match(files.bundleCheck, /manifest\.client\.stagingPublicPath/);
assert.match(files.bundleCheck, /manifest\.client\.legacyShimPath/);
assert.match(files.compatCheck, /updateScriptTreesWith/);
assert.match(files.compatCheck, /expectedImport/);

assert.match(files.masterWorkerCheck, /config\/workshop\.json/);
assert.match(files.masterWorkerCheck, /manifest\.endpoints\.staging/);

assert.match(files.agents, /Mandatory task-intent header/);
assert.match(files.agents, /Normal development[\s\S]*origin\/staging/);
assert.match(files.agents, /Production hotfix[\s\S]*main → hotfix → main/);
assert.match(files.agents, /must never be implemented on `origin\/staging` first/);
assert.doesNotMatch(files.agents, /Direction:\s*`main → staging`/);

assert.match(files.workflow, /Task-intent routing declaration/);
assert.match(files.workflow, /create task branch from refreshed origin\/staging/);
assert.match(files.workflow, /main → hotfix → main/);
assert.match(files.workflow, /Forbidden: implement a production hotfix on `origin\/staging` first/);

assert.match(files.releaseSop, /Three artifact lifecycles/);
assert.match(files.releaseSop, /build:release/);
assert.match(files.releaseSop, /build:staging/);
assert.match(files.releaseSop, /historical public compatibility endpoint/i);
assert.match(files.releaseSop, /main → hotfix → main|upstream\/main \/ exact production source → hotfix branch → upstream\/main/);

assert.match(files.configReadme, /single source of truth/i);
assert.match(files.configReadme, /historical public compatibility endpoint/i);
assert.match(files.readme, /guarded deployment helper/);
assert.doesNotMatch(files.readme, /npm run deploy/);

assert.match(files.bundleWorkflow, /pnpm check:workshop-config/);
assert.match(files.bundleWorkflow, /pnpm build:all/);
assert.match(files.bundleWorkflow, /pnpm check:workshop-bundles/);
assert.match(files.cloudflareWorkflow, /npm run check:workshop-config/);
assert.match(files.cloudflareWorkflow, /npm run cf-typegen/);
assert.match(files.cloudflareWorkflow, /npm run check:types/);
assert.match(files.cloudflareWorkflow, /npm run check:home-js-smoke/);

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
  workerIndex: files.workerIndex,
  masterWorkerCheck: files.masterWorkerCheck,
})) {
  for (const value of managedValues) {
    assert.ok(!source.includes(value), `${fileName} duplicates managed config value: ${value}`);
  }
}

console.log(
  'Workshop config/workflow source-of-truth check: ok'
  + ` stable=${manifest.client.stable}`
  + ` minimum=${manifest.client.minimum}`
  + ` staging=${manifest.client.staging}`,
);
