import {
  createCreativeWorkshopRegexIdentityResolver,
  getCreativeWorkshopRegexRecordMetadata,
  setCreativeWorkshopInstallRecord,
  type CreativeWorkshopRegexInstallEntry,
} from './install-registry';
import {
  buildCreativeWorkshopRegexRecordPayload,
  isCreativeWorkshopUuid,
} from './install-identity';
import { fetchCreativeWorkshopProjectDetail, type CreativeWorkshopProjectDetail } from './project-fetch';
import {
  getCreativeWorkshopManagedRegexId,
  getCreativeWorkshopRegexEntryKey,
  getCreativeWorkshopRegexId,
  getReadableRegexName,
} from './regex-name';
import { matchesCreativeWorkshopPayload, findCreativeWorkshopInstallLocations, isCreativeWorkshopProjectEntry } from './worldbook-stage';
import { getCreativeWorkshopWorldbookMetadataString } from './install-identity';

export type CreativeWorkshopPreparedRegexEntry = {
  entry: Record<string, any>;
  originalIndex: number;
  entryKey: string;
};

export function prepareCreativeWorkshopRegexEntries(
  detail: CreativeWorkshopProjectDetail,
  selectedEntryKeys?: string[],
): CreativeWorkshopPreparedRegexEntry[] {
  const selected = selectedEntryKeys ? new Set(selectedEntryKeys) : null;
  const prepared = (detail.regexEntriesPreview || [])
    .map((entry, originalIndex) => ({
      entry,
      originalIndex,
      entryKey: getCreativeWorkshopRegexEntryKey(entry, originalIndex),
    }))
    .filter(({ entryKey }) => !selected || selected.has(entryKey));
  if (new Set(prepared.map(item => item.entryKey)).size !== prepared.length ||
      prepared.some(({ entry }) => typeof entry.findRegex !== 'string' || !entry.findRegex || typeof entry.replaceString !== 'string' || ![0, false].includes(entry.substituteRegex ?? 0)))
    throw new Error('DLC 正则身份重复、内容缺失或包含当前无法保存的设置，已停止安装');
  if (selected && [...selected].some(key => !prepared.some(item => item.entryKey === key)))
    throw new Error('选中的正则条目不存在，请重新选择');
  return prepared;
}

function matchesProjectIdentity(
  projectId: string,
  candidateProjectId: string | null | undefined,
  legacyProjectName?: string,
) {
  return candidateProjectId === projectId ||
    Boolean(legacyProjectName && candidateProjectId === legacyProjectName);
}

function allocateRegexId(occupiedIds: Set<string>): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = getCreativeWorkshopManagedRegexId();
    if (!occupiedIds.has(id)) return id;
  }
  throw new Error('无法为 Workshop Regex 分配唯一 UUID');
}

function buildCreativeWorkshopRegexRecord(
  projectId: string,
  detail: CreativeWorkshopProjectDetail,
  entries: CreativeWorkshopRegexInstallEntry[],
): TavernRegex | null {
  if (!isCreativeWorkshopUuid(projectId) || entries.length === 0) return null;
  const installedVersion = detail.project.version || null;
  const projectName = detail.project.name || '未命名项目';

  return {
    id: projectId,
    script_name: `[工坊记录] ${projectName}（请勿删除）`,
    enabled: false,
    scope: 'character' as const,
    find_regex: '(?!)',
    replace_string: buildCreativeWorkshopRegexRecordPayload({
      schemaVersion: 1,
      projectId,
      projectNameDisplay: projectName,
      installedVersion,
      entries: entries.map(entry => ({
        regexId: entry.regexId,
        entryKey: entry.entryKey,
        installedVersion: entry.installedVersion ?? installedVersion,
      })),
    }),
    trim_strings: [],
    source: {
      user_input: false,
      ai_output: false,
      slash_command: false,
      world_info: false,
      reasoning: false,
    },
    destination: {
      display: false,
      prompt: false,
    },
    run_on_edit: false,
    min_depth: null,
    max_depth: null,
  } as unknown as TavernRegex;
}

