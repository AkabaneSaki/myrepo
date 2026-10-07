// Single source of truth for external-link normalization, classification and
// trust decisions.
//
// This module is deliberately dependency-free (no config import, no I/O) so the
// same rules can run in three very different places:
//   - the Worker endpoints (TypeScript),
//   - the EJS/Regex checker modules (.mjs, which are also bundled into the
//     offline browser checker by esbuild),
//   - the plain Node tests.
//
// The allowed Discord guild ids are passed in by the caller instead of being
// read from config here, because the browser bundle must not pull in
// config/workshop.json. `config/workshop.json` stays the single source of truth
// for that value; only the way it reaches this module differs per consumer.

/** Hosts that may serve statically proven media without human review. */
export const TRUSTED_MEDIA_HOSTS = Object.freeze(['files.catbox.moe', 'i.ibb.co']);

/** Discord hosts accepted for a project community thread. */
export const DISCORD_HOSTS = Object.freeze(['discord.com', 'www.discord.com']);

/** Discord snowflakes are 17-20 digits. */
export const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;

const MEDIA_EXTENSIONS =
  /\.(?:png|jpe?g|webp|gif|avif|apng|bmp|ico|mp4|webm|mov|m4v|ogv)$/i;

/** How a URL is used. Drives which trust rules apply. */
export const LINK_USAGE = Object.freeze({
  MEDIA: 'media',
  NAVIGATION: 'navigation',
  NETWORK: 'network',
  RESOURCE: 'resource',
  UNKNOWN: 'unknown',
});

/** Why a link is (or is not) trusted. Surfaced to the auditor. */
export const LINK_TRUST = Object.freeze({
  TRUSTED: 'trusted',
  UNTRUSTED: 'untrusted',
  UNKNOWN: 'unknown',
});

/** Where a link was found. */
export const LINK_SOURCE = Object.freeze({
  DESCRIPTION: 'description',
  PRECAUTIONS: 'precautions',
  DISCORD_THREAD: 'discordThreadUrl',
  WORLDBOOK: 'worldbook',
  REGEX: 'regex',
  CHARINFO_MEDIA: 'charInfoMedia',
  EJS: 'ejs',
});

