import { getCreativeWorkshopWorldbookMetadataString } from './install-identity';
import type { CreativeWorkshopDesiredWorldbookEntry } from './worldbook-reconcile';
import { getCreativeWorkshopBoundWorldbookNames } from './install-registry';

function uid(entry: WorldbookEntry): string | null {
  return (entry as any).uid == null ? null : String((entry as any).uid);
}

export function isCreativeWorkshopProjectEntry(entry: WorldbookEntry, projectId: string, legacyName?: string): boolean {
  const id = getCreativeWorkshopWorldbookMetadataString(entry, 'cw_project_id');
  const old = getCreativeWorkshopWorldbookMetadataString(entry, 'fate_project_name');
  return id === projectId || old === projectId ||
    Boolean(legacyName && (id === legacyName || old === legacyName));
}

// Compare the fields supplied by the package, including nested configuration.
export function matchesCreativeWorkshopPayload(actual: any, expected: any): boolean {
  if (Object.prototype.toString.call(actual) === '[object RegExp]')
    return actual.toString() === (typeof expected === 'string' ? expected : expected?.toString());
  if (expected === undefined) return true;
  if (expected === null || typeof expected !== 'object') return actual === expected;
  if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length &&
    expected.every((value, index) => matchesCreativeWorkshopPayload(actual[index], value));
  return actual != null && Object.keys(expected).every(key =>
    matchesCreativeWorkshopPayload(actual[key], expected[key]));
}

export async function writeAndReadCreativeWorkshopWorldbook(name: string, write: () => Promise<unknown>) {
  let writeError: unknown;
  try { await write(); } catch (error) { writeError = error; }
  let entries: WorldbookEntry[];
  try { entries = await getWorldbook(name); } catch {
    throw new Error('状态未知：无法重新读取世界书「' + name + '」，请重新扫描后再操作');
  }
  return { entries, writeError };
}

function assertUnique(entries: WorldbookEntry[], label: string) {
  const uids = entries.map(uid);
  if (uids.some(value => value === null) || new Set(uids).size !== uids.length) {
    throw new Error(label + '的 UID 缺失或重复，不能安全更新');
  }
}

function assertSnapshots(actual: WorldbookEntry[], expected: WorldbookEntry[]) {
  for (const entry of expected) {
    const saved = actual.filter(item => uid(item) === uid(entry));
    if (saved.length !== 1 || !matchesCreativeWorkshopPayload(saved[0], entry) || !matchesCreativeWorkshopPayload(entry, saved[0]))
      throw new Error('世界书条目在写入期间被修改或缺失，已停止更新，请重新扫描');
  }
}

export function verifyCreativeWorkshopWorldbook(
  worldbookName: string,
  actual: WorldbookEntry[],
  projectId: string,
  version: string,
  desired: CreativeWorkshopDesiredWorldbookEntry[],
  legacyName?: string,
  expectedEnabled?: Map<string, boolean>,
) {
  const found = actual.filter(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyName));
  if (found.length !== desired.length) {
    throw new Error('世界书「' + worldbookName + '」安装验收失败：预期 ' + desired.length +
      ' 条，实际 ' + found.length + ' 条');
  }
  assertUnique(actual, '世界书');
  for (const item of desired) {
    const matching = found.filter(entry =>
      getCreativeWorkshopWorldbookMetadataString(entry, 'cw_entry_key') === item.stableKey);
    if (matching.length !== 1) throw new Error('安装验收失败：「' + item.sourceName + '」缺失或重复');
    const saved = matching[0];
    const { enabled, uid: ignoredUid, ...configuration } = item.payload;
    if (getCreativeWorkshopWorldbookMetadataString(saved, 'cw_project_id') !== projectId ||
        getCreativeWorkshopWorldbookMetadataString(saved, 'cw_project_version') !== version ||
        (saved as any).extra?.cw_update_stage ||
        !matchesCreativeWorkshopPayload(saved, configuration) ||
        typeof saved.enabled !== 'boolean' ||
        (expectedEnabled && saved.enabled !== (expectedEnabled.get(item.stableKey) ?? enabled))) {
      throw new Error('安装验收失败：「' + item.sourceName + '」身份、版本、内容或配置不符合下载包');
    }
  }
}

