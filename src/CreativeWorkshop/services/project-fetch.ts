import { getCreativeWorkshopUrl } from './config';

const CREATIVE_WORKSHOP_CACHE_KEY = 'creative_workshop_cache';
const PROJECT_DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;
const WORLDBOOK_SOURCE_CACHE_TTL_MS = 30 * 60 * 1000;

export type CreativeWorkshopProjectDetail = {
  project: Record<string, any>;
  worldbookEntriesPreview: Record<string, any>[];
  regexEntriesPreview: Record<string, any>[];
};

export type CreativeWorkshopWorldbookSourceEntry = Partial<WorldbookEntry> & Record<string, any>;

type CreativeWorkshopCacheStore = {
  projectDetails?: Record<
    string,
    {
      cachedAt: number;
      data: CreativeWorkshopProjectDetail;
    }
  >;
  worldbookSources?: Record<
    string,
    {
      cachedAt: number;
      downloadUrl: string;
      projectVersion?: string | null;
      data: CreativeWorkshopWorldbookSourceEntry[];
    }
  >;
};

function getCreativeWorkshopCacheStore(): CreativeWorkshopCacheStore {
  const variables = getVariables({ type: 'script', script_id: getScriptId() });
  const cache = _.get(variables, CREATIVE_WORKSHOP_CACHE_KEY);
  return _.isObject(cache) ? (cache as CreativeWorkshopCacheStore) : {};
}

function writeCreativeWorkshopCacheStore(cache: CreativeWorkshopCacheStore) {
  updateVariablesWith(
    variables => {
      _.set(variables, CREATIVE_WORKSHOP_CACHE_KEY, cache);
      return variables;
    },
    { type: 'script', script_id: getScriptId() },
  );
}

function pruneCreativeWorkshopCacheStore(cache: CreativeWorkshopCacheStore): CreativeWorkshopCacheStore {
  const now = Date.now();
  cache.projectDetails = _.pickBy(
    cache.projectDetails || {},
    entry => now - entry.cachedAt <= PROJECT_DETAIL_CACHE_TTL_MS * 3,
  );
  cache.worldbookSources = _.pickBy(
    cache.worldbookSources || {},
    entry => now - entry.cachedAt <= WORLDBOOK_SOURCE_CACHE_TTL_MS * 3,
  );
  return cache;
}

export function invalidateCreativeWorkshopProjectCache(projectId: string) {
  const cache = getCreativeWorkshopCacheStore();
  if (cache.projectDetails) delete cache.projectDetails[projectId];
  if (cache.worldbookSources) delete cache.worldbookSources[projectId];
  writeCreativeWorkshopCacheStore(cache);
}

function getCachedProjectDetail(projectId: string, expectedVersion?: string): CreativeWorkshopProjectDetail | null {
  const cache = getCreativeWorkshopCacheStore();
  const entry = cache.projectDetails?.[projectId];
  if (
    !entry ||
    Date.now() - entry.cachedAt > PROJECT_DETAIL_CACHE_TTL_MS ||
    (expectedVersion && _.get(entry.data, 'project.version') !== expectedVersion)
  ) {
    return null;
  }
  return entry.data;
}

function setCachedProjectDetail(projectId: string, data: CreativeWorkshopProjectDetail) {
  const cache = pruneCreativeWorkshopCacheStore(getCreativeWorkshopCacheStore());
  cache.projectDetails = cache.projectDetails || {};
  cache.projectDetails[projectId] = {
    cachedAt: Date.now(),
    data,
  };
  writeCreativeWorkshopCacheStore(cache);
}

function getCachedWorldbookSource(
  projectId: string,
  downloadUrl: string,
  projectVersion?: string,
): CreativeWorkshopWorldbookSourceEntry[] | null {
  const cache = getCreativeWorkshopCacheStore();
  const entry = cache.worldbookSources?.[projectId];
  if (
    !entry ||
    entry.downloadUrl !== downloadUrl ||
    Date.now() - entry.cachedAt > WORLDBOOK_SOURCE_CACHE_TTL_MS ||
    (projectVersion && entry.projectVersion !== projectVersion)
  ) {
    return null;
  }
  return entry.data;
}

function getAnyCachedWorldbookSource(
  projectId: string,
  downloadUrl: string,
  projectVersion?: string,
): CreativeWorkshopWorldbookSourceEntry[] | null {
  const cache = getCreativeWorkshopCacheStore();
  const entry = cache.worldbookSources?.[projectId];
  return entry?.downloadUrl === downloadUrl && (!projectVersion || entry.projectVersion === projectVersion)
    ? entry.data
    : null;
}

function setCachedWorldbookSource(
  projectId: string,
  downloadUrl: string,
  projectVersion: string | null,
  data: CreativeWorkshopWorldbookSourceEntry[],
) {
  const cache = pruneCreativeWorkshopCacheStore(getCreativeWorkshopCacheStore());
  cache.worldbookSources = cache.worldbookSources || {};
  cache.worldbookSources[projectId] = {
    cachedAt: Date.now(),
    downloadUrl,
    projectVersion,
    data,
  };
  writeCreativeWorkshopCacheStore(cache);
}

