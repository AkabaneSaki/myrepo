import { getCreativeWorkshopWorldbookMetadataString } from './install-identity';
import { getCreativeWorkshopBoundWorldbookNames, getCreativeWorkshopInstallRecord, setCreativeWorkshopInstallRecord } from './install-registry';
import { matchesCreativeWorkshopWorldbookSnapshot } from './worldbook-stage';

function captureCharacterBindings(): () => void {
  const current = () => {
    const context = SillyTavern.getContext();
    const avatar = context.characters?.[context.characterId]?.avatar;
    if (!avatar) throw new Error('请先选择角色，再操作世界书');
    return JSON.stringify([avatar, getCharWorldbookNames('current')]);
  };
  const expected = current();
  return () => {
    if (current() !== expected) throw new Error('当前角色或绑定世界书已变化，操作已停止。请重新扫描');
  };
}

/** Create a new book and bind it to this character without overwriting existing books. */
export async function createCreativeWorkshopAdditionalWorldbook(rawName: string): Promise<string> {
  const name = rawName.trim();
  if (!name || name.length > 120 || /[\r\n]/.test(name))
    throw new Error('请输入 1–120 字的世界书名称（不能包含换行）');
  if (getWorldbookNames().some(existing => existing.toLowerCase() === name.toLowerCase()))
    throw new Error('已有同名世界书，请直接选择现有世界书');
  const assertCharacter = captureCharacterBindings();
  const bindings = getCharWorldbookNames('current');
  await createWorldbook(name, []);
  assertCharacter();
  if (!getWorldbookNames().includes(name))
    throw new Error('世界书创建后未能读取，请到 SillyTavern 检查，不要直接重试');
  try {
    await rebindCharWorldbooks('current', {
      primary: bindings.primary,
      additional: [...new Set([...(bindings.additional || []), name])],
    });
  } catch {
    throw new Error('世界书已创建，但绑定失败。请到 SillyTavern 手动绑定，勿重复创建');
  }
  if (!(getCharWorldbookNames('current').additional || []).includes(name))
    throw new Error('世界书已创建，但绑定未通过验证。请到 SillyTavern 检查');
  return name;
}

function entryUid(entry: WorldbookEntry): string {
  return String((entry as any).uid ?? '');
}

function checkUnique(entries: WorldbookEntry[], label: string): void {
  const ids = entries.map(entryUid);
  if (ids.some(id => !id) || new Set(ids).size !== ids.length)
    throw new Error(label + '的 UID 缺失或重复；迁移已停止');
}

function checkUnchanged(actual: WorldbookEntry[], expected: WorldbookEntry[], label: string): void {
  if (!matchesCreativeWorkshopWorldbookSnapshot(actual, expected) ||
      actual.some((entry, i) => entryUid(entry) !== entryUid(expected[i])))
    throw new Error(label + '在迁移过程中发生变化。请重新扫描，勿重复迁移');
}

function belonging(entries: WorldbookEntry[], projectId: string): WorldbookEntry[] {
  return entries.filter(entry =>
    getCreativeWorkshopWorldbookMetadataString(entry, 'cw_project_id') === projectId);
}

function verifyCopy(
  rows: WorldbookEntry[], projectId: string, expected: WorldbookEntry[], staged: boolean,
): void {
  const actual = belonging(rows, projectId);
  if (actual.length !== expected.length || actual.some((entry, i) =>
      !matchesCreativeWorkshopWorldbookSnapshot(entry, expected[i]) ||
      entryUid(entry) !== entryUid(expected[i]) ||
      Boolean((entry as any).extra?.cw_transfer_stage) !== staged)) {
    throw new Error('目标世界书写入或重新读取验收失败。源内容尚未主动删除；请重新扫描');
  }
}

/**
 * Source must be bound to the current character; destination may be any existing
 * worldbook without auto-binding it. Character Regex is left unchanged.
 * The source is removed only after the destination has been saved and reread.
 */
