import { type CreativeWorkshopOriginalEntryState } from './install-registry';
import { writeAndReadCreativeWorkshopWorldbook, matchesCreativeWorkshopPayload } from './worldbook-stage';
import { type CreativeWorkshopProjectDetail } from './project-fetch';

export type OriginalConflictRegexChoice = { referenceItemId: string; regexId: string };
type OriginalTarget = {
  referenceItemId: string;
  kind: 'worldbook' | 'regex';
  sourceKey: string | null;
  displayName: string;
};
function normalizedOriginalRegexName(raw: string): string {
  return raw.trim().replace(/^\[本体\]/, '').trim();
}
function originalConflictTargets(detail: CreativeWorkshopProjectDetail): OriginalTarget[] {
  const project = detail.project || {};
  if (!project.conflictsWithOriginal) return [];
  const selectedIds: string[] = Array.isArray(project.originalConflictReferenceItemIds)
    ? project.originalConflictReferenceItemIds : [];
  if (selectedIds.length) {
    if (!Array.isArray(project.originalConflictTargets) ||
        project.originalConflictTargets.length !== selectedIds.length)
      throw new Error('原版条目基准信息不完整，请刷新详情或自行处理后安装');
    const byId = new Map<string, OriginalTarget>();
    for (const item of project.originalConflictTargets) {
      if (!item || !selectedIds.includes(item.referenceItemId) ||
          (item.kind !== 'worldbook' && item.kind !== 'regex') ||
          typeof item.displayName !== 'string' || !item.displayName.trim() ||
          byId.has(item.referenceItemId))
        throw new Error('原版条目身份信息不一致，已停止自动关闭');
      byId.set(item.referenceItemId, item);
    }
    return selectedIds.map(id => byId.get(id)!);
  }
  const names: string[] = Array.isArray(project.originalConflictEntryNames)
    ? Array.from(new Set<string>(project.originalConflictEntryNames.map(String).map((name: string) => name.trim()).filter(Boolean)))
    : [];
  return names.map((displayName, i) => ({
    referenceItemId: 'legacy:' + i,
    kind: 'worldbook' as const,
    sourceKey: null,
    displayName,
  }));
}
export type OriginalConflictAmbiguity = {
  referenceItemId: string;
  displayName: string;
  candidates: Array<{ regexId: string; displayName: string; enabled: boolean }>;
};

type LoadedWorldbook = {
  name: string;
  entries: WorldbookEntry[];
};

function getOriginalEntryName(entry: WorldbookEntry): string {
  return String((entry as any).comment || entry.name || '').trim();
}

function getEntryUid(entry: WorldbookEntry): string | null {
  const uid = (entry as any).uid;
  return uid === undefined || uid === null || uid === '' ? null : String(uid);
}

function getEntryEnabled(entry: WorldbookEntry): boolean {
  const enabled = (entry as any).enabled;
  if (typeof enabled === 'boolean') return enabled;
  const disable = (entry as any).disable;
  if (typeof disable === 'boolean') return !disable;
  return true;
}

function entryMatchesState(entry: WorldbookEntry, state: CreativeWorkshopOriginalEntryState) {
  if (state.entryUid) return getEntryUid(entry) === state.entryUid;
  return getOriginalEntryName(entry) === state.displayName;
}

async function loadCharacterWorldbooks(): Promise<LoadedWorldbook[]> {
  const bound = getCharWorldbookNames('current');
  const names = _.uniq([bound.primary, ...(bound.additional || [])]).filter(
    (name): name is string => _.isString(name) && Boolean(name),
  );
  const existing = new Set(getWorldbookNames());
  const loaded: LoadedWorldbook[] = [];
  for (const name of names) {
    if (!existing.has(name)) throw new Error('状态未知：当前角色启用的世界书不存在，请重新扫描');
    loaded.push({ name, entries: await getWorldbook(name) });
  }
  return loaded;
}

function findUniqueOriginalEntryByName(
  entryName: string,
  worldbooks: LoadedWorldbook[],
): { worldbookName: string; entry: WorldbookEntry } | null {
  const matches = worldbooks.flatMap(worldbook =>
    worldbook.entries
      .filter(entry => getOriginalEntryName(entry) === entryName)
      .map(entry => ({ worldbookName: worldbook.name, entry })),
  );
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(`找到多个同名原版内容「${entryName}」，请自己关闭冲突条目后继续安装`);
  }
  return matches[0];
}

