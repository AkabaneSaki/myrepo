import {
  getCreativeWorkshopWorldbookMetadataString,
  parseCreativeWorkshopRegexId,
  parseCreativeWorkshopRegexRecordPayload,
  type CreativeWorkshopRegexIdentity,
  type CreativeWorkshopRegexRecordMetadata,
} from './install-identity';

const CREATIVE_WORKSHOP_INSTALL_REGISTRY_KEY = 'creative_workshop_install_registry';

export type CreativeWorkshopOriginalEntryState = {
  referenceItemId: string;
  worldbookName: string;
  displayName: string;
  entryUid?: string | null;
  wasEnabled: boolean;
};

export type CreativeWorkshopRegexInstallEntry = {
  regexId: string;
  entryKey: string;
  installedVersion?: string | null;
};

export type CreativeWorkshopInstallRecord = {
  projectId: string;
  worldbookName: string | null;
  installedVersion?: string | null;
  originalEntryStates?: CreativeWorkshopOriginalEntryState[];
  regexEntries?: CreativeWorkshopRegexInstallEntry[];
  installedAt: number;
};

type CreativeWorkshopInstallRegistry = Record<string, Record<string, CreativeWorkshopInstallRecord>>;

function getRegistryScopeKey() {
  return getCurrentCharacterName() || '__no_character__';
}

function readInstallRegistry(): CreativeWorkshopInstallRegistry {
  const variables = getVariables({ type: 'script', script_id: getScriptId() });
  const raw = _.get(variables, CREATIVE_WORKSHOP_INSTALL_REGISTRY_KEY);
  return _.isObject(raw) ? (raw as CreativeWorkshopInstallRegistry) : {};
}

function writeInstallRegistry(registry: CreativeWorkshopInstallRegistry) {
  updateVariablesWith(
    variables => {
      _.set(variables, CREATIVE_WORKSHOP_INSTALL_REGISTRY_KEY, registry);
      return variables;
    },
    { type: 'script', script_id: getScriptId() },
  );
}

export function getCreativeWorkshopInstallRecords(): Record<string, CreativeWorkshopInstallRecord> {
  return readInstallRegistry()[getRegistryScopeKey()] || {};
}

export function getCreativeWorkshopInstallRecord(projectId: string): CreativeWorkshopInstallRecord | null {
  return getCreativeWorkshopInstallRecords()[projectId] || null;
}

function getRegexId(regex: Record<string, any>): string {
  return String(regex.id || regex.script_name || '');
}

function normalizeRegexInstallEntries(value: unknown): CreativeWorkshopRegexInstallEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const raw = item as Record<string, unknown>;
    if (typeof raw.regexId !== 'string' || !raw.regexId) return [];
    if (typeof raw.entryKey !== 'string' || !raw.entryKey) return [];
    if (
      raw.installedVersion !== null &&
      raw.installedVersion !== undefined &&
      typeof raw.installedVersion !== 'string'
    ) return [];
    return [{
      regexId: raw.regexId,
      entryKey: raw.entryKey,
      installedVersion: raw.installedVersion ?? null,
    }];
  });
}

export function getCreativeWorkshopRegexInstallEntries(projectId: string): CreativeWorkshopRegexInstallEntry[] {
  return normalizeRegexInstallEntries(getCreativeWorkshopInstallRecord(projectId)?.regexEntries);
}

export function getCreativeWorkshopRegexRecordMetadata(
  regex: Record<string, any>,
): CreativeWorkshopRegexRecordMetadata | null {
  const metadata = parseCreativeWorkshopRegexRecordPayload(regex.replace_string);
  if (!metadata || getRegexId(regex) !== metadata.projectId) return null;
  return metadata;
}

function addRegexIdentity(
  identities: Map<string, CreativeWorkshopRegexIdentity>,
  ambiguousIds: Set<string>,
  regexId: string,
  identity: CreativeWorkshopRegexIdentity,
) {
  if (!regexId || ambiguousIds.has(regexId)) return;
  const existing = identities.get(regexId);
  if (!existing) {
    identities.set(regexId, identity);
    return;
  }
  if (
    existing.projectId === identity.projectId &&
    existing.entryKey === identity.entryKey
  ) {
    if (identity.installedVersion !== null || existing.installedVersion === null) {
      identities.set(regexId, identity);
    }
    return;
  }
  identities.delete(regexId);
  ambiguousIds.add(regexId);
}