export async function transferCreativeWorkshopInstalledWorldbook(
  projectId: string,
  sourceName: string,
  targetName: string,
): Promise<void> {
  if (!projectId || !sourceName || !targetName || sourceName === targetName)
    throw new Error('请选择不同的来源与目标世界书');
  const assertCharacter = captureCharacterBindings();
  const bindings = getCharWorldbookNames('current');
  const allowed = new Set([bindings.primary, ...(bindings.additional || [])].filter(Boolean));
  const scanned = new Set(getCreativeWorkshopBoundWorldbookNames());
  if (!allowed.has(sourceName) ||
      !scanned.has(sourceName))
    throw new Error('来源必须是当前角色已绑定、可扫描的主／附加世界书');
  if (!getWorldbookNames().includes(sourceName) || !getWorldbookNames().includes(targetName))
    throw new Error('来源或目标世界书不存在；未作任何修改');

  const [sourceBefore, targetBefore] = await Promise.all([
    getWorldbook(sourceName), getWorldbook(targetName),
  ]);
  assertCharacter();
  checkUnique(sourceBefore, '来源世界书');
  checkUnique(targetBefore, '目标世界书');
  const original = belonging(sourceBefore, projectId);
  if (!original.length) throw new Error('来源中没有此 DLC 的世界书条目；Regex-only 项目不能执行世界书迁移');
  const identityKeys = original.map(entry =>
    getCreativeWorkshopWorldbookMetadataString(entry, 'cw_entry_key'));
  if (identityKeys.some(key => !key) || new Set(identityKeys).size !== original.length)
    throw new Error('来源 DLC 缺少唯一的现代条目身份，请先用 DLC 修复，不自动迁移');

  if (belonging(targetBefore, projectId).length)
    throw new Error('目标世界书已包含此 DLC，请先检查重复安装，禁止覆盖');
  if (original.some(entry => Boolean((entry as any).extra?.cw_transfer_stage)))
    throw new Error('来源含未完成的迁移暂存条目，请先人工核对');

  const maxUid = Math.max(0, ...targetBefore.map(entry => Number(entryUid(entry)))
    .filter(value => Number.isSafeInteger(value) && value >= 0));
  if (!Number.isSafeInteger(maxUid + original.length + 1))
    throw new Error('目标世界书 UID 空间已耗尽');
  const stageEntries = original.map((entry, i) => ({
    ...structuredClone(entry),
    uid: maxUid + 1 + i,
    enabled: false,
    extra: { ...structuredClone((entry as any).extra || {}), cw_transfer_stage: true },
  })) as WorldbookEntry[];

  // Stage a disabled copy before touching any source entry.
  await updateWorldbookWith(targetName, rows => {
    assertCharacter();
    checkUnchanged(rows, targetBefore, '目标世界书');
    return [...rows, ...stageEntries];
  });
  const staged = await getWorldbook(targetName);
  assertCharacter();
  checkUnique(staged, '目标世界书暂存');
  verifyCopy(staged, projectId, stageEntries, true);

  // Fail closed if the source was edited while the disabled copy was staged.
  checkUnchanged(await getWorldbook(sourceName), sourceBefore, '来源世界书');
  const finalEntries = stageEntries.map((entry, i) => ({
    ...entry,
    enabled: original[i].enabled,
    extra: Object.fromEntries(Object.entries((entry as any).extra || {})
      .filter(([key]) => key !== 'cw_transfer_stage')),
  })) as WorldbookEntry[];

  await updateWorldbookWith(targetName, rows => {
    assertCharacter();
    checkUnchanged(rows, staged, '目标世界书暂存');
    return rows.map(entry => {
      const index = stageEntries.findIndex(item => entryUid(item) === entryUid(entry));
      return index === -1 ? entry : finalEntries[index];
    });
  });
  const activated = await getWorldbook(targetName);
  assertCharacter();
  verifyCopy(activated, projectId, finalEntries, false);
  checkUnchanged(await getWorldbook(sourceName), sourceBefore, '来源世界书');

  // Destination is now readable and active; only then remove exact source UIDs.
  checkUnchanged(await getWorldbook(targetName), activated, '目标世界书');
  const originalUids = new Set(original.map(entryUid));
  await updateWorldbookWith(sourceName, rows => {
    assertCharacter();
    checkUnchanged(rows, sourceBefore, '来源世界书');
    return rows.filter(entry => !originalUids.has(entryUid(entry)));
  });
  const [sourceAfter, targetAfter] = await Promise.all([
    getWorldbook(sourceName), getWorldbook(targetName),
  ]);
  assertCharacter();
  if (belonging(sourceAfter, projectId).length)
    throw new Error('部分完成：来源世界书仍残留 DLC 条目，请重新扫描，禁止直接重试');
  verifyCopy(targetAfter, projectId, finalEntries, false);

  // Installation metadata is advisory; live worldbook entries are authoritative.
  const record = getCreativeWorkshopInstallRecord(projectId);
  if (!record || record.worldbookName === sourceName) {
    setCreativeWorkshopInstallRecord(projectId, { worldbookName: targetName });
    if (getCreativeWorkshopInstallRecord(projectId)?.worldbookName !== targetName)
      throw new Error('世界书迁移成功，但本地记录未更新，请重新扫描');
  }
}
