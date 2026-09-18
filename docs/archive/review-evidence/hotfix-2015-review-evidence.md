# CreativeWorkshop 2.0.15 hotfix review evidence

Scope: same-character install/update/uninstall only. Branch starts exactly at tag 2.0.14 (HEAD before changes 2ab714e011dfd6f93f0801b1567e9ac2d5d62358). Build passes.

## version.ts
```ts
export const CREATIVE_WORKSHOP_CLIENT_VERSION = '2.0.15';
```

## project-fetch.ts changed behavior
```ts
type CreativeWorkshopCacheStore = {
  projectDetails?: Record<string, { cachedAt: number; data: CreativeWorkshopProjectDetail }>;
  worldbookSources?: Record<string, {
    cachedAt: number;
    downloadUrl: string;
    projectVersion?: string | null;
    data: CreativeWorkshopWorldbookSourceEntry[];
  }>;
};

function getCachedWorldbookSource(projectId: string, downloadUrl: string, projectVersion?: string) {
  const cache = getCreativeWorkshopCacheStore();
  const entry = cache.worldbookSources?.[projectId];
  if (
    !entry ||
    entry.downloadUrl !== downloadUrl ||
    Date.now() - entry.cachedAt > WORLDBOOK_SOURCE_CACHE_TTL_MS ||
    (projectVersion && entry.projectVersion !== projectVersion)
  ) return null;
  return entry.data;
}

function getAnyCachedWorldbookSource(projectId: string, downloadUrl: string, projectVersion?: string) {
  const cache = getCreativeWorkshopCacheStore();
  const entry = cache.worldbookSources?.[projectId];
  return entry?.downloadUrl === downloadUrl && (!projectVersion || entry.projectVersion === projectVersion)
    ? entry.data
    : null;
}

function setCachedWorldbookSource(projectId: string, downloadUrl: string, projectVersion: string | null, data: CreativeWorkshopWorldbookSourceEntry[]) {
  const cache = pruneCreativeWorkshopCacheStore(getCreativeWorkshopCacheStore());
  cache.worldbookSources = cache.worldbookSources || {};
  cache.worldbookSources[projectId] = { cachedAt: Date.now(), downloadUrl, projectVersion, data };
  writeCreativeWorkshopCacheStore(cache);
}

export async function fetchCreativeWorkshopProjectWorldbookSource(projectDetail: CreativeWorkshopProjectDetail) {
  const projectId = _.get(projectDetail, 'project.id');
  const downloadUrl = _.get(projectDetail, 'project.downloadUrl');
  const projectVersion = _.isString(_.get(projectDetail, 'project.version'))
    ? String(_.get(projectDetail, 'project.version'))
    : null;
  if (!_.isString(downloadUrl) || !downloadUrl) return [] as CreativeWorkshopWorldbookSourceEntry[];

  if (_.isString(projectId) && projectId) {
    const cached = getCachedWorldbookSource(projectId, downloadUrl, projectVersion || undefined);
    if (cached) return cached;
  }

  try {
    const response = await fetch(downloadUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`获取世界书原始配置失败: ${response.status}`);
    const raw = await response.json();
    const normalized = normalizeWorldbookSourceEntries(raw);
    if (_.isString(projectId) && projectId) setCachedWorldbookSource(projectId, downloadUrl, projectVersion, normalized);
    return normalized;
  } catch (error) {
    if (_.isString(projectId) && projectId) {
      const fallback = getAnyCachedWorldbookSource(projectId, downloadUrl, projectVersion || undefined);
      if (fallback) return fallback;
    }
    throw error;
  }
}

export async function fetchCreativeWorkshopProjectDetail(projectId: string, expectedVersion?: string) {
  const cached = getCachedProjectDetail(projectId, expectedVersion);
  if (cached) return cached;
  try {
    const versionQuery = expectedVersion ? `?v=${encodeURIComponent(expectedVersion)}` : '';
    const response = await fetch(`${getCreativeWorkshopUrl()}/api/projects/${projectId}${versionQuery}`, {
      cache: expectedVersion ? 'no-store' : 'no-cache',
    });
    if (!response.ok) throw new Error(`获取云端项目详情失败: ${response.status}`);
    const data = await response.json();
    if (!data?.project) throw new Error('云端项目详情数据异常');
    if (expectedVersion && data.project.version !== expectedVersion) {
      throw new Error(`云端项目版本不一致：期望 ${expectedVersion}，实际 ${data.project.version || '未知'}，已中止安装以避免使用旧缓存`);
    }
    const normalized = { project: data.project, worldbookEntriesPreview: Array.isArray(data.worldbookEntriesPreview) ? data.worldbookEntriesPreview : [], regexEntriesPreview: Array.isArray(data.regexEntriesPreview) ? data.regexEntriesPreview : [] };
    setCachedProjectDetail(projectId, normalized);
    return normalized;
  } catch (error) {
    const fallback = getCreativeWorkshopCacheStore().projectDetails?.[projectId]?.data;
    if (fallback && (!expectedVersion || _.get(fallback, 'project.version') === expectedVersion)) return fallback;
    throw error;
  }
}
```

