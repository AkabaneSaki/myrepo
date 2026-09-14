import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import type { AppContext } from '../types';
import { getCurrentUserFromRequest } from '../utils/jwt';
import { r2Storage } from '../utils/r2';
import { normalizeDiscoverBannerSettings, siteSettingsDb } from '../utils/site-settings';

const MAX_BANNER_SIZE = 8 * 1024 * 1024;

function isPreviewHost(c: AppContext): boolean {
  const hostname = new URL(c.req.url).hostname.toLowerCase();
  if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname.endsWith('.trycloudflare.com')) return true;

  const octets = hostname.split('.').map(part => Number(part));
  if (octets.length !== 4 || octets.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function toPublicBanner(c: AppContext, settings: Awaited<ReturnType<typeof siteSettingsDb.getDiscoverBanner>>) {
  const imageUrl = settings.imageKey
    ? r2Storage.getProxyUrl(c, settings.imageKey)
    : isPreviewHost(c) ? '/discover-preview-banner.png' : null;
  return { ...settings, imageUrl };
}

export class DiscoverBannerGet extends OpenAPIRoute {
  schema = { tags: ['Site'], summary: 'Get Discover banner settings', responses: { '200': { description: 'Banner settings' } } };
  async handle(c: AppContext) {
    return { success: true, banner: toPublicBanner(c, await siteSettingsDb.getDiscoverBanner(c)) };
  }
}

export class AdminDiscoverBannerUpdate extends OpenAPIRoute {
  schema = {
    tags: ['Admin'],
    summary: 'Update Discover banner presentation (Admin Only)',
    request: {
      headers: z.object({ authorization: z.string() }),
      body: { content: { 'application/json': { schema: z.object({
        positionX: z.number().min(0).max(100).optional(),
        positionY: z.number().min(0).max(100).optional(),
        zoom: z.number().min(1).max(3).optional(),
        mobilePositionX: z.number().min(0).max(100).optional(),
        mobilePositionY: z.number().min(0).max(100).optional(),
        mobileZoom: z.number().min(1).max(3).optional(),
      }) } } },
    },
    responses: { '200': { description: 'Banner updated' }, '403': { description: 'Admin only' } },
  };
  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload?.isAdmin) return c.json({ error: 'Admin only' }, 403);
    const data = await this.getValidatedData<typeof this.schema>();
    const current = await siteSettingsDb.getDiscoverBanner(c);
    const next = normalizeDiscoverBannerSettings({ ...current, ...data.body });
    await siteSettingsDb.setDiscoverBanner(c, next, payload.userId);
    return { success: true, banner: toPublicBanner(c, next) };
  }
}

export class AdminDiscoverBannerUpload extends OpenAPIRoute {
  schema = {
    tags: ['Admin'],
    summary: 'Upload Discover banner image (Admin Only)',
    request: { headers: z.object({ authorization: z.string() }) },
    responses: { '200': { description: 'Banner uploaded' }, '403': { description: 'Admin only' } },
  };
  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload?.isAdmin) return c.json({ error: 'Admin only' }, 403);
    const formData = await c.req.formData();
    const banner = formData.get('banner');
    if (!(banner instanceof File)) return c.json({ error: 'Banner file is required' }, 400);
    if (banner.size > MAX_BANNER_SIZE) return c.json({ error: 'Banner must be 8 MB or smaller' }, 413);
    const extension = banner.type === 'image/png' ? 'png' : banner.type === 'image/webp' ? 'webp' : banner.type === 'image/jpeg' ? 'jpg' : null;
    if (!extension) return c.json({ error: 'Only jpg/png/webp images are allowed' }, 400);

    const current = await siteSettingsDb.getDiscoverBanner(c);
    const key = `site/discover-banner-${Date.now()}.${extension}`;
    const result = await r2Storage.upload(c, key, await banner.arrayBuffer(), banner.type || 'application/octet-stream');
    if (!result) return c.json({ error: 'Upload failed' }, 500);

    const next = { ...current, imageKey: key };
    await siteSettingsDb.setDiscoverBanner(c, next, payload.userId);
    if (current.imageKey && current.imageKey !== key) {
      await r2Storage.delete(c, current.imageKey).catch(() => false);
    }
    return { success: true, banner: toPublicBanner(c, next) };
  }
}
