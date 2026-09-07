import type { RegexEntryPreviewType, WorldbookEntryPreviewType } from '../types';
import { extractProjectEntries, parseProjectJson, type ProjectEntryKind } from './project-content.ts';
import { parseRegexEntriesPreview, parseWorldbookEntriesPreview } from './project-preview.ts';

export type ReviewEntryStatus = 'added' | 'modified' | 'deleted' | 'unchanged';

export type ReviewEntryChange = {
  status: ReviewEntryStatus;
  entryKey: string;
  previousEntryKey?: string;
  changedFields: string[];
  current?: Record<string, unknown>;
  previous?: Record<string, unknown>;
  currentRaw?: string;
  previousRaw?: string;
  currentReviewText?: string;
  previousReviewText?: string;
};

type EntrySnapshot = {
  entryKey: string;
  index: number;
  raw: Record<string, unknown>;
  preview: Record<string, unknown>;
  canonical: string;
  semanticName: string;
};

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortValue(child)]),
  );
}

function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function formatEntryForReview(entry: Record<string, unknown>): string {
  const lines: string[] = [];
  Object.keys(entry)
    .sort()
    .forEach(key => {
      const value = entry[key];
      if (typeof value === 'string') {
        if (value.includes('\n')) {
          lines.push(`${key}:`);
          value.split('\n').forEach(line => lines.push(`  ${line}`));
        } else {
          lines.push(`${key}: ${value}`);
        }
        return;
      }
      if (value === null || typeof value === 'number' || typeof value === 'boolean' || value === undefined) {
        lines.push(`${key}: ${String(value)}`);
        return;
      }
      const serialized = JSON.stringify(sortValue(value), null, 2);
      if (!serialized.includes('\n')) {
        lines.push(`${key}: ${serialized}`);
        return;
      }
      const [first, ...rest] = serialized.split('\n');
      lines.push(`${key}: ${first}`);
      rest.forEach(line => lines.push(`  ${line}`));
    });
  return lines.join('\n');
}

function getSemanticName(kind: ProjectEntryKind, preview: Record<string, unknown>): string {
  const candidates =
    kind === 'worldbook'
      ? [preview.comment, preview.uid]
      : [preview.scriptName, preview.id, preview.findRegex];
  const value = candidates.find(candidate => typeof candidate === 'string' && candidate.trim());
  return typeof value === 'string' ? value.trim().toLocaleLowerCase() : '';
}

function makeSnapshots(text: string | null | undefined, kind: ProjectEntryKind): EntrySnapshot[] {
  if (!text) return [];
  const raw = parseProjectJson(text);
  const refs = extractProjectEntries(raw, kind);
  const previews =
    kind === 'worldbook'
      ? (parseWorldbookEntriesPreview(text) as WorldbookEntryPreviewType[])
      : (parseRegexEntriesPreview(text) as RegexEntryPreviewType[]);

  return refs.map((ref, index) => {
    const preview = (previews[index] || {}) as Record<string, unknown>;
    return {
      entryKey: ref.entryKey,
      index: ref.index,
      raw: ref.entry,
      preview,
      canonical: canonicalize(ref.entry),
      semanticName: getSemanticName(kind, preview),
    };
  });
}

function isStableEntryKey(entryKey: string): boolean {
  return !entryKey.startsWith('index:');
}

function changedTopLevelFields(previous: Record<string, unknown>, current: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(previous), ...Object.keys(current)]);
  return Array.from(keys)
    .filter(key => canonicalize(previous[key]) !== canonicalize(current[key]))
    .sort();
}

function pushMatch(
  matches: Map<number, number>,
  previousUsed: Set<number>,
  currentIndex: number,
  previousIndex: number,
) {
  if (matches.has(currentIndex) || previousUsed.has(previousIndex)) return;
  matches.set(currentIndex, previousIndex);
  previousUsed.add(previousIndex);
}

function pairSnapshots(previous: EntrySnapshot[], current: EntrySnapshot[]): Map<number, number> {
  const matches = new Map<number, number>();
  const previousUsed = new Set<number>();

  // Stable IDs/object keys are authoritative when available.
  const previousByStableKey = new Map<string, number>();
  previous.forEach((entry, index) => {
    if (isStableEntryKey(entry.entryKey) && !previousByStableKey.has(entry.entryKey)) {
      previousByStableKey.set(entry.entryKey, index);
    }
  });
  current.forEach((entry, currentIndex) => {
    if (!isStableEntryKey(entry.entryKey)) return;
    const previousIndex = previousByStableKey.get(entry.entryKey);
    if (previousIndex !== undefined) pushMatch(matches, previousUsed, currentIndex, previousIndex);
  });

  // Exact-content matching prevents an insertion from turning every later index-only entry into "modified".
  const previousByCanonical = new Map<string, number[]>();
  previous.forEach((entry, index) => {
    if (previousUsed.has(index)) return;
    const bucket = previousByCanonical.get(entry.canonical) || [];
    bucket.push(index);
    previousByCanonical.set(entry.canonical, bucket);
  });
  current.forEach((entry, currentIndex) => {
    if (matches.has(currentIndex)) return;
    const bucket = previousByCanonical.get(entry.canonical);
    const previousIndex = bucket?.find(index => !previousUsed.has(index));
    if (previousIndex !== undefined) pushMatch(matches, previousUsed, currentIndex, previousIndex);
  });

  // A unique title/name is a useful legacy fallback for changed entries without stable IDs.
  const previousByName = new Map<string, number[]>();
  previous.forEach((entry, index) => {
    if (previousUsed.has(index) || !entry.semanticName) return;
    const bucket = previousByName.get(entry.semanticName) || [];
    bucket.push(index);
    previousByName.set(entry.semanticName, bucket);
  });
  current.forEach((entry, currentIndex) => {
    if (matches.has(currentIndex) || !entry.semanticName) return;
    const bucket = (previousByName.get(entry.semanticName) || []).filter(index => !previousUsed.has(index));
    if (bucket.length === 1) pushMatch(matches, previousUsed, currentIndex, bucket[0]);
  });

  // Last-resort positional pairing keeps legacy index-only entries reviewable.
  current.forEach((entry, currentIndex) => {
    if (matches.has(currentIndex)) return;
    const previousIndex = previous.findIndex(
      (candidate, index) => !previousUsed.has(index) && candidate.entryKey === entry.entryKey,
    );
    if (previousIndex >= 0) pushMatch(matches, previousUsed, currentIndex, previousIndex);
  });

  return matches;
}

