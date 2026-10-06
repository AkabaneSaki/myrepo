import {
  createCreativeWorkshopRegexIdentityResolver,
  getCreativeWorkshopRegexRecordMetadata,
  setCreativeWorkshopInstallRecord,
  type CreativeWorkshopRegexInstallEntry,
} from './install-registry';
import {
  buildCreativeWorkshopRegexRecordPayload,
  isCreativeWorkshopUuid,
} from './install-identity';
import { fetchCreativeWorkshopProjectDetail, type CreativeWorkshopProjectDetail } from './project-fetch';
import {
  getCreativeWorkshopManagedRegexId,
  getCreativeWorkshopRegexEntryKey,
  getCreativeWorkshopRegexId,
  getReadableRegexName,
} from './regex-name';

export type CreativeWorkshopPreparedRegexEntry = {
  entry: Record<string, any>;
  originalIndex: number;
  entryKey: string;
};

export function prepareCreativeWorkshopRegexEntries(
  detail: CreativeWorkshopProjectDetail,
  selectedEntryKeys?: string[],
): CreativeWorkshopPreparedRegexEntry[] {
  const selected = selectedEntryKeys ? new Set(selectedEntryKeys) : null;
  return (detail.regexEntriesPreview || [])
    .map((entry, originalIndex) => ({
      entry,
      originalIndex,
      entryKey: getCreativeWorkshopRegexEntryKey(entry, originalIndex),
    }))
    .filter(({ entryKey }) => !selected || selected.has(entryKey));
}

function matchesProjectIdentity(
  projectId: string,
  candidateProjectId: string | null | undefined,
  legacyProjectName?: string,
) {
  return candidateProjectId === projectId ||
    Boolean(legacyProjectName && candidateProjectId === legacyProjectName);
}

function allocateRegexId(occupiedIds: Set<string>): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = getCreativeWorkshopManagedRegexId();
    if (!occupiedIds.has(id)) return id;
  }
  throw new Error('无法为 Workshop Regex 分配唯一 UUID');
}

function buildCreativeWorkshopRegexRecord(
  projectId: string,
  detail: CreativeWorkshopProjectDetail,
  entries: CreativeWorkshopRegexInstallEntry[],
): TavernRegex | null {
  if (!isCreativeWorkshopUuid(projectId) || entries.length === 0) return null;
  const installedVersion = detail.project.version || null;
  const projectName = detail.project.name || '未命名项目';

  return {
    id: projectId,
    script_name: `[工坊记录] ${projectName}（请勿删除）`,
    enabled: false,
    scope: 'character' as const,
    find_regex: '(?!)',
    replace_string: buildCreativeWorkshopRegexRecordPayload({
      schemaVersion: 1,
      projectId,
      projectNameDisplay: projectName,
      installedVersion,
      entries: entries.map(entry => ({
        regexId: entry.regexId,
        entryKey: entry.entryKey,
        installedVersion: entry.installedVersion ?? installedVersion,
      })),
    }),
    trim_strings: '',
    source: {
      user_input: false,
      ai_output: false,
      slash_command: false,
      world_info: false,
    },
    destination: {
      display: false,
      prompt: false,
    },
    run_on_edit: false,
    min_depth: null,
    max_depth: null,
    placement: [2],
    substitute_regex: 0,
  } as unknown as TavernRegex;
}

