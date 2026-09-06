import {
  deleteCreativeWorkshopInstallRecord,
  getCreativeWorkshopRelevantWorldbookNames,
  resolveCreativeWorkshopInstallWorldbook,
  setCreativeWorkshopInstallRecord,
} from './install-registry';
import { fetchCreativeWorkshopProjectDetail, fetchCreativeWorkshopProjectWorldbookSource } from './project-fetch';
import {
  getCreativeWorkshopFiniteNumber,
  getCreativeWorkshopPositionRole,
  getCreativeWorkshopPositionType,
  getCreativeWorkshopSecondaryLogic,
  getCreativeWorkshopStrategyType,
  getCreativeWorkshopWorldbookEntryKey,
  type CreativeWorkshopPositionType,
} from './worldbook-normalize';

function getCurrentWorldbookName(): string {
  const charWorldbooks = getCharWorldbookNames('current');
  if (!charWorldbooks.primary) throw new Error('当前角色卡未绑定世界书');
  return charWorldbooks.primary;
}

async function getInstalledWorldbookName(projectId: string, legacyProjectName?: string): Promise<string> {
  return (await resolveCreativeWorkshopInstallWorldbook(projectId, legacyProjectName)) || getCurrentWorldbookName();
}

async function ensureTargetWorldbook(worldbookName: string): Promise<string> {
  const target = worldbookName.trim();
  if (!target) throw new Error('请选择安装目标世界书');

  const existingNames = getWorldbookNames();
  if (!existingNames.includes(target)) {
    await createWorldbook(target, []);
  }

  const charWorldbooks = getCharWorldbookNames('current');
  if (target !== charWorldbooks.primary && !(charWorldbooks.additional || []).includes(target)) {
    await rebindCharWorldbooks('current', {
      primary: charWorldbooks.primary,
      additional: [...(charWorldbooks.additional || []), target],
    });
  }

  return target;
}

function renameEntry(entryName: string, tags: string[], projectName: string): string {
  if (tags.includes('系统')) {
    return entryName.startsWith('命定系统-') ? entryName : `命定系统-${entryName}`;
  }
  const type = tags.includes('角色') ? '角色' : tags.includes('事件') ? '事件' : '扩展';
  return entryName.startsWith('[DLC]') ? entryName : `[DLC][${type}][${projectName}]${entryName}`;
}

function arrayField(entry: Record<string, any>, rawPath: string, previewPath: string) {
  const rawValue = _.get(entry, rawPath);
  if (Array.isArray(rawValue)) return rawValue;
  const previewValue = _.get(entry, previewPath);
  return Array.isArray(previewValue) ? previewValue : [];
}

function fieldWithDefault<T>(entry: Record<string, any>, rawPath: string, previewPath: string, defaultValue: T): T {
  return (_.get(entry, rawPath) ?? _.get(entry, previewPath) ?? defaultValue) as T;
}

function getScanDepth(entry: Record<string, any>): WorldbookEntry['strategy']['scan_depth'] {
  const value = _.get(entry, 'strategy.scan_depth') ?? entry.scanDepth;
  if (value === undefined || value === null) return 'same_as_global';
  if (value === 'same_as_global') return value;
  if (_.isNumber(value) && Number.isFinite(value)) return value;
  throw new Error(`scanDepth 无效: ${String(value)}`);
}

function getProbability(entry: Record<string, any>) {
  if (entry.useProbability === false) return 100;
  return getCreativeWorkshopFiniteNumber(entry, 'probability', 'probability', 100);
}

function getRecursionDelayUntil(entry: Record<string, any>) {
  if (_.get(entry, 'recursion.delay_until') !== undefined) return _.get(entry, 'recursion.delay_until');
  if (entry.delayUntilRecursion !== undefined) return entry.delayUntilRecursion ? 1 : null;
  return null;
}

type PreparedEntry = {
  entry: Record<string, any>;
  index: number;
  entryKey: string;
  positionType: CreativeWorkshopPositionType;
  positionRole: WorldbookEntry['position']['role'];
  strategyType: WorldbookEntry['strategy']['type'];
  secondaryLogic: WorldbookEntry['strategy']['keys_secondary']['logic'];
  depth: number;
  order: number;
  probability: number;
  scanDepth: WorldbookEntry['strategy']['scan_depth'];
};

