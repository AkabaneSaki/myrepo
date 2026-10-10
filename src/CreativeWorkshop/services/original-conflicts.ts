import { type CreativeWorkshopOriginalEntryState } from './install-registry';
import { writeAndReadCreativeWorkshopWorldbook, matchesCreativeWorkshopPayload } from './worldbook-stage';
import { type CreativeWorkshopProjectDetail } from './project-fetch';

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

export async function syncCreativeWorkshopOriginalConflicts(
  projectId: string,
  detail: CreativeWorkshopProjectDetail,
): Promise<CreativeWorkshopOriginalEntryState[]> {
  const project = detail.project || {};
  const requestedNames = project.conflictsWithOriginal && Array.isArray(project.originalConflictEntryNames)
    ? Array.from(new Set(project.originalConflictEntryNames.map(String).map(name => name.trim()).filter(Boolean)))
    : [];

  if (!project.conflictsWithOriginal) return [];
  if (requestedNames.length === 0) {
    throw new Error('这个 DLC 没有可自动匹配的原版条目名称，请自己关闭冲突条目后继续安装');
  }

  const worldbooks = await loadCharacterWorldbooks();
  const desiredStates: CreativeWorkshopOriginalEntryState[] = [];
  const regexes = getTavernRegexes({ scope: 'character', enable_state: 'all' });
  const conflictingRegexIds: string[] = [];

  for (const entryName of requestedNames) {
    const located = findUniqueOriginalEntryByName(entryName, worldbooks);
    const regexMatches = regexes.filter(regex => String(regex.script_name || '').trim() === entryName);
    if ((located ? 1 : 0) + regexMatches.length > 1) {
      throw new Error(`原版冲突「${entryName}」未找到或同时匹配多个世界书/Regex 条目，已停止自动修改。请手动处理后再安装`);
    }
    if (!located && !regexMatches.length) continue; // The user may already have deleted the original.
    if (!located) {
      const regexId = String(regexMatches[0].id || '');
      if (!regexId || regexes.filter(regex => String(regex.id || '') === regexId).length !== 1)
        throw new Error('原版正则缺少唯一标识或重复，不能安全关闭，请手动检查');
      conflictingRegexIds.push(regexId);
      continue;
    }
    const localStateIdentity: CreativeWorkshopOriginalEntryState = {
      worldbookName: located.worldbookName,
      displayName: entryName,
      entryUid: getEntryUid(located.entry),
      wasEnabled: getEntryEnabled(located.entry),
    };
    // Use the latest real setting; old registry snapshots cannot override user edits.
    desiredStates.push(localStateIdentity);
  }

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