## worldbook.ts changed behavior
```ts
async function getInstalledWorldbookName(projectId: string, legacyProjectName?: string): Promise<string> {
  const worldbookName = await resolveCreativeWorkshopInstallWorldbook(projectId, legacyProjectName);
  if (!worldbookName) throw new Error('无法确认此项目的已安装世界书，已中止操作以避免重复安装');
  return worldbookName;
}

async function applyPreparedProject(projectId: string, detail: Record<string, any>, prepared: PreparedEntry[], worldbookName: string, option: { replaceExistingProject?: boolean; legacyProjectName?: string } = {}) {
  if (prepared.length === 0 && !option.replaceExistingProject) return;
  await updateWorldbookWith(worldbookName, worldbook => {
    if (option.replaceExistingProject) {
      _.remove(worldbook, entry => isCreativeWorkshopProjectEntry(entry, projectId, option.legacyProjectName));
    }
    prepared.forEach(({ entry, index, entryKey, positionType, positionRole, strategyType, secondaryLogic, depth, order, probability, scanDepth }) => {
      const name = renameEntry(entry.comment || entry.name || `条目${index + 1}`, detail.project.tags || [], detail.project.name || '未命名项目');
      const stableKey = `${projectId}:${entryKey}`;
      const legacyKey = `${projectId}:${index}`;
      const matchingIndexes = worldbook.reduce<number[]>((indexes, item, itemIndex) => {
        const itemProjectId = _.get(item, 'extra.cw_project_id') ?? _.get(item, 'extra.fate_project_name');
        if (_.get(item, 'extra.cw_entry_key') === stableKey || _.get(item, 'extra.cw_entry_key') === legacyKey || (itemProjectId === projectId && item.name === name)) indexes.push(itemIndex);
        return indexes;
      }, []);
      const existingIndex = matchingIndexes[0] ?? -1;
      for (let duplicateIndex = matchingIndexes.length - 1; duplicateIndex >= 1; duplicateIndex -= 1) worldbook.splice(matchingIndexes[duplicateIndex], 1);
      const payload = { /* normalized fields omitted */ extra: {
        ..._.get(worldbook[existingIndex], 'extra', {}),
        cw_project_id: projectId,
        cw_project_name_display: detail.project.name || '未命名项目',
        cw_project_version: detail.project.version || null,
        cw_remote_version: detail.project.version || null,
        cw_entry_key: stableKey,
      }};
      if (existingIndex >= 0) worldbook[existingIndex] = { ...worldbook[existingIndex], ...payload, uid: worldbook[existingIndex].uid };
      else worldbook.push(payload as unknown as WorldbookEntry);
    });
    return worldbook;
  });
}

export async function installCreativeWorkshopProject(projectId: string, selectedEntryKeys?: string[], requestedWorldbookName?: string, expectedVersion?: string) {
  const { detail, prepared } = await prepareCreativeWorkshopProject(projectId, selectedEntryKeys, expectedVersion);
  const worldbookName = requestedWorldbookName ? await ensureTargetWorldbook(requestedWorldbookName) : getCurrentWorldbookName();
  await applyPreparedProject(projectId, detail, prepared, worldbookName);
  setCreativeWorkshopInstallRecord(projectId, worldbookName);
  return detail;
}

export async function uninstallCreativeWorkshopProject(projectId: string, legacyProjectName?: string) {
  const worldbookName = await getInstalledWorldbookName(projectId, legacyProjectName);
  const deletedEntries = await deleteProjectEntriesFromInstalledWorldbooks(projectId, worldbookName, legacyProjectName);
  await assertNoProjectEntriesInRelevantWorldbooks(projectId, legacyProjectName);
  return deletedEntries;
}

export async function updateCreativeWorkshopProject(projectId: string, expectedVersion?: string, legacyProjectName?: string) {
  const { detail, prepared } = await prepareCreativeWorkshopProject(projectId, undefined, expectedVersion);
  const worldbookName = await ensureTargetWorldbook(await getInstalledWorldbookName(projectId, legacyProjectName));
  const otherWorldbooks = _.uniq(getCreativeWorkshopRelevantWorldbookNames(projectId, legacyProjectName)).filter(name => name !== worldbookName);
  for (const otherWorldbookName of otherWorldbooks) await deleteProjectEntriesFromWorldbook(projectId, otherWorldbookName, legacyProjectName);
  await applyPreparedProject(projectId, detail, prepared, worldbookName, { replaceExistingProject: true, legacyProjectName });
  const persisted = await getWorldbook(worldbookName);
  const persistedProjectEntries = persisted.filter(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName));
  if (persistedProjectEntries.length !== prepared.length) throw new Error(`世界书「${worldbookName}」更新后条目数量异常，请重试`);
  await assertNoProjectEntriesInRelevantWorldbooks(projectId, legacyProjectName, worldbookName);
  if (legacyProjectName && legacyProjectName !== projectId) deleteCreativeWorkshopInstallRecord(legacyProjectName);
  setCreativeWorkshopInstallRecord(projectId, worldbookName);
  return detail;
}
```

