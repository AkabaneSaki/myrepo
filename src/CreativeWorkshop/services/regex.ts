import {
  createCreativeWorkshopRegexIdentityResolver,
  getCreativeWorkshopRegexRecordMetadata,
  setCreativeWorkshopInstallRecord,
  type CreativeWorkshopRegexInstallEntry,
} from './install-registry';
import {
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
import { compareProjectVersions } from '../../../cloudflare/src/utils/version.js';
import { readCreativeWorkshopRegexManifest, saveCreativeWorkshopRegexManifest } from './regex-record';

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
  try { await verifyCreativeWorkshopRegexInstallation(projectId, detail, legacyProjectName, selectedEntryKeys, current); return; }
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
  const manifest = await readCreativeWorkshopRegexManifest();
  let alreadyInstalled = false;
  try {
    await verifyCreativeWorkshopRegexInstallation(projectId, detail, legacyProjectName, regexEntries.map(item => item.entryKey), before);
    alreadyInstalled = true;
  } catch { /* The saved content differs; proceed through the guarded write below. */ }
  if (alreadyInstalled) {
    const resolve = createCreativeWorkshopRegexIdentityResolver(before, [...manifest.projects, ...manifest.pending]);
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

  const resolveBefore = createCreativeWorkshopRegexIdentityResolver(before, [...manifest.projects, ...manifest.pending]);
  const occupied = new Set(before.map(regex => getCreativeWorkshopRegexId(regex)));
  const pendingEntries = regexEntries.map(item => {
    const existing = before.filter(regex => {
      const identity = resolveBefore(regex);
      return identity && matchesProjectIdentity(projectId, identity.projectId, legacyProjectName) && identity.entryKey === item.entryKey;
    });
    if (existing.length > 1) throw new Error('DLC 正则身份重复，已停止更新');
    const currentVersion = existing.length ? resolveBefore(existing[0])!.installedVersion : installedVersion;
    const order = compareProjectVersions(installedVersion, currentVersion);
    if (order === null || order === -1) throw new Error('无法确认角色正则版本或远端版本较旧，已停止写入');
    const regexId = existing.length && isCreativeWorkshopUuid(existing[0].id) ? existing[0].id : allocateRegexId(occupied);
    occupied.add(regexId);
    return { regexId, entryKey: item.entryKey, installedVersion };
  });
  const pendingRecord = { schemaVersion: 1 as const, projectId, projectNameDisplay: detail.project.name || '未命名项目', installedVersion, entries: pendingEntries };
  const pendingManifest = await saveCreativeWorkshopRegexManifest(value => {
    for (const record of [...value.projects, ...value.pending].filter(record => matchesProjectIdentity(projectId, record.projectId, legacyProjectName))) {
      const order = compareProjectVersions(installedVersion, record.installedVersion);
      if (order === null || order === -1) throw new Error('主世界书中的正则版本未知或更高，已停止写入，避免降级');
    }
    return { ...value, pending: [...value.pending.filter(record => record.projectId !== projectId), pendingRecord] };
  });

  try { await updateTavernRegexesWith(
    regexes => {
      const resolveIdentity = createCreativeWorkshopRegexIdentityResolver(regexes, [...pendingManifest.projects, ...pendingManifest.pending]);
      const existingByEntryKey = new Map<string, Record<string, any>>();
      const duplicateEntryKeys = new Set<string>();

      for (const regex of regexes) {
        const identity = resolveIdentity(regex);
        if (!identity || !matchesProjectIdentity(projectId, identity.projectId, legacyProjectName)) continue;
        const versionOrder = compareProjectVersions(installedVersion, identity.installedVersion);
        if (versionOrder === null) throw new Error('无法确认实际角色正则版本，已停止写入，请重新扫描');
        if (versionOrder === -1) throw new Error('实际角色正则版本 ' + identity.installedVersion + ' 比远端 ' + installedVersion + ' 新，已停止写入，避免降级');
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

      const appended = regexEntries.map(item => {
        const { entry, entryKey } = item;
        const existing = existingByEntryKey.get(entryKey);
        const id = pendingEntries.find(record => record.entryKey === entryKey)!.regexId;
        if (occupiedIds.has(id)) throw new Error('角色正则 UUID 已被其他内容使用，已停止写入');
        occupiedIds.add(id);
        registryEntries.push({
          regexId: id,
          entryKey,
          installedVersion,
        });

        return regexPayload(detail, item, id, typeof existing?.enabled === 'boolean' ? existing.enabled : !entry.disabled);
      });

      expectedRegexes = appended;
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
  await saveCreativeWorkshopRegexManifest(value => {
    if (JSON.stringify(value.pending.find(record => record.projectId === projectId)) !== JSON.stringify(pendingRecord))
      throw new Error('角色正则待验收记录已改变，已停止完成安装');
    return { ...value,
      projects: [...value.projects.filter(record => !matchesProjectIdentity(projectId, record.projectId, legacyProjectName)), pendingRecord],
      pending: value.pending.filter(record => record.projectId !== projectId) };
  });
  await verifyCreativeWorkshopRegexInstallation(projectId, detail, legacyProjectName, regexEntries.map(item => item.entryKey));

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
  const manifest = await readCreativeWorkshopRegexManifest();
  let writeError: unknown;
  try { await updateTavernRegexesWith(
    regexes => {
      const resolveIdentity = createCreativeWorkshopRegexIdentityResolver(regexes, [...manifest.projects, ...manifest.pending]);
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
  const resolve = createCreativeWorkshopRegexIdentityResolver(result, [...manifest.projects, ...manifest.pending]);
  if (result.some(regex => matchesProjectIdentity(projectId, resolve(regex)?.projectId || getCreativeWorkshopRegexRecordMetadata(regex)?.projectId, legacyProjectName)))
    throw new Error('部分完成：角色正则仍然存在，请重新扫描并重试卸载');
  if ([...manifest.projects, ...manifest.pending].some(record => matchesProjectIdentity(projectId, record.projectId, legacyProjectName))) await saveCreativeWorkshopRegexManifest(value => ({ ...value,
    projects: value.projects.filter(record => !matchesProjectIdentity(projectId, record.projectId, legacyProjectName)),
    pending: value.pending.filter(record => !matchesProjectIdentity(projectId, record.projectId, legacyProjectName)) }));
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
export async function verifyCreativeWorkshopRegexInstallation(
  projectId: string,
  detail: CreativeWorkshopProjectDetail,
  legacyProjectName?: string,
  selectedEntryKeys?: string[],
  savedRegexes?: TavernRegex[],
) {
  const expected = prepareCreativeWorkshopRegexEntries(detail, selectedEntryKeys);
  const regexes = savedRegexes || getTavernRegexes({ scope: 'character', enable_state: 'all' });
  const manifest = await readCreativeWorkshopRegexManifest();
  const resolve = createCreativeWorkshopRegexIdentityResolver(regexes, [...manifest.projects, ...manifest.pending]);
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
  if (manifest.pending.some(record => matchesProjectIdentity(projectId, record.projectId, legacyProjectName)))
    throw new Error('角色正则写入尚未完成验收，请重新扫描后重试');
  const records = manifest.projects.filter(record => matchesProjectIdentity(projectId, record.projectId, legacyProjectName));
  if (expected.length && (records.length !== 1 || records[0].installedVersion !== version ||
      records[0].entries.length !== actual.length || records[0].entries.some(entry =>
        !actual.some(row => row.regex.id === entry.regexId && row.identity!.entryKey === entry.entryKey && entry.installedVersion === version))))
    throw new Error('主世界书中的角色正则记录不一致，无法确认安装版本');
}
