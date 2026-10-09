import {
  fetchCreativeWorkshopProjectDetail,
  fetchCreativeWorkshopProjectWorldbookSource,
  invalidateCreativeWorkshopProjectCache,
  type CreativeWorkshopTransferProgress,
} from './project-fetch';
import { CREATIVE_WORKSHOP_NAME_FORMAT_VERSION, formatCreativeWorkshopEntryName } from './project-type';
import { findCreativeWorkshopInstallLocations, stageAndSwitchCreativeWorkshopWorldbook, verifyCreativeWorkshopWorldbook, isCreativeWorkshopProjectEntry, writeAndReadCreativeWorkshopWorldbook, matchesCreativeWorkshopWorldbookSnapshot } from './worldbook-stage';
import { assertCreativeWorkshopSharedRegexUpdate } from './regex';
import { compareProjectVersions } from '../../../cloudflare/src/utils/version.js';
import { createCreativeWorkshopRegexIdentityResolver } from './install-registry';
import { readCreativeWorkshopRegexManifest } from './regex-record';
import {
  syncCreativeWorkshopOriginalConflicts,
} from './original-conflicts';
import {
  reconcileCreativeWorkshopWorldbookEntries,
  type CreativeWorkshopDesiredWorldbookEntry,
} from './worldbook-reconcile';
import {
  getCreativeWorkshopWorldbookMetadataString,
  injectCreativeWorkshopWorldbookMetadata,
} from './install-identity';
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

export async function ensureCreativeWorkshopTargetWorldbook(worldbookName: string): Promise<string> {
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
  const raw = _.get(entry, 'recursion.delay_until') ?? entry.delayUntilRecursion;
  return raw === true ? 1 : _.isNumber(raw) && raw > 0 ? raw : null;
}

function durationField(entry: Record<string, any>, field: string) {
  const value = fieldWithDefault(entry, 'effect.' + field, field, null);
  if (value == null || value === 0) return null;
  if (!_.isNumber(value) || !Number.isFinite(value) || value < 0) throw new Error('世界书持续时间设置无效');
  return value;
}

