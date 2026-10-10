export const CHECK_POLICY_VERSION = 'PW-CODE-POLICY-2026-10-10.1';
import { isTrustedStaticMediaUrl } from '../external-links/policy.mjs';
export { TRUSTED_MEDIA_HOSTS as trustedAssetHosts } from '../external-links/policy.mjs';
export const CHARINFO_MANAGED_BLOCK_START = '<%# char-info-ejs-builder:start:v2 %>';
export const CHARINFO_MANAGED_BLOCK_END = '<%# char-info-ejs-builder:end:v2 %>';

export function trustedStaticMediaUrl(value, usage) {
  return usage === 'media' && isTrustedStaticMediaUrl(value);
}

function countOccurrences(content, target) {
  if (!target) return 0;
  let count = 0;
  let offset = 0;
  while ((offset = content.indexOf(target, offset)) !== -1) {
    count += 1;
    offset += target.length;
  }
  return count;
}

function readJsonObjectAfterAssignment(block, assignment) {
  if (countOccurrences(block, assignment) !== 1) return null;
  let cursor = block.indexOf(assignment) + assignment.length;
  while (cursor < block.length && /\s/.test(block[cursor])) cursor += 1;
  if (block[cursor] !== '{') return null;

  const start = cursor;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (; cursor < block.length; cursor += 1) {
    const character = block[cursor];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(block.slice(start, cursor + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function normalizeProfileMediaUrls(profile) {
  const values = [];
  const add = value => {
    if (typeof value !== 'string' || !value.trim()) return;
    try {
      const url = new URL(value.trim());
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return;
      if (!values.includes(url.href)) values.push(url.href);
    } catch {
      // Invalid URLs remain untrusted and are handled by the normal checker path.
    }
  };

  add(profile?.avatarUrl);
  add(profile?.coverUrl);
  for (const image of Array.isArray(profile?.gallery) ? profile.gallery : []) {
    if (!image || typeof image !== 'object' || Array.isArray(image)) continue;
    for (const source of Array.isArray(image.sources) ? image.sources : []) add(source);
    add(image.thumbnail);
  }
  return values;
}

function managedBlockLooksLikeCharInfoV2(block) {
  return block.startsWith(CHARINFO_MANAGED_BLOCK_START)
    && block.endsWith(CHARINFO_MANAGED_BLOCK_END)
    && block.includes('const npcName = profile.characterName;')
    && block.includes('setLocalVar(`char_info.profiles[')
    && block.includes('gallery: profile.gallery.map(image =>')
    && block.includes('status.externalAvatars.partners')
    && block.includes('status.externalGalleries.partners');
}

export function inspectCharInfoManagedV2Block(source, index = -1) {
  const text = String(source || '');
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf(CHARINFO_MANAGED_BLOCK_START, cursor);
    if (start < 0) return null;
    const endMarker = text.indexOf(CHARINFO_MANAGED_BLOCK_END, start + CHARINFO_MANAGED_BLOCK_START.length);
    if (endMarker < 0) return null;
    const end = endMarker + CHARINFO_MANAGED_BLOCK_END.length;
    if (index < 0 || (index >= start && index < end)) {
      const block = text.slice(start, end);
      if (!managedBlockLooksLikeCharInfoV2(block)) return null;
      const profile = readJsonObjectAfterAssignment(block, 'const profile =');
      if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return null;
      if (typeof profile.characterName !== 'string' || !Array.isArray(profile.gallery)) return null;
      return {
        start,
        end,
        profile,
        mediaUrls: normalizeProfileMediaUrls(profile),
      };
    }
    cursor = end;
  }
  return null;
}

export function trustedCharInfoManagedMediaBlock(source, index) {
  const block = inspectCharInfoManagedV2Block(source, index);
  return Boolean(block && block.mediaUrls.length > 0 && block.mediaUrls.every(url => trustedStaticMediaUrl(url, 'media')));
}
