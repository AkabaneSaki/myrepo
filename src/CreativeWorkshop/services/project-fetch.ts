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

function getCachedProjectDetail(projectId: string): CreativeWorkshopProjectDetail | null {
  const cache = getCreativeWorkshopCacheStore();
  const entry = cache.projectDetails?.[projectId];
  if (!entry || Date.now() - entry.cachedAt > PROJECT_DETAIL_CACHE_TTL_MS) {
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
): CreativeWorkshopWorldbookSourceEntry[] | null {
  const cache = getCreativeWorkshopCacheStore();
  const entry = cache.worldbookSources?.[projectId];
  if (!entry || entry.downloadUrl !== downloadUrl || Date.now() - entry.cachedAt > WORLDBOOK_SOURCE_CACHE_TTL_MS) {
    return null;
  }
  return entry.data;
}

function getAnyCachedWorldbookSource(projectId: string): CreativeWorkshopWorldbookSourceEntry[] | null {
  const cache = getCreativeWorkshopCacheStore();
  const entry = cache.worldbookSources?.[projectId];
  return entry ? entry.data : null;
}

function setCachedWorldbookSource(
  projectId: string,
  downloadUrl: string,
  data: CreativeWorkshopWorldbookSourceEntry[],
) {
  const cache = pruneCreativeWorkshopCacheStore(getCreativeWorkshopCacheStore());
  cache.worldbookSources = cache.worldbookSources || {};
  cache.worldbookSources[projectId] = {
    cachedAt: Date.now(),
    downloadUrl,
    data,
  };
  writeCreativeWorkshopCacheStore(cache);
}

function normalizeWorldbookSourceEntries(raw: unknown): CreativeWorkshopWorldbookSourceEntry[] {
  const entries = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { entries?: unknown[] })?.entries)
      ? (raw as { entries: unknown[] }).entries
      : (raw as { entries?: Record<string, unknown> })?.entries &&
          typeof (raw as { entries?: Record<string, unknown> }).entries === 'object'
        ? Object.values((raw as { entries: Record<string, unknown> }).entries)
        : [];

  return entries.filter(_.isObject) as CreativeWorkshopWorldbookSourceEntry[];
}

export async function fetchCreativeWorkshopProjectWorldbookSource(projectDetail: CreativeWorkshopProjectDetail) {
  const projectId = _.get(projectDetail, 'project.id');
  const downloadUrl = _.get(projectDetail, 'project.downloadUrl');
  if (!_.isString(downloadUrl) || !downloadUrl) {
    return [] as CreativeWorkshopWorldbookSourceEntry[];
  }

  if (_.isString(projectId) && projectId) {
    const cached = getCachedWorldbookSource(projectId, downloadUrl);
    if (cached) {
      return cached;
    }
  }

  try {
    const response = await fetch(downloadUrl, {
      cache: 'force-cache',
    });
    if (!response.ok) {
      throw new Error(`获取世界书原始配置失败: ${response.status}`);
    }

    const raw = await response.json();
    const normalized = normalizeWorldbookSourceEntries(raw);
    if (_.isString(projectId) && projectId) {
      setCachedWorldbookSource(projectId, downloadUrl, normalized);
    }
    return normalized;
  } catch (error) {
    if (_.isString(projectId) && projectId) {
      const fallback = getAnyCachedWorldbookSource(projectId);
      if (fallback) {
        console.warn('[CreativeWorkshop] 使用缓存的世界书源文件', { projectId, error });
        return fallback;
      }
    }
    throw error;
  }
}

export async function fetchCreativeWorkshopProjectDetail(projectId: string): Promise<CreativeWorkshopProjectDetail> {
  const cached = getCachedProjectDetail(projectId);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(`${getCreativeWorkshopUrl()}/api/projects/${projectId}`, {
      cache: 'force-cache',
    });
    if (!response.ok) {
      throw new Error(`获取云端项目详情失败: ${response.status}`);
    }

    const data = await response.json();
    if (!data?.project) {
      throw new Error('云端项目详情数据异常');
    }

    const normalized = {
      project: data.project,
      worldbookEntriesPreview: Array.isArray(data.worldbookEntriesPreview) ? data.worldbookEntriesPreview : [],
      regexEntriesPreview: Array.isArray(data.regexEntriesPreview) ? data.regexEntriesPreview : [],
    };

    setCachedProjectDetail(projectId, normalized);
    return normalized;
  } catch (error) {
    const fallback = getCreativeWorkshopCacheStore().projectDetails?.[projectId]?.data;
    if (fallback) {
      console.warn('[CreativeWorkshop] 使用缓存的项目详情', { projectId, error });
      return fallback;
    }
    throw error;
  }
}
