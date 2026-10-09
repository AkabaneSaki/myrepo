import {
  createCreativeWorkshopRegexIdentityResolver,
} from './install-registry';
import { readCreativeWorkshopRegexManifest } from './regex-record';
import { fetchCreativeWorkshopProjectDetail } from './project-fetch';
import { findCreativeWorkshopInstallLocations } from './worldbook-stage';
import { formatCreativeWorkshopEntryName } from './project-type';
import {
  getCreativeWorkshopRegexIdentityKey,
  getCreativeWorkshopWorldbookMetadataString,
  stripCreativeWorkshopWorldbookMetadata,
} from './install-identity';
import {
  getCreativeWorkshopManagedRegexStableIdentityKey,
  getCreativeWorkshopRegexId,

  getReadableRegexName,
} from './regex-name';

const CREATIVE_WORKSHOP_DIFF_CACHE_KEY = 'creative_workshop_diff_cache';
const PROJECT_DIFF_CACHE_TTL_MS = 5 * 60 * 1000;
const DIFF_IDENTITY_VERSION = 5;

type CreativeWorkshopDiffStatus = 'added' | 'modified' | 'deleted';

type CreativeWorkshopDiffChange = {
  status: CreativeWorkshopDiffStatus;
  entryKey: string;
  changedFields: string[];
  current?: Record<string, any>;
  previous?: Record<string, any>;
  currentReviewText?: string;
  previousReviewText?: string;
};

type CreativeWorkshopReviewDiff = {
  mode: 'update';
  summary: {
    added: number;
    modified: number;
    deleted: number;
    unchanged: 0;
    changed: number;
    total: number;
  };
  worldbook: CreativeWorkshopDiffChange[];
  regex: CreativeWorkshopDiffChange[];
};

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
        reviewDiff: CreativeWorkshopReviewDiff;
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
  const entryKey = getCreativeWorkshopWorldbookMetadataString(entry, 'cw_entry_key');
  return {
    entryKey: entryKey || comment,
    name: entry.name,
    comment,
    content: stripCreativeWorkshopWorldbookMetadata(String(entry.content || '')),
    key: JSON.stringify(entry.strategy.keys || []),
    keysecondary: JSON.stringify(entry.strategy.keys_secondary?.keys || []),
  };
}

function normalizeRemoteEntry(
  entry: Record<string, any>,
  projectId: string,
  index: number,
  project: Record<string, any> | null | undefined,
  projectName: string,
) {
  const comment = entry.comment || '无标题';
  const rawEntryKey = _.get(entry, 'entryKey');
  const entryKey = _.isString(rawEntryKey) && rawEntryKey ? `${projectId}:${rawEntryKey}` : `${projectId}:${index}`;
  return {
    entryKey,
    name: formatCreativeWorkshopEntryName(comment, project, projectName),
    comment,
    content: stripCreativeWorkshopWorldbookMetadata(entry.content || ''),
    key: JSON.stringify(Array.isArray(entry.key) ? entry.key : []),
    keysecondary: JSON.stringify(Array.isArray(entry.keysecondary) ? entry.keysecondary : []),
  };
}

function formatDiffEntryForReview(entry: Record<string, any>): string {
  return Object.keys(entry)
    .filter(key => key !== 'entryKey' && key !== 'id')
    .sort()
    .flatMap(key => {
      const value = entry[key];
      if (typeof value === 'string' && value.includes('\n')) {
        return [`${key}:`, ...value.split('\n').map(line => `  ${line}`)];
      }
      if (typeof value === 'string') return [`${key}: ${value}`];
      if (value === undefined || value === null || typeof value === 'number' || typeof value === 'boolean') {
        return [`${key}: ${String(value)}`];
      }
      return [`${key}: ${JSON.stringify(value)}`];
    })
    .join('\n');
}

function getChangedDiffFields(previous: Record<string, any>, current: Record<string, any>): string[] {
  return Array.from(new Set([...Object.keys(previous), ...Object.keys(current)]))
    .filter(key => key !== 'entryKey' && key !== 'id')
    .filter(key => JSON.stringify(previous[key]) !== JSON.stringify(current[key]))
    .sort();
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

  const changes: CreativeWorkshopDiffChange[] = [
    ...added.map(item => ({
      status: 'added' as const,
      entryKey: keyGetter(item),
      changedFields: Object.keys(item).filter(key => key !== 'entryKey' && key !== 'id').sort(),
      current: item,
      currentReviewText: formatDiffEntryForReview(item),
    })),
    ...modified.map(item => {
      const entryKey = keyGetter(item);
      const previous = localMap.get(entryKey)!;
      return {
        status: 'modified' as const,
        entryKey,
        changedFields: getChangedDiffFields(previous, item),
        current: item,
        previous,
        currentReviewText: formatDiffEntryForReview(item),
        previousReviewText: formatDiffEntryForReview(previous),
      };
    }),
    ...removed.map(item => ({
      status: 'deleted' as const,
      entryKey: keyGetter(item),
      changedFields: Object.keys(item).filter(key => key !== 'entryKey' && key !== 'id').sort(),
      previous: item,
      previousReviewText: formatDiffEntryForReview(item),
    })),
  ];

  return { added, removed, modified, changes };
}