function assertStateIsUnambiguous(
  worldbook: WorldbookEntry[],
  state: CreativeWorkshopOriginalEntryState,
) {
  const count = worldbook.filter(entry => entryMatchesState(entry, state)).length;
  if (count === 1) return;
  throw new Error(`原版内容「${state.displayName}」现在出现多个匹配条目，为避免误改已中止`);
}

async function applyOriginalEntryStates(
  desiredStates: CreativeWorkshopOriginalEntryState[],
  worldbooks: LoadedWorldbook[],
) {
  const worldbookNames = _.uniq(desiredStates.map(state => state.worldbookName));

  for (const worldbookName of worldbookNames) {
    const desiredForBook = desiredStates.filter(state => state.worldbookName === worldbookName);
    const result = await writeAndReadCreativeWorkshopWorldbook(worldbookName, () => updateWorldbookWith(worldbookName, worldbook => {
      for (const state of desiredForBook) {
        assertStateIsUnambiguous(worldbook, state);
        const snapshot = worldbooks.find(book => book.name === worldbookName)?.entries.find(entry => entryMatchesState(entry, state));
        const current = worldbook.find(entry => entryMatchesState(entry, state));
        if (JSON.stringify(current) !== JSON.stringify(snapshot) || getOriginalEntryName(current!) !== state.displayName)
          throw new Error('原版条目在确认后已改变，请重新检查冲突');
      }
      return worldbook.map(entry => {
        const desired = desiredForBook.find(state => entryMatchesState(entry, state));
        if (desired) return { ...entry, enabled: false };
        return entry;
      });
    }));
    for (const state of desiredForBook) {
      const saved = result.entries.filter(entry => entryMatchesState(entry, state));
      const snapshot = worldbooks.find(book => book.name === worldbookName)?.entries.find(entry => entryMatchesState(entry, state));
      if (saved.length !== 1 || !matchesCreativeWorkshopPayload(saved[0], { ...snapshot, enabled: false }))
        throw new Error('部分完成：原版世界书内容关闭后验收失败，请重新扫描');
    }
  }
}

function resolveOriginalConflictActions(
  detail: CreativeWorkshopProjectDetail,
  worldbooks: LoadedWorldbook[],
  regexes: TavernRegex[],
  selections: OriginalConflictRegexChoice[],
): {
  desiredStates: CreativeWorkshopOriginalEntryState[];
  conflictingRegexIds: string[];
  ambiguities: OriginalConflictAmbiguity[];
} {
  const targets = originalConflictTargets(detail);
  if (detail.project?.conflictsWithOriginal && !targets.length)
    throw new Error('这个 DLC 没有可自动匹配的原版条目名称，请自己关闭冲突条目后继续安装');
  const allowed = new Set(targets.map(item => item.referenceItemId));
  if (new Set(selections.map(item => item.referenceItemId)).size !== selections.length ||
      selections.some(item => !allowed.has(item.referenceItemId)))
    throw new Error('原版 Regex 选择信息无效，请重新确认');
  const chosen = new Map(selections.map(item => [item.referenceItemId, item.regexId]));
  const desiredStates: CreativeWorkshopOriginalEntryState[] = [];
  const conflictingRegexIds: string[] = [];
  const ambiguities: OriginalConflictAmbiguity[] = [];

  for (const target of targets) {
    const entryName = target.displayName.trim();
    const legacy = target.referenceItemId.startsWith('legacy:');
    const located = target.kind === 'worldbook'
      ? findUniqueOriginalEntryByName(entryName, worldbooks) : null;
    const expectedId = target.kind === 'regex' && target.sourceKey?.startsWith('id:')
      ? target.sourceKey.slice(3) : null;
    const idMatches = expectedId
      ? regexes.filter(regex => String(regex.id || '') === expectedId) : [];
    if (idMatches.length > 1) throw new Error('原版 Regex ID 重复，已停止自动关闭');
    const regexMatches = target.kind === 'regex' || legacy
      ? (idMatches.length ? idMatches : regexes.filter(regex =>
          normalizedOriginalRegexName(String(regex.script_name || '')) === normalizedOriginalRegexName(entryName)))
      : [];
    if (legacy && located && regexMatches.length)
      throw new Error('原版冲突「' + entryName + '」同时匹配多个世界书/Regex 条目，已停止自动修改');
    if (located) {
      desiredStates.push({
        worldbookName: located.worldbookName,
        displayName: entryName,
        entryUid: getEntryUid(located.entry),
        wasEnabled: getEntryEnabled(located.entry),
      });
      continue;
    }
    if (!regexMatches.length) continue;
    const candidates = regexMatches.map(regex => ({
      regexId: String(regex.id || ''),
      displayName: String(regex.script_name || ''),
      enabled: regex.enabled !== false,
    }));
    if (candidates.some(item => !item.regexId) ||
        new Set(candidates.map(item => item.regexId)).size !== candidates.length)
      throw new Error('原版 Regex ID 不可区分，请手动关闭');
    const selectedId = chosen.get(target.referenceItemId);
    if (candidates.length > 1 && !selectedId) {
      ambiguities.push({ referenceItemId: target.referenceItemId, displayName: entryName, candidates });
      continue;
    }
    if (selectedId && !candidates.some(item => item.regexId === selectedId))
      throw new Error('玩家选择的原版 Regex 已变化，请重新选择后再安装');
    conflictingRegexIds.push(selectedId || candidates[0].regexId);
  }
  if (new Set(conflictingRegexIds).size !== conflictingRegexIds.length)
    throw new Error('多个原版冲突指向同一条 Regex，请重新确认');
  return { desiredStates, conflictingRegexIds, ambiguities };
}

