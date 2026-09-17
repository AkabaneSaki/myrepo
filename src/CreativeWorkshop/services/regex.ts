import { setCreativeWorkshopInstallRecord } from './install-registry';
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

export async function applyPreparedCreativeWorkshopRegex(
  projectId: string,
  detail: CreativeWorkshopProjectDetail,
  regexEntries: CreativeWorkshopPreparedRegexEntry[],
  legacyProjectName?: string,
) {
  const result = await updateTavernRegexesWith(
    regexes => {
      const filtered = regexes.filter(regex => {
        const regexId = getCreativeWorkshopRegexId(regex);
        return !regexId.startsWith(`creative_workshop:${projectId}:`) &&
          !Boolean(legacyProjectName && regexId.startsWith(`creative_workshop:${legacyProjectName}:`));
      });
      const appended = regexEntries.map(
        ({ entry, originalIndex, entryKey }) =>
          ({
            id: getCreativeWorkshopManagedRegexId(projectId, { ...entry, entryKey }, originalIndex),
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
          }) as unknown as TavernRegex,
      );
      return [...filtered, ...appended];
    },
    { scope: 'character' },
  );
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

  if (regexEntries.length === 0) {
    return [];
  }

  const result = await applyPreparedCreativeWorkshopRegex(projectId, detail, regexEntries, legacyProjectName);
  setCreativeWorkshopInstallRecord(projectId, {
    installedVersion: detail.project.version || expectedVersion || null,
  });
  return result;
}

export async function uninstallCreativeWorkshopRegex(projectId: string, legacyProjectName?: string) {
  return updateTavernRegexesWith(
    regexes => regexes.filter(regex => {
      const regexId = getCreativeWorkshopRegexId(regex);
      return !regexId.startsWith(`creative_workshop:${projectId}:`) &&
        !Boolean(legacyProjectName && regexId.startsWith(`creative_workshop:${legacyProjectName}:`));
    }),
    { scope: 'character' },
  );
}

export async function updateCreativeWorkshopRegex(
  projectId: string,
  expectedVersion?: string,
  legacyProjectName?: string,
) {
  await uninstallCreativeWorkshopRegex(projectId, legacyProjectName);
  return installCreativeWorkshopRegex(projectId, undefined, expectedVersion, legacyProjectName);
}
