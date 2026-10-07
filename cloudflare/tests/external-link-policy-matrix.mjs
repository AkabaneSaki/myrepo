// #23 matrix test: one external-link policy, exercised across every source the
// product collects from, and across the trust decisions the Audit Center makes.
//
// A normalized URL has one identity; each observation retains its source and
// usage, so media trust cannot wash away prose or navigation warnings.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeProjectCodeV2 } from '../src/utils/ejs-checker/index.mjs';
import {
  collectProjectExternalLinks,
  externalLinksNeedingReview,
  groupExternalLinksByHostname,
  trustedExternalLinks,
} from '../src/utils/external-links/collect.mjs';
import {
  LINK_SOURCE,
  LINK_TRUST,
  LINK_USAGE,
  classifyDynamicMediaCandidates,
  inspectExternalLink,
  normalizeProjectDiscordThreadUrl,
} from '../src/utils/external-links/policy.mjs';
import { inspectCharInfoManagedV2Block, trustedAssetHosts } from '../src/utils/ejs-checker/policy-config.mjs';

const workshopConfig = JSON.parse(
  readFileSync(new URL('../../config/workshop.json', import.meta.url), 'utf8'),
);
const ALLOWED_GUILDS = workshopConfig.projectCommunity?.discordGuildIds ?? [];
const [ALLOWED_GUILD] = ALLOWED_GUILDS;
const OTHER_GUILD = '1200000000000000000';

let count = 0;
const check = (source, type = 'worldbook') =>
  analyzeProjectCodeV2([
    {
      fileName: 'matrix.json',
      type,
      text: JSON.stringify(
        type === 'regex'
          ? { id: 's', scriptName: 'media', findRegex: 'x', replaceString: source }
          : { entries: { 1: { uid: 1, comment: 'media', content: source } } },
      ),
    },
  ]);
const ejs = source => check(`@@private\n<% { ${source} } %>`);
const rules = report => report.findings.map(finding => finding.ruleId);
const mediaAh2 = report =>
  report.findings.filter(finding => finding.ruleId === 'AH2' && finding.riskEvidence?.usage === 'media');

// ---------------------------------------------------------------- policy unit

// Normalization rejects anything that is not a plain credential-free http(s) URL.
for (const value of [
  'javascript:alert(1)',
  'data:text/html,<h1>x</h1>',
  'ftp://example.com/a.png',
  'https://user:pass@example.com/a.png',
  '',
  null,
  undefined,
]) {
  assert.equal(inspectExternalLink(value, LINK_USAGE.MEDIA).trust, LINK_TRUST.UNKNOWN, String(value));
  count++;
}

// Classification is usage-sensitive: a trusted media host is only trusted as media.
assert.equal(inspectExternalLink('https://files.catbox.moe/a.png', LINK_USAGE.MEDIA).trust, LINK_TRUST.TRUSTED);
assert.equal(inspectExternalLink('https://files.catbox.moe/a.png', LINK_USAGE.NAVIGATION).trust, LINK_TRUST.UNTRUSTED);
count += 2;

// Rejected shapes that must never be trusted.
for (const value of [
  'http://files.catbox.moe/a.png',        // insecure
  'https://sub.files.catbox.moe/a.png',   // subdomain is not the host
  'https://files.catbox.moe.evil.org/a.png', // suffix attack
  'https://files.catbox.moe/a.js',        // not a media extension
  'https://files.catbox.moe/',            // no media path
]) {
  assert.notEqual(inspectExternalLink(value, LINK_USAGE.MEDIA).trust, LINK_TRUST.TRUSTED, value);
  count++;
}
assert.deepEqual([...trustedAssetHosts], ['files.catbox.moe', 'i.ibb.co']);
count++;

