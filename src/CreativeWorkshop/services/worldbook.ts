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
          type: (entry.constant
            ? 'constant'
            : entry.selective
              ? 'selective'
              : 'vectorized') as WorldbookEntry['strategy']['type'],
          keys: Array.isArray(entry.key) ? entry.key : [],
          keys_secondary: {
            logic: (Number(entry.selectiveLogic) === 0
              ? 'and_any'
              : 'and_all') as WorldbookEntry['strategy']['keys_secondary']['logic'],
            keys: Array.isArray(entry.keysecondary) ? entry.keysecondary : [],
          },
          scan_depth: entry.scanDepth || 'same_as_global',
        },
        position: {
          type: 'at_depth' as WorldbookEntry['position']['type'],
          depth: entry.depth || 4,
          order: entry.order || index,
          role: (entry.role || 'system') as WorldbookEntry['position']['role'],
        },
        recursion: {
          prevent_incoming: Boolean(entry.excludeRecursion),
          prevent_outgoing: Boolean(entry.preventRecursion),
          delay_until: entry.delayUntilRecursion ? 1 : null,
        },
        effect: {
          sticky: entry.sticky || null,
          cooldown: entry.cooldown || null,
          delay: entry.delay || null,
        },
        probability: entry.useProbability ? entry.probability || 100 : 100,
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
