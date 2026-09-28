import { homedir } from 'node:os';
import { join } from 'node:path';

const PROFILE_ROOT = join(homedir(), '.cotel', 'profiles');

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

export function getWorkshopViewport(name) {
  const viewport = WORKSHOP_VIEWPORTS[name];
  if (!viewport) {
    throw new Error(
      `Unknown Workshop viewport "${name}". Expected one of: ${Object.keys(WORKSHOP_VIEWPORTS).join(', ')}`,
    );
  }
  return viewport;
}