// Dynamic candidate sets: all-trusted suppresses, anything else keeps the warning.
assert.equal(classifyDynamicMediaCandidates(['https://files.catbox.moe/a.png', 'https://i.ibb.co/b.webp']).trust, LINK_TRUST.TRUSTED);
assert.notEqual(classifyDynamicMediaCandidates(['https://files.catbox.moe/a.png', 'https://evil.example/b.png']).trust, LINK_TRUST.TRUSTED);
assert.equal(classifyDynamicMediaCandidates([]).trust, LINK_TRUST.UNKNOWN);
count += 3;

// ---------------------------------------------------------------- Discord

// The project field validator is the authority on the guild rule.
const threadUrl = `https://discord.com/channels/${ALLOWED_GUILD}/${ALLOWED_GUILD}1`;
assert.equal(normalizeProjectDiscordThreadUrl(threadUrl, ALLOWED_GUILDS).ok, true);
assert.equal(normalizeProjectDiscordThreadUrl(threadUrl, [OTHER_GUILD]).ok, false, 'wrong guild must be rejected');
assert.equal(normalizeProjectDiscordThreadUrl(`https://discord.com/channels/${OTHER_GUILD}/${OTHER_GUILD}1`, ALLOWED_GUILDS).ok, false);
assert.equal(normalizeProjectDiscordThreadUrl('https://discord.gg/abc123', ALLOWED_GUILDS).ok, false, 'invite link');
assert.equal(normalizeProjectDiscordThreadUrl(`https://discord.com/channels/${ALLOWED_GUILD}/${ALLOWED_GUILD}1/9`, ALLOWED_GUILDS).ok, false, 'message link');
assert.equal(normalizeProjectDiscordThreadUrl(`http://discord.com/channels/${ALLOWED_GUILD}/${ALLOWED_GUILD}1`, ALLOWED_GUILDS).ok, false, 'http');
assert.equal(normalizeProjectDiscordThreadUrl(`https://example.com/channels/${ALLOWED_GUILD}/${ALLOWED_GUILD}1`, ALLOWED_GUILDS).ok, false, 'other host');
count += 7;

// Only the dedicated project field is exempt, and only because the validator
// above already confirmed the configured guild. A thread URL appearing inside
// arbitrary EJS / worldbook / regex content has no such provenance, so it stays
// an ordinary unverified link. Trusting it here would let a creator route users
// to a foreign server without the auditor ever seeing it.
assert.ok(rules(ejs(`const link = "${threadUrl}";`)).includes('U2'), 'a thread URL in EJS content is not exempt');
assert.ok(rules(ejs(`const link = "${threadUrl}";`)).includes('U2'), 'also for the configured guild shape');
assert.ok(
  rules(check(`see https://discord.com/channels/${ALLOWED_GUILD}/${ALLOWED_GUILD}1 for details`, 'worldbook')).includes('U2'),
  'a thread URL in worldbook text is not exempt',
);
count += 3;

// Invites, message links and other hosts are U2 in content too.
assert.ok(rules(ejs('const link = "https://discord.gg/abc123";')).includes('U2'));
assert.ok(rules(ejs(`const link = "https://discord.com/channels/${ALLOWED_GUILD}/${ALLOWED_GUILD}1/42";`)).includes('U2'));
count += 2;

// ---------------------------------------------------------------- matrix across sources

const TRUSTED_PNG = 'https://files.catbox.moe/album/portrait.png';
const TRUSTED_WEBP = 'https://i.ibb.co/album/cover.webp';
const UNTRUSTED = 'https://unknown-host.example/asset.png';

