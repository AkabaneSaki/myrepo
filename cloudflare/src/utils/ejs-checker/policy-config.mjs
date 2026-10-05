export const CHECK_POLICY_VERSION = 'PW-CODE-POLICY-2026-10-05.1';
export const trustedAssetHosts = Object.freeze(['files.catbox.moe', 'i.ibb.co']);
const MEDIA_EXTENSIONS = /\.(?:png|jpe?g|webp|gif|avif|apng|bmp|ico|mp4|webm|mov|m4v|ogv)$/i;

export function trustedStaticMediaUrl(value, usage) {
  if (usage !== 'media' || typeof value !== 'string' || /\$\d+|\$<[^>]+>|\$\{/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      && trustedAssetHosts.includes(url.hostname.toLowerCase()) && MEDIA_EXTENSIONS.test(url.pathname);
  } catch { return false; }
}