function regexPayload(detail: CreativeWorkshopProjectDetail, item: CreativeWorkshopPreparedRegexEntry, id: string, enabled: boolean): TavernRegex {
  const { entry, originalIndex } = item;
  return {
    id, script_name: getReadableRegexName(detail.project.name || '未命名项目', entry, originalIndex),
    enabled, scope: 'character', find_regex: entry.findRegex || '', replace_string: entry.replaceString || '',
    trim_strings: Array.isArray(entry.trimStrings) ? entry.trimStrings : [],
    source: {
      user_input: (entry.placement || [2]).includes(1), ai_output: (entry.placement || [2]).includes(2),
      slash_command: (entry.placement || [2]).includes(3), world_info: (entry.placement || [2]).includes(5),
      reasoning: (entry.placement || [2]).includes(6),
    },
    destination: { display: Boolean(entry.markdownOnly), prompt: Boolean(entry.promptOnly) },
    run_on_edit: Boolean(entry.runOnEdit), min_depth: _.isNumber(entry.minDepth) ? entry.minDepth : null,
    max_depth: _.isNumber(entry.maxDepth) ? entry.maxDepth : null,
  } as unknown as TavernRegex;
}

export async function assertCreativeWorkshopSharedRegexUpdate(projectId: string, detail: CreativeWorkshopProjectDetail,
  targetWorldbook: string | null, legacyProjectName?: string, selectedEntryKeys?: string[], approvedRemovalBooks: string[] = []) {
  prepareCreativeWorkshopRegexEntries(detail, selectedEntryKeys);
  const current = getTavernRegexes({ scope: 'character', enable_state: 'all' });
  try { verifyCreativeWorkshopRegexInstallation(projectId, detail, legacyProjectName, selectedEntryKeys, current); return; }
  catch (error) {
    // A differing shared Regex may only be replaced when every other active installation agrees.
    for (const name of await findCreativeWorkshopInstallLocations(projectId, legacyProjectName)) {
      if (name === targetWorldbook || approvedRemovalBooks.includes(name)) continue;
      const entries = (await getWorldbook(name)).filter(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName));
      if (entries.some(entry => getCreativeWorkshopWorldbookMetadataString(entry, 'cw_project_version') !== detail.project.version))
        throw new Error('此 DLC 在世界书「' + name + '」中使用其他版本，共用的角色正则无法单独更新。请先统一这些安装的版本');
    }
  }
}