export type CreativeWorkshopPreparedWorldbookEntry = {
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

export async function prepareCreativeWorkshopProject(
  projectId: string,
  selectedEntryKeys?: string[],
  expectedVersion?: string,
  downloadUrlOverride?: string,
  onProgress?: CreativeWorkshopTransferProgress,
) {
  onProgress?.('download', { source: 'detail' });
  const fetchedDetail = await fetchCreativeWorkshopProjectDetail(projectId, expectedVersion);
  const detail = downloadUrlOverride
    ? { ...fetchedDetail, project: { ...fetchedDetail.project, downloadUrl: downloadUrlOverride } }
    : fetchedDetail;
  const sourceEntries = await fetchCreativeWorkshopProjectWorldbookSource(detail, onProgress);
  onProgress?.('validate');
  if (detail.project.id !== projectId || typeof detail.project.version !== 'string' || !detail.project.version ||
      (expectedVersion && detail.project.version !== expectedVersion)) throw new Error('下载包的项目身份或版本不一致，已停止安装');
  if (detail.project.downloadUrl && sourceEntries.length === 0 &&
      (detail.worldbookEntriesPreview || []).length > 0) {
    throw new Error('下载的世界书 JSON 没有有效条目，已停止安装，不会以预览数据代替完整文件');
  }
  const entries = sourceEntries.length > 0 ? sourceEntries : detail.worldbookEntriesPreview || [];
  if ((detail.worldbookEntriesPreview || []).length !== sourceEntries.length)
    throw new Error('完整世界书下载包与项目条目数量不一致，已停止安装');
  const keys = entries.map((entry, index) => getCreativeWorkshopWorldbookEntryKey(entry, index));
  if (new Set(keys).size !== keys.length || entries.some(entry => typeof entry.content !== 'string' || !entry.content.trim()))
    throw new Error('下载包条目身份重复或正文缺失，已停止安装');
  const preview = detail.worldbookEntriesPreview || [];
  for (const [index, entry] of entries.entries()) {
    const matches = preview.filter((item, n) => getCreativeWorkshopWorldbookEntryKey(item, n) === keys[index]);
    if (matches.length !== 1 || matches[0].content !== entry.content)
      throw new Error('下载包条目身份或正文与所选版本不一致，已停止安装');
  }
  const selected = selectedEntryKeys ? new Set(selectedEntryKeys) : null;
  if (selected && [...selected].some(key => !keys.includes(key))) throw new Error('选中的条目不在下载包内，请重新选择');

  const prepared = entries
    .map((entry, index) => ({ entry, index, entryKey: getCreativeWorkshopWorldbookEntryKey(entry, index) }))
    .filter(item => !selected || selected.has(item.entryKey))
    .map(({ entry, index, entryKey }): CreativeWorkshopPreparedWorldbookEntry => {
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

function buildCreativeWorkshopDesiredEntries(
  projectId: string,
  detail: Record<string, any>,
  prepared: CreativeWorkshopPreparedWorldbookEntry[],
): CreativeWorkshopDesiredWorldbookEntry[] {
  const projectName = detail.project.name || '未命名项目';
    const desiredEntries: CreativeWorkshopDesiredWorldbookEntry[] = prepared.map(
      ({ entry, index, entryKey, positionType, positionRole, strategyType, secondaryLogic, depth, order, probability, scanDepth }) => {
        const sourceName = entry.comment || entry.name || `条目${index + 1}`;
        const name = formatCreativeWorkshopEntryName(sourceName, detail.project, projectName);
        const stableKey = `${projectId}:${entryKey}`;
        const legacyKey = `${projectId}:${index}`;
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
            sticky: durationField(entry, 'sticky'),
            cooldown: durationField(entry, 'cooldown'),
            delay: durationField(entry, 'delay'),
          },
          probability,
          content: injectCreativeWorkshopWorldbookMetadata(entry.content || '', {
            cw_project_id: projectId,
            cw_project_name_display: projectName,
            cw_project_version: detail.project.version || null,
            cw_remote_version: detail.project.version || null,
            cw_entry_key: stableKey,
            cw_name_format_version: CREATIVE_WORKSHOP_NAME_FORMAT_VERSION,
          }),
          outletName: _.isString(entry.outletName) ? entry.outletName : '',
          ...Object.fromEntries(['addMemo', 'matchPersonaDescription', 'matchCharacterDescription',
            'matchCharacterPersonality', 'matchCharacterDepthPrompt', 'matchScenario', 'matchCreatorNotes',
            'group', 'groupOverride', 'groupWeight', 'caseSensitive', 'matchWholeWords', 'useGroupScoring',
            'automationId', 'ignoreBudget', 'triggers', 'characterFilter'].filter(key => entry[key] !== undefined).map(key => [key, entry[key]])),
          extra: {
            cw_project_id: projectId,
            cw_project_name_display: projectName,
            cw_project_version: detail.project.version || null,
            cw_remote_version: detail.project.version || null,
            cw_entry_key: stableKey,
            cw_name_format_version: CREATIVE_WORKSHOP_NAME_FORMAT_VERSION,
          },
        } as unknown as WorldbookEntry;

        return { payload, stableKey, legacyKey, sourceName };
      },
    );
  return desiredEntries;
}

export async function applyPreparedCreativeWorkshopProject(
  projectId: string,
  detail: Record<string, any>,
  prepared: CreativeWorkshopPreparedWorldbookEntry[],
  worldbookName: string,
  options: { pruneMissing?: boolean; legacyProjectName?: string } = {},
) {
  if (prepared.length === 0 && !options.pruneMissing) return;

  const projectName = detail.project.name || '未命名项目';
  const desiredEntries = buildCreativeWorkshopDesiredEntries(projectId, detail, prepared);
  await updateWorldbookWith(worldbookName, worldbook => {

    return reconcileCreativeWorkshopWorldbookEntries(worldbook, desiredEntries, projectId, {
      projectName,
      legacyProjectName: options.legacyProjectName,
      pruneMissing: options.pruneMissing,
    });
  });
}

async function deleteProjectEntriesFromWorldbook(projectId: string, worldbookName: string, legacyProjectName?: string, expected?: WorldbookEntry[]) {
  if (!getWorldbookNames().includes(worldbookName)) return [] as WorldbookEntry[];
  const before = await getWorldbook(worldbookName);
  if (expected && !matchesCreativeWorkshopWorldbookSnapshot(before.filter(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName)), expected))
    throw new Error('已授权删除的副本发生变化，请重新扫描并确认');
  if (!before.some(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName))) {
    return [] as WorldbookEntry[];
  }

  const owned = before.filter(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName));
  const result = await writeAndReadCreativeWorkshopWorldbook(worldbookName, () => updateWorldbookWith(worldbookName, entries => {
    for (const previous of owned) {
      const matches = entries.filter(entry => entry.uid === previous.uid);
      if (previous.uid == null || matches.length !== 1 || !matchesCreativeWorkshopWorldbookSnapshot(matches[0], previous))
        throw new Error('卸载期间条目已改变，已停止删除，请重新扫描');
    }
    return entries.filter(entry => !owned.some(previous => previous.uid === entry.uid));
  }));
  if (result.entries.some(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName)))
    throw new Error('部分完成：世界书中的 DLC 条目仍然存在，请重新扫描后重试卸载');
  return owned;
}

