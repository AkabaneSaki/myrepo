import { fetchCreativeWorkshopProjectDetail } from './project-fetch';

export async function installCreativeWorkshopRegex(projectId: string) {
  const detail = await fetchCreativeWorkshopProjectDetail(projectId);
  const regexEntries = detail.regexEntriesPreview || [];
  if (regexEntries.length === 0) {
    return [];
  }

  return updateTavernRegexesWith(
    regexes => {
      const filtered = regexes.filter(regex => !String(regex.id || '').startsWith(`creative_workshop:${projectId}:`));
      const appended = regexEntries.map(
        (entry, index) =>
          ({
            id: `creative_workshop:${projectId}:${entry.id || index}`,
            script_name: `creative_workshop:${projectId}:${entry.id || index}`,
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

export async function uninstallCreativeWorkshopRegex(projectId: string) {
  return updateTavernRegexesWith(
    regexes => regexes.filter(regex => !String(regex.id || '').startsWith(`creative_workshop:${projectId}:`)),
    { scope: 'character' },
  );
}

export async function updateCreativeWorkshopRegex(projectId: string) {
  await uninstallCreativeWorkshopRegex(projectId);
  return installCreativeWorkshopRegex(projectId);
}
