import { fetchCreativeWorkshopProjectDetail, fetchCreativeWorkshopProjectWorldbookSource } from './project-fetch';

function getCurrentWorldbookName(): string {
  const charWorldbooks = getCharWorldbookNames('current');
  if (!charWorldbooks.primary) {
    throw new Error('当前角色卡未绑定世界书');
  }
  return charWorldbooks.primary;
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

function getStrategyType(entry: Record<string, any>): WorldbookEntry['strategy']['type'] {
  const type = _.get(entry, 'strategy.type');
  if (type === 'constant' || type === 'selective' || type === 'vectorized') return type;
  return (entry.constant ? 'constant' : entry.selective ? 'selective' : 'vectorized') as WorldbookEntry['strategy']['type'];
}

function getSecondaryLogic(entry: Record<string, any>): WorldbookEntry['strategy']['keys_secondary']['logic'] {
  const logic = _.get(entry, 'strategy.keys_secondary.logic');
  if (logic) return logic as WorldbookEntry['strategy']['keys_secondary']['logic'];
  return (Number(entry.selectiveLogic ?? 0) === 0 ? 'and_any' : 'and_all') as WorldbookEntry['strategy']['keys_secondary']['logic'];
}

function getProbability(entry: Record<string, any>) {
  if (entry.useProbability !== undefined) return entry.useProbability ? (entry.probability ?? 100) : 100;
  if (_.get(entry, 'probability') !== undefined) return _.get(entry, 'probability');
  return 100;
}

function getRecursionDelayUntil(entry: Record<string, any>) {
  if (_.get(entry, 'recursion.delay_until') !== undefined) return _.get(entry, 'recursion.delay_until');
  if (entry.delayUntilRecursion !== undefined) return entry.delayUntilRecursion ? 1 : null;
  return null;
}

export async function installCreativeWorkshopProject(projectId: string) {
  const detail = await fetchCreativeWorkshopProjectDetail(projectId);
  const worldbookName = getCurrentWorldbookName();
  const sourceEntries = await fetchCreativeWorkshopProjectWorldbookSource(detail);
  const entries = sourceEntries.length > 0 ? sourceEntries : detail.worldbookEntriesPreview || [];

  await updateWorldbookWith(worldbookName, worldbook => {
    entries.forEach((entry, index) => {
      const name = renameEntry(
        entry.comment || `条目${index + 1}`,
        detail.project.tags || [],
        detail.project.name || '未命名项目',
      );
      const existingIndex = worldbook.findIndex(
        item => item.name === name || _.get(item, 'extra.cw_entry_key') === `${projectId}:${index}`,
      );
      const payload = {
        name,
        enabled: _.isBoolean(entry.enabled) ? entry.enabled : !entry.disable,
        strategy: {
          type: getStrategyType(entry),
          keys: arrayField(entry, 'strategy.keys', 'key'),
          keys_secondary: {
            logic: getSecondaryLogic(entry),
            keys: arrayField(entry, 'strategy.keys_secondary.keys', 'keysecondary'),
          },
          scan_depth: fieldWithDefault(entry, 'strategy.scan_depth', 'scanDepth', 'same_as_global'),
        },
        position: {
          type: fieldWithDefault(entry, 'position.type', 'positionType', 'at_depth') as WorldbookEntry['position']['type'],
          depth: fieldWithDefault(entry, 'position.depth', 'depth', 4),
          order: fieldWithDefault(entry, 'position.order', 'order', index),
          role: fieldWithDefault(entry, 'position.role', 'role', 'system') as WorldbookEntry['position']['role'],
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
        probability: getProbability(entry),
        content: entry.content || '',
        comment: entry.comment || name,
        extra: {
          ..._.get(worldbook[existingIndex], 'extra', {}),
          ...(_.isObject(entry.extra) ? entry.extra : {}),
          cw_project_id: projectId,
          cw_project_name_display: detail.project.name || '未命名项目',
          cw_project_version: detail.project.version || null,
          cw_remote_version: detail.project.version || null,
          cw_entry_key: `${projectId}:${index}`,
        },
      };

      if (existingIndex >= 0) {
        worldbook[existingIndex] = {
          ...worldbook[existingIndex],
          ...payload,
          uid: worldbook[existingIndex].uid,
        };
      } else {
        worldbook.push(payload as unknown as WorldbookEntry);
      }
    });

    return worldbook;
  });

  return detail;
}

export async function uninstallCreativeWorkshopProject(projectId: string) {
  const worldbookName = getCurrentWorldbookName();
  const result = await deleteWorldbookEntries(
    worldbookName,
    entry => _.get(entry, 'extra.cw_project_id') === projectId || _.get(entry, 'extra.fate_project_name') === projectId,
  );
  return result.deleted_entries;
}

export async function updateCreativeWorkshopProject(projectId: string) {
  await uninstallCreativeWorkshopProject(projectId);
  return installCreativeWorkshopProject(projectId);
}