export function createCreativeWorkshopRegexIdentityResolver(
  regexes: Array<Record<string, any>>,
): (regex: Record<string, any>) => CreativeWorkshopRegexIdentity | null {
  const identities = new Map<string, CreativeWorkshopRegexIdentity>();
  const ambiguousIds = new Set<string>();
  const records = getCreativeWorkshopInstallRecords();

  for (const record of Object.values(records)) {
    for (const entry of normalizeRegexInstallEntries(record.regexEntries)) {
      addRegexIdentity(identities, ambiguousIds, entry.regexId, {
        schemaVersion: 2,
        projectId: record.projectId,
        entryKey: entry.entryKey,
        installedVersion: entry.installedVersion ?? record.installedVersion ?? null,
      });
    }
  }

  const presentIds = new Set(regexes.map(getRegexId));
  for (const regex of regexes) {
    const record = getCreativeWorkshopRegexRecordMetadata(regex);
    if (!record) continue;
    for (const entry of record.entries) {
      if (!presentIds.has(entry.regexId)) continue;
      addRegexIdentity(identities, ambiguousIds, entry.regexId, {
        schemaVersion: 2,
        projectId: record.projectId,
        entryKey: entry.entryKey,
        installedVersion: entry.installedVersion ?? record.installedVersion ?? null,
      });
    }
  }

  return regex => {
    if (getCreativeWorkshopRegexRecordMetadata(regex)) return null;
    const regexId = getRegexId(regex);
    return identities.get(regexId) || parseCreativeWorkshopRegexId(regexId);
  };
}

export function getCreativeWorkshopBoundWorldbookNames(): string[] {
  const charWorldbooks = getCharWorldbookNames('current');
  let chatWorldbook: string | null = null;
  try {
    chatWorldbook = getChatWorldbookName('current');
  } catch {
    chatWorldbook = null;
  }
  return _.uniq([
    charWorldbooks.primary,
    ...(charWorldbooks.additional || []),
    ...getGlobalWorldbookNames(),
    chatWorldbook,
  ]).filter((name): name is string => _.isString(name) && Boolean(name));
}

export function getCreativeWorkshopRelevantWorldbookNames(projectId?: string, legacyProjectName?: string): string[] {
  const charWorldbooks = getCharWorldbookNames('current');
  const registry = getCreativeWorkshopInstallRecords();
  const registryNames = projectId
    ? [registry[projectId]?.worldbookName, legacyProjectName ? registry[legacyProjectName]?.worldbookName : null]
    : Object.values(registry).map(record => record.worldbookName);
  let chatWorldbook: string | null = null;
  try {
    chatWorldbook = getChatWorldbookName('current');
  } catch {
    chatWorldbook = null;
  }
  return _.uniq([
    ...registryNames,
    charWorldbooks.primary,
    ...(charWorldbooks.additional || []),
    ...getGlobalWorldbookNames(),
    chatWorldbook,
  ]).filter((name): name is string => _.isString(name) && Boolean(name));
}

export async function resolveCreativeWorkshopInstallWorldbook(
  projectId: string,
  legacyProjectName?: string,
): Promise<string | null> {
  const recorded = getCreativeWorkshopInstallRecord(projectId) ||
    (legacyProjectName ? getCreativeWorkshopInstallRecord(legacyProjectName) : null);
  if (recorded?.worldbookName) return recorded.worldbookName;
  if (recorded && recorded.worldbookName === null) return null;

  const candidates = getCreativeWorkshopRelevantWorldbookNames(projectId, legacyProjectName);
  const existingNames = new Set(getWorldbookNames());

  for (const worldbookName of candidates) {
    if (!existingNames.has(worldbookName)) continue;
    const entries = await getWorldbook(worldbookName);
    if (
      entries.some(entry => {
        const currentProjectId = getCreativeWorkshopWorldbookMetadataString(entry, 'cw_project_id');
        const legacyName = getCreativeWorkshopWorldbookMetadataString(entry, 'fate_project_name');
        return currentProjectId === projectId ||
          legacyName === projectId ||
          Boolean(legacyProjectName && currentProjectId === legacyProjectName) ||
          Boolean(legacyProjectName && legacyName === legacyProjectName);
      })
    ) {
      return worldbookName;
    }
  }

  return null;
}

export function setCreativeWorkshopInstallRecord(
  projectId: string,
  patch: {
    worldbookName?: string | null;
    installedVersion?: string | null;
    originalEntryStates?: CreativeWorkshopOriginalEntryState[];
    regexEntries?: CreativeWorkshopRegexInstallEntry[];
  },
) {
  const registry = readInstallRegistry();
  const scopeKey = getRegistryScopeKey();
  registry[scopeKey] = registry[scopeKey] || {};
  const current = registry[scopeKey][projectId];
  registry[scopeKey][projectId] = {
    projectId,
    worldbookName: patch.worldbookName !== undefined ? patch.worldbookName : current?.worldbookName ?? null,
    installedVersion: patch.installedVersion !== undefined ? patch.installedVersion : current?.installedVersion ?? null,
    originalEntryStates:
      patch.originalEntryStates !== undefined ? patch.originalEntryStates : current?.originalEntryStates ?? [],
    regexEntries: patch.regexEntries !== undefined
      ? normalizeRegexInstallEntries(patch.regexEntries)
      : normalizeRegexInstallEntries(current?.regexEntries),
    installedAt: Date.now(),
  };
  writeInstallRegistry(registry);
}

export function deleteCreativeWorkshopInstallRecord(projectId: string) {
  const registry = readInstallRegistry();
  const scopeKey = getRegistryScopeKey();
  if (!registry[scopeKey]?.[projectId]) return;
  delete registry[scopeKey][projectId];
  if (Object.keys(registry[scopeKey]).length === 0) {
    delete registry[scopeKey];
  }
  writeInstallRegistry(registry);
}