export async function installCreativeWorkshopProject(
  projectId: string,
  selectedEntryKeys?: string[],
  requestedWorldbookName?: string,
  expectedVersion?: string,
  manageOriginalConflicts = false,
  downloadUrlOverride?: string,
  selectedRegexEntryKeys?: string[],
  onProgress?: CreativeWorkshopTransferProgress,
) {
  invalidateCreativeWorkshopProjectCache(projectId);
  const { detail, prepared } = await prepareCreativeWorkshopProject(
    projectId,
    selectedEntryKeys,
    expectedVersion,
    downloadUrlOverride,
    onProgress,
  );
  if (prepared.length === 0) {
    await assertCreativeWorkshopSharedRegexUpdate(projectId, detail, null, undefined, selectedRegexEntryKeys);
    const originalEntryStates = manageOriginalConflicts
      ? await syncCreativeWorkshopOriginalConflicts(projectId, detail)
      : [];
    return { ...detail, installRecord: { worldbookName: null, installedVersion: detail.project.version || expectedVersion || null, originalEntryStates, worldbookEntryKeys: [] as string[] } };
  }
  const worldbookName = requestedWorldbookName
    ? await ensureCreativeWorkshopTargetWorldbook(requestedWorldbookName)
    : getCurrentWorldbookName();
  await assertCreativeWorkshopSharedRegexUpdate(projectId, detail, worldbookName, undefined, selectedRegexEntryKeys);
  const before = (await getWorldbook(worldbookName)).filter(entry => isCreativeWorkshopProjectEntry(entry, projectId));
  if (!before.length) onProgress?.('install');
  const installed = await writeAndReadCreativeWorkshopWorldbook(worldbookName, () => before.length
    ? stageAndSwitchCreativeWorkshopWorldbook(worldbookName, projectId, detail.project.version,
        buildCreativeWorkshopDesiredEntries(projectId, detail, prepared), undefined, before, onProgress)
    : applyPreparedCreativeWorkshopProject(projectId, detail, prepared, worldbookName));
  onProgress?.('worldbook_verify');
  verifyCreativeWorkshopWorldbook(worldbookName, installed.entries,
    projectId, String(detail.project.version || expectedVersion || ''),
    buildCreativeWorkshopDesiredEntries(projectId, detail, prepared));
  let originalEntryStates = [];
  if (manageOriginalConflicts) onProgress?.('conflicts');
  if (manageOriginalConflicts) {
    try {
      originalEntryStates = await syncCreativeWorkshopOriginalConflicts(projectId, detail);
    } catch (error) {
      throw new Error('DLC 已写入，但原版冲突处理失败。请重新扫描安装状态：' +
        (error instanceof Error ? error.message : String(error)));
    }
  }
  return { ...detail, installRecord: {
    worldbookName,
    installedVersion: detail.project.version || expectedVersion || null,
    originalEntryStates,
    worldbookEntryKeys: prepared.map(item => `${projectId}:${item.entryKey}`),
  } };
}

export async function uninstallCreativeWorkshopProject(
  projectId: string,
  legacyProjectName?: string,
  requestedWorldbookName?: string,
) {
  const found = await findCreativeWorkshopInstallLocations(
    projectId, legacyProjectName, requestedWorldbookName ? [requestedWorldbookName] : [], Boolean(requestedWorldbookName));
  if (requestedWorldbookName && !found.includes(requestedWorldbookName))
    throw new Error(`世界书「${requestedWorldbookName}」没有该 DLC，已停止卸载`);
  if (!requestedWorldbookName && found.length > 1)
    throw new Error('该 DLC 安装在多本世界书，请在已安装页面选择一个位置卸载');
  const target = requestedWorldbookName || found[0] || null;
  const deleted = target ? await deleteProjectEntriesFromWorldbook(projectId, target, legacyProjectName) : [];
  if (target && (await getWorldbook(target)).some(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName)))
    throw new Error(`世界书「${target}」卸载验收失败，仍有 DLC 条目`);
  // Never restore a historical original-entry enabled state.
  return deleted;
}