const DYNAMIC_URL_PATTERN = /\$\d+|\$<[^>]+>|\$\{|\$[&`']|<%/;

/** A value the checker could not reduce to one static URL. */
export function isDynamicUrlCandidate(value) {
  return DYNAMIC_URL_PATTERN.test(String(value ?? ''));
}

/**
 * Parse a URL the way every consumer must agree on.
 *
 * Returns null for anything that is not a plain credential-free http(s) URL.
 */
export function normalizeExternalLinkUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 4096) return null;
  if (isDynamicUrlCandidate(raw)) return null;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  if (url.username || url.password) return null;

  return url;
}

/** True when the host is a bare IP address rather than a domain name. */
export function isIpHost(hostname) {
  const host = String(hostname ?? '').toLowerCase();
  if (!host) return false;
  return host.includes(':') || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
}

/** Trim the trailing punctuation a prose sentence leaves on a bare URL. */
export function trimTrailingUrlPunctuation(value) {
  let candidate = String(value).replace(/[.,;:!?，。；：！？、]+$/u, '');
  const pairs = [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ];

  const countOf = (text, character) => {
    let count = 0;
    for (const current of text) if (current === character) count += 1;
    return count;
  };

  for (const [open, close] of pairs) {
    while (
      candidate.endsWith(close) &&
      countOf(candidate, close) > countOf(candidate, open)
    ) {
      candidate = candidate.slice(0, -1);
    }
  }

  return candidate;
}

/**
 * Trust decision for a single, already-normalized URL.
 *
 * `usage` matters: a trusted media host is only trusted when the link is
 * actually used as media, never when the user is navigated to it.
 */
export function classifyExternalLink(normalized, usage = LINK_USAGE.UNKNOWN) {
  const url = normalized instanceof URL ? normalized : normalizeExternalLinkUrl(normalized);
  if (!url) {
    return {
      trust: LINK_TRUST.UNKNOWN,
      reason: 'not-a-plain-http-url',
    };
  }

  const hostname = url.hostname.toLowerCase();

  if (isIpHost(hostname)) {
    return { trust: LINK_TRUST.UNTRUSTED, reason: 'ip-host' };
  }

  if (url.protocol === 'http:') {
    return { trust: LINK_TRUST.UNTRUSTED, reason: 'insecure-http' };
  }

  if (usage === LINK_USAGE.MEDIA && TRUSTED_MEDIA_HOSTS.includes(hostname)) {
    if (!MEDIA_EXTENSIONS.test(url.pathname)) {
      return { trust: LINK_TRUST.UNTRUSTED, reason: 'media-host-without-media-extension' };
    }
    return { trust: LINK_TRUST.TRUSTED, reason: 'trusted-media-host' };
  }

  return { trust: LINK_TRUST.UNTRUSTED, reason: 'unlisted-host' };
}

/** Convenience wrapper: normalize then classify in one step. */
export function inspectExternalLink(value, usage = LINK_USAGE.UNKNOWN) {
  const url = normalizeExternalLinkUrl(value);
  const decision = classifyExternalLink(url, usage);
  return {
    url: url ? url.href : null,
    hostname: url ? url.hostname.toLowerCase() : null,
    ...decision,
  };
}

/** True when a static media URL may be used without human review. */
export function isTrustedStaticMediaUrl(value) {
  return inspectExternalLink(value, LINK_USAGE.MEDIA).trust === LINK_TRUST.TRUSTED;
}

/**
 * Trust decision for a set of dynamic media candidates.
 *
 * The warning is only suppressed when every statically discoverable candidate
 * is trusted. An empty set, or any single untrusted/unknown member, keeps the
 * warning, because a trusted URL appearing somewhere does not prove it is the
 * value that will actually be loaded.
 */
export function classifyDynamicMediaCandidates(candidates) {
  const values = Array.isArray(candidates) ? candidates : [];
  if (values.length === 0) {
    return { trust: LINK_TRUST.UNKNOWN, reason: 'no-candidates' };
  }

  for (const candidate of values) {
    const decision = inspectExternalLink(candidate, LINK_USAGE.MEDIA);
    if (decision.trust !== LINK_TRUST.TRUSTED) {
      return { trust: decision.trust, reason: `candidate-not-trusted:${candidate}` };
    }
  }

  return { trust: LINK_TRUST.TRUSTED, reason: 'all-candidates-trusted' };
}

/**
 * Validate a project community Discord thread URL.
 *
 * Shared with the project field validator so the generic external-link checker
 * does not re-report an already-accepted thread as an unknown link. Invites,
 * message links, other guilds, non-HTTPS and credentials are all rejected.
 */
export function normalizeProjectDiscordThreadUrl(value, allowedGuildIds = []) {
  const raw = String(value ?? '').trim();
  if (!raw) return { ok: true, value: null, reason: 'empty' };

  const url = normalizeExternalLinkUrl(raw);
  if (!url) {
    return { ok: false, value: null, reason: 'invalid-url' };
  }

  if (url.protocol !== 'https:' || !DISCORD_HOSTS.includes(url.hostname.toLowerCase())) {
    return { ok: false, value: null, reason: 'not-https-discord-host' };
  }

  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 3 || parts[0] !== 'channels') {
    return { ok: false, value: null, reason: 'not-a-thread-url' };
  }

  const [, guildId, threadId] = parts;
  if (
    !DISCORD_SNOWFLAKE_PATTERN.test(guildId) ||
    !DISCORD_SNOWFLAKE_PATTERN.test(threadId)
  ) {
    return { ok: false, value: null, reason: 'invalid-snowflake' };
  }

  if (!allowedGuildIds.includes(guildId)) {
    return { ok: false, value: null, reason: 'guild-not-allowed' };
  }

  return {
    ok: true,
    value: `https://discord.com/channels/${guildId}/${threadId}`,
    reason: 'validated-project-thread',
  };
}