const collectorCases = [
  {
    label: 'description',
    input: { description: `see ${TRUSTED_PNG} and ${UNTRUSTED}` },
    expect: { [LINK_SOURCE.DESCRIPTION]: [TRUSTED_PNG, UNTRUSTED] },
  },
  {
    label: 'precautions',
    input: { precautions: `backup at ${TRUSTED_WEBP}` },
    expect: { [LINK_SOURCE.PRECAUTIONS]: [TRUSTED_WEBP] },
  },
  {
    label: 'discord thread field',
    input: { discordThreadUrl: threadUrl, allowedGuildIds: ALLOWED_GUILDS },
    expect: { [LINK_SOURCE.DISCORD_THREAD]: [threadUrl] },
  },
  {
    label: 'worldbook',
    input: { worldbookEntries: [{ content: `asset ${UNTRUSTED}` }] },
    expect: { [LINK_SOURCE.WORLDBOOK]: [UNTRUSTED] },
  },
  {
    label: 'regex',
    input: { regexEntries: [{ replaceString: `image ${TRUSTED_PNG}` }] },
    expect: { [LINK_SOURCE.REGEX]: [TRUSTED_PNG] },
  },
];

for (const testCase of collectorCases) {
  const records = collectProjectExternalLinks({ allowedGuildIds: ALLOWED_GUILDS, ...testCase.input });
  for (const [source, expectedUrls] of Object.entries(testCase.expect)) {
    const actual = records.filter(record => record.sources.includes(source)).map(record => record.url);
    assert.deepEqual(actual, expectedUrls, `${testCase.label}: ${JSON.stringify(records)}`);
  }
  count += Object.keys(testCase.expect).length;
}

// ---------------------------------------------------------------- #23 final edge case
//
// A thread URL that already passed the dedicated project field validator must not
// come back as an untrusted description/precautions record for the same
// normalized URL. These are one link, not two.
{
  const reviewUrls = input => externalLinksNeedingReview(
    collectProjectExternalLinks({ allowedGuildIds: ALLOWED_GUILDS, ...input }),
  ).map(record => record.url);

  // 1. same validated thread in description + project field
  const inDescription = reviewUrls({ description: `加入讨论：${threadUrl}`, discordThreadUrl: threadUrl });
  assert.equal(inDescription.includes(threadUrl), false, `description duplicate: ${JSON.stringify(inDescription)}`);

  // 2. same validated thread in precautions + project field
  const inPrecautions = reviewUrls({ precautions: `反馈请到 ${threadUrl}`, discordThreadUrl: threadUrl });
  assert.equal(inPrecautions.includes(threadUrl), false, `precautions duplicate: ${JSON.stringify(inPrecautions)}`);

  // 3. both, plus the project field: one consistent classification, no noise
  const bothRecords = collectProjectExternalLinks({
    description: `加入讨论：${threadUrl}`,
    precautions: `也在这里 ${threadUrl}`,
    discordThreadUrl: threadUrl,
    allowedGuildIds: ALLOWED_GUILDS,
  });
  const threadRecords = bothRecords.filter(record => record.url === threadUrl);
  assert.equal(threadRecords.length, 1, `contradictory duplicate pair: ${JSON.stringify(bothRecords)}`);
  const threadRecord = threadRecords[0];
  assert.ok(
    threadRecord.observations.some(observation => observation.authoritative && observation.trust === LINK_TRUST.TRUSTED),
    `missing authoritative observation: ${JSON.stringify(threadRecord.observations)}`,
  );
  assert.ok(
    threadRecord.observations.some(observation => observation.source === LINK_SOURCE.DESCRIPTION),
    'the description sighting must still be recorded',
  );
  assert.deepEqual([...threadRecord.sources].sort(), [
    LINK_SOURCE.DESCRIPTION,
    LINK_SOURCE.DISCORD_THREAD,
    LINK_SOURCE.PRECAUTIONS,
  ].sort(), 'every sighting must be preserved as source metadata');
  assert.equal(externalLinksNeedingReview(bothRecords).length, 0, JSON.stringify(externalLinksNeedingReview(bothRecords)));
  count += 4;

  // 4/5/6. the same shapes in description are still reviewed when the project
  // field never validated them.
  const wrongGuild = `https://discord.com/channels/${OTHER_GUILD}/${OTHER_GUILD}1`;
  for (const url of [
    wrongGuild,
    'https://discord.gg/abc123',
    `https://discord.com/channels/${ALLOWED_GUILD}/${ALLOWED_GUILD}1/42`,
  ]) {
    const urls = reviewUrls({ description: `see ${url}` });
    assert.ok(urls.includes(url), `${url} must still need review: ${JSON.stringify(urls)}`);
    count++;
  }

  // A project field that is present but invalid must not lend trust to anything.
  const withBadField = reviewUrls({
    description: `see ${wrongGuild}`,
    discordThreadUrl: wrongGuild,
    allowedGuildIds: ALLOWED_GUILDS,
  });
  assert.ok(withBadField.includes(wrongGuild), `rejected project field must not trust its copy: ${JSON.stringify(withBadField)}`);
  count++;
}