export async function updateCreativeWorkshopProject(
  projectId: string,
  expectedVersion?: string,
  legacyProjectName?: string,
  manageOriginalConflicts = false,
  downloadUrlOverride?: string,
  requestedWorldbookName?: string,
  approvedDuplicates: Array<{ worldbookName: string; localVersion: string | null; entryCount: number }> = [],
  onProgress?: CreativeWorkshopTransferProgress,
) {
  const found = await findCreativeWorkshopInstallLocations(
    projectId, legacyProjectName);
  if (requestedWorldbookName && !found.includes(requestedWorldbookName))
    throw new Error('所选世界书中找不到此 DLC，请重新扫描安装位置');
  if (!requestedWorldbookName && found.length > 1)
    throw new Error('此 DLC 安装在多本世界书中，请选择其中一本再更新');
  const worldbookName = requestedWorldbookName || found[0] || null;
  const removalNames = found.filter(name => name !== worldbookName);
  if (new Set(approvedDuplicates.map(item => item.worldbookName)).size !== approvedDuplicates.length ||
      approvedDuplicates.length !== removalNames.length || removalNames.some(name => !approvedDuplicates.some(item => item.worldbookName === name)))
    throw new Error('发现同一 DLC 的多个安装位置，请先选择保留的位置并明确授权删除其他副本，或取消更新');
  const duplicateSnapshots: Array<{ worldbookName: string; entries: WorldbookEntry[] }> = [];
  for (const name of removalNames) {
    const entries = (await getWorldbook(name)).filter(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName));
    const approval = approvedDuplicates.find(item => item.worldbookName === name)!;
    const versions = new Set(entries.map(entry => getCreativeWorkshopWorldbookMetadataString(entry, 'cw_project_version') || ''));
    if (versions.size !== 1 || !versions.has(String(approval.localVersion || '')) || entries.length !== approval.entryCount)
      throw new Error('重复安装的位置、版本或数量已改变，请重新扫描并确认');
    duplicateSnapshots.push({ worldbookName: name, entries });
  }
  const old = worldbookName ? (await getWorldbook(worldbookName)).filter(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName)) : undefined;
  invalidateCreativeWorkshopProjectCache(projectId);
  const { detail, prepared } = await prepareCreativeWorkshopProject(
    projectId,
    undefined,
    expectedVersion,
    downloadUrlOverride,
    onProgress,
  );
  const targetVersion = String(detail.project.version || expectedVersion || '');
  const regexes = getTavernRegexes({ scope: 'character', enable_state: 'all' });
  const manifest = await readCreativeWorkshopRegexManifest();
  const resolveRegexIdentity = createCreativeWorkshopRegexIdentityResolver(regexes, [...manifest.projects, ...manifest.pending]);
  const regexVersions = regexes.map(resolveRegexIdentity).filter(identity => identity &&
    (identity.projectId === projectId || identity.projectId === legacyProjectName)).map(identity => identity!.installedVersion);
  const currentVersions = [
    ...(old || []).map(entry => getCreativeWorkshopWorldbookMetadataString(entry, 'cw_project_version')),
    ...duplicateSnapshots.flatMap(snapshot => snapshot.entries.map(entry => getCreativeWorkshopWorldbookMetadataString(entry, 'cw_project_version'))),
    ...regexVersions,
  ];
  if (!currentVersions.length || currentVersions.some(version => compareProjectVersions(targetVersion, version) === null))
    throw new Error('无法确认实际已安装版本或目标版本，已停止更新，请重新扫描');
  const newerLocal = currentVersions.find(version => compareProjectVersions(targetVersion, version) === -1);
  if (newerLocal) throw new Error('远端版本 ' + targetVersion + ' 比本地 ' + newerLocal + ' 旧，已停止更新，避免降级');
  if (prepared.length === 0 && detail.project.downloadUrl &&
      (detail.worldbookEntriesPreview || []).length > 0) {
    throw new Error('新版世界书数据为空，已停止更新，旧版仍在');
  }
  await verifyCreativeWorkshopApprovedDuplicateState(projectId, worldbookName, duplicateSnapshots, legacyProjectName);
  await assertCreativeWorkshopSharedRegexUpdate(projectId, detail, worldbookName, legacyProjectName, undefined, removalNames);
  if (!prepared.length && old?.length) throw new Error('新版不含世界书内容，已保留现有条目，请先手动确认后再安装');
  if (prepared.length > 0) {
    if (!worldbookName) throw new Error('找不到原有的世界书安装位置，已停止更新，不能自动创建新副本');
    const desired = buildCreativeWorkshopDesiredEntries(projectId, detail, prepared);
    await stageAndSwitchCreativeWorkshopWorldbook(
      worldbookName, projectId, String(detail.project.version || expectedVersion || ''),
      desired, legacyProjectName, old, onProgress);
  }
  let originalEntryStates = [];
  if (manageOriginalConflicts) onProgress?.('conflicts');
  if (manageOriginalConflicts) {
    try { originalEntryStates = await syncCreativeWorkshopOriginalConflicts(projectId, detail); }
    catch (error) { throw new Error('部分完成：原版冲突处理未通过验收，请重新扫描：' + (error instanceof Error ? error.message : String(error))); }
  }
  return { ...detail, duplicateSnapshots,
    worldbookVerification: prepared.length && worldbookName ? { worldbookName, desired: buildCreativeWorkshopDesiredEntries(projectId, detail, prepared), version: String(detail.project.version || expectedVersion || '') } : null,
    installRecord: {
    worldbookName: prepared.length > 0 ? worldbookName : null,
    installedVersion: detail.project.version || expectedVersion || null,
    originalEntryStates,
    worldbookEntryKeys: prepared.map(item => `${projectId}:${item.entryKey}`),
  } };
}

