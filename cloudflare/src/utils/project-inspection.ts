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

const EJS_TAG_PATTERN = /<%[\s\S]*?%>/;
const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"'`，。；：！？、（）【】《》“”‘’]+/giu;

function getInspectableStrings(entry: Record<string, unknown>, kind: ProjectEntryKind): string[] {
  if (kind === 'worldbook') {
    const content = typeof entry.content === 'string' ? entry.content : typeof entry.text === 'string' ? entry.text : '';
    return content ? [content] : [];
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