// 7. a Discord thread URL inside content stays U2 and must not inherit trust from
// an unrelated, genuinely validated project thread.
{
  const otherThread = `https://discord.com/channels/${OTHER_GUILD}/${OTHER_GUILD}2`;
  const records = collectProjectExternalLinks({
    discordThreadUrl: threadUrl,
    allowedGuildIds: ALLOWED_GUILDS,
    worldbookEntries: [{ content: `join ${otherThread}` }],
    regexEntries: [{ replaceString: `or ${otherThread}` }],
  });
  const review = externalLinksNeedingReview(records).map(record => record.url);
  assert.ok(review.includes(otherThread), `content thread must be reviewed: ${JSON.stringify(review)}`);
  assert.equal(review.includes(threadUrl), false, 'the validated field thread stays trusted');
  assert.equal(records.filter(record => record.url === otherThread).every(record => record.trust !== LINK_TRUST.TRUSTED), true);

  assert.ok(rules(check(`const link = "${otherThread}";`, 'worldbook')).includes('U2'), 'worldbook content thread must be U2');
  assert.ok(rules(check(`replace ${otherThread} here`, 'regex')).includes('U2'), 'regex content thread must be U2');
  count += 5;
}

// 8. no trusted/untrusted contradictory pair for one normalized URL, across a
// case where the same asset is a proven media value and also mentioned in prose.
// 8. no trusted/untrusted contradictory pair for one normalized URL, across a
// case where the same asset is a proven media value and also mentioned in prose.
// (Asserted after charInfoBlock / TRUSTED_GALLERY are defined below.)

// Trusted links stay out of the review set; untrusted ones stay in.
const mixedRecords = collectProjectExternalLinks({
  description: `intro ${TRUSTED_PNG} plus ${UNTRUSTED}`,
  precautions: `note ${TRUSTED_WEBP}`,
  discordThreadUrl: threadUrl,
  allowedGuildIds: ALLOWED_GUILDS,
  regexEntries: [{ replaceString: `more ${UNTRUSTED}` }],
});
// Trust is scoped to what we can actually prove. A trusted media host reached
// through prose has unknown usage, so it is NOT auto-trusted: only proven media
// usage and the validated Discord thread clear the review set.
const reviewUrls = externalLinksNeedingReview(mixedRecords).map(record => record.url);
assert.ok(reviewUrls.includes(UNTRUSTED));
assert.ok(reviewUrls.includes(TRUSTED_PNG), 'prose usage is unknown, so a media host is not auto-trusted');
assert.ok(reviewUrls.includes(TRUSTED_WEBP));
assert.equal(reviewUrls.includes(threadUrl), false, 'a validated thread is a trusted community link');
assert.deepEqual(trustedExternalLinks(mixedRecords).map(record => record.source), [LINK_SOURCE.DISCORD_THREAD]);
count += 5;

// The wrong-guild thread must not be reported as trusted.
const badGuild = collectProjectExternalLinks({
  discordThreadUrl: `https://discord.com/channels/${OTHER_GUILD}/${OTHER_GUILD}1`,
  allowedGuildIds: ALLOWED_GUILDS,
});
assert.equal(badGuild.length, 0, JSON.stringify(badGuild));
count++;

