import type { ProjectEntryKind } from './project-content';

export type ProjectExternalLink = {
  url: string;
  hostname: string;
};

export type ProjectEntryInspection = {
  hasEjs: boolean;
  hasCharacterArtwork: boolean;
  characterArtworkBlockCount: number;
  inspectionWarnings: string[];
  externalLinks: ProjectExternalLink[];
};

export const CHARACTER_ARTWORK_START = '<%# char-info-ejs-builder:start:v2 %>';
export const CHARACTER_ARTWORK_END = '<%# char-info-ejs-builder:end:v2 %>';
export const CHARACTER_ARTWORK_INCOMPLETE_WARNING = 'character_artwork_marker_incomplete';
const WORKSHOP_METADATA_START = '<%# poem-workshop-meta:v1-start\n';
const WORKSHOP_METADATA_END = '\npoem-workshop-meta:v1-end %>';

const EJS_TAG_PATTERN = /<%[\s\S]*?%>/;
const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"'`，。；：！？、（）【】《》“”‘’]+/giu;

function isValidWorkshopMetadataPayload(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    if (typeof parsed.cw_project_id !== 'string' || !parsed.cw_project_id) return false;
    if (typeof parsed.cw_entry_key !== 'string' || !parsed.cw_entry_key) return false;
    if (typeof parsed.cw_project_name_display !== 'string') return false;
    if (
      parsed.cw_project_version !== null &&
      parsed.cw_project_version !== undefined &&
      typeof parsed.cw_project_version !== 'string'
    ) return false;
    if (
      parsed.cw_remote_version !== null &&
      parsed.cw_remote_version !== undefined &&
      typeof parsed.cw_remote_version !== 'string'
    ) return false;
    return typeof parsed.cw_name_format_version === 'string' ||
      (typeof parsed.cw_name_format_version === 'number' && Number.isFinite(parsed.cw_name_format_version));
  } catch {
    return false;
  }
}

export function stripWorkshopMetadataBlocks(content: string): string {
  const validRanges: Array<{ start: number; end: number }> = [];
  let cursor = 0;

  while (cursor < content.length) {
    const start = content.indexOf(WORKSHOP_METADATA_START, cursor);
    if (start < 0) break;

    const payloadStart = start + WORKSHOP_METADATA_START.length;
    const endMarkerStart = content.indexOf(WORKSHOP_METADATA_END, payloadStart);
    if (endMarkerStart < 0) {
      cursor = payloadStart;
      continue;
    }

    const nestedStart = content.indexOf(WORKSHOP_METADATA_START, payloadStart);
    if (nestedStart >= 0 && nestedStart < endMarkerStart) {
      cursor = nestedStart;
      continue;
    }

    if (isValidWorkshopMetadataPayload(content.slice(payloadStart, endMarkerStart))) {
      validRanges.push({
        start,
        end: endMarkerStart + WORKSHOP_METADATA_END.length,
      });
    }
    cursor = endMarkerStart + WORKSHOP_METADATA_END.length;
  }

  if (validRanges.length === 0) return content;

  let output = '';
  let outputCursor = 0;
  for (const range of validRanges) {
    output += content.slice(outputCursor, range.start);
    outputCursor = range.end;
  }
  output += content.slice(outputCursor);
  return output;
}

function getInspectableStrings(entry: Record<string, unknown>, kind: ProjectEntryKind): string[] {
  if (kind === 'worldbook') {
    const content = typeof entry.content === 'string' ? entry.content : typeof entry.text === 'string' ? entry.text : '';
    const inspectableContent = stripWorkshopMetadataBlocks(content);
    return inspectableContent ? [inspectableContent] : [];
  }

  const replacement =
    typeof entry.replaceString === 'string'
      ? entry.replaceString
      : typeof entry.replace_string === 'string'
        ? entry.replace_string
        : '';
  return replacement ? [replacement] : [];
}

function countOccurrences(text: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let cursor = 0;
  while (true) {
    const index = text.indexOf(needle, cursor);
    if (index < 0) return count;
    count += 1;
    cursor = index + needle.length;
  }
}

function countCompleteCharacterArtworkBlocks(text: string): number {
  let count = 0;
  let cursor = 0;
  while (true) {
    const start = text.indexOf(CHARACTER_ARTWORK_START, cursor);
    if (start < 0) return count;
    const end = text.indexOf(CHARACTER_ARTWORK_END, start + CHARACTER_ARTWORK_START.length);
    if (end < 0) return count;
    count += 1;
    cursor = end + CHARACTER_ARTWORK_END.length;
  }
}

function countCharacter(text: string, character: string): number {
  let count = 0;
  for (const current of text) {
    if (current === character) count += 1;
  }
  return count;
}

function trimTrailingUrlPunctuation(value: string): string {
  let candidate = value.replace(/[.,;:!?，。；：！？、]+$/u, '');
  const pairs = [
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
  ] as const;

  for (const [open, close] of pairs) {
    while (candidate.endsWith(close) && countCharacter(candidate, close) > countCharacter(candidate, open)) {
      candidate = candidate.slice(0, -1);
    }
  }

  return candidate;
}

function extractExternalLinks(strings: string[]): ProjectExternalLink[] {
  const links = new Map<string, ProjectExternalLink>();

  for (const text of strings) {
    HTTP_URL_PATTERN.lastIndex = 0;
    for (const match of text.matchAll(HTTP_URL_PATTERN)) {
      const candidate = trimTrailingUrlPunctuation(match[0]);
      try {
        const parsed = new URL(candidate);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
        if (!parsed.hostname) continue;
        const url = parsed.href;
        if (!links.has(url)) {
          links.set(url, {
            url,
            hostname: parsed.hostname.toLowerCase(),
          });
        }
      } catch {
        // Best-effort static inspection only. Never fetch remote content here.
      }
    }
  }

  return [...links.values()];
}

export function inspectProjectEntry(entry: Record<string, unknown>, kind: ProjectEntryKind): ProjectEntryInspection {
  const strings = getInspectableStrings(entry, kind);

  let hasEjs = false;
  let startCount = 0;
  let endCount = 0;
  let completeBlockCount = 0;

  for (const text of strings) {
    if (!hasEjs && EJS_TAG_PATTERN.test(text)) hasEjs = true;
    if (kind !== 'worldbook') continue;
    startCount += countOccurrences(text, CHARACTER_ARTWORK_START);
    endCount += countOccurrences(text, CHARACTER_ARTWORK_END);
    completeBlockCount += countCompleteCharacterArtworkBlocks(text);
  }

  const pairedMarkerCount = Math.min(startCount, endCount);
  const hasIncompleteArtworkMarker = startCount !== endCount || completeBlockCount < pairedMarkerCount;

  return {
    hasEjs,
    hasCharacterArtwork: completeBlockCount > 0,
    characterArtworkBlockCount: completeBlockCount,
    inspectionWarnings: hasIncompleteArtworkMarker ? [CHARACTER_ARTWORK_INCOMPLETE_WARNING] : [],
    externalLinks: extractExternalLinks(strings),
  };
}
