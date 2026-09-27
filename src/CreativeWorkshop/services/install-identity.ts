export const CREATIVE_WORKSHOP_WORLD_BOOK_META_START = '<%# poem-workshop-meta:v1-start\n';
export const CREATIVE_WORKSHOP_WORLD_BOOK_META_END = '\npoem-workshop-meta:v1-end %>';
const CREATIVE_WORKSHOP_REGEX_ID_PREFIX = 'creative_workshop:';
const CREATIVE_WORKSHOP_REGEX_RECORD_PAYLOAD_PREFIX = 'poem-workshop-regex-meta:v1\n';

export type CreativeWorkshopWorldbookMetadata = {
  cw_project_id: string;
  cw_project_name_display: string;
  cw_project_version: string | null;
  cw_remote_version?: string | null;
  cw_entry_key: string;
  cw_name_format_version: string | number;
};

export type CreativeWorkshopRegexIdentity = {
  schemaVersion: 0 | 1 | 2;
  projectId: string;
  entryKey: string;
  installedVersion: string | null;
};

export type CreativeWorkshopRegexRecordEntry = {
  regexId: string;
  entryKey: string;
  installedVersion: string | null;
};

export type CreativeWorkshopRegexRecordMetadata = {
  schemaVersion: 1;
  projectId: string;
  projectNameDisplay: string;
  installedVersion: string | null;
  entries: CreativeWorkshopRegexRecordEntry[];
};

type CreativeWorkshopWorldbookMetadataBlock = {
  start: number;
  end: number;
  metadata: CreativeWorkshopWorldbookMetadata;
};

type CreativeWorkshopWorldbookMetadataScan = {
  blocks: CreativeWorkshopWorldbookMetadataBlock[];
  malformed: boolean;
};

function asRecord(value: unknown): Record<string, any> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function meaningfulMetadataValue(value: unknown): unknown {
  if (typeof value === 'string') return value ? value : null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return value === null ? null : value;
}

