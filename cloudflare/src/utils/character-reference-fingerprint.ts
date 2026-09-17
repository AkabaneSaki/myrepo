import type { RegexEntryPreviewType, WorldbookEntryPreviewType } from '../types';

export type CharacterReferenceItemKind = 'worldbook' | 'regex';
export type CharacterReferenceMatchLevel = 'exact' | 'changed-high-confidence' | 'uncertain' | 'no-match';

export type CharacterReferenceFingerprint = {
  kind: CharacterReferenceItemKind;
  displayName: string;
  sourceKey: string | null;
  exactHash: string;
  normalizedContentHash: string;
  nameHash: string;
  keysHash: string | null;
  structureHash: string;
};

export type CharacterReferenceMatch = {
  level: CharacterReferenceMatchLevel;
  reasons: string[];
};

type LooseEntry = Record<string, unknown>;

function normalizeLineEndings(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim()
    : '';
}

function normalizeName(value: unknown): string {
  return normalizeLineEndings(value).replace(/\s+/g, ' ').toLocaleLowerCase();
}

function normalizeStringArray(value: unknown, sort = false): string[] {
  if (!Array.isArray(value)) return [];
  const items = value
    .filter((item): item is string => typeof item === 'string')
    .map(item => normalizeLineEndings(item))
    .filter(Boolean);
  return sort ? [...new Set(items)].sort((a, b) => a.localeCompare(b)) : items;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort((a, b) => a.localeCompare(b))
      .map(key => [key, stableValue(record[key])]),
  );
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : stableStringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function worldbookSemantic(entry: WorldbookEntryPreviewType & LooseEntry) {
  const primaryKeys = normalizeStringArray(entry.key, true);
  const secondaryKeys = normalizeStringArray(entry.keysecondary, true);
  const name = normalizeName(entry.comment);
  const content = normalizeLineEndings(entry.content);
  const keys = { primary: primaryKeys, secondary: secondaryKeys };
  const structure = {
    constant: booleanValue(entry.constant),
    selective: booleanValue(entry.selective),
    selectiveLogic: finiteOrNull(entry.selectiveLogic) ?? 0,
    scanDepth: finiteOrNull(entry.scanDepth),
    positionType: normalizeLineEndings(entry.positionType),
    outletName: normalizeLineEndings(entry.outletName),
    role: normalizeLineEndings(entry.role ?? 'system') || 'system',
    depth: finiteOrNull(entry.depth),
    probability: finiteOrNull(entry.probability) ?? 100,
    useProbability: booleanValue(entry.useProbability),
    sticky: finiteOrNull(entry.sticky) ?? 0,
    cooldown: finiteOrNull(entry.cooldown) ?? 0,
    delay: finiteOrNull(entry.delay) ?? 0,
    excludeRecursion: booleanValue(entry.excludeRecursion),
    preventRecursion: booleanValue(entry.preventRecursion),
    delayUntilRecursion: booleanValue(entry.delayUntilRecursion),
  };
  return { name, content, keys, structure };
}

function regexSemantic(entry: RegexEntryPreviewType & LooseEntry) {
  const name = normalizeName(entry.scriptName);
  const content = {
    findRegex: normalizeLineEndings(entry.findRegex),
    replaceString: normalizeLineEndings(entry.replaceString),
  };
  const structure = {
    trimStrings: normalizeStringArray(entry.trimStrings),
    markdownOnly: booleanValue(entry.markdownOnly),
    promptOnly: booleanValue(entry.promptOnly),
    runOnEdit: booleanValue(entry.runOnEdit),
    substituteRegex:
      typeof entry.substituteRegex === 'boolean' || typeof entry.substituteRegex === 'number'
        ? entry.substituteRegex
        : 0,
    minDepth: finiteOrNull(entry.minDepth),
    maxDepth: finiteOrNull(entry.maxDepth),
    placement: Array.isArray(entry.placement)
      ? entry.placement.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      : [],
  };
  return { name, content, structure };
}

export async function fingerprintWorldbookEntry(
  entry: WorldbookEntryPreviewType & LooseEntry,
): Promise<CharacterReferenceFingerprint> {
  const semantic = worldbookSemantic(entry);
  const keysPresent = semantic.keys.primary.length > 0 || semantic.keys.secondary.length > 0;
  return {
    kind: 'worldbook',
    displayName: normalizeLineEndings(entry.comment) || '无标题',
    sourceKey: typeof entry.entryKey === 'string' ? entry.entryKey : null,
    exactHash: await sha256(semantic),
    normalizedContentHash: await sha256(semantic.content),
    nameHash: await sha256(semantic.name),
    keysHash: keysPresent ? await sha256(semantic.keys) : null,
    structureHash: await sha256(semantic.structure),
  };
}

export async function fingerprintRegexEntry(
  entry: RegexEntryPreviewType & LooseEntry,
): Promise<CharacterReferenceFingerprint> {
  const semantic = regexSemantic(entry);
  return {
    kind: 'regex',
    displayName: normalizeLineEndings(entry.scriptName) || '未命名 Regex',
    sourceKey: typeof entry.entryKey === 'string' ? entry.entryKey : null,
    exactHash: await sha256(semantic),
    normalizedContentHash: await sha256(semantic.content),
    nameHash: await sha256(semantic.name),
    keysHash: null,
    structureHash: await sha256(semantic.structure),
  };
}

export function matchCharacterReferenceFingerprint(
  reference: Pick<CharacterReferenceFingerprint, 'kind' | 'exactHash' | 'normalizedContentHash' | 'nameHash' | 'keysHash' | 'structureHash'>,
  candidate: Pick<CharacterReferenceFingerprint, 'kind' | 'exactHash' | 'normalizedContentHash' | 'nameHash' | 'keysHash' | 'structureHash'>,
): CharacterReferenceMatch {
  if (reference.kind !== candidate.kind) return { level: 'no-match', reasons: ['kind'] };
  if (reference.exactHash === candidate.exactHash) return { level: 'exact', reasons: ['exact_hash'] };

  const content = reference.normalizedContentHash === candidate.normalizedContentHash;
  const name = reference.nameHash === candidate.nameHash;
  const structure = reference.structureHash === candidate.structureHash;
  const keys = Boolean(reference.keysHash && candidate.keysHash && reference.keysHash === candidate.keysHash);
  const reasons = [
    content ? 'content' : '',
    name ? 'name' : '',
    structure ? 'structure' : '',
    keys ? 'keys' : '',
  ].filter(Boolean);

  // Conservative by design. High-confidence is advisory only; future automatic local
  // mutation is allowed exclusively for `exact` matches.
  if ((content && structure) || (name && structure && keys)) {
    return { level: 'changed-high-confidence', reasons };
  }
  if (content || name || structure || keys) return { level: 'uncertain', reasons };
  return { level: 'no-match', reasons: [] };
}