export async function applyPreparedCreativeWorkshopRegex(
  projectId: string,
  detail: CreativeWorkshopProjectDetail,
  regexEntries: CreativeWorkshopPreparedRegexEntry[],
  legacyProjectName?: string,
) {
  const installedVersion = detail.project.version || null;
  const registryEntries: CreativeWorkshopRegexInstallEntry[] = [];
  const before = getTavernRegexes({ scope: 'character', enable_state: 'all' });
  let alreadyInstalled = false;
  try {
    verifyCreativeWorkshopRegexInstallation(projectId, detail, legacyProjectName, regexEntries.map(item => item.entryKey), before);
    alreadyInstalled = true;
  } catch { /* The saved content differs; proceed through the guarded write below. */ }
  if (alreadyInstalled) {
    const resolve = createCreativeWorkshopRegexIdentityResolver(before);
    setCreativeWorkshopInstallRecord(projectId, { installedVersion, regexEntries: before.flatMap(regex => {
      const identity = resolve(regex);
      return identity && matchesProjectIdentity(projectId, identity.projectId, legacyProjectName)
        ? [{ regexId: regex.id, entryKey: identity.entryKey, installedVersion }] : [];
    }) });
    return before;
  }
  let expectedRegexes: TavernRegex[] = [];
  let expectedList: TavernRegex[] = [];
  let writeError: unknown;

  try { await updateTavernRegexesWith(
    regexes => {
      const resolveIdentity = createCreativeWorkshopRegexIdentityResolver(regexes);
      const existingByEntryKey = new Map<string, Record<string, any>>();
      const duplicateEntryKeys = new Set<string>();

      for (const regex of regexes) {
        const identity = resolveIdentity(regex);
        if (!identity || !matchesProjectIdentity(projectId, identity.projectId, legacyProjectName)) continue;
        if (existingByEntryKey.has(identity.entryKey)) {
          duplicateEntryKeys.add(identity.entryKey);
          existingByEntryKey.delete(identity.entryKey);
          continue;
        }
        if (!duplicateEntryKeys.has(identity.entryKey)) existingByEntryKey.set(identity.entryKey, regex);
      }
      if (duplicateEntryKeys.size) throw new Error('DLC 正则身份重复，请先检查角色正则，已停止更新');
      const allIds = regexes.map(regex => getCreativeWorkshopRegexId(regex));
      if (new Set(allIds).size !== allIds.length) throw new Error('角色正则的唯一标识重复，已停止更新');

      const filtered = regexes.filter(regex => {
        const record = getCreativeWorkshopRegexRecordMetadata(regex);
        if (record && matchesProjectIdentity(projectId, record.projectId, legacyProjectName)) return false;
        const identity = resolveIdentity(regex);
        return !identity || !matchesProjectIdentity(projectId, identity.projectId, legacyProjectName);
      });

      const occupiedIds = new Set(filtered.map(regex => getCreativeWorkshopRegexId(regex)));
      if (isCreativeWorkshopUuid(projectId) && occupiedIds.has(projectId)) {
        throw new Error('存在与 Workshop 项目 UUID 冲突的 Regex ID，无法安全建立工坊记录');
      }
      if (isCreativeWorkshopUuid(projectId)) occupiedIds.add(projectId);

      const appended = regexEntries.map(item => {
        const { entry, entryKey } = item;
        const existing = existingByEntryKey.get(entryKey);
        const existingId = existing ? getCreativeWorkshopRegexId(existing) : '';
        const id = isCreativeWorkshopUuid(existingId) && existingId !== projectId
          ? existingId
          : allocateRegexId(occupiedIds);
        occupiedIds.add(id);
        registryEntries.push({
          regexId: id,
          entryKey,
          installedVersion,
        });

        return regexPayload(detail, item, id, typeof existing?.enabled === 'boolean' ? existing.enabled : !entry.disabled);
      });

      const record = buildCreativeWorkshopRegexRecord(projectId, detail, registryEntries);
      expectedRegexes = record ? [...appended, record] : appended;
      expectedList = [...filtered, ...expectedRegexes];
      return expectedList;
    },
    { scope: 'character' },
  ); } catch (error) { writeError = error; }
  let actual: TavernRegex[];
  try { actual = getTavernRegexes({ scope: 'character', enable_state: 'all' }); } catch {
    throw new Error('状态未知：无法重新读取角色正则，请重新扫描后再操作');
  }
  if (!expectedRegexes.length && writeError) throw writeError;
  if (actual.length !== expectedList.length) throw new Error('部分完成：角色正则数量异常，请重新扫描并重试');
  for (const expected of expectedList) {
    const saved = actual.filter(regex => regex.id === expected.id);
    if (saved.length !== 1 || !matchesCreativeWorkshopPayload(saved[0], expected))
      throw new Error('部分完成：角色正则保存后验收失败，请重新扫描并重试');
  }
  verifyCreativeWorkshopRegexInstallation(projectId, detail, legacyProjectName, regexEntries.map(item => item.entryKey));

  setCreativeWorkshopInstallRecord(projectId, {
    installedVersion,
    regexEntries: registryEntries,
  });
  return actual;
}

export async function installCreativeWorkshopRegex(
  projectId: string,
  selectedEntryKeys?: string[],
  expectedVersion?: string,
  legacyProjectName?: string,
) {
  const detail = await fetchCreativeWorkshopProjectDetail(projectId, expectedVersion);
  const regexEntries = prepareCreativeWorkshopRegexEntries(detail, selectedEntryKeys);
  return applyPreparedCreativeWorkshopRegex(projectId, detail, regexEntries, legacyProjectName);
}