async function prepareCreativeWorkshopProject(projectId: string, selectedEntryKeys?: string[], expectedVersion?: string) {
  const detail = await fetchCreativeWorkshopProjectDetail(projectId, expectedVersion);
  const sourceEntries = await fetchCreativeWorkshopProjectWorldbookSource(detail);
  const entries = sourceEntries.length > 0 ? sourceEntries : detail.worldbookEntriesPreview || [];
  const selected = selectedEntryKeys ? new Set(selectedEntryKeys) : null;

  const prepared = entries
    .map((entry, index) => ({ entry, index, entryKey: getCreativeWorkshopWorldbookEntryKey(entry, index) }))
    .filter(item => !selected || selected.has(item.entryKey))
    .map(({ entry, index, entryKey }): PreparedEntry => {
      try {
        const positionType = getCreativeWorkshopPositionType(entry);
        return {
          entry,
          index,
          entryKey,
          positionType,
          positionRole: getCreativeWorkshopPositionRole(entry, positionType),
          strategyType: getCreativeWorkshopStrategyType(entry),
          secondaryLogic: getCreativeWorkshopSecondaryLogic(entry),
          depth: getCreativeWorkshopFiniteNumber(entry, 'position.depth', 'depth', 4),
          order: getCreativeWorkshopFiniteNumber(entry, 'position.order', 'order', index),
          probability: getProbability(entry),
          scanDepth: getScanDepth(entry),
        };
      } catch (error) {
        const title = entry.comment || entry.name || `条目${index + 1}`;
        throw new Error(`世界书条目「${title}」配置无效：${error instanceof Error ? error.message : String(error)}`);
      }
    });

  return { detail, prepared };
}

async function applyPreparedProject(
  projectId: string,
  detail: Record<string, any>,
  prepared: PreparedEntry[],
  worldbookName: string,
) {
  if (prepared.length === 0) return;

  await updateWorldbookWith(worldbookName, worldbook => {
    prepared.forEach(({ entry, index, entryKey, positionType, positionRole, strategyType, secondaryLogic, depth, order, probability, scanDepth }) => {
      const name = renameEntry(
        entry.comment || entry.name || `条目${index + 1}`,
        detail.project.tags || [],
        detail.project.name || '未命名项目',
      );
      const stableKey = `${projectId}:${entryKey}`;
      const legacyKey = `${projectId}:${index}`;
      const existingIndex = worldbook.findIndex(item => {
        const itemProjectId = _.get(item, 'extra.cw_project_id') ?? _.get(item, 'extra.fate_project_name');
        return (
          _.get(item, 'extra.cw_entry_key') === stableKey ||
          _.get(item, 'extra.cw_entry_key') === legacyKey ||
          (itemProjectId === projectId && item.name === name)
        );
      });
      const payload = {
        name,
        enabled: _.isBoolean(entry.enabled) ? entry.enabled : !entry.disable,
        strategy: {
          type: strategyType,
          keys: arrayField(entry, 'strategy.keys', 'key'),
          keys_secondary: {
            logic: secondaryLogic,
            keys: arrayField(entry, 'strategy.keys_secondary.keys', 'keysecondary'),
          },
          scan_depth: scanDepth,
        },
        position: {
          type: positionType,
          depth,
          order,
          role: positionRole,
        },
        recursion: {
          prevent_incoming: fieldWithDefault(entry, 'recursion.prevent_incoming', 'excludeRecursion', false),
          prevent_outgoing: fieldWithDefault(entry, 'recursion.prevent_outgoing', 'preventRecursion', false),
          delay_until: getRecursionDelayUntil(entry),
        },
        effect: {
          sticky: fieldWithDefault(entry, 'effect.sticky', 'sticky', null),
          cooldown: fieldWithDefault(entry, 'effect.cooldown', 'cooldown', null),
          delay: fieldWithDefault(entry, 'effect.delay', 'delay', null),
        },
        probability,
        content: entry.content || '',
        comment: entry.comment || entry.name || name,
        outletName: _.isString(entry.outletName) ? entry.outletName : '',
        extra: {
          ..._.get(worldbook[existingIndex], 'extra', {}),
          cw_project_id: projectId,
          cw_project_name_display: detail.project.name || '未命名项目',
          cw_project_version: detail.project.version || null,
          cw_remote_version: detail.project.version || null,
          cw_entry_key: stableKey,
        },
      };

      if (existingIndex >= 0) {
        worldbook[existingIndex] = { ...worldbook[existingIndex], ...payload, uid: worldbook[existingIndex].uid };
      } else {
        worldbook.push(payload as unknown as WorldbookEntry);
      }
    });
    return worldbook;
  });
}