// Grouping is a pure view over the same records, so the detail panel cannot drift.
const grouped = groupExternalLinksByHostname(mixedRecords);
assert.ok(grouped.length > 0);
assert.ok(grouped.some(group => group.hostname === 'files.catbox.moe'));
count += 2;

// ---------------------------------------------------------------- CharInfo media

function charInfoBlock(mediaUrls) {
  const profile = {
    characterName: 'Test',
    avatarUrl: 'https://files.catbox.moe/avatar.png',
    coverUrl: 'https://i.ibb.co/demo/cover.webp',
    raceColor: '#A9DBC3',
    tierColor: '#B7D9E8',
    entranceQuote: '',
    gallery: [{ title: '主立绘', sources: mediaUrls }],
  };
  return [
    '<%# char-info-ejs-builder:start:v2 %>',
    '<%_',
    '{',
    '  const profile = ' + JSON.stringify(profile, null, 2) + ';',
    '  const npcName = profile.characterName;',
    '  const statusGalleryExtensions = [".png", ".jpg", ".jpeg", ".webp", ".avif"];',
    '  const statusGalleryImages = profile.gallery.flatMap(image => {',
    '    const candidates = [...image.sources, ...(image.thumbnail ? [image.thumbnail] : [])];',
    '    const url = candidates.find(value => {',
    '      try {',
    '        const pathname = new URL(value).pathname.toLowerCase();',
    '        return statusGalleryExtensions.some(extension => pathname.endsWith(extension));',
    '      } catch { return false; }',
    '    }) ?? "";',
    '    return url ? [{ title: image.title, url }] : [];',
    '  });',
    '  setLocalVar(`char_info.profiles[${JSON.stringify(npcName)}]`, {',
    '    schema_version: 2,',
    '    ...(profile.coverUrl ? { cover_url: profile.coverUrl } : {}),',
    '    gallery: profile.gallery.map(image => ({ title: image.title, sources: image.sources, ...(image.thumbnail ? { thumbnail: image.thumbnail } : {}) })),',
    '  });',
    '  if (profile.avatarUrl) {',
    '    setLocalVar(`status.externalAvatars.partners[${JSON.stringify(npcName)}].url`, profile.avatarUrl);',
    '  }',
    '  setLocalVar(`status.externalGalleries.partners[${JSON.stringify(npcName)}].images`, statusGalleryImages);',
    '}',
    '_%>',
    '<%# char-info-ejs-builder:end:v2 %>',
  ].join('\n');
}

const TRUSTED_GALLERY = 'https://i.ibb.co/YTpkjhVt/file-00000000e0bc81fda16e63b1a9c1ba24.png';
const trustedBlock = charInfoBlock([TRUSTED_GALLERY]);

// 8. one URL identity, two observations with different usage. The CharInfo MEDIA
// sighting is trusted, but the description sighting is unknown-usage and must
// still need review. This is the P1 rule: trust is not lifted across usages.
{
  const records = collectProjectExternalLinks({
    description: `cover ${TRUSTED_GALLERY}`,
    worldbookEntries: [{ content: trustedBlock }],
  });
  const gallery = records.filter(record => record.url === TRUSTED_GALLERY);
  assert.equal(gallery.length, 1, `duplicated identity: ${JSON.stringify(records)}`);

  const media = gallery[0].observations.find(item => item.source === LINK_SOURCE.CHARINFO_MEDIA);
  assert.equal(media?.trust, LINK_TRUST.TRUSTED, JSON.stringify(gallery[0].observations));
  assert.equal(media?.usage, LINK_USAGE.MEDIA);

  const prose = gallery[0].observations.find(item => item.source === LINK_SOURCE.DESCRIPTION);
  assert.ok(prose, `description observation lost: ${JSON.stringify(gallery[0].observations)}`);
  assert.equal(prose.usage, LINK_USAGE.UNKNOWN);
  assert.notEqual(prose.trust, LINK_TRUST.TRUSTED, 'the media sighting must not launder the prose sighting');

  const review = externalLinksNeedingReview(records);
  assert.equal(review.length, 1, `expected the description sighting to need review: ${JSON.stringify(review)}`);
  assert.equal(review[0].url, TRUSTED_GALLERY);
  assert.ok(review[0].reviewSources.includes(LINK_SOURCE.DESCRIPTION));

  // Only the media-only case stays fully clean.
  const mediaOnly = collectProjectExternalLinks({ worldbookEntries: [{ content: trustedBlock }] });
  assert.equal(externalLinksNeedingReview(mediaOnly).length, 0, JSON.stringify(externalLinksNeedingReview(mediaOnly)));
  count += 10;
}

