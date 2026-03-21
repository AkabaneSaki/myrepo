import { fetchCreativeWorkshopProjectDetail } from './project-fetch';

function normalizeWorldbookEntry(entry: WorldbookEntry) {
  const comment = _.get(entry, 'comment', entry.name);
  return {
    name: entry.name,
    comment,
    content: entry.content,
    key: JSON.stringify(entry.strategy.keys || []),
    keysecondary: JSON.stringify(entry.strategy.keys_secondary?.keys || []),
  };
}

function normalizeRemoteEntry(entry: Record<string, any>) {
  return {
    name: entry.comment || '无标题',
    comment: entry.comment || '无标题',
    content: entry.content || '',
    key: JSON.stringify(Array.isArray(entry.key) ? entry.key : []),
    keysecondary: JSON.stringify(Array.isArray(entry.keysecondary) ? entry.keysecondary : []),
  };
}

function diffByKey<T extends Record<string, any>>(localItems: T[], remoteItems: T[], keyGetter: (item: T) => string) {
  const localMap = new Map(localItems.map(item => [keyGetter(item), item]));
  const remoteMap = new Map(remoteItems.map(item => [keyGetter(item), item]));

  const added = remoteItems.filter(item => !localMap.has(keyGetter(item)));
  const removed = localItems.filter(item => !remoteMap.has(keyGetter(item)));
  const modified = remoteItems.filter(item => {
    const key = keyGetter(item);
    return localMap.has(key) && JSON.stringify(localMap.get(key)) !== JSON.stringify(item);
  });

  return { added, removed, modified };
}

export async function getCreativeWorkshopProjectDiff(projectId: string) {
  const detail = await fetchCreativeWorkshopProjectDetail(projectId);
  const charWorldbooks = getCharWorldbookNames('current');
  const worldbookEntries = charWorldbooks.primary ? await getWorldbook(charWorldbooks.primary) : [];
  const localEntries = worldbookEntries
    .filter(
      entry =>
        _.get(entry, 'extra.cw_project_id') === projectId || _.get(entry, 'extra.fate_project_name') === projectId,
    )
    .map(normalizeWorldbookEntry);
  const remoteEntries = (detail.worldbookEntriesPreview || []).map(normalizeRemoteEntry);

  const localRegexes = getTavernRegexes({ scope: 'character', enable_state: 'all' })
    .filter(regex => regex.script_name.startsWith(`creative_workshop:${projectId}:`))
    .map(regex => ({
      id: regex.id,
      scriptName: regex.script_name,
      findRegex: regex.find_regex,
      replaceString: regex.replace_string,
    }));
  const remoteRegexes = (detail.regexEntriesPreview || []).map((entry, index) => ({
    id: entry.id || String(index),
    scriptName: `creative_workshop:${projectId}:${entry.scriptName || index}`,
    findRegex: entry.findRegex || '',
    replaceString: entry.replaceString || '',
  }));

  const entryDiff = diffByKey(localEntries, remoteEntries, item => item.comment);
  const regexDiff = diffByKey(localRegexes, remoteRegexes, item => item.scriptName);

  return {
    projectId,
    diff: {
      added: {
        worldbookEntries: entryDiff.added,
        regexEntries: regexDiff.added,
      },
      modified: {
        worldbookEntries: entryDiff.modified,
        regexEntries: regexDiff.modified,
      },
      removed: {
        worldbookEntries: entryDiff.removed,
        regexEntries: regexDiff.removed,
      },
    },
  };
}