function isCreativeWorkshopProjectEntry(entry: WorldbookEntry, projectId: string, legacyProjectName?: string) {
  return (
    _.get(entry, 'extra.cw_project_id') === projectId ||
    _.get(entry, 'extra.fate_project_name') === projectId ||
    Boolean(legacyProjectName && _.get(entry, 'extra.fate_project_name') === legacyProjectName)
  );
}

async function deleteProjectEntriesFromWorldbook(projectId: string, worldbookName: string, legacyProjectName?: string) {
  if (!getWorldbookNames().includes(worldbookName)) return [] as WorldbookEntry[];
  const before = await getWorldbook(worldbookName);
  if (!before.some(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName))) {
    return [] as WorldbookEntry[];
  }

  const result = await deleteWorldbookEntries(
    worldbookName,
    entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName),
    { render: 'immediate' },
  );
  if (
    result.deleted_entries.length === 0 ||
    result.worldbook.some(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName))
  ) {
    throw new Error(`世界书「${worldbookName}」中的工坊条目未成功删除`);
  }
  return result.deleted_entries;
}

async function assertNoProjectEntriesInRelevantWorldbooks(projectId: string, legacyProjectName?: string) {
  const existingNames = new Set(getWorldbookNames());
  for (const worldbookName of getCreativeWorkshopRelevantWorldbookNames(projectId, legacyProjectName)) {
    if (!existingNames.has(worldbookName)) continue;
    const entries = await getWorldbook(worldbookName);
    if (entries.some(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName))) {
      throw new Error(`卸载未完全完成：世界书「${worldbookName}」仍有工坊条目`);
    }
  }
}

async function deleteProjectEntriesFromInstalledWorldbooks(
  projectId: string,
  preferredWorldbookName: string,
  legacyProjectName?: string,
) {
  const candidates = _.uniq([
    preferredWorldbookName,
    ...getCreativeWorkshopRelevantWorldbookNames(projectId, legacyProjectName),




  ]).filter((name): name is string => _.isString(name) && Boolean(name));
  const deletedEntries: WorldbookEntry[] = [];
  for (const worldbookName of candidates) {
    deletedEntries.push(...await deleteProjectEntriesFromWorldbook(projectId, worldbookName, legacyProjectName));
  }
  return deletedEntries;
}

export async function installCreativeWorkshopProject(
  projectId: string,
  selectedEntryKeys?: string[],
  requestedWorldbookName?: string,
  expectedVersion?: string,
) {
  const { detail, prepared } = await prepareCreativeWorkshopProject(projectId, selectedEntryKeys, expectedVersion);
  const worldbookName = requestedWorldbookName
    ? await ensureTargetWorldbook(requestedWorldbookName)
    : getCurrentWorldbookName();
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

export async function updateCreativeWorkshopProject(
  projectId: string,
  expectedVersion?: string,
  legacyProjectName?: string,
) {
  const { detail, prepared } = await prepareCreativeWorkshopProject(projectId, undefined, expectedVersion);
  const worldbookName = await ensureTargetWorldbook(await getInstalledWorldbookName(projectId, legacyProjectName));
  await deleteProjectEntriesFromInstalledWorldbooks(projectId, worldbookName, legacyProjectName);
  await assertNoProjectEntriesInRelevantWorldbooks(projectId, legacyProjectName);
  await applyPreparedProject(projectId, detail, prepared, worldbookName);
  if (legacyProjectName && legacyProjectName !== projectId) {
    deleteCreativeWorkshopInstallRecord(legacyProjectName);
  }
  setCreativeWorkshopInstallRecord(projectId, worldbookName);
  return detail;
}