// A trusted CharInfo media block produces no yellow audit signal at all.
const trustedReport = check(trustedBlock);
assert.equal(mediaAh2(trustedReport).length, 0, JSON.stringify(trustedReport.findings));
assert.equal(rules(trustedReport).some(rule => ['U2', 'U3', 'U4', 'U5'].includes(rule)), false, JSON.stringify(trustedReport.findings));
count += 2;

// The collector sees the same trusted media through the shared policy.
const charInfoRecords = collectProjectExternalLinks({
  worldbookEntries: [{ content: trustedBlock }],
});
const charInfoMediaObservations = charInfoRecords.flatMap(record =>
  record.observations.filter(observation => observation.source === LINK_SOURCE.CHARINFO_MEDIA),
);
assert.ok(charInfoMediaObservations.length > 0, JSON.stringify(charInfoRecords));
assert.ok(
  charInfoMediaObservations.every(observation => observation.trust === LINK_TRUST.TRUSTED),
  JSON.stringify(charInfoMediaObservations),
);
// The same URLs must not reappear as generic worldbook prose.
assert.deepEqual(
  charInfoRecords.flatMap(record => record.observations)
    .filter(observation => observation.source === LINK_SOURCE.WORLDBOOK)
    .map(observation => observation.url),
  [],
  `CharInfo media re-entered as worldbook prose: ${JSON.stringify(charInfoRecords)}`,
);
assert.equal(externalLinksNeedingReview(charInfoRecords).length, 0, JSON.stringify(externalLinksNeedingReview(charInfoRecords)));
count += 3;

// A mixed gallery keeps the warning.
const mixedBlock = charInfoBlock([TRUSTED_GALLERY, 'https://untrusted.example/portrait.png']);
const mixedReport = check(mixedBlock);
assert.ok(mediaAh2(mixedReport).length > 0, JSON.stringify(mixedReport.findings));
count++;

// A target whose own provable values are all trusted media is still clean. This
// is NOT the entry-wide scrape: `urls[mood]` reduces to its own literal values,
// so the checker can actually prove what will be loaded.
{
  const source = 'const urls = {one:"https://files.catbox.moe/a.png",two:"https://files.catbox.moe/b.png"}; image.src = urls[mood];';
  const report = ejs(source);
  assert.equal(mediaAh2(report).length, 0, JSON.stringify(report.findings));
  assert.equal(report.audit, 'green', JSON.stringify(report.findings));
  count += 2;
}

// The same trusted values as bare, unrelated constants prove nothing about a
// runtime target, so they must not launder it.
for (const source of [
  'const fallback="https://files.catbox.moe/fallback.png"; const profile={avatarUrl:runtimeTarget};',
  'const one="https://files.catbox.moe/a.png"; const two="https://i.ibb.co/b.webp"; const profile={avatarUrl:runtimeTarget};',
]) {
  const report = ejs(source);
  assert.ok(mediaAh2(report).length > 0, `${source} -> ${JSON.stringify(report.findings)}`);
  count++;
}

