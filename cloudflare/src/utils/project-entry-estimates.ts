import type { WorldbookEntryPreviewType } from '../types';

export const MAX_WORLD_BOOK_EJS_LENGTH_ESTIMATES = 500;
export const MAX_WORLD_BOOK_EJS_LENGTH_ESTIMATE_CHARS = 160;
const MAX_ENTRY_KEY_CHARS = 512;

export type WorldbookEjsLengthEstimates = Record<string, string>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sliceUnicode(value: string, maxChars: number): string {
  return Array.from(value).slice(0, maxChars).join('');
}

export function normalizeWorldbookEjsLengthEstimates(value: unknown): WorldbookEjsLengthEstimates {
  if (!isRecord(value)) return {};

  const result: WorldbookEjsLengthEstimates = {};
  for (const [rawKey, rawText] of Object.entries(value).slice(0, MAX_WORLD_BOOK_EJS_LENGTH_ESTIMATES)) {
    const key = String(rawKey || '');
    if (!key || Array.from(key).length > MAX_ENTRY_KEY_CHARS || typeof rawText !== 'string') continue;
    const text = sliceUnicode(rawText.trim(), MAX_WORLD_BOOK_EJS_LENGTH_ESTIMATE_CHARS);
    if (!text) continue;
    result[key] = text;
  }
  return result;
}

export function parseWorldbookEjsLengthEstimates(value: unknown): WorldbookEjsLengthEstimates {
  if (typeof value !== 'string') return normalizeWorldbookEjsLengthEstimates(value);
  if (!value.trim()) return {};
  try {
    return normalizeWorldbookEjsLengthEstimates(JSON.parse(value));
  } catch {
    return {};
  }
}

export function validateWorldbookEjsLengthEstimatesInput(
  value: unknown,
): { value: WorldbookEjsLengthEstimates; error: string | null } {
  if (value === undefined) return { value: {}, error: null };
  if (!isRecord(value)) return { value: {}, error: 'EJS 作者预估长度格式不正确' };

  const entries = Object.entries(value);
  if (entries.length > MAX_WORLD_BOOK_EJS_LENGTH_ESTIMATES) {
    return { value: {}, error: `EJS 作者预估长度最多记录 ${MAX_WORLD_BOOK_EJS_LENGTH_ESTIMATES} 条` };
  }

  for (const [key, rawText] of entries) {
    if (!key || Array.from(key).length > MAX_ENTRY_KEY_CHARS) {
      return { value: {}, error: 'EJS 条目标识格式不正确' };
    }
    if (typeof rawText !== 'string') {
      return { value: {}, error: 'EJS 作者预估长度必须是文字' };
    }
    if (Array.from(rawText.trim()).length > MAX_WORLD_BOOK_EJS_LENGTH_ESTIMATE_CHARS) {
      return {
        value: {},
        error: `每条 EJS 作者预估长度最多 ${MAX_WORLD_BOOK_EJS_LENGTH_ESTIMATE_CHARS} 字符`,
      };
    }
  }

  return { value: normalizeWorldbookEjsLengthEstimates(value), error: null };
}

export function attachWorldbookEjsLengthEstimates(
  entries: WorldbookEntryPreviewType[],
  estimates: WorldbookEjsLengthEstimates,
): WorldbookEntryPreviewType[] {
  return entries.map(entry => {
    if (!entry.hasEjs || !entry.entryKey) return entry;
    const authorEstimatedLength = estimates[entry.entryKey];
    return authorEstimatedLength ? { ...entry, authorEstimatedLength } : entry;
  });
}
