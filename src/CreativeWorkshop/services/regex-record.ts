import { buildCreativeWorkshopRegexRecordPayload, parseCreativeWorkshopRegexRecordPayload,
  type CreativeWorkshopRegexRecordMetadata } from './install-identity';

const PREFIX = 'poem-workshop-character-regex-meta:v1\n';
const NAME = '[工坊记录] 角色正则（禁用）';
type Manifest = { schemaVersion: 1; characterAvatar: string;
  projects: CreativeWorkshopRegexRecordMetadata[]; pending: CreativeWorkshopRegexRecordMetadata[] };

function characterScope() {
  const context = SillyTavern.getContext();
  const characterAvatar = context.characters?.[context.characterId]?.avatar;
  if (!characterAvatar) throw new Error('无法确认当前角色身份，已停止修改工坊正则记录');
  return { characterAvatar, worldbookName: getCharWorldbookNames('current').primary };
}

function parse(entry: WorldbookEntry): Manifest | null {
  if (!entry.content?.startsWith(PREFIX)) return null;
  let value: Manifest;
  try { value = JSON.parse(entry.content.slice(PREFIX.length)); }
  catch { throw new Error('工坊角色正则记录损坏，请检查主世界书'); }
  if (value.schemaVersion !== 1 || typeof value.characterAvatar !== 'string' ||
      !Array.isArray(value.projects) || !Array.isArray(value.pending) ||
      [...value.projects, ...value.pending].some(record => !parseCreativeWorkshopRegexRecordPayload(buildCreativeWorkshopRegexRecordPayload(record))) ||
      [value.projects, value.pending].some(records => new Set(records.map(record => record.projectId)).size !== records.length))
    throw new Error('工坊角色正则记录格式或身份异常，已停止操作');
  return value;
}

function find(entries: WorldbookEntry[], avatar: string) {
  const matches = entries.map(entry => ({ entry, value: parse(entry) })).filter(row => row.value?.characterAvatar === avatar);
  if (matches.length > 1) throw new Error('当前角色的工坊正则记录重复，已停止操作');
  const match = matches[0];
  if (match && match.entry.enabled !== false) throw new Error('工坊正则记录必须保持禁用，请检查主世界书');
  return match || null;
}

export async function readCreativeWorkshopRegexManifest(entries?: WorldbookEntry[]) {
  const { characterAvatar, worldbookName } = characterScope();
  if (!worldbookName) return { schemaVersion: 1, characterAvatar, projects: [], pending: [] } as Manifest;
  return find(entries || await getWorldbook(worldbookName), characterAvatar)?.value ||
    { schemaVersion: 1, characterAvatar, projects: [], pending: [] } as Manifest;
}