## bridge/host.ts mutation guard context
```ts
const projectMutationInFlight = new Set<string>();

async function handleMessage(event: MessageEvent) {
  if (event.source !== iframe.contentWindow) return;
  if (targetOrigin !== '*' && event.origin !== targetOrigin) return;
  if (!isCreativeWorkshopBridgeMessage(event.data)) return;

  const actionType = event.data.type;
  const actionProjectId = _.isString(_.get(event.data, 'payload.projectId')) ? String(event.data.payload?.projectId) : undefined;
  const isProjectMutation = actionType === 'bridge:install-project' || actionType === 'bridge:uninstall-project' || actionType === 'bridge:confirm-project-update';
  if (isProjectMutation && actionProjectId) {
    if (projectMutationInFlight.has(actionProjectId)) {
      await post('bridge:error', { message: '此项目已有安装、更新或卸载操作正在进行，请等待完成', projectId: actionProjectId, action: actionType }, event.data.requestId);
      return;
    }
    projectMutationInFlight.add(actionProjectId);
  }
  try {
    switch (event.data.type) {
      case 'bridge:install-project': /* awaits worldbook then regex then success */ break;
      case 'bridge:uninstall-project': /* awaits worldbook then regex, rescans, then success */ break;
      case 'bridge:confirm-project-update': /* awaits worldbook then regex then success */ break;
    }
  } catch (error) {
    await post('bridge:error', { message: error instanceof Error ? error.message : String(error), projectId: actionProjectId, action: actionType }, event.data.requestId);
  } finally {
    if (isProjectMutation && actionProjectId) projectMutationInFlight.delete(actionProjectId);
  }
}
```

## verification already run
- `pnpm run build`: webpack compiled successfully.
- Static smoke checks both prod/staging bundles: version 2.0.15 present; `force-cache` absent; fail-closed messages and mutation-lock message present.