export async function uninstallCreativeWorkshopRegex(projectId: string, legacyProjectName?: string) {
  let writeError: unknown;
  try { await updateTavernRegexesWith(
    regexes => {
      const resolveIdentity = createCreativeWorkshopRegexIdentityResolver(regexes);
      return regexes.filter(regex => {
        const record = getCreativeWorkshopRegexRecordMetadata(regex);
        if (record && matchesProjectIdentity(projectId, record.projectId, legacyProjectName)) return false;
        const identity = resolveIdentity(regex);
        return !identity || !matchesProjectIdentity(projectId, identity.projectId, legacyProjectName);
      });
    },
    { scope: 'character' },
  ); } catch (error) { writeError = error; }
  let result: TavernRegex[];
  try { result = getTavernRegexes({ scope: 'character', enable_state: 'all' }); } catch {
    throw new Error('状态未知：无法重新读取角色正则，请重新扫描后再操作');
  }
  const resolve = createCreativeWorkshopRegexIdentityResolver(result);
  if (result.some(regex => matchesProjectIdentity(projectId, resolve(regex)?.projectId || getCreativeWorkshopRegexRecordMetadata(regex)?.projectId, legacyProjectName)))
    throw new Error('部分完成：角色正则仍然存在，请重新扫描并重试卸载');
  setCreativeWorkshopInstallRecord(projectId, { regexEntries: [] });
  return result;
}

export async function updateCreativeWorkshopRegex(
  projectId: string,
  expectedVersion?: string,
  legacyProjectName?: string,
) {
  const detail = await fetchCreativeWorkshopProjectDetail(projectId, expectedVersion);
  const regexEntries = prepareCreativeWorkshopRegexEntries(detail);
  return applyPreparedCreativeWorkshopRegex(projectId, detail, regexEntries, legacyProjectName);
}


/** Fresh-read verification. Only the actual SillyTavern regex list can confirm success. */
export function verifyCreativeWorkshopRegexInstallation(
  projectId: string,
  detail: CreativeWorkshopProjectDetail,
  legacyProjectName?: string,
  selectedEntryKeys?: string[],
  savedRegexes?: TavernRegex[],
) {
  const expected = prepareCreativeWorkshopRegexEntries(detail, selectedEntryKeys);
  const regexes = savedRegexes || getTavernRegexes({ scope: 'character', enable_state: 'all' });
  const resolve = createCreativeWorkshopRegexIdentityResolver(regexes);
  const actual = regexes
    .map(regex => ({ regex, identity: resolve(regex) }))
    .filter(row => row.identity && matchesProjectIdentity(projectId, row.identity.projectId, legacyProjectName));
  const ids = regexes.map(regex => regex.id);
  if (new Set(ids).size !== ids.length) throw new Error('角色正则的唯一标识重复，无法验收');
  if (actual.length !== expected.length) {
    throw new Error(`Regex 验收失败：预期 ${expected.length} 条，实际 ${actual.length} 条。世界书可能已经更新，请重新扫描`);
  }
  const version = String(detail.project.version || '');
  for (const item of expected) {
    const matches = actual.filter(row => row.identity?.entryKey === item.entryKey);
    if (matches.length !== 1) throw new Error(`Regex 验收失败：正则条目「${item.entryKey}」缺失或重复`);
    const { regex, identity } = matches[0];
    if (identity?.installedVersion !== version || typeof regex.enabled !== 'boolean' ||
        !matchesCreativeWorkshopPayload(regex, regexPayload(detail, item, regex.id, regex.enabled))) {
      throw new Error('Regex 验收失败：版本、内容或配置不一致，请重新扫描后重试');
    }
  }
  const records = regexes.filter(regex => matchesProjectIdentity(projectId, getCreativeWorkshopRegexRecordMetadata(regex)?.projectId, legacyProjectName));
  const recordPayload = buildCreativeWorkshopRegexRecord(projectId, detail, actual.map(row => ({
    regexId: row.regex.id, entryKey: row.identity!.entryKey, installedVersion: version,
  })));
  if (recordPayload ? records.length !== 1 || !matchesCreativeWorkshopPayload(records[0], recordPayload) : records.length !== 0)
    throw new Error('角色正则的工坊记录缺失、重复或设置异常，无法确认安装版本');
}