export async function saveCreativeWorkshopRegexManifest(change: (value: Manifest) => Manifest) {
  const scope = characterScope();
  if (!scope.worldbookName) throw new Error('请先绑定当前角色的主世界书，用于保存工坊正则记录');
  const before = await getWorldbook(scope.worldbookName);
  const previous = find(before, scope.characterAvatar);
  if (previous && (typeof previous.entry.uid !== 'number' || !Number.isSafeInteger(previous.entry.uid)))
    throw new Error('主世界书中的工坊正则记录 UID 无效，已停止修改，请重新扫描');
  const value = change(previous?.value || { schemaVersion: 1, characterAvatar: scope.characterAvatar, projects: [], pending: [] });
  const content = PREFIX + JSON.stringify(value);
  // A retry after a lost Regex-delete response must not rewrite the whole main book
  // when the durable manifest is already correct.
  if (previous?.entry.content === content) return previous.value;
  let error: unknown;
  try {
    if (previous) {
      await updateWorldbookWith(scope.worldbookName, entries => {
        const current = characterScope();
        if (current.characterAvatar !== scope.characterAvatar || current.worldbookName !== scope.worldbookName)
          throw new Error('当前角色或主世界书已改变，已停止保存');
        const latest = find(entries, scope.characterAvatar);
        if (latest?.entry.uid !== previous.entry.uid || latest?.entry.content !== previous.entry.content)
          throw new Error('工坊正则记录已改变，请重新扫描');
        return entries.map(entry => entry.uid === latest.entry.uid ? { ...entry, content, enabled: false } : entry);
      });
    } else {
      const current = characterScope();
      if (current.characterAvatar !== scope.characterAvatar || current.worldbookName !== scope.worldbookName)
        throw new Error('当前角色或主世界书已改变，已停止保存');
      const latest = find(await getWorldbook(scope.worldbookName), scope.characterAvatar);
      if (latest) throw new Error('工坊正则记录已被其他操作创建，请重新扫描');
      // Only the TavernHelper creation API is responsible for allocating a new UID.
      await createWorldbookEntries(scope.worldbookName, [{
        name: NAME, content, enabled: false,
        strategy: { type: 'constant' },
        position: { type: 'before_character_definition', order: 0 },
      } as WorldbookEntry]);
    }
  } catch (caught) { error = caught; }
  let saved: WorldbookEntry[];
  try { saved = await getWorldbook(scope.worldbookName); }
  catch { throw new Error('状态未知：无法重读主世界书中的工坊正则记录'); }
  const actual = find(saved, scope.characterAvatar);
  if (!actual || actual.entry.content !== content || typeof actual.entry.uid !== 'number')
    throw new Error('工坊正则记录保存未通过验收：' + (error instanceof Error ? error.message : '内容不一致'));
  return actual.value;
}

export async function migrateCreativeWorkshopLegacyRegexRecords() {
  const regexes = getTavernRegexes({ scope: 'character', enable_state: 'all' });
  const legacy = regexes.filter(regex => {
    const record = parseCreativeWorkshopRegexRecordPayload(regex.replace_string);
    return record && record.projectId === regex.id;
  });
  if (!legacy.length) return;
  // An edited/activated item might be executable user content despite matching
  // a historical metadata ID. Never delete it based on metadata alone.
  if (legacy.some(regex => regex.enabled !== false || regex.find_regex !== '(?!)'))
    throw new Error('旧工坊正则记录已经被修改或启用，已停止自动迁移删除，请手动检查');
  const records = legacy.map(regex => parseCreativeWorkshopRegexRecordPayload(regex.replace_string)!);
  if (new Set(records.map(record => record.projectId)).size !== records.length)
    throw new Error('旧工坊正则记录重复，已停止迁移');
  // Never convert an interrupted Regex write into a completed installation.
  // If a pending write exists, leave the legacy backup untouched for manual recovery.
  await saveCreativeWorkshopRegexManifest(value => {
    for (const record of records) {
      if (value.pending.some(item => item.projectId === record.projectId))
        throw new Error('工坊正则仍有待完成的安装，已保留旧记录，请先恢复安装');
      const existing = value.projects.find(item => item.projectId === record.projectId);
      if (existing && JSON.stringify(existing) !== JSON.stringify(record))
        throw new Error('新旧工坊正则记录不一致，已保留旧记录');
    }
    return { ...value, projects: [...value.projects.filter(item => !records.some(record => record.projectId === item.projectId)), ...records] };
  });
  let error: unknown;
  try { await updateTavernRegexesWith(current => {
    if (JSON.stringify(current) !== JSON.stringify(regexes)) throw new Error('角色正则已改变，已停止迁移删除');
    return current.filter(regex => !legacy.some(record => record.id === regex.id));
  }, { scope: 'character' }); } catch (caught) { error = caught; }
  const actual = getTavernRegexes({ scope: 'character', enable_state: 'all' });
  if (JSON.stringify(actual) !== JSON.stringify(regexes.filter(regex => !legacy.some(record => record.id === regex.id))))
    throw new Error('工坊正则记录迁移未完成：' + (error instanceof Error ? error.message : '角色正则验收失败'));
}
