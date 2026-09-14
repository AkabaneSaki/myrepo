import type { AppContext } from '../types';

export type DiscoverBannerSettings = {
  imageKey: string | null;
  positionX: number;
  positionY: number;
  zoom: number;
  mobilePositionX: number;
  mobilePositionY: number;
  mobileZoom: number;
};

const DEFAULT_DISCOVER_BANNER: DiscoverBannerSettings = {
  imageKey: null,
  positionX: 50,
  positionY: 50,
  zoom: 1,
  mobilePositionX: 50,
  mobilePositionY: 50,
  mobileZoom: 1,
};

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

export function normalizeDiscoverBannerSettings(value: unknown): DiscoverBannerSettings {
  const input = value && typeof value === 'object' ? value as Partial<DiscoverBannerSettings> : {};
  return {
    imageKey: typeof input.imageKey === 'string' && input.imageKey.trim() ? input.imageKey.trim() : null,
    positionX: clamp(input.positionX, 0, 100, 50),
    positionY: clamp(input.positionY, 0, 100, 50),
    zoom: clamp(input.zoom, 1, 3, 1),
    mobilePositionX: clamp(input.mobilePositionX, 0, 100, 50),
    mobilePositionY: clamp(input.mobilePositionY, 0, 100, 50),
    mobileZoom: clamp(input.mobileZoom, 1, 3, 1),
  };
}

export const siteSettingsDb = {
  getDiscoverBanner: async (c: AppContext): Promise<DiscoverBannerSettings> => {
    const row = await c.env.DB.prepare('SELECT value FROM site_settings WHERE key = ?')
      .bind('discover_banner')
      .first<{ value: string }>();
    if (!row?.value) return { ...DEFAULT_DISCOVER_BANNER };
    try {
      return normalizeDiscoverBannerSettings(JSON.parse(row.value));
    } catch {
      return { ...DEFAULT_DISCOVER_BANNER };
    }
  },

  setDiscoverBanner: async (c: AppContext, settings: DiscoverBannerSettings, actorId: string): Promise<void> => {
    await c.env.DB.prepare(`
      INSERT INTO site_settings (key, value, updated_at, updated_by)
      VALUES (?, ?, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP, updated_by = excluded.updated_by
    `)
      .bind('discover_banner', JSON.stringify(normalizeDiscoverBannerSettings(settings)), actorId)
      .run();
  },
};