export async function verifyCreativeWorkshopApprovedDuplicateState(projectId: string, keptName: string | null,
  snapshots: Array<{ worldbookName: string; entries: WorldbookEntry[] }>, legacyProjectName?: string) {
  const found = await findCreativeWorkshopInstallLocations(projectId, legacyProjectName);
  const expectedNames = [keptName, ...snapshots.map(item => item.worldbookName)].filter(Boolean);
  if (found.length !== expectedNames.length || found.some(name => !expectedNames.includes(name)))
    throw new Error('当前启用的 DLC 安装位置已改变，请重新扫描并确认');
  for (const snapshot of snapshots) {
    const actual = (await getWorldbook(snapshot.worldbookName)).filter(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName));
    if (!matchesCreativeWorkshopWorldbookSnapshot(actual, snapshot.entries))
      throw new Error('已授权删除的副本发生变化，请重新扫描并确认');
  }
}

export async function removeCreativeWorkshopApprovedDuplicates(projectId: string,
  snapshots: Array<{ worldbookName: string; entries: WorldbookEntry[] }>, legacyProjectName?: string,
  kept?: { worldbookName: string; desired: ReturnType<typeof buildCreativeWorkshopDesiredEntries>; version: string } | null) {
  const verifyKept = async () => {
    if (!kept) { if (snapshots.length) throw new Error('没有通过验收的保留位置，不能删除副本'); return; }
    await findCreativeWorkshopInstallLocations(projectId, legacyProjectName, [kept.worldbookName], true);
    verifyCreativeWorkshopWorldbook(kept.worldbookName, await getWorldbook(kept.worldbookName), projectId, kept.version, kept.desired, legacyProjectName);
  };
  for (let index = 0; index < snapshots.length; index++) {
    const snapshot = snapshots[index];
    await verifyCreativeWorkshopApprovedDuplicateState(projectId, kept?.worldbookName || null, snapshots.slice(index), legacyProjectName);
    await verifyKept();
    await findCreativeWorkshopInstallLocations(projectId, legacyProjectName, [snapshot.worldbookName], true);
    await deleteProjectEntriesFromWorldbook(projectId, snapshot.worldbookName, legacyProjectName, snapshot.entries);
  }
  await verifyCreativeWorkshopApprovedDuplicateState(projectId, kept?.worldbookName || null, [], legacyProjectName);
  await verifyKept();
}
