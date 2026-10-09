import { getCreativeWorkshopUrl } from './config';
import { extractProjectEntries } from '../../../cloudflare/src/utils/project-content';

const CREATIVE_WORKSHOP_CACHE_KEY = 'creative_workshop_cache';
const PROJECT_DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;
const WORLDBOOK_SOURCE_CACHE_TTL_MS = 30 * 60 * 1000;

export type CreativeWorkshopProjectDetail = {
  project: Record<string, any>;
  worldbookEntriesPreview: Record<string, any>[];
  regexEntriesPreview: Record<string, any>[];
};

export type CreativeWorkshopWorldbookSourceEntry = Partial<WorldbookEntry> & Record<string, any>;

export type CreativeWorkshopTransferProgress = (stage: string, details?: { loadedBytes?: number; totalBytes?: number; source?: string }) => void;


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

export async function fetchCreativeWorkshopProjectWorldbookSource(projectDetail: CreativeWorkshopProjectDetail, onProgress?: CreativeWorkshopTransferProgress) {
  const projectId = _.get(projectDetail, 'project.id');
  const downloadUrl = _.get(projectDetail, 'project.downloadUrl');
  const projectVersion = _.isString(_.get(projectDetail, 'project.version'))
    ? String(_.get(projectDetail, 'project.version'))
    : null;
  if (!_.isString(downloadUrl) || !downloadUrl) {
    onProgress?.('download', { source: 'none' });
    return [] as CreativeWorkshopWorldbookSourceEntry[];
  }

  if (_.isString(projectId) && projectId) {
    const cached = getCachedWorldbookSource(projectId, downloadUrl, projectVersion || undefined);
    if (cached) {
      onProgress?.('download', { source: 'cache' });
      return cached;
    }
  }

  onProgress?.('download', { source: 'network' });
  try {
    const response = await fetch(downloadUrl, {
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`获取世界书原始配置失败: ${response.status}`);
    }

    let raw: unknown;
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      const statedTotal = Number(response.headers.get('content-length'));
      const totalBytes = Number.isSafeInteger(statedTotal) && statedTotal > 0 ? statedTotal : undefined;
      const decoder = new TextDecoder();
      const parts: string[] = [];
      let loadedBytes = 0;
      let previousBucket = -1;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        loadedBytes += value.byteLength;
        parts.push(decoder.decode(value, { stream: true }));
        // Limit messages without pretending that downloaded bytes equal install progress.
        const bucket = totalBytes
          ? Math.floor((loadedBytes / totalBytes) * 20)
          : Math.floor(loadedBytes / (128 * 1024));
        if (bucket !== previousBucket) {
          previousBucket = bucket;
          onProgress?.('download', {
            loadedBytes,
            ...(totalBytes && loadedBytes <= totalBytes ? { totalBytes } : {}),
          });
        }
      }
      parts.push(decoder.decode());
      onProgress?.('download', { loadedBytes, ...(totalBytes && loadedBytes === totalBytes ? { totalBytes } : {}) });
      raw = JSON.parse(parts.join(''));
    } else {
      raw = await response.json();
      onProgress?.('download', { source: 'complete' });
    }
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


/**
 * Regex-only install/update: fetch the actual published Regex JSON rather than
 * treating it as a worldbook. Its authorized /api/files/ GET is the same
 * real-download accounting path as normal worldbook downloads.
 * Deliberately not cached: each deliberate install/update is a download.
 */
export async function fetchCreativeWorkshopProjectRegexSource(
  downloadUrl: string,
  detail: CreativeWorkshopProjectDetail,
  onProgress?: CreativeWorkshopTransferProgress,
): Promise<void> {
  const projectId = String(detail.project.id || '');
  const expectedKey = 'projects/' + projectId + '/regex-' + projectId + '.json';
  const base = new URL(getCreativeWorkshopUrl());
  const url = new URL(downloadUrl);
  if (!projectId || url.origin !== base.origin ||
      decodeURIComponent(url.pathname) !== '/api/files/' + expectedKey)
    throw new Error('DLC 正则下载地址与当前工坊或项目身份不符');
  onProgress?.('download', { source: 'network' });
  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (!response.ok) throw new Error('获取 DLC 正则文件失败：' + response.status);
  const source = await response.text();
  onProgress?.('download', { loadedBytes: new TextEncoder().encode(source).byteLength });
  onProgress?.('validate');
  let raw: unknown;
  try { raw = JSON.parse(source); }
  catch { throw new Error('DLC 正则文件不是有效 JSON'); }
  const entries = extractProjectEntries(raw, 'regex');
  const preview = detail.regexEntriesPreview || [];
  if (!entries.length || entries.length !== preview.length)
    throw new Error('DLC 正则文件与项目预览条目数量不一致');
  const seen = new Set<string>();
  for (const { entry, entryKey } of entries) {
    if (seen.has(entryKey)) throw new Error('DLC 正则文件含重复条目身份');
    seen.add(entryKey);
    const expected = preview.filter(item => item.entryKey === entryKey);
    const findRegex = entry.findRegex ?? entry.find_regex;
    const replaceString = entry.replaceString ?? entry.replace_string;
    if (expected.length !== 1 || findRegex !== expected[0].findRegex ||
        replaceString !== expected[0].replaceString)
      throw new Error('DLC 正则下载内容与所选版本不一致，已停止安装');
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