function buildEntryChanges(
  previousText: string | null | undefined,
  currentText: string | null | undefined,
  kind: ProjectEntryKind,
): ReviewEntryChange[] {
  const previous = makeSnapshots(previousText, kind);
  const current = makeSnapshots(currentText, kind);
  const matches = pairSnapshots(previous, current);
  const matchedPrevious = new Set(matches.values());

  const changes = current.map((currentEntry, currentIndex): ReviewEntryChange => {
    const previousIndex = matches.get(currentIndex);
    if (previousIndex === undefined) {
      return {
        status: 'added',
        entryKey: currentEntry.entryKey,
        changedFields: Object.keys(currentEntry.raw).sort(),
        current: currentEntry.preview,
        currentRaw: JSON.stringify(currentEntry.raw, null, 2),
        currentReviewText: formatEntryForReview(currentEntry.raw),
      };
    }

    const previousEntry = previous[previousIndex];
    const unchanged = previousEntry.canonical === currentEntry.canonical;
    return {
      status: unchanged ? 'unchanged' : 'modified',
      entryKey: currentEntry.entryKey,
      previousEntryKey: previousEntry.entryKey,
      changedFields: unchanged ? [] : changedTopLevelFields(previousEntry.raw, currentEntry.raw),
      current: currentEntry.preview,
      previous: previousEntry.preview,
      ...(unchanged
        ? {}
        : {
            currentRaw: JSON.stringify(currentEntry.raw, null, 2),
            currentReviewText: formatEntryForReview(currentEntry.raw),
            previousRaw: JSON.stringify(previousEntry.raw, null, 2),
            previousReviewText: formatEntryForReview(previousEntry.raw),
          }),
    };
  });

  previous.forEach((previousEntry, previousIndex) => {
    if (matchedPrevious.has(previousIndex)) return;
    changes.push({
      status: 'deleted',
      entryKey: previousEntry.entryKey,
      previousEntryKey: previousEntry.entryKey,
      changedFields: Object.keys(previousEntry.raw).sort(),
      previous: previousEntry.preview,
      previousRaw: JSON.stringify(previousEntry.raw, null, 2),
      previousReviewText: formatEntryForReview(previousEntry.raw),
    });
  });

  return changes;
}

function summarizeChanges(changes: ReviewEntryChange[]) {
  return changes.reduce(
    (summary, change) => {
      summary[change.status] += 1;
      return summary;
    },
    { added: 0, modified: 0, deleted: 0, unchanged: 0 },
  );
}

function warningsOf(entry: Record<string, unknown> | undefined): string[] {
  return Array.isArray(entry?.inspectionWarnings)
    ? entry.inspectionWarnings.filter((value): value is string => typeof value === 'string')
    : [];
}

function summarizeRiskDelta(changes: ReviewEntryChange[]) {
  let newEjs = 0;
  let newCharacterArtwork = 0;
  let newWarnings = 0;

  changes.forEach(change => {
    if (!change.current || change.status === 'deleted' || change.status === 'unchanged') return;
    if (Boolean(change.current.hasEjs) && !Boolean(change.previous?.hasEjs)) newEjs += 1;
    if (Boolean(change.current.hasCharacterArtwork) && !Boolean(change.previous?.hasCharacterArtwork)) {
      newCharacterArtwork += 1;
    }
    const previousWarnings = new Set(warningsOf(change.previous));
    warningsOf(change.current).forEach(warning => {
      if (!previousWarnings.has(warning)) newWarnings += 1;
    });
  });

  return { newEjs, newCharacterArtwork, newWarnings };
}

export function buildProjectReviewDiff(input: {
  previousWorldbookText?: string | null;
  currentWorldbookText?: string | null;
  previousRegexText?: string | null;
  currentRegexText?: string | null;
  isUpdate: boolean;
}) {
  const worldbook = buildEntryChanges(input.previousWorldbookText, input.currentWorldbookText, 'worldbook');
  const regex = buildEntryChanges(input.previousRegexText, input.currentRegexText, 'regex');
  const allChanges = [...worldbook, ...regex];
  const summary = summarizeChanges(allChanges);

  return {
    mode: input.isUpdate ? ('update' as const) : ('initial' as const),
    summary: {
      ...summary,
      changed: summary.added + summary.modified + summary.deleted,
      total: allChanges.length,
    },
    riskDelta: summarizeRiskDelta(allChanges),
    worldbook,
    regex,
  };
}
