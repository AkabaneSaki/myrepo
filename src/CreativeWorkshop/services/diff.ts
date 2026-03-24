import { fetchCreativeWorkshopProjectDetail } from './project-fetch';

const CREATIVE_WORKSHOP_DIFF_CACHE_KEY = 'creative_workshop_diff_cache';
const PROJECT_DIFF_CACHE_TTL_MS = 5 * 60 * 1000;

type CreativeWorkshopDiffCache = Record<
  string,
  {
    cachedAt: number;
    localSignature: string;
    remoteVersion: string | null;
    data: {
      projectId: string;
      diff: {
        added: { worldbookEntries: Record<string, any>[]; regexEntries: Record<string, any>[] };
        modified: { worldbookEntries: Record<string, any>[]; regexEntries: Record<string, any>[] };
        removed: { worldbookEntries: Record<string, any>[]; regexEntries: Record<string, any>[] };
      };
    };
  }
>;

function getCreativeWorkshopDiffCache(): CreativeWorkshopDiffCache {
  const variables = getVariables({ type: 'script', script_id: getScriptId() });
  const cache = _.get(variables, CREATIVE_WORKSHOP_DIFF_CACHE_KEY);
  return _.isObject(cache) ? (cache as CreativeWorkshopDiffCache) : {};
}

function writeCreativeWorkshopDiffCache(cache: CreativeWorkshopDiffCache) {
  updateVariablesWith(
    variables => {
      _.set(variables, CREATIVE_WORKSHOP_DIFF_CACHE_KEY, cache);
      return variables;
    },
    { type: 'script', script_id: getScriptId() },
  );
}

function pruneCreativeWorkshopDiffCache(cache: CreativeWorkshopDiffCache): CreativeWorkshopDiffCache {
  const now = Date.now();
  return _.pickBy(cache, entry => now - entry.cachedAt <= PROJECT_DIFF_CACHE_TTL_MS * 3);
}

function normalizeWorldbookEntry(entry: WorldbookEntry) {
  const comment = _.get(entry, 'comment', entry.name);
  const entryKey = _.get(entry, 'extra.cw_entry_key');
  return {
    entryKey: _.isString(entryKey) && entryKey ? entryKey : comment,
    name: entry.name,
    comment,
    content: entry.content,
    key: JSON.stringify(entry.strategy.keys || []),
    keysecondary: JSON.stringify(entry.strategy.keys_secondary?.keys || []),
  };
}

function normalizeRemoteEntry(entry: Record<string, any>, projectId: string, index: number) {
  const comment = entry.comment || '无标题';
  return {
    entryKey: `${projectId}:${index}`,
    name: comment,
    comment,
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
  const remoteEntries = (detail.worldbookEntriesPreview || []).map((entry, index) =>
    normalizeRemoteEntry(entry, projectId, index),
  );

  const localRegexes = getTavernRegexes({ scope: 'character', enable_state: 'all' })
    .filter(
      regex =>
        String(regex.id || '').startsWith(`creative_workshop:${projectId}:`) ||
        String(regex.script_name || '').startsWith(`creative_workshop:${projectId}:`),
    )
    .map(regex => ({
      id: regex.id,
      scriptName: String(regex.id || regex.script_name || ''),
      findRegex: regex.find_regex,
      replaceString: regex.replace_string,
    }));
  const remoteRegexes = (detail.regexEntriesPreview || []).map((entry, index) => ({
    id: entry.id || String(index),
    scriptName: `creative_workshop:${projectId}:${entry.id || index}`,
    findRegex: entry.findRegex || '',
    replaceString: entry.replaceString || '',
  }));

  const localSignature = JSON.stringify({
    localEntries,
    localRegexes,
  });
  const remoteVersion = _.get(detail, 'project.version', null);
  const cached = getCreativeWorkshopDiffCache()[projectId];
  if (
    cached &&
    cached.localSignature === localSignature &&
    cached.remoteVersion === remoteVersion &&
    Date.now() - cached.cachedAt <= PROJECT_DIFF_CACHE_TTL_MS
  ) {
    return cached.data;
  }

  const entryDiff = diffByKey(localEntries, remoteEntries, item => item.entryKey);
  const regexDiff = diffByKey(localRegexes, remoteRegexes, item => item.scriptName);

  const result = {
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

  const cache = pruneCreativeWorkshopDiffCache(getCreativeWorkshopDiffCache());
  cache[projectId] = {
    cachedAt: Date.now(),
    localSignature,
    remoteVersion,
    data: result,
  };
  writeCreativeWorkshopDiffCache(cache);

  return result;
}
