import { fetchCreativeWorkshopProjectDetail } from './project-fetch';
import { getCreativeWorkshopRegexId, getReadableRegexName } from './regex-name';

export async function installCreativeWorkshopRegex(
  projectId: string,
  selectedEntryKeys?: string[],
  expectedVersion?: string,
  legacyProjectName?: string,
) {
  const detail = await fetchCreativeWorkshopProjectDetail(projectId, expectedVersion);
  const selected = selectedEntryKeys ? new Set(selectedEntryKeys) : null;
  const regexEntries = (detail.regexEntriesPreview || [])
    .map((entry, originalIndex) => ({
      entry,
      originalIndex,
      entryKey: entry.entryKey || (entry.id !== undefined ? `id:${entry.id}` : `index:${originalIndex}`),
    }))
    .filter(({ entryKey }) => !selected || selected.has(entryKey));

  if (regexEntries.length === 0) {
    return [];
  }

  return updateTavernRegexesWith(
    regexes => {
      const filtered = regexes.filter(regex => {
        const regexId = getCreativeWorkshopRegexId(regex);
        return !regexId.startsWith(`creative_workshop:${projectId}:`) &&
          !Boolean(legacyProjectName && regexId.startsWith(`creative_workshop:${legacyProjectName}:`));
      });
      const appended = regexEntries.map(
        ({ entry, originalIndex, entryKey }) =>
          ({
            id: `creative_workshop:${projectId}:${entryKey}`,
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