// Undeterminable target keeps AH2.
assert.equal(mediaAh2(ejs('const profile={avatarUrl:runtimeTarget};')).length, 1);
assert.equal(mediaAh2(ejs('const img=document.createElement("img"); img.src=runtimeTarget;')).length, 1);
count += 2;

// Code injected into a trusted block must not inherit the block's trust.
const injected = trustedBlock.replace(
  '\n}\n_%>',
  '\n  const injectedImage = document.createElement("img");\n  injectedImage.src = runtimeTarget;\n}\n_%>',
);
const injectedReport = check(injected);
assert.ok(
  injectedReport.findings.some(
    finding =>
      finding.ruleId === 'AH2' &&
      finding.riskEvidence?.usage === 'media' &&
      String(finding.riskEvidence?.expression || '').includes('runtimeTarget'),
  ),
  JSON.stringify(injectedReport.findings),
);
count++;

// P1-3 regression: the checker stays quiet about trusted CharInfo media, so the
// server-side collector must not put the same URL back into the review set as an
// unknown worldbook link. This is the gap that would have re-created the exact
// audit noise #23 set out to remove.
{
  const records = collectProjectExternalLinks({ worldbookEntries: [{ content: trustedBlock }] });
  const trustedMedia = trustedExternalLinks(records).map(record => record.url);
  assert.ok(trustedMedia.length > 0, JSON.stringify(records));
  const reviewSet = externalLinksNeedingReview(records);
  assert.deepEqual(reviewSet, [], `trusted CharInfo media leaked into the review set: ${JSON.stringify(reviewSet)}`);
  // The URL must be present exactly once, as proven media, not twice.
  const occurrences = records.filter(record => record.url === TRUSTED_GALLERY);
  assert.equal(occurrences.length, 1, `duplicated record: ${JSON.stringify(occurrences)}`);
  assert.deepEqual(
    occurrences[0].observations.map(observation => [observation.source, observation.usage, observation.trust]),
    [[LINK_SOURCE.CHARINFO_MEDIA, LINK_USAGE.MEDIA, LINK_TRUST.TRUSTED]],
    `unexpected observations: ${JSON.stringify(occurrences[0].observations)}`,
  );
  count += 4;
}