function safeMetadataJson(metadata: CreativeWorkshopWorldbookMetadata): string {
  return JSON.stringify(metadata)
    .replace(/%/g, '\\u0025')
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

function parseCreativeWorkshopWorldbookMetadata(raw: string): CreativeWorkshopWorldbookMetadata | null {
  try {
    const parsed = asRecord(JSON.parse(raw));
    if (!parsed) return null;
    if (typeof parsed.cw_project_id !== 'string' || !parsed.cw_project_id) return null;
    if (typeof parsed.cw_entry_key !== 'string' || !parsed.cw_entry_key) return null;
    if (typeof parsed.cw_project_name_display !== 'string') return null;
    if (
      parsed.cw_project_version !== null &&
      parsed.cw_project_version !== undefined &&
      typeof parsed.cw_project_version !== 'string'
    ) return null;
    if (
      parsed.cw_remote_version !== null &&
      parsed.cw_remote_version !== undefined &&
      typeof parsed.cw_remote_version !== 'string'
    ) return null;
    if (
      typeof parsed.cw_name_format_version !== 'string' &&
      !(typeof parsed.cw_name_format_version === 'number' && Number.isFinite(parsed.cw_name_format_version))
    ) return null;

    return {
      cw_project_id: parsed.cw_project_id,
      cw_project_name_display: parsed.cw_project_name_display,
      cw_project_version: parsed.cw_project_version ?? null,
      ...(parsed.cw_remote_version !== undefined ? { cw_remote_version: parsed.cw_remote_version ?? null } : {}),
      cw_entry_key: parsed.cw_entry_key,
      cw_name_format_version: parsed.cw_name_format_version,
    };
  } catch {
    return null;
  }
}

function getWorldbookMetadataIdentity(metadata: CreativeWorkshopWorldbookMetadata): string {
  return JSON.stringify([metadata.cw_project_id, metadata.cw_entry_key]);
}

function scanCreativeWorkshopWorldbookMetadata(
  content: string,
): CreativeWorkshopWorldbookMetadataScan {
  const blocks: CreativeWorkshopWorldbookMetadataBlock[] = [];
  const recognizedEndStarts = new Set<number>();
  let malformed = false;
  let cursor = 0;

  while (cursor < content.length) {
    const start = content.indexOf(CREATIVE_WORKSHOP_WORLD_BOOK_META_START, cursor);
    if (start < 0) break;

    const payloadStart = start + CREATIVE_WORKSHOP_WORLD_BOOK_META_START.length;
    const endMarkerStart = content.indexOf(CREATIVE_WORKSHOP_WORLD_BOOK_META_END, payloadStart);
    if (endMarkerStart < 0) {
      malformed = true;
      break;
    }

    const nestedStart = content.indexOf(CREATIVE_WORKSHOP_WORLD_BOOK_META_START, payloadStart);
    if (nestedStart >= 0 && nestedStart < endMarkerStart) {
      malformed = true;
      cursor = nestedStart;
      continue;
    }

    recognizedEndStarts.add(endMarkerStart);
    const metadata = parseCreativeWorkshopWorldbookMetadata(
      content.slice(payloadStart, endMarkerStart),
    );
    const end = endMarkerStart + CREATIVE_WORKSHOP_WORLD_BOOK_META_END.length;

    if (metadata) {
      blocks.push({ start, end, metadata });
    } else {
      malformed = true;
    }
    cursor = end;
  }

  let endCursor = 0;
  while (endCursor < content.length) {
    const endMarkerStart = content.indexOf(CREATIVE_WORKSHOP_WORLD_BOOK_META_END, endCursor);
    if (endMarkerStart < 0) break;
    if (!recognizedEndStarts.has(endMarkerStart)) malformed = true;
    endCursor = endMarkerStart + CREATIVE_WORKSHOP_WORLD_BOOK_META_END.length;
  }

  return { blocks, malformed };
}

export function buildCreativeWorkshopWorldbookMetadataBlock(
  metadata: CreativeWorkshopWorldbookMetadata,
): string {
  return `${CREATIVE_WORKSHOP_WORLD_BOOK_META_START}${safeMetadataJson(metadata)}${CREATIVE_WORKSHOP_WORLD_BOOK_META_END}`;
}

export function stripCreativeWorkshopWorldbookMetadata(content: string): string {
  if (typeof content !== 'string' || !content) return typeof content === 'string' ? content : '';
  const scan = scanCreativeWorkshopWorldbookMetadata(content);
  if (scan.malformed || scan.blocks.length === 0) return content;

  let output = '';
  let cursor = 0;
  for (const block of scan.blocks) {
    output += content.slice(cursor, block.start);
    cursor = block.end;
  }
  output += content.slice(cursor);
  return output;
}

export function injectCreativeWorkshopWorldbookMetadata(
  originalContent: string,
  metadata: CreativeWorkshopWorldbookMetadata,
): string {
  const content = typeof originalContent === 'string' ? originalContent : '';
  const scan = scanCreativeWorkshopWorldbookMetadata(content);

  if (scan.malformed) {
    throw new Error('世界书内容中的工坊身份标记损坏或不完整');
  }

  const block = buildCreativeWorkshopWorldbookMetadataBlock(metadata);
  if (scan.blocks.length === 0) return block + content;

  const identities = new Set(scan.blocks.map(item => getWorldbookMetadataIdentity(item.metadata)));
  if (identities.size > 1) {
    throw new Error('世界书内容中存在互相冲突的工坊身份标记');
  }

  let output = '';
  let cursor = 0;
  scan.blocks.forEach((existing, index) => {
    output += content.slice(cursor, existing.start);
    if (index === 0) output += block;
    cursor = existing.end;
  });
  output += content.slice(cursor);
  return output;
}

export function readCreativeWorkshopWorldbookMetadata(
  content: string,
): CreativeWorkshopWorldbookMetadata | null {
  if (typeof content !== 'string' || !content) return null;
  const scan = scanCreativeWorkshopWorldbookMetadata(content);
  if (scan.malformed || scan.blocks.length === 0) return null;

  const identities = new Set(scan.blocks.map(item => getWorldbookMetadataIdentity(item.metadata)));
  if (identities.size !== 1) return null;
  return scan.blocks[0].metadata;
}

export function getCreativeWorkshopWorldbookMetadataValue(
  entry: WorldbookEntry | Record<string, any>,
  field: string,
): unknown {
  const raw = entry as Record<string, any>;
  const extra = asRecord(raw.extra);
  const direct = meaningfulMetadataValue(extra?.[field]);
  if (direct !== undefined && direct !== null) return direct;

  const embedded = readCreativeWorkshopWorldbookMetadata(
    typeof raw.content === 'string' ? raw.content : '',
  ) as Record<string, any> | null;
  const fallback = meaningfulMetadataValue(embedded?.[field]);
  return fallback === undefined ? null : fallback;
}

export function getCreativeWorkshopWorldbookMetadataString(
  entry: WorldbookEntry | Record<string, any>,
  field: string,
): string | null {
  const value = getCreativeWorkshopWorldbookMetadataValue(entry, field);
  if (typeof value === 'string' && value) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

export function isCreativeWorkshopUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function createCreativeWorkshopRegexUuid(): string {
  const id = globalThis.crypto?.randomUUID?.();
  if (!isCreativeWorkshopUuid(id)) {
    throw new Error('当前环境无法生成合法的 Workshop Regex UUID');
  }
  return id;
}

export function buildCreativeWorkshopRegexRecordPayload(
  metadata: CreativeWorkshopRegexRecordMetadata,
): string {
  return CREATIVE_WORKSHOP_REGEX_RECORD_PAYLOAD_PREFIX + JSON.stringify(metadata);
}

export function parseCreativeWorkshopRegexRecordPayload(
  raw: unknown,
): CreativeWorkshopRegexRecordMetadata | null {
  if (typeof raw !== 'string' || !raw.startsWith(CREATIVE_WORKSHOP_REGEX_RECORD_PAYLOAD_PREFIX)) return null;

  try {
    const parsed = asRecord(JSON.parse(raw.slice(CREATIVE_WORKSHOP_REGEX_RECORD_PAYLOAD_PREFIX.length)));
    if (!parsed || parsed.schemaVersion !== 1) return null;
    if (!isCreativeWorkshopUuid(parsed.projectId)) return null;
    if (typeof parsed.projectNameDisplay !== 'string') return null;
    if (
      parsed.installedVersion !== null &&
      parsed.installedVersion !== undefined &&
      typeof parsed.installedVersion !== 'string'
    ) return null;
    if (!Array.isArray(parsed.entries)) return null;

    const entries: CreativeWorkshopRegexRecordEntry[] = [];
    const regexIds = new Set<string>();
    const entryKeys = new Set<string>();
    for (const value of parsed.entries) {
      const entry = asRecord(value);
      if (!entry || !isCreativeWorkshopUuid(entry.regexId)) return null;
      if (typeof entry.entryKey !== 'string' || !entry.entryKey) return null;
      if (
        entry.installedVersion !== null &&
        entry.installedVersion !== undefined &&
        typeof entry.installedVersion !== 'string'
      ) return null;
      if (regexIds.has(entry.regexId) || entryKeys.has(entry.entryKey)) return null;
      regexIds.add(entry.regexId);
      entryKeys.add(entry.entryKey);
      entries.push({
        regexId: entry.regexId,
        entryKey: entry.entryKey,
        installedVersion: entry.installedVersion ?? null,
      });
    }

    return {
      schemaVersion: 1,
      projectId: parsed.projectId,
      projectNameDisplay: parsed.projectNameDisplay,
      installedVersion: parsed.installedVersion ?? null,
      entries,
    };
  } catch {
    return null;
  }
}

function encodeRegexIdentityComponent(value: string): string {
  return value.replace(/%/g, '%25').replace(/:/g, '%3A');
}

function decodeRegexIdentityComponent(value: string): string {
  return value.replace(/%3A/gi, ':').replace(/%25/gi, '%');
}

export function buildCreativeWorkshopRegexId(
  projectId: string,
  entryKey: string,
  installedVersion?: string | null,
): string {
  const normalizedProjectId = String(projectId || '');
  if (!normalizedProjectId) throw new Error('Workshop regex projectId 不能为空');
  if (normalizedProjectId.includes(':')) {
    throw new Error('Workshop regex projectId 不能包含冒号');
  }
  const normalizedEntryKey = String(entryKey || '');
  if (!normalizedEntryKey) throw new Error('Workshop regex entryKey 不能为空');

  return `${CREATIVE_WORKSHOP_REGEX_ID_PREFIX}${normalizedProjectId}:v1:${encodeRegexIdentityComponent(normalizedEntryKey)}:${encodeRegexIdentityComponent(installedVersion || '')}`;
}

export function parseCreativeWorkshopRegexId(value: string): CreativeWorkshopRegexIdentity | null {
  const raw = String(value || '');
  if (!raw.startsWith(CREATIVE_WORKSHOP_REGEX_ID_PREFIX)) return null;

  const rest = raw.slice(CREATIVE_WORKSHOP_REGEX_ID_PREFIX.length);
  const projectSeparator = rest.indexOf(':');
  if (projectSeparator <= 0) return null;

  const projectId = rest.slice(0, projectSeparator);
  const tail = rest.slice(projectSeparator + 1);
  if (!tail) return null;

  if (tail.startsWith('v1:')) {
    const payload = tail.slice('v1:'.length);
    const versionSeparator = payload.indexOf(':');
    if (versionSeparator < 0) return null;
    const entryKey = decodeRegexIdentityComponent(payload.slice(0, versionSeparator));
    const installedVersion = decodeRegexIdentityComponent(payload.slice(versionSeparator + 1)) || null;
    if (!entryKey) return null;
    return { schemaVersion: 1, projectId, entryKey, installedVersion };
  }

  return {
    schemaVersion: 0,
    projectId,
    entryKey: tail,
    installedVersion: null,
  };
}

export function getCreativeWorkshopRegexIdentityKey(projectId: string, entryKey: string): string {
  return JSON.stringify([projectId, entryKey]);
}