export async function assertCreativeWorkshopOriginalConflictsResolved(
  detail: CreativeWorkshopProjectDetail,
  selections: OriginalConflictRegexChoice[] = [],
): Promise<void> {
  if (!detail.project?.conflictsWithOriginal) return;
  const worldbooks = await loadCharacterWorldbooks();
  const regexes = getTavernRegexes({ scope: 'character', enable_state: 'all' });
  const result = resolveOriginalConflictActions(detail, worldbooks, regexes, selections);
  if (result.ambiguities.length)
    throw new Error('发现多条同名原版 Regex，请在安装前选择要关闭的条目');
}

export async function inspectCreativeWorkshopOriginalConflicts(detail: CreativeWorkshopProjectDetail) {
  if (!detail.project?.conflictsWithOriginal) return { ambiguities: [] as OriginalConflictAmbiguity[] };
  const worldbooks = await loadCharacterWorldbooks();
  const regexes = getTavernRegexes({ scope: 'character', enable_state: 'all' });
  const result = resolveOriginalConflictActions(detail, worldbooks, regexes, []);
  return { ambiguities: result.ambiguities };
}

export async function syncCreativeWorkshopOriginalConflicts(
  projectId: string,
  detail: CreativeWorkshopProjectDetail,
  selections: OriginalConflictRegexChoice[] = [],
): Promise<CreativeWorkshopOriginalEntryState[]> {
  if (!detail.project?.conflictsWithOriginal) return [];
  const worldbooks = await loadCharacterWorldbooks();
  const regexes = getTavernRegexes({ scope: 'character', enable_state: 'all' });
  const { desiredStates, conflictingRegexIds, ambiguities } =
    resolveOriginalConflictActions(detail, worldbooks, regexes, selections);
  if (ambiguities.length)
    throw new Error('发现多条同名原版 Regex，请在安装前选择要关闭的条目');

  // The historical snapshot is not authority over the user's current choices.
  await applyOriginalEntryStates(desiredStates, worldbooks);
  if (conflictingRegexIds.length) {
    try { await updateTavernRegexesWith(regexList => {
      for (const id of conflictingRegexIds) {
        const matches = regexList.filter(regex => String(regex.id || '') === id);
        if (matches.length !== 1 || JSON.stringify(matches[0]) !== JSON.stringify(regexes.find(regex => String(regex.id || '') === id)))
          throw new Error('原版正则在确认后已改变，请重新检查冲突');
      }
      return regexList.map(regex => conflictingRegexIds.includes(String(regex.id || '')) ? { ...regex, enabled: false } : regex);
    }, { scope: 'character' }); } catch (error) {
      const saved = getTavernRegexes({ scope: 'character', enable_state: 'all' });
      if (conflictingRegexIds.some(id => saved.filter(regex => String(regex.id || '') === id && regex.enabled === false).length !== 1)) throw error;
    }
    let savedRegexes: TavernRegex[];
    try { savedRegexes = getTavernRegexes({ scope: 'character', enable_state: 'all' }); } catch {
      throw new Error('状态未知：无法重新读取原版正则，请重新扫描');
    }
    for (const regexId of conflictingRegexIds) {
      const snapshot = regexes.find(regex => String(regex.id || '') === regexId);
      if (!savedRegexes.some(regex => String(regex.id || '') === regexId && matchesCreativeWorkshopPayload(regex, { ...snapshot, enabled: false })))
        throw new Error('原版正则关闭后验收失败，请检查角色正则');
    }
  }
  return desiredStates;
}
