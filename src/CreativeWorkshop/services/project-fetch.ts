import { getCreativeWorkshopUrl } from './config';

export type CreativeWorkshopProjectDetail = {
  project: Record<string, any>;
  worldbookEntriesPreview: Record<string, any>[];
  regexEntriesPreview: Record<string, any>[];
};

export type CreativeWorkshopWorldbookSourceEntry = Partial<WorldbookEntry> & Record<string, any>;

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
  const downloadUrl = _.get(projectDetail, 'project.downloadUrl');
  if (!_.isString(downloadUrl) || !downloadUrl) {
    return [] as CreativeWorkshopWorldbookSourceEntry[];
  }

  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`获取世界书原始配置失败: ${response.status}`);
  }

  const raw = await response.json();
  return normalizeWorldbookSourceEntries(raw);
}

export async function fetchCreativeWorkshopProjectDetail(projectId: string): Promise<CreativeWorkshopProjectDetail> {
  const response = await fetch(`${getCreativeWorkshopUrl()}/api/projects/${projectId}`);
  if (!response.ok) {
    throw new Error(`获取云端项目详情失败: ${response.status}`);
  }

  const data = await response.json();
  if (!data?.project) {
    throw new Error('云端项目详情数据异常');
  }

  return {
    project: data.project,
    worldbookEntriesPreview: Array.isArray(data.worldbookEntriesPreview) ? data.worldbookEntriesPreview : [],
    regexEntriesPreview: Array.isArray(data.regexEntriesPreview) ? data.regexEntriesPreview : [],
  };
}