export async function applyPreparedCreativeWorkshopRegex(
  projectId: string,
  detail: CreativeWorkshopProjectDetail,
  regexEntries: CreativeWorkshopPreparedRegexEntry[],
  legacyProjectName?: string,
) {
  const installedVersion = detail.project.version || null;
  const registryEntries: CreativeWorkshopRegexInstallEntry[] = [];

  const result = await updateTavernRegexesWith(
    regexes => {
      const resolveIdentity = createCreativeWorkshopRegexIdentityResolver(regexes);
      const existingByEntryKey = new Map<string, Record<string, any>>();
      const duplicateEntryKeys = new Set<string>();

      for (const regex of regexes) {
        const identity = resolveIdentity(regex);
        if (!identity || !matchesProjectIdentity(projectId, identity.projectId, legacyProjectName)) continue;
        if (existingByEntryKey.has(identity.entryKey)) {
          duplicateEntryKeys.add(identity.entryKey);
          existingByEntryKey.delete(identity.entryKey);
          continue;
        }
        if (!duplicateEntryKeys.has(identity.entryKey)) existingByEntryKey.set(identity.entryKey, regex);
      }

      const filtered = regexes.filter(regex => {
        const record = getCreativeWorkshopRegexRecordMetadata(regex);
        if (record && matchesProjectIdentity(projectId, record.projectId, legacyProjectName)) return false;
        const identity = resolveIdentity(regex);
        return !identity || !matchesProjectIdentity(projectId, identity.projectId, legacyProjectName);
      });

      const occupiedIds = new Set(filtered.map(regex => getCreativeWorkshopRegexId(regex)));
      if (isCreativeWorkshopUuid(projectId) && occupiedIds.has(projectId)) {
        throw new Error('存在与 Workshop 项目 UUID 冲突的 Regex ID，无法安全建立工坊记录');
      }
      if (isCreativeWorkshopUuid(projectId)) occupiedIds.add(projectId);

      const appended = regexEntries.map(({ entry, originalIndex, entryKey }) => {
        const existing = existingByEntryKey.get(entryKey);
        const existingId = existing ? getCreativeWorkshopRegexId(existing) : '';
        const id = isCreativeWorkshopUuid(existingId) && existingId !== projectId
          ? existingId
          : allocateRegexId(occupiedIds);
        occupiedIds.add(id);
        registryEntries.push({
          regexId: id,
          entryKey,
          installedVersion,
        });

        return {
          id,
          script_name: getReadableRegexName(detail.project.name || '未命名项目', entry, originalIndex),
          enabled: !entry.disabled,
          scope: 'character' as const,
          find_regex: entry.findRegex || '',
          replace_string: entry.replaceString || '',
          trim_strings: Array.isArray(entry.trimStrings) ? entry.trimStrings.join('\n') : '',
          source: {
            user_input: false,
            ai_output: true,
            slash_command: false,
            world_info: false,
          },
          destination: {
            display: !entry.promptOnly,
            prompt: !entry.markdownOnly,
          },
          run_on_edit: Boolean(entry.runOnEdit),
          min_depth: _.isNumber(entry.minDepth) ? entry.minDepth : null,
          max_depth: _.isNumber(entry.maxDepth) ? entry.maxDepth : null,
          placement: Array.isArray(entry.placement) ? entry.placement : [2],
          substitute_regex: entry.substituteRegex ?? 0,
        } as unknown as TavernRegex;
      });

      const record = buildCreativeWorkshopRegexRecord(projectId, detail, registryEntries);
      return record ? [...filtered, ...appended, record] : [...filtered, ...appended];
    },
    { scope: 'character' },
  );

  setCreativeWorkshopInstallRecord(projectId, {
    installedVersion,
    regexEntries: registryEntries,
  });
  return result;
}

export async function installCreativeWorkshopRegex(
  projectId: string,
  selectedEntryKeys?: string[],
  expectedVersion?: string,
  legacyProjectName?: string,
) {
  const detail = await fetchCreativeWorkshopProjectDetail(projectId, expectedVersion);
  const regexEntries = prepareCreativeWorkshopRegexEntries(detail, selectedEntryKeys);
  return applyPreparedCreativeWorkshopRegex(projectId, detail, regexEntries, legacyProjectName);
}

export async function uninstallCreativeWorkshopRegex(projectId: string, legacyProjectName?: string) {
  const result = await updateTavernRegexesWith(
    regexes => {
      const resolveIdentity = createCreativeWorkshopRegexIdentityResolver(regexes);
      return regexes.filter(regex => {
        const record = getCreativeWorkshopRegexRecordMetadata(regex);
        if (record && matchesProjectIdentity(projectId, record.projectId, legacyProjectName)) return false;
        const identity = resolveIdentity(regex);
        return !identity || !matchesProjectIdentity(projectId, identity.projectId, legacyProjectName);
      });
    },
    { scope: 'character' },
  );
  setCreativeWorkshopInstallRecord(projectId, { regexEntries: [] });
  return result;
}

export async function updateCreativeWorkshopRegex(
  projectId: string,
  expectedVersion?: string,
  legacyProjectName?: string,
) {
  const detail = await fetchCreativeWorkshopProjectDetail(projectId, expectedVersion);
  const regexEntries = prepareCreativeWorkshopRegexEntries(detail);
  return applyPreparedCreativeWorkshopRegex(projectId, detail, regexEntries, legacyProjectName);
}