// ---------------------------------------------------------------- P1 observation cases
{
  const review = input => externalLinksNeedingReview(
    collectProjectExternalLinks({ allowedGuildIds: ALLOWED_GUILDS, ...input }),
  );
  const observationsFor = (input, url) => collectProjectExternalLinks(
    { allowedGuildIds: ALLOWED_GUILDS, ...input },
  ).find(record => record.url === url)?.observations ?? [];

  // 1. CharInfo trusted media only -> no review.
  const mediaOnly = review({ worldbookEntries: [{ content: trustedBlock }] });
  assert.deepEqual(mediaOnly, [], JSON.stringify(mediaOnly));

  // 2. + description: media trusted, description observation still unresolved.
  const withDescription = { worldbookEntries: [{ content: trustedBlock }], description: `cover ${TRUSTED_GALLERY}` };
  const descObservations = observationsFor(withDescription, TRUSTED_GALLERY);
  assert.equal(descObservations.find(item => item.source === LINK_SOURCE.CHARINFO_MEDIA)?.trust, LINK_TRUST.TRUSTED);
  const descProse = descObservations.find(item => item.source === LINK_SOURCE.DESCRIPTION);
  assert.ok(descProse, JSON.stringify(descObservations));
  assert.notEqual(descProse.trust, LINK_TRUST.TRUSTED);
  assert.equal(review(withDescription).length, 1, 'the prose sighting must still need review');

  // 3. + precautions: same rule.
  const withPrecautions = { worldbookEntries: [{ content: trustedBlock }], precautions: `cover ${TRUSTED_GALLERY}` };
  const precProse = observationsFor(withPrecautions, TRUSTED_GALLERY)
    .find(item => item.source === LINK_SOURCE.PRECAUTIONS);
  assert.ok(precProse, 'precautions sighting lost');
  assert.notEqual(precProse.trust, LINK_TRUST.TRUSTED);
  assert.equal(review(withPrecautions).length, 1);

  // 4. ordinary worldbook prose outside managed media usage is not laundered.
  const withProse = review({
    worldbookEntries: [{ content: `${trustedBlock}\nsee also ${TRUSTED_GALLERY} for details` }],
  });
  assert.equal(withProse.length, 1, `worldbook prose must not be laundered: ${JSON.stringify(withProse)}`);
  assert.equal(withProse[0].url, TRUSTED_GALLERY);
  count += 9;

  // 5/6. a validated project thread still removes its description/precautions
  // duplicates, because that is an identity proof, not a usage proof.
  for (const field of ['description', 'precautions']) {
    const input = { [field]: threadUrl, discordThreadUrl: threadUrl };
    assert.deepEqual(review(input), [], `${field} duplicate must not need review`);
  }
  count += 2;

  // 7. wrong guild / invite / message in prose are still reviewed.
  for (const url of [
    `https://discord.com/channels/${OTHER_GUILD}/${OTHER_GUILD}1`,
    'https://discord.gg/abc123',
    `https://discord.com/channels/${ALLOWED_GUILD}/${ALLOWED_GUILD}1/42`,
  ]) {
    assert.equal(review({ description: `see ${url}` }).length, 1, `${url} must be reviewed`);
  }
  count += 3;

  // 9. no project field, or a field the validator rejects, produces no
  // authoritative observation at all.
  const noField = observationsFor({ description: threadUrl }, threadUrl);
  assert.equal(noField.some(item => item.authoritative), false, JSON.stringify(noField));
  const badField = observationsFor({ description: `https://discord.com/channels/${OTHER_GUILD}/${OTHER_GUILD}1`, discordThreadUrl: 'https://discord.gg/nope' }, `https://discord.com/channels/${OTHER_GUILD}/${OTHER_GUILD}1`);
  assert.equal(badField.some(item => item.authoritative), false, JSON.stringify(badField));
  assert.equal(review({ description: `https://discord.com/channels/${OTHER_GUILD}/${OTHER_GUILD}1`, discordThreadUrl: 'https://discord.gg/nope' }).length, 1);
  count += 4;
}

// ---------------------------------------------------------------- severity matrix

const severityCases = [
  ['https://random-host.example/page', 'U2'],
  ['http://random-host.example/page', 'U3'],
  ['https://203.0.113.9/page', 'U4'],
];
for (const [url, expected] of severityCases) {
  assert.ok(rules(ejs(`const x = "${url}";`)).includes(expected), url);
  count++;
}

// A trusted media host is not a free pass when the user is navigated to it.
const navigated = ejs('window.open("https://files.catbox.moe/a.png");');
assert.ok(rules(navigated).includes('U2'), JSON.stringify(navigated.findings));
count++;

// P0-1 regression: an unrelated trusted URL in the same entry must not wash the
// dynamic target clean. The loaded value here is completely unknown.
for (const source of [
  'const randomFallback="https://files.catbox.moe/safe.png"; const img=document.createElement("img"); img.src=runtimeTarget;',
  'const one="https://files.catbox.moe/a.png"; const two="https://i.ibb.co/b.webp"; const profile={avatarUrl:runtimeTarget};',
  'const fallback="https://files.catbox.moe/fallback.png"; const cfg={videoUrl:runtimeTarget};',
]) {
  const report = ejs(source);
  assert.ok(
    mediaAh2(report).length > 0,
    `an unrelated trusted URL suppressed AH2: ${source} -> ${JSON.stringify(report.findings)}`,
  );
  assert.equal(report.audit, 'yellow');
  count += 2;
}

console.log(`external-link policy matrix: ${count} assertions passed`);
