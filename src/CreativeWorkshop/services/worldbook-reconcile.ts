import { getCreativeWorkshopWorldbookMetadataString } from './install-identity';

export type CreativeWorkshopDesiredWorldbookEntry = {
  payload: WorldbookEntry;
  stableKey: string;
  legacyKey: string;
  sourceName: string;
};

export type CreativeWorkshopReconcileOptions = {
  projectName: string;
  legacyProjectName?: string;
  pruneMissing?: boolean;
};

function getEntryExtra(entry: WorldbookEntry): Record<string, any> {
  const extra = (entry as any).extra;
  return extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : {};
}

function isSameCreativeWorkshopProject(
  entry: WorldbookEntry,
  projectId: string,
  projectName: string,
  legacyProjectName?: string,
): boolean {
  const extra = getEntryExtra(entry);
  const itemProjectId = getCreativeWorkshopWorldbookMetadataString(entry, 'cw_project_id');
  const legacyName = extra.fate_project_name;
  return (
    itemProjectId === projectId ||
    legacyName === projectId ||
    Boolean(legacyProjectName && itemProjectId === legacyProjectName) ||
    Boolean(legacyProjectName && legacyName === legacyProjectName) ||
    (!itemProjectId && legacyName === projectName)
  );
}

function findExistingEntryIndex(
  worldbook: WorldbookEntry[],
  desired: CreativeWorkshopDesiredWorldbookEntry,
  projectId: string,
  options: CreativeWorkshopReconcileOptions,
  alreadyMatched: Set<number>,
): number {
  return worldbook.findIndex((entry, index) => {
    if (alreadyMatched.has(index)) return false;
    const extra = getEntryExtra(entry);
    const entryKey = getCreativeWorkshopWorldbookMetadataString(entry, 'cw_entry_key');
    if (entryKey === desired.stableKey || entryKey === desired.legacyKey) return true;
    const isConfirmedLegacyAlias = Boolean(
      options.legacyProjectName &&
        (
          getCreativeWorkshopWorldbookMetadataString(entry, 'cw_project_id') === options.legacyProjectName ||
          extra.fate_project_name === options.legacyProjectName
        ),
    );
    if (entryKey && !isConfirmedLegacyAlias) return false;
    if (!isSameCreativeWorkshopProject(entry, projectId, options.projectName, options.legacyProjectName)) return false;
    return entry.name === desired.payload.name || (entry as any).comment === desired.sourceName;
  });
}

export function reconcileCreativeWorkshopWorldbookEntries(
  worldbook: WorldbookEntry[],
  desiredEntries: CreativeWorkshopDesiredWorldbookEntry[],
  projectId: string,
  options: CreativeWorkshopReconcileOptions,
): WorldbookEntry[] {
  const matchedExisting = new Set<number>();

  for (const desired of desiredEntries) {
    const existingIndex = findExistingEntryIndex(worldbook, desired, projectId, options, matchedExisting);
    if (existingIndex >= 0) {
      const existing = worldbook[existingIndex];
      const mergedExtra = { ...getEntryExtra(existing), ...getEntryExtra(desired.payload) };
      worldbook[existingIndex] = { ...existing, ...desired.payload, extra: mergedExtra, uid: existing.uid };
      matchedExisting.add(existingIndex);
    } else {
      worldbook.push(desired.payload);
    }
  }

  if (!options.pruneMissing) return worldbook;

  const desiredKeys = new Set(desiredEntries.map(entry => entry.stableKey));
  const seenDesiredKeys = new Set<string>();
  return worldbook.filter(entry => {
    if (!isSameCreativeWorkshopProject(entry, projectId, options.projectName, options.legacyProjectName)) return true;
    const entryKey = getCreativeWorkshopWorldbookMetadataString(entry, 'cw_entry_key');
    if (typeof entryKey !== 'string' || !desiredKeys.has(entryKey) || seenDesiredKeys.has(entryKey)) return false;
    seenDesiredKeys.add(entryKey);
    return true;
  });
}