function normalizeWorldbookSourceEntries(raw: unknown): CreativeWorkshopWorldbookSourceEntry[] {
  const entryKey = (entry: Record<string, any>, index: number, objectKey?: string) => {
    if (objectKey !== undefined) return `object:${objectKey}`;
    const uid = entry.uid ?? _.get(entry, 'extensions.cw_entry_id');
    return uid !== undefined && uid !== null ? `uid:${String(uid)}` : `index:${index}`;
  };

  if (Array.isArray(raw)) {
    return raw
      .filter(_.isObject)
      .map((entry, index) => ({ ...(entry as Record<string, any>), __cwEntryKey: entryKey(entry as Record<string, any>, index) }));
  }

  const container = _.get(raw, 'entries');
  if (Array.isArray(container)) {
    return container
      .filter(_.isObject)
      .map((entry, index) => ({ ...(entry as Record<string, any>), __cwEntryKey: entryKey(entry as Record<string, any>, index) }));
  }
  if (_.isObject(container)) {
    return Object.entries(container as Record<string, unknown>)
      .filter(([, entry]) => _.isObject(entry))
      .map(([objectKey, entry], index) => ({
        ...(entry as Record<string, any>),
        __cwEntryKey: entryKey(entry as Record<string, any>, index, objectKey),
      }));
  }

  return [];
}

export async function fetchCreativeWorkshopProjectWorldbookSource(projectDetail: CreativeWorkshopProjectDetail) {
  const projectId = _.get(projectDetail, 'project.id');
  const downloadUrl = _.get(projectDetail, 'project.downloadUrl');
  const projectVersion = _.isString(_.get(projectDetail, 'project.version'))
    ? String(_.get(projectDetail, 'project.version'))
    : null;
  if (!_.isString(downloadUrl) || !downloadUrl) {
    return [] as CreativeWorkshopWorldbookSourceEntry[];
  }

  if (_.isString(projectId) && projectId) {
    const cached = getCachedWorldbookSource(projectId, downloadUrl, projectVersion || undefined);
    if (cached) {
      return cached;
    }
  }

  try {
    const response = await fetch(downloadUrl, {
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`获取世界书原始配置失败: ${response.status}`);
    }

    const raw = await response.json();
    const normalized = normalizeWorldbookSourceEntries(raw);
    if (_.isString(projectId) && projectId) {
      setCachedWorldbookSource(projectId, downloadUrl, projectVersion, normalized);
    }
    return normalized;
  } catch (error) {
    if (_.isString(projectId) && projectId) {
      const fallback = getAnyCachedWorldbookSource(projectId, downloadUrl, projectVersion || undefined);
      if (fallback) {
        console.warn('[CreativeWorkshop] 使用缓存的世界书源文件', { projectId, error });
        return fallback;
      }
    }
    throw error;
  }
}

export async function fetchCreativeWorkshopProjectDetail(
  projectId: string,
  expectedVersion?: string,
): Promise<CreativeWorkshopProjectDetail> {
  const cached = getCachedProjectDetail(projectId, expectedVersion);
  if (cached) {
    return cached;
  }

  let receivedVersionMismatch = false;
  try {
    const versionQuery = expectedVersion ? `?v=${encodeURIComponent(expectedVersion)}` : '';
    const response = await fetch(`${getCreativeWorkshopUrl()}/api/projects/${projectId}${versionQuery}`, {
      cache: expectedVersion ? 'no-store' : 'no-cache',
    });
    if (!response.ok) {
      throw new Error(`获取云端项目详情失败: ${response.status}`);
    }

    const data = await response.json();
    if (!data?.project) {
      throw new Error('云端项目详情数据异常');
    }
    if (expectedVersion && data.project.version !== expectedVersion) {
      receivedVersionMismatch = true;
      throw new Error(
        `云端项目版本不一致：期望 ${expectedVersion}，实际 ${data.project.version || '未知'}，已中止安装以避免使用旧缓存`,
      );
    }

    const normalized = {
      project: data.project,
      worldbookEntriesPreview: Array.isArray(data.worldbookEntriesPreview) ? data.worldbookEntriesPreview : [],
      regexEntriesPreview: Array.isArray(data.regexEntriesPreview) ? data.regexEntriesPreview : [],
    };

    setCachedProjectDetail(projectId, normalized);
    return normalized;
  } catch (error) {
    if (receivedVersionMismatch) throw error;
    const fallback = getCreativeWorkshopCacheStore().projectDetails?.[projectId]?.data;
    if (fallback && (!expectedVersion || _.get(fallback, 'project.version') === expectedVersion)) {
      console.warn('[CreativeWorkshop] 使用缓存的项目详情', { projectId, expectedVersion, error });
      return fallback;
    }
    throw error;
  }
}