export async function findCreativeWorkshopInstallLocations(
  projectId: string,
  legacyName?: string,
  preferredNames: string[] = [],
  exactTargetOnly = false,
): Promise<string[]> {
  const existing = getWorldbookNames();
  const bound = getCreativeWorkshopBoundWorldbookNames();
  if (preferredNames.some(name => exactTargetOnly && !bound.includes(name)))
    throw new Error('所选世界书当前未启用，请重新扫描安装位置');
  const names = Array.from(new Set(exactTargetOnly ? preferredNames : bound));
  const found: string[] = [];
  for (const name of names) {
    if (!existing.includes(name)) throw new Error('状态未知：当前启用的世界书「' + name + '」不存在');
    let entries: WorldbookEntry[];
    try {
      entries = await getWorldbook(name);
    } catch {
      throw new Error('无法读取世界书「' + name + '」，位置检查不完整，已停止更新');
    }
    if (entries.some(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyName))) found.push(name);
  }
  return found;
}

/** Two-phase replacement. Every persistent write is followed by a fresh read. */
export async function stageAndSwitchCreativeWorkshopWorldbook(
  worldbookName: string,
  projectId: string,
  version: string,
  desired: CreativeWorkshopDesiredWorldbookEntry[],
  legacyName?: string,
  expectedOriginal?: WorldbookEntry[],
) {
  if (!version || !desired.length) throw new Error('新版世界书版本或内容为空，已中止更新');
  if (new Set(desired.map(item => item.stableKey)).size !== desired.length)
    throw new Error('新版 DLC 的条目身份重复，已中止更新');

  const original = await getWorldbook(worldbookName);
  assertUnique(original, '目标世界书');
  let old = original.filter(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyName));
  if (expectedOriginal && (!matchesCreativeWorkshopPayload(old, expectedOriginal) || !matchesCreativeWorkshopPayload(expectedOriginal, old)))
    throw new Error('下载期间旧版条目被修改，已停止更新，请重新扫描');
  if (!old.length) throw new Error('目标世界书中找不到旧版 DLC，无法安全更新');
  assertUnique(old, '旧版世界书');
  if (old.every(entry => !(entry as any).extra?.cw_update_stage &&
      getCreativeWorkshopWorldbookMetadataString(entry, 'cw_project_version') === version)) {
    verifyCreativeWorkshopWorldbook(worldbookName, original, projectId, version, desired, legacyName);
    return; // Worldbook phase already passed; retry only the remaining Regex phase.
  }

  // An interrupted attempt may have left disabled staged entries.
  // Only clean our own marker, after confirming the original installation still exists.
  const unfinished = old.filter(entry => Boolean((entry as any).extra?.cw_update_stage));
  if (unfinished.length) {
    const liveOld = old.filter(entry => !(entry as any).extra?.cw_update_stage);
    if (!liveOld.length || unfinished.some(entry => entry.enabled !== false)) {
      throw new Error('上次更新暂存内容已改变或旧版缺失，无法自动恢复，请使用 DLC 修复');
    }
    assertUnique(unfinished, '上次更新暂存');
    const staleIds = new Set(unfinished.map(uid));
    const recovery = await writeAndReadCreativeWorkshopWorldbook(worldbookName, () => updateWorldbookWith(worldbookName, entries => {
      for (const staged of unfinished) {
        const matches = entries.filter(entry => uid(entry) === uid(staged));
        if (matches.length !== 1 || !matchesCreativeWorkshopPayload(matches[0], staged) || !matchesCreativeWorkshopPayload(staged, matches[0]))
          throw new Error('暂存条目在恢复期间被修改，不能自动清理');
      }
      for (const previous of liveOld) {
        const matches = entries.filter(entry => uid(entry) === uid(previous));
        if (matches.length !== 1 || !matchesCreativeWorkshopPayload(matches[0], previous) || !matchesCreativeWorkshopPayload(previous, matches[0]))
          throw new Error('旧版条目在恢复期间被修改，已停止清理暂存内容');
      }
      return entries.filter(entry => !staleIds.has(uid(entry)));
    }));
    const recovered = recovery.entries;
    if (recovered.some(entry => staleIds.has(uid(entry))))
      throw new Error('上次更新暂存清理未完成，请重新检查');
    old = recovered.filter(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyName));
    if (old.length !== liveOld.length) throw new Error('恢复后旧版条目数量异常，已停止更新');
    assertUnique(old, '恢复后的旧版');
  }
  const oldUidSet = new Set(old.map(uid));
  const oldKeys = old.map(entry => getCreativeWorkshopWorldbookMetadataString(entry, 'cw_entry_key'));
  if (oldKeys.some(key => !key) || new Set(oldKeys).size !== oldKeys.length ||
      old.some(entry => !getCreativeWorkshopWorldbookMetadataString(entry, 'cw_project_version')))
    throw new Error('旧版条目的身份或版本缺失、重复，已停止更新，请先使用 DLC 修复');

  const operationId = crypto.randomUUID();
  const input = desired.map(item => ({
    ...item.payload,
    enabled: false,
    extra: { ...(item.payload as any).extra, cw_update_stage: operationId },
  }));
  const staged = await writeAndReadCreativeWorkshopWorldbook(worldbookName,
    () => createWorldbookEntries(worldbookName, input as WorldbookEntry[]));
  const afterStage = staged.entries;
  assertUnique(afterStage, '暂存后的世界书');
  assertSnapshots(afterStage, original.filter(entry => !(entry as any).extra?.cw_update_stage));
  const createdEntries = afterStage.filter(entry => (entry as any).extra?.cw_update_stage === operationId);
  if (createdEntries.length !== desired.length) {
    throw new Error('新版写入数量不完整；旧版仍保留。请重新扫描后修复暂存条目');
  }
  const newEntries = desired.map(item => {
    const matches = createdEntries.filter(entry => getCreativeWorkshopWorldbookMetadataString(entry, 'cw_entry_key') === item.stableKey);
    if (matches.length !== 1) throw new Error('新版暂存身份缺失或重复；旧版保留');
    return matches[0];
  });
  assertUnique(newEntries, '暂存新版');
  const newUids = newEntries.map(uid);
  if (newUids.some(id => oldUidSet.has(id))) throw new Error('暂存 UID 与旧版冲突，已停止替换');
  const enabledByKey = new Map<string, boolean>();
  for (const item of desired) {
    const previous = old.filter(entry => getCreativeWorkshopWorldbookMetadataString(entry, 'cw_entry_key') === item.stableKey);
    if (previous.length > 1) throw new Error('旧版条目身份重复，已停止更新');
    enabledByKey.set(item.stableKey, previous.length ? previous[0].enabled : item.payload.enabled);
  }
  for (let i = 0; i < desired.length; i++) {
    const match = afterStage.filter(entry => uid(entry) === newUids[i]);
    if (match.length !== 1 || !matchesCreativeWorkshopPayload(match[0], input[i]) ||
        getCreativeWorkshopWorldbookMetadataString(match[0], 'cw_entry_key') !== desired[i].stableKey ||
        getCreativeWorkshopWorldbookMetadataString(match[0], 'cw_project_version') !== version) {
      throw new Error('新版暂存内容验证失败；旧版保留。请重新扫描并修复暂存条目');
    }
  }

  // A single worldbook mutation switches old -> new; no cross-worldbook deletion.
  let expectedFinal: WorldbookEntry[] = [];
  const switched = await writeAndReadCreativeWorkshopWorldbook(worldbookName, () => updateWorldbookWith(worldbookName, entries => {
    for (const previous of old) {
      const matches = entries.filter(entry => uid(entry) === uid(previous));
      if (matches.length !== 1 || !matchesCreativeWorkshopPayload(matches[0], previous) || !matchesCreativeWorkshopPayload(previous, matches[0])) {
        throw new Error('更新期间旧版条目被修改，已停止替换');
      }
    }
    for (let i = 0; i < newUids.length; i++) {
      const matches = entries.filter(entry => uid(entry) === newUids[i]);
      if (matches.length !== 1 || !matchesCreativeWorkshopPayload(matches[0], newEntries[i]) || !matchesCreativeWorkshopPayload(newEntries[i], matches[0])) {
        throw new Error('新版暂存条目已改变，不能安全切换');
      }
    }
      expectedFinal = entries.filter(entry => !oldUidSet.has(uid(entry))).map(entry => {
      const index = newUids.indexOf(uid(entry));
      if (index < 0) return entry;
      const extra = { ...((entry as any).extra || {}) };
      delete extra.cw_update_stage;
      return {
        ...entry,
        enabled: enabledByKey.get(desired[index].stableKey),
        extra,
      };
    });
    return expectedFinal;
  }));
  const installed = switched.entries;
  if (switched.writeError && installed.some(entry => oldUidSet.has(uid(entry)))) throw switched.writeError;
  verifyCreativeWorkshopWorldbook(worldbookName, installed, projectId, version, desired, legacyName, enabledByKey);
  if (installed.length !== expectedFinal.length) throw new Error('世界书最终验收失败：条目数量异常，请重新扫描');
  assertSnapshots(installed, expectedFinal);
  if (installed.some(entry => oldUidSet.has(uid(entry)))) {
    throw new Error('安装验收失败：旧版 UID 仍然存在，请先重新扫描');
  }
}