export async function getCreativeWorkshopProjectDiff(
  projectId: string,
  expectedVersion?: string,
  legacyProjectName?: string,
  requestedWorldbookName?: string,
) {
  const detail = await fetchCreativeWorkshopProjectDetail(projectId, expectedVersion);
  const found = await findCreativeWorkshopInstallLocations(
    projectId, legacyProjectName, requestedWorldbookName ? [requestedWorldbookName] : [], Boolean(requestedWorldbookName));
  if (requestedWorldbookName && !found.includes(requestedWorldbookName))
    throw new Error('所选世界书找不到此 DLC，无法生成准确更新差异');
  if (!requestedWorldbookName && found.length > 1)
    throw new Error('此 DLC 在多本世界书中，请先选择一处安装位置');
  const worldbookName = requestedWorldbookName || found[0] || null;
  const worldbookEntries = worldbookName && getWorldbookNames().includes(worldbookName)
    ? await getWorldbook(worldbookName)
    : [];
  const localEntries = worldbookEntries
    .filter(entry => {
      const currentProjectId = getCreativeWorkshopWorldbookMetadataString(entry, 'cw_project_id');
      const legacyName = getCreativeWorkshopWorldbookMetadataString(entry, 'fate_project_name');
      return currentProjectId === projectId ||
        legacyName === projectId ||
        Boolean(legacyProjectName && currentProjectId === legacyProjectName) ||
        Boolean(legacyProjectName && legacyName === legacyProjectName);
    })
    .map(normalizeWorldbookEntry);
  const localEntryKeys = new Set(localEntries.map(entry => entry.entryKey));
  const remoteEntries = (detail.worldbookEntriesPreview || []).map((entry, index) => {
    const normalized = normalizeRemoteEntry(
      entry,
      projectId,
      index,
      detail.project,
      detail.project.name || legacyProjectName || '未命名项目',
    );
    const legacyEntryKey = `${projectId}:${index}`;
    return !localEntryKeys.has(normalized.entryKey) && localEntryKeys.has(legacyEntryKey)
      ? { ...normalized, entryKey: legacyEntryKey }
      : normalized;
  });

  const allRegexes = getTavernRegexes({ scope: 'character', enable_state: 'all' });
  const manifest = await readCreativeWorkshopRegexManifest();
  const resolveRegexIdentity = createCreativeWorkshopRegexIdentityResolver(allRegexes, [...manifest.projects, ...manifest.pending]);
  const localRegexes = allRegexes
    .filter(regex => {
      const identity = resolveRegexIdentity(regex);
      return identity?.projectId === projectId ||
        Boolean(legacyProjectName && identity?.projectId === legacyProjectName);
    })
    .map(regex => {
      const identity = resolveRegexIdentity(regex);
      return {
      id: identity
        ? getCreativeWorkshopRegexIdentityKey(identity.projectId, identity.entryKey)
        : getCreativeWorkshopRegexId(regex),
      scriptName: String(regex.script_name || regex.id || ''),
      findRegex: regex.find_regex,
      replaceString: regex.replace_string,
      };
    });
  const remoteRegexes = (detail.regexEntriesPreview || []).map((entry, index) => ({
    id: getCreativeWorkshopManagedRegexStableIdentityKey(projectId, entry, index),
    scriptName: getReadableRegexName(detail.project.name || '未命名项目', entry, index),
    findRegex: entry.findRegex || '',
    replaceString: entry.replaceString || '',
  }));

  const localSignature = JSON.stringify({
    identityVersion: DIFF_IDENTITY_VERSION,
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
  const regexDiff = diffByKey(localRegexes, remoteRegexes, item => item.id);
  const reviewSummary = {
    added: entryDiff.added.length + regexDiff.added.length,
    modified: entryDiff.modified.length + regexDiff.modified.length,
    deleted: entryDiff.removed.length + regexDiff.removed.length,
  };
  const changedCount = reviewSummary.added + reviewSummary.modified + reviewSummary.deleted;

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
      reviewDiff: {
        mode: 'update' as const,
        summary: {
          ...reviewSummary,
          unchanged: 0 as const,
          changed: changedCount,
          total: changedCount,
        },
        worldbook: entryDiff.changes,
        regex: regexDiff.changes,
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
