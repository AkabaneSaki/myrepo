import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const PROFILE_ROOT = join(homedir(), '.cotel', 'profiles');
const TRANSIENT_PROFILE_ENTRIES = new Set([
  'BrowserMetrics',
  'Cache',
  'CacheStorage',
  'Code Cache',
  'Crashpad',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'DevToolsActivePort',
  'GraphiteDawnCache',
  'GrShaderCache',
  'GPUCache',
  'Media Cache',
  'ShaderCache',
]);

export const ST_PROFILE_DEFINITIONS = {
  anonymous: {
    authenticated: false,
    path: join(PROFILE_ROOT, 'poem-workshop-st-anonymous'),
  },
  'authenticated-player': {
    authenticated: true,
    // Reuse the profile Master already completed legal consent + Discord OAuth in.
    path: join(PROFILE_ROOT, 'poem-workshop-st-edge'),
  },
};

export const WORKSHOP_VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 412, height: 915 },
};

export function getStProfileDefinition(name) {
  const resolved = ST_PROFILE_DEFINITIONS[name];
  if (!resolved) {
    throw new Error(
      `Unknown ST test profile "${name}". Expected one of: ${Object.keys(ST_PROFILE_DEFINITIONS).join(', ')}`,
    );
  }
  return resolved;
}

export function getStProfilePath(name) {
  if (name === 'anonymous' && process.env.ST_ANONYMOUS_PROFILE) {
    return process.env.ST_ANONYMOUS_PROFILE;
  }
  if (name === 'authenticated-player') {
    if (process.env.ST_AUTHENTICATED_PLAYER_PROFILE) {
      return process.env.ST_AUTHENTICATED_PLAYER_PROFILE;
    }
    // Backward-compatible single-profile override from the first Player Journey prototype.
    if (process.env.ST_TEST_PROFILE) return process.env.ST_TEST_PROFILE;
  }
  return getStProfileDefinition(name).path;
}

export function createStProfileRun(name) {
  getStProfileDefinition(name);
  const sourcePath = getStProfilePath(name);
  if (!existsSync(sourcePath)) {
    throw new Error(
      `ST test profile "${name}" does not exist at ${sourcePath}. Run the matching test:st:setup script first.`,
    );
  }

  const tempRoot = mkdtempSync(join(tmpdir(), `poem-workshop-${name}-`));
  const runPath = join(tempRoot, 'profile');
  try {
    cpSync(sourcePath, runPath, {
      recursive: true,
      filter(source) {
        const entry = basename(source);
        if (entry.startsWith('Singleton') || entry.startsWith('BrowserMetrics')) return false;
        return !TRANSIENT_PROFILE_ENTRIES.has(entry);
      },
    });
  } catch (error) {
    rmSync(tempRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
    throw error;
  }

  return {
    path: runPath,
    async cleanup() {
      await rm(tempRoot, { recursive: true, force: true, maxRetries: 60, retryDelay: 500 });
    },
  };
}

export function getWorkshopViewport(name) {
  const viewport = WORKSHOP_VIEWPORTS[name];
  if (!viewport) {
    throw new Error(
      `Unknown Workshop viewport "${name}". Expected one of: ${Object.keys(WORKSHOP_VIEWPORTS).join(', ')}`,
    );
  }
  return viewport;
}
