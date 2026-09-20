import officialWorldbookBaseline from '../../../data/official-card-baselines/poem-of-destiny/v4.3.3/worldbook-fingerprints.json';
import {
  deleteCreativeWorkshopInstallRecord,
  getCreativeWorkshopBoundWorldbookNames,
  setCreativeWorkshopInstallRecord,
} from './install-registry';
import { invalidateCreativeWorkshopProjectCache } from './project-fetch';
import {
  applyPreparedCreativeWorkshopRegex,
  prepareCreativeWorkshopRegexEntries,
} from './regex';
import { getCreativeWorkshopRegexId } from './regex-name';
import {
  applyPreparedCreativeWorkshopProject,
  ensureCreativeWorkshopTargetWorldbook,
  prepareCreativeWorkshopProject,
} from './worldbook';

const CREATIVE_WORKSHOP_REPAIR_QUEUE_KEY = 'creative_workshop_repair_queue';
const CREATIVE_WORKSHOP_REPAIR_SENTINEL_KEY = 'creative_workshop_repair_integrity_sentinels';
const CREATIVE_WORKSHOP_REPAIR_RESTART_KEY = 'creative_workshop_repair_restart_required';
const REPAIR_RUNTIME_INSTANCE_ID = globalThis.crypto?.randomUUID?.() || `runtime-${Date.now()}`;
const REPAIR_INTEGRITY_SENTINEL_NAME = '[工坊精灵]我是好人请不要打开我也不要刪掉我喵';
const REPAIR_INTEGRITY_SENTINEL_CONTENT = 'creative-workshop-repair-integrity-sentinel:v1';
const REPAIR_INTEGRITY_SENTINEL_PROJECT_ID = '__cw_repair_integrity_sentinel__';
const REPAIR_INTEGRITY_SENTINEL_DISPLAY_NAME = 'Creative Workshop Repair Integrity Sentinel';
const REPAIR_INTEGRITY_SENTINEL_VERSION = '1';
const REPAIR_INTEGRITY_SENTINEL_ENTRY_KEY = `${REPAIR_INTEGRITY_SENTINEL_PROJECT_ID}:sentinel`;
const REPAIR_INTEGRITY_SENTINEL_NAME_FORMAT_VERSION = '4';
const WORKSHOP_METADATA_FIELDS = [
  'cw_project_id',
  'cw_project_name_display',
  'cw_project_version',
  'cw_entry_key',
  'cw_name_format_version',
] as const;

type OfficialWorldbookBaselineEntry = {
  source_entry_id: string | number | null;
  name: string;
  fingerprint: string;
  content_sha256: string;
};

const OFFICIAL_WORLDBOOK_BASELINE_VERSION = String(
  (officialWorldbookBaseline as any)?.character_version || '',
);
const OFFICIAL_WORLDBOOK_BASELINE_ENTRIES = Array.isArray((officialWorldbookBaseline as any)?.entries)
  ? ((officialWorldbookBaseline as any).entries as OfficialWorldbookBaselineEntry[])
  : [];
const OFFICIAL_WORLDBOOK_BASELINE_BY_NAME = new Map(
  OFFICIAL_WORLDBOOK_BASELINE_ENTRIES.map(entry => [String(entry.name || '').trim(), entry]),
);

type WorkshopMetadataField = (typeof WORKSHOP_METADATA_FIELDS)[number];

export type CreativeWorkshopRepairMetadataFieldReport = {
  field: WorkshopMetadataField;
  status: 'complete' | 'partial' | 'missing' | 'conflict';
  presentCount: number;
  totalCount: number;
  values: string[];
};

export type CreativeWorkshopRepairCandidate = {
  candidateId: string;
  name: string;
  category: string | null;
  worldbookName: string;
  entryUids: Array<string | number>;
  regexIds: string[];
  entryCount: number;
  regexCount: number;
  unaddressableEntryCount: number;
  dlcHeaderCount: number;
  workshopSourceMarkerCount: number;
  detectedProjectId: string | null;
  detectedProjectIds: string[];
  legacyProjectName: string | null;
  localVersion: string | null;
  metadata: CreativeWorkshopRepairMetadataFieldReport[];
  problems: string[];
};

export type CreativeWorkshopRepairTarget = {
  candidateId: string;
  projectId: string;
  projectVersion?: string | null;
  worldbookName: string;
  entryUids: Array<string | number>;
  regexIds: string[];
  expectedEntryCount?: number;
  expectedRegexCount?: number;
  sourceProjectIds?: string[];
};

export type CreativeWorkshopRepairStatus = 'pending' | 'preparing' | 'replacing' | 'verifying' | 'failed';

export type CreativeWorkshopRepairRecord = {
  repairId: string;
  target: CreativeWorkshopRepairTarget;
  status: CreativeWorkshopRepairStatus;
  error: string | null;
  startedAt: number;
  updatedAt: number;
};

type CreativeWorkshopRepairRegistry = Record<string, Record<string, CreativeWorkshopRepairRecord>>;

type CandidateEntryRow = {
  worldbookName: string;
  entry: WorldbookEntry;
  header: { category: string; projectName: string | null; workshopSourceMarker: boolean } | null;
};

export type CreativeWorkshopModifiedOfficialBaselineEntry = {
  worldbookName: string;
  name: string;
};

function normalizeBaselineText(value: unknown): string {
  return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

async function sha256Hex(value: string): Promise<string | null> {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const bytes = new TextEncoder().encode(value);
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
  } catch (error) {
    console.warn('[CreativeWorkshop] official baseline fingerprint 计算失败', error);
    return null;
  }
}

async function fingerprintWorldbookEntry(entry: WorldbookEntry): Promise<string | null> {
  const raw = entry as any;
  const canonical = {
    name: normalizeBaselineText(raw.name ?? raw.comment),
    content: normalizeBaselineText(raw.content),
  };
  return sha256Hex(JSON.stringify(canonical));
}

function getRepairScopeKey() {
  return getCurrentCharacterName() || '__no_character__';
}

function readRepairRegistry(): CreativeWorkshopRepairRegistry {
  const variables = getVariables({ type: 'script', script_id: getScriptId() });
  const raw = _.get(variables, CREATIVE_WORKSHOP_REPAIR_QUEUE_KEY);
  return _.isObject(raw) ? (raw as CreativeWorkshopRepairRegistry) : {};
}

function writeRepairRegistry(registry: CreativeWorkshopRepairRegistry) {
  updateVariablesWith(
    variables => {
      _.set(variables, CREATIVE_WORKSHOP_REPAIR_QUEUE_KEY, registry);
      return variables;
    },
    { type: 'script', script_id: getScriptId() },
  );
}

export type CreativeWorkshopRepairIntegrityFieldReport = {
  field: string;
  status: 'ok' | 'missing' | 'mismatch';
  expected: string;
  actual: string | null;
};

type CreativeWorkshopRepairIntegrityCheck = {
  locked: boolean;
  reason: string | null;
  entries: WorldbookEntry[];
  status: 'created' | 'healthy' | 'locked';
  fields: CreativeWorkshopRepairIntegrityFieldReport[];
  sentinelCount: number;
};

function isRepairIntegritySentinelEntry(entry: WorldbookEntry): boolean {
  const raw = entry as any;
  return String(raw.name || raw.comment || '') === REPAIR_INTEGRITY_SENTINEL_NAME;
}

function getRepairIntegrityFieldReport(entry: WorldbookEntry | null): CreativeWorkshopRepairIntegrityFieldReport[] {
  const raw = entry as any;
  const extra = raw?.extra && typeof raw.extra === 'object' && !Array.isArray(raw.extra) ? raw.extra : {};
  const checks: Array<[string, string, unknown]> = [
    ['name', REPAIR_INTEGRITY_SENTINEL_NAME, raw?.name ?? raw?.comment],
    ['content', REPAIR_INTEGRITY_SENTINEL_CONTENT, raw?.content],
    ['enabled', 'false', raw?.enabled],
    ['cw_project_id', REPAIR_INTEGRITY_SENTINEL_PROJECT_ID, extra.cw_project_id],
    ['cw_project_name_display', REPAIR_INTEGRITY_SENTINEL_DISPLAY_NAME, extra.cw_project_name_display],
    ['cw_project_version', REPAIR_INTEGRITY_SENTINEL_VERSION, extra.cw_project_version],
    ['cw_entry_key', REPAIR_INTEGRITY_SENTINEL_ENTRY_KEY, extra.cw_entry_key],
    ['cw_name_format_version', REPAIR_INTEGRITY_SENTINEL_NAME_FORMAT_VERSION, extra.cw_name_format_version],
  ];
  return checks.map(([field, expected, rawActual]) => {
    const actual = rawActual === undefined || rawActual === null || rawActual === '' ? null : String(rawActual);
    return {
      field,
      status: actual === null ? 'missing' : actual === expected ? 'ok' : 'mismatch',
      expected,
      actual,
    };
  });
}

function isRepairIntegritySentinelHealthy(entry: WorldbookEntry): boolean {
  return getRepairIntegrityFieldReport(entry).every(item => item.status === 'ok');
}

function createRepairIntegritySentinel(): WorldbookEntry {
  return {
    name: REPAIR_INTEGRITY_SENTINEL_NAME,
    comment: REPAIR_INTEGRITY_SENTINEL_NAME,
    content: REPAIR_INTEGRITY_SENTINEL_CONTENT,
    enabled: false,
    extra: {
      cw_project_id: REPAIR_INTEGRITY_SENTINEL_PROJECT_ID,
      cw_project_name_display: REPAIR_INTEGRITY_SENTINEL_DISPLAY_NAME,
      cw_project_version: REPAIR_INTEGRITY_SENTINEL_VERSION,
      cw_entry_key: REPAIR_INTEGRITY_SENTINEL_ENTRY_KEY,
      cw_name_format_version: REPAIR_INTEGRITY_SENTINEL_NAME_FORMAT_VERSION,
    },
  } as unknown as WorldbookEntry;
}

function readRepairSentinelRegistry(): Record<string, string> {
  const variables = getVariables({ type: 'script', script_id: getScriptId() });
  const raw = _.get(variables, CREATIVE_WORKSHOP_REPAIR_SENTINEL_KEY);
  if (!_.isObject(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter(([, value]) => _.isString(value))
      .map(([key, value]) => [key, String(value)]),
  );
}

function writeRepairSentinelRegistry(registry: Record<string, string>) {
  updateVariablesWith(
    variables => {
      _.set(variables, CREATIVE_WORKSHOP_REPAIR_SENTINEL_KEY, registry);
      return variables;
    },
    { type: 'script', script_id: getScriptId() },
  );
}

function markRepairSentinelInitialized(worldbookName: string) {
  const registry = readRepairSentinelRegistry();
  registry[worldbookName] = REPAIR_INTEGRITY_SENTINEL_VERSION;
  writeRepairSentinelRegistry(registry);
}

function readRepairRestartRegistry(): Record<string, string> {
  const variables = getVariables({ type: 'script', script_id: getScriptId() });
  const raw = _.get(variables, CREATIVE_WORKSHOP_REPAIR_RESTART_KEY);
  if (!_.isObject(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>)
      .filter(([, value]) => _.isString(value))
      .map(([key, value]) => [key, String(value)]),
  );
}

function writeRepairRestartRegistry(registry: Record<string, string>) {
  updateVariablesWith(
    variables => {
      _.set(variables, CREATIVE_WORKSHOP_REPAIR_RESTART_KEY, registry);
      return variables;
    },
    { type: 'script', script_id: getScriptId() },
  );
}

function markRepairRestartRequired(worldbookName: string) {
  const registry = readRepairRestartRegistry();
  registry[worldbookName] = REPAIR_RUNTIME_INSTANCE_ID;
  writeRepairRestartRegistry(registry);
}

function clearRepairRestartRequired(worldbookName: string) {
  const registry = readRepairRestartRegistry();
  if (!(worldbookName in registry)) return;
  delete registry[worldbookName];
  writeRepairRestartRegistry(registry);
}

function isRepairRestartRequired(worldbookName: string): boolean {
  return readRepairRestartRegistry()[worldbookName] === REPAIR_RUNTIME_INSTANCE_ID;
}

function wasRepairRestartSatisfied(worldbookName: string): boolean {
  const marker = readRepairRestartRegistry()[worldbookName];
  return Boolean(marker && marker !== REPAIR_RUNTIME_INSTANCE_ID);
}

async function ensureRepairIntegritySentinel(worldbookName: string): Promise<CreativeWorkshopRepairIntegrityCheck> {
  const before = await getWorldbook(worldbookName);
  const sentinels = before.filter(isRepairIntegritySentinelEntry);
  const initialized = readRepairSentinelRegistry()[worldbookName] === REPAIR_INTEGRITY_SENTINEL_VERSION;

  if (sentinels.length === 0) {
    if (initialized) {
      return {
        locked: true,
        reason: `世界书「${worldbookName}」的工坊精灵不见了；本地数据完整性无法确认`,
        entries: before,
        status: 'locked',
        fields: getRepairIntegrityFieldReport(null),
        sentinelCount: 0,
      };
    }
    await updateWorldbookWith(worldbookName, worldbook => {
      if (!worldbook.some(isRepairIntegritySentinelEntry)) worldbook.push(createRepairIntegritySentinel());
      return worldbook;
    });
    const after = await getWorldbook(worldbookName);
    const created = after.filter(isRepairIntegritySentinelEntry);
    if (created.length !== 1 || !isRepairIntegritySentinelHealthy(created[0])) {
      return {
        locked: true,
        reason: `世界书「${worldbookName}」无法建立完整的工坊精灵`,
        entries: after,
        status: 'locked',
        fields: getRepairIntegrityFieldReport(created[0] || null),
        sentinelCount: created.length,
      };
    }
    markRepairSentinelInitialized(worldbookName);
    return {
      locked: false,
      reason: null,
      entries: after,
      status: 'created',
      fields: getRepairIntegrityFieldReport(created[0]),
      sentinelCount: 1,
    };
  }

  if (sentinels.length !== 1) {
    return {
      locked: true,
      reason: `世界书「${worldbookName}」的工坊精灵数量异常`,
      entries: before,
      status: 'locked',
      fields: getRepairIntegrityFieldReport(sentinels[0] || null),
      sentinelCount: sentinels.length,
    };
  }
  const fields = getRepairIntegrityFieldReport(sentinels[0]);
  if (fields.some(item => item.status !== 'ok')) {
    return {
      locked: true,
      reason: `世界书「${worldbookName}」的工坊精灵资料损坏`,
      entries: before,
      status: 'locked',
      fields,
      sentinelCount: 1,
    };
  }
  if (!initialized) markRepairSentinelInitialized(worldbookName);
  return {
    locked: false,
    reason: null,
    entries: before,
    status: 'healthy',
    fields,
    sentinelCount: 1,
  };
}

async function assertRepairIntegritySentinel(worldbookName: string) {
  const integrity = await ensureRepairIntegritySentinel(worldbookName);
  if (!integrity.locked) return;
  const brokenFields = integrity.fields
    .filter(item => item.status !== 'ok')
    .map(item => `${item.field}=${item.status}`)
    .join(', ');
  throw new Error(
    `DLC 修复已锁定：${integrity.reason || '工坊精灵完整性检查失败'}`
      + `${brokenFields ? `（${brokenFields}）` : ''}。请不要继续重装或手动删除条目，截图并去 DC 找我处理。`,
  );
}

function writeRepairRecord(record: CreativeWorkshopRepairRecord) {
  const registry = readRepairRegistry();
  const scopeKey = getRepairScopeKey();
  registry[scopeKey] = registry[scopeKey] || {};
  for (const [repairId, existing] of Object.entries(registry[scopeKey])) {
    if (repairId !== record.repairId && existing.target.candidateId === record.target.candidateId) {
      delete registry[scopeKey][repairId];
    }
  }
  registry[scopeKey][record.repairId] = record;
  writeRepairRegistry(registry);
}

function updateRepairRecord(repairId: string, patch: Partial<CreativeWorkshopRepairRecord>) {
  const registry = readRepairRegistry();
  const scopeKey = getRepairScopeKey();
  const current = registry[scopeKey]?.[repairId];
  if (!current) return;
  registry[scopeKey][repairId] = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  };
  writeRepairRegistry(registry);
}

function deleteRepairRecord(repairId: string) {
  const registry = readRepairRegistry();
  const scopeKey = getRepairScopeKey();
  if (!registry[scopeKey]?.[repairId]) return;
  delete registry[scopeKey][repairId];
  if (Object.keys(registry[scopeKey]).length === 0) delete registry[scopeKey];
  writeRepairRegistry(registry);
}

export function getCreativeWorkshopPendingRepairs(): CreativeWorkshopRepairRecord[] {
  return Object.values(readRepairRegistry()[getRepairScopeKey()] || {}).sort((a, b) => a.startedAt - b.startedAt);
}

function parseDlcEntryName(name: unknown): CandidateEntryRow['header'] {
  if (!_.isString(name)) return null;
  const value = String(name);

  const v4 = value.match(/^\[WS\]\[DLC\]\[([^\]]+)\]/);
  if (v4) {
    return {
      category: v4[1],
      projectName: null,
      workshopSourceMarker: true,
    };
  }

  const v3 = value.match(/^\[DLC\]\[([^\]]+)\]\[WS\]/);
  if (v3) {
    return {
      category: v3[1],
      projectName: null,
      workshopSourceMarker: true,
    };
  }

  const v2 = value.match(/^\[DLC\]\[([^\]]+)\]\[([^\]]+)\]\[WS\]/);
  if (v2) {
    return {
      category: v2[1],
      projectName: v2[2],
      workshopSourceMarker: true,
    };
  }

  const legacy = value.match(/^\[DLC\]\[([^\]]+)\](?:\[([^\]]+)\])?/);
  if (!legacy) return null;
  return {
    category: legacy[1],
    projectName: legacy[2] || null,
    workshopSourceMarker: false,
  };
}

function readStringMetadata(entry: WorldbookEntry, field: string): string | null {
  const value = _.get(entry, `extra.${field}`);
  if (_.isString(value) && value) return String(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function readUid(entry: WorldbookEntry): string | number | null {
  const value = (entry as any).uid;
  if (_.isString(value) && value) return String(value);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

function makeMetadataReport(entries: WorldbookEntry[]): CreativeWorkshopRepairMetadataFieldReport[] {
  return WORKSHOP_METADATA_FIELDS.map(field => {
    const values = entries.map(entry => readStringMetadata(entry, field)).filter((value): value is string => Boolean(value));
    const uniqueValues = _.uniq(values);
    let status: CreativeWorkshopRepairMetadataFieldReport['status'];
    if (values.length === 0) status = 'missing';
    else if (uniqueValues.length > 1 && field !== 'cw_entry_key') status = 'conflict';
    else if (values.length < entries.length) status = 'partial';
    else status = 'complete';
    return {
      field,
      status,
      presentCount: values.length,
      totalCount: entries.length,
      values: uniqueValues.slice(0, field === 'cw_entry_key' ? 4 : 8),
    };
  });
}

function candidateIdFor(worldbookName: string, projectName: string) {
  return `${worldbookName}::${projectName}`;
}

function describeCandidateProblems(candidate: Omit<CreativeWorkshopRepairCandidate, 'problems'>): string[] {
  const problems: string[] = [];
  const projectIdReport = candidate.metadata.find(item => item.field === 'cw_project_id');
  const versionReport = candidate.metadata.find(item => item.field === 'cw_project_version');
  const entryKeyReport = candidate.metadata.find(item => item.field === 'cw_entry_key');
  if (projectIdReport?.status === 'missing') problems.push('缺少 cw_project_id，无法仅靠工坊 metadata 识别项目');
  else if (projectIdReport?.status === 'partial') problems.push('只有部分条目具有 cw_project_id');
  else if (projectIdReport?.status === 'conflict') problems.push('cw_project_id 存在冲突，同一 DLC 组出现多个项目 ID');
  if (versionReport?.status === 'missing') problems.push('缺少 cw_project_version，无法确认本地版本');
  else if (versionReport?.status === 'conflict') problems.push('本地条目的 cw_project_version 不一致');
  if (entryKeyReport?.status === 'missing') problems.push('缺少 cw_entry_key，不能依赖工坊条目键进行更新');
  else if (entryKeyReport?.status === 'partial') problems.push('只有部分条目具有 cw_entry_key');
  if (candidate.unaddressableEntryCount > 0) problems.push(`${candidate.unaddressableEntryCount} 个条目没有本地 UID，自动删除不安全`);
  if (candidate.dlcHeaderCount === 0) problems.push('没有发现 [DLC] 命名头，仅依赖旧 metadata 识别');
  if (candidate.workshopSourceMarkerCount === 0) problems.push('没有发现 [WS] 工坊来源标记');
  return problems;
}

export async function scanCreativeWorkshopRepairCandidates(options: {
  worldbookNames?: string[];
} = {}): Promise<{
  candidates: CreativeWorkshopRepairCandidate[];
  unreadableWorldbookNames: string[];
  pending: CreativeWorkshopRepairRecord[];
  availableWorldbookNames: string[];
  enabledWorldbookNames: string[];
  scannedWorldbookNames: string[];
  officialBaselineVersion: string;
  officialBaselineSkippedCount: number;
  modifiedOfficialBaselineEntries: CreativeWorkshopModifiedOfficialBaselineEntry[];
  repairIntegrityLocked: boolean;
  repairIntegrityReason: string | null;
  repairIntegrityWorldbookName: string | null;
  repairIntegrityStatus: 'created' | 'healthy' | 'locked';
  repairIntegrityFields: CreativeWorkshopRepairIntegrityFieldReport[];
  repairIntegritySentinelCount: number;
  repairRestartRequired: boolean;
  repairRestartWorldbookNames: string[];
}> {
  const availableWorldbookNames = _.uniq(getWorldbookNames().filter(name => _.isString(name) && Boolean(name)));
  const availableWorldbookNameSet = new Set(availableWorldbookNames);
  const enabledWorldbookNames = _.uniq(
    getCreativeWorkshopBoundWorldbookNames().filter(name => _.isString(name) && Boolean(name)),
  );
  const requestedWorldbookNames = Array.isArray(options.worldbookNames) && options.worldbookNames.length > 0
    ? _.uniq(options.worldbookNames.filter(name => _.isString(name) && Boolean(name)))
        .filter(name => availableWorldbookNameSet.has(name))
    : enabledWorldbookNames;

  const rows = await Promise.all(
    requestedWorldbookNames.map(async worldbookName => {
      try {
        const integrity = await ensureRepairIntegritySentinel(worldbookName);
        return {
          worldbookName,
          entries: integrity.entries,
          readable: true,
          repairIntegrityLocked: integrity.locked,
          repairIntegrityReason: integrity.reason,
          repairIntegrityStatus: integrity.status,
          repairIntegrityFields: integrity.fields,
          repairIntegritySentinelCount: integrity.sentinelCount,
        };
      } catch (error) {
        console.warn('[CreativeWorkshop] repair scan 无法读取世界书', { worldbookName, error });
        return {
          worldbookName,
          entries: [] as WorldbookEntry[],
          readable: false,
          repairIntegrityLocked: false,
          repairIntegrityReason: null,
          repairIntegrityStatus: 'created' as const,
          repairIntegrityFields: [] as CreativeWorkshopRepairIntegrityFieldReport[],
          repairIntegritySentinelCount: 0,
        };
      }
    }),
  );

  const integrityFailure = rows.find(row => row.readable && row.repairIntegrityLocked);
  if (integrityFailure) {
    return {
      candidates: [],
      unreadableWorldbookNames: rows.filter(row => !row.readable).map(row => row.worldbookName),
      pending: getCreativeWorkshopPendingRepairs(),
      availableWorldbookNames,
      enabledWorldbookNames,
      scannedWorldbookNames: requestedWorldbookNames,
      officialBaselineVersion: OFFICIAL_WORLDBOOK_BASELINE_VERSION,
      officialBaselineSkippedCount: 0,
      modifiedOfficialBaselineEntries: [],
      repairIntegrityLocked: true,
      repairIntegrityReason: integrityFailure.repairIntegrityReason,
      repairIntegrityWorldbookName: integrityFailure.worldbookName,
      repairIntegrityStatus: 'locked',
      repairIntegrityFields: integrityFailure.repairIntegrityFields,
      repairIntegritySentinelCount: integrityFailure.repairIntegritySentinelCount,
      repairRestartRequired: false,
      repairRestartWorldbookNames: [],
    };
  }

  const readableIntegrityRows = rows.filter(row => row.readable);
  const repairRestartWorldbookNames = readableIntegrityRows
    .filter(row => row.repairIntegrityStatus === 'healthy' && isRepairRestartRequired(row.worldbookName))
    .map(row => row.worldbookName);
  readableIntegrityRows
    .filter(row => row.repairIntegrityStatus === 'healthy' && wasRepairRestartSatisfied(row.worldbookName))
    .forEach(row => clearRepairRestartRequired(row.worldbookName));
  const repairIntegrityStatus = readableIntegrityRows.length > 0
    && readableIntegrityRows.every(row => row.repairIntegrityStatus === 'healthy')
    ? 'healthy'
    : 'created';
  const primaryIntegrityRow = readableIntegrityRows[0] || null;

  let officialBaselineSkippedCount = 0;
  const modifiedOfficialBaselineEntries: CreativeWorkshopModifiedOfficialBaselineEntry[] = [];
  const entryRows: CandidateEntryRow[] = [];

  for (const row of rows.filter(row => row.readable)) {
    for (const entry of row.entries) {
      if (isRepairIntegritySentinelEntry(entry)) continue;
      const header = parseDlcEntryName(entry.name);
      const currentProjectId = readStringMetadata(entry, 'cw_project_id');
      const legacyProjectName = readStringMetadata(entry, 'fate_project_name');

      if (header && !currentProjectId && !legacyProjectName) {
        const baselineEntry = OFFICIAL_WORLDBOOK_BASELINE_BY_NAME.get(normalizeBaselineText((entry as any).name ?? (entry as any).comment));
        if (baselineEntry) {
          const fingerprint = await fingerprintWorldbookEntry(entry);
          if (fingerprint && fingerprint === baselineEntry.fingerprint) {
            officialBaselineSkippedCount += 1;
          } else {
            modifiedOfficialBaselineEntries.push({
              worldbookName: row.worldbookName,
              name: normalizeBaselineText((entry as any).name ?? (entry as any).comment),
            });
          }
          continue;
        }
      }

      if (header || currentProjectId || legacyProjectName) {
        entryRows.push({ worldbookName: row.worldbookName, entry, header });
      }
    }
  }

  const grouped = _.groupBy(entryRows, row => {
    const name = readStringMetadata(row.entry, 'cw_project_name_display') ||
      readStringMetadata(row.entry, 'fate_project_name') ||
      readStringMetadata(row.entry, 'cw_project_id') ||
      row.header?.projectName ||
      String(row.entry.name || '未命名 DLC');
    return candidateIdFor(row.worldbookName, name);
  });

  const regexes = getTavernRegexes({ scope: 'character', enable_state: 'all' });
  const candidates = Object.entries(grouped).map(([candidateId, candidateRows]) => {
    const entries = candidateRows.map(row => row.entry);
    const name = entries.map(entry => readStringMetadata(entry, 'cw_project_name_display')).find(Boolean) ||
      entries.map(entry => readStringMetadata(entry, 'fate_project_name')).find(Boolean) ||
      entries.map(entry => readStringMetadata(entry, 'cw_project_id')).find(Boolean) ||
      candidateRows[0]?.header?.projectName ||
      String(entries[0]?.name || '未命名 DLC');
    const category = candidateRows.map(row => row.header?.category || null).find(Boolean) || null;
    const worldbookName = candidateRows[0].worldbookName;
    const entryUids = entries.map(readUid).filter((value): value is string | number => value !== null);
    const metadata = makeMetadataReport(entries);
    const detectedProjectIds = _.uniq([
      ...entries.map(entry => readStringMetadata(entry, 'cw_project_id')).filter((value): value is string => Boolean(value)),
      ...entries.map(entry => readStringMetadata(entry, 'fate_project_name')).filter((value): value is string => Boolean(value)),
    ]);
    const regexIds = regexes
      .filter(regex => {
        const regexId = getCreativeWorkshopRegexId(regex);
        const scriptName = _.isString((regex as any).script_name) ? String((regex as any).script_name) : '';
        return detectedProjectIds.some(projectId => regexId.startsWith(`creative_workshop:${projectId}:`)) ||
          scriptName.startsWith(`[工坊] ${name} -`);
      })
      .map(regex => getCreativeWorkshopRegexId(regex))
      .filter(Boolean);
    const versions = _.uniq(entries.map(entry => readStringMetadata(entry, 'cw_project_version')).filter((value): value is string => Boolean(value)));
    const legacyNames = _.uniq(entries.map(entry => readStringMetadata(entry, 'fate_project_name')).filter((value): value is string => Boolean(value)));

    const base = {
      candidateId,
      name,
      category,
      worldbookName,
      entryUids,
      regexIds: _.uniq(regexIds),
      entryCount: entries.length,
      regexCount: _.uniq(regexIds).length,
      unaddressableEntryCount: entries.length - entryUids.length,
      dlcHeaderCount: candidateRows.filter(row => Boolean(row.header)).length,
      workshopSourceMarkerCount: candidateRows.filter(row => row.header?.workshopSourceMarker).length,
      detectedProjectId: detectedProjectIds.length === 1 ? detectedProjectIds[0] : null,
      detectedProjectIds,
      legacyProjectName: legacyNames.length === 1 ? legacyNames[0] : null,
      localVersion: versions.length === 1 ? versions[0] : null,
      metadata,
    } satisfies Omit<CreativeWorkshopRepairCandidate, 'problems'>;

    return {
      ...base,
      problems: describeCandidateProblems(base),
    } satisfies CreativeWorkshopRepairCandidate;
  });

  return {
    candidates: candidates.sort((a, b) => a.worldbookName.localeCompare(b.worldbookName) || a.name.localeCompare(b.name)),
    unreadableWorldbookNames: rows.filter(row => !row.readable).map(row => row.worldbookName),
    pending: getCreativeWorkshopPendingRepairs(),
    availableWorldbookNames,
    enabledWorldbookNames,
    scannedWorldbookNames: requestedWorldbookNames,
    officialBaselineVersion: OFFICIAL_WORLDBOOK_BASELINE_VERSION,
    officialBaselineSkippedCount,
    modifiedOfficialBaselineEntries,
    repairIntegrityLocked: false,
    repairIntegrityReason: null,
    repairIntegrityWorldbookName: null,
    repairIntegrityStatus,
    repairIntegrityFields: primaryIntegrityRow?.repairIntegrityFields || [],
    repairIntegritySentinelCount: primaryIntegrityRow?.repairIntegritySentinelCount || 0,
    repairRestartRequired: repairRestartWorldbookNames.length > 0,
    repairRestartWorldbookNames,
  };
}

function normalizeRepairTarget(target: CreativeWorkshopRepairTarget): CreativeWorkshopRepairTarget {
  const candidateId = String(target?.candidateId || '').trim();
  const projectId = String(target?.projectId || '').trim();
  const worldbookName = String(target?.worldbookName || '').trim();
  if (!candidateId) throw new Error('修复任务缺少 candidateId');
  if (!projectId) throw new Error('修复任务缺少 Workshop projectId');
  if (!worldbookName) throw new Error('修复任务缺少世界书');

  const entryUids = Array.from(new Set((Array.isArray(target.entryUids) ? target.entryUids : [])
    .map(value => (_.isString(value) && value) || (typeof value === 'number' && Number.isFinite(value) ? value : null))
    .filter((value): value is string | number => value !== null)));
  const regexIds = Array.from(new Set((Array.isArray(target.regexIds) ? target.regexIds : [])
    .filter(_.isString)
    .map(String)
    .filter(Boolean)));
  const expectedEntryCount = Number.isInteger(target.expectedEntryCount) && Number(target.expectedEntryCount) >= 0
    ? Number(target.expectedEntryCount)
    : undefined;
  const expectedRegexCount = Number.isInteger(target.expectedRegexCount) && Number(target.expectedRegexCount) >= 0
    ? Number(target.expectedRegexCount)
    : undefined;
  if (entryUids.length === 0 && regexIds.length === 0) {
    throw new Error('没有可安全定位的旧 DLC 内容；已禁止自动删除');
  }
  if (expectedEntryCount !== undefined && entryUids.length !== expectedEntryCount) {
    throw new Error(`旧 DLC 条目快照不完整：扫描到 ${expectedEntryCount} 个条目，但只有 ${entryUids.length} 个可定位 UID；已禁止自动删除`);
  }
  if (expectedRegexCount !== undefined && regexIds.length !== expectedRegexCount) {
    throw new Error(`旧 DLC 正则快照不完整：扫描到 ${expectedRegexCount} 个正则，但只有 ${regexIds.length} 个可定位 ID；已禁止自动删除`);
  }

  return {
    candidateId,
    projectId,
    projectVersion: _.isString(target.projectVersion) && target.projectVersion ? String(target.projectVersion) : null,
    worldbookName,
    entryUids,
    regexIds,
    expectedEntryCount,
    expectedRegexCount,
    sourceProjectIds: Array.from(new Set((Array.isArray(target.sourceProjectIds) ? target.sourceProjectIds : [])
      .filter(_.isString)
      .map(String)
      .filter(Boolean))),
  };
}

async function deleteSelectedRepairArtifacts(target: CreativeWorkshopRepairTarget) {
  const uidKeys = new Set(target.entryUids.map(uid => String(uid)));
  if (uidKeys.size > 0) {
    if (!getWorldbookNames().includes(target.worldbookName)) {
      throw new Error(`世界书「${target.worldbookName}」不存在，无法安全删除旧 DLC`);
    }
    await deleteWorldbookEntries(
      target.worldbookName,
      entry => {
        const uid = readUid(entry);
        return uid !== null && uidKeys.has(String(uid));
      },
      { render: 'immediate' },
    );
    const remaining = await getWorldbook(target.worldbookName);
    if (remaining.some(entry => {
      const uid = readUid(entry);
      return uid !== null && uidKeys.has(String(uid));
    })) {
      throw new Error(`世界书「${target.worldbookName}」仍存在选中的旧 DLC 条目`);
    }
  }

  const regexIds = new Set(target.regexIds);
  if (regexIds.size > 0) {
    await updateTavernRegexesWith(
      regexes => regexes.filter(regex => !regexIds.has(getCreativeWorkshopRegexId(regex))),
      { scope: 'character' },
    );
    const remainingRegexIds = new Set(
      getTavernRegexes({ scope: 'character', enable_state: 'all' }).map(regex => getCreativeWorkshopRegexId(regex)),
    );
    if (target.regexIds.some(regexId => remainingRegexIds.has(regexId))) {
      throw new Error('仍存在选中的旧 DLC 正则');
    }
  }
}

async function verifyCreativeWorkshopRepair(
  target: CreativeWorkshopRepairTarget,
  expectedEntryCount: number,
  expectedRegexCount: number,
) {
  const entries = await getWorldbook(target.worldbookName);
  const installedEntries = entries.filter(entry => _.get(entry, 'extra.cw_project_id') === target.projectId);
  if (installedEntries.length !== expectedEntryCount) {
    throw new Error(`修复验证失败：世界书应有 ${expectedEntryCount} 个新版条目，实际 ${installedEntries.length} 个`);
  }

  const regexes = getTavernRegexes({ scope: 'character', enable_state: 'all' });
  const installedRegexCount = regexes.filter(regex =>
    getCreativeWorkshopRegexId(regex).startsWith(`creative_workshop:${target.projectId}:`),
  ).length;
  if (installedRegexCount !== expectedRegexCount) {
    throw new Error(`修复验证失败：应有 ${expectedRegexCount} 个新版正则，实际 ${installedRegexCount} 个`);
  }
}

export async function repairCreativeWorkshopProject(rawTarget: CreativeWorkshopRepairTarget) {
  const target = normalizeRepairTarget(rawTarget);
  await assertRepairIntegritySentinel(target.worldbookName);
  const repairId = `${target.candidateId}::${target.projectId}`;
  const startedAt = Date.now();
  writeRepairRecord({ repairId, target, status: 'preparing', error: null, startedAt, updatedAt: startedAt });

  try {
    // Repair always targets the current Workshop version. Do not pin retries to an older matched version.
    invalidateCreativeWorkshopProjectCache(target.projectId);
    const { detail, prepared } = await prepareCreativeWorkshopProject(target.projectId);
    const preparedRegexes = prepareCreativeWorkshopRegexEntries(detail);
    await ensureCreativeWorkshopTargetWorldbook(target.worldbookName);

    updateRepairRecord(repairId, { status: 'replacing', error: null });
    await deleteSelectedRepairArtifacts(target);
    await applyPreparedCreativeWorkshopProject(target.projectId, detail, prepared, target.worldbookName, { pruneMissing: true });
    await applyPreparedCreativeWorkshopRegex(target.projectId, detail, preparedRegexes);
    setCreativeWorkshopInstallRecord(target.projectId, {
      worldbookName: target.worldbookName,
      installedVersion: detail.project.version || target.projectVersion || null,
    });
    for (const sourceProjectId of target.sourceProjectIds || []) {
      if (sourceProjectId !== target.projectId) deleteCreativeWorkshopInstallRecord(sourceProjectId);
    }

    updateRepairRecord(repairId, { status: 'verifying', error: null });
    await verifyCreativeWorkshopRepair(target, prepared.length, preparedRegexes.length);
    markRepairRestartRequired(target.worldbookName);
    deleteRepairRecord(repairId);
    return {
      success: true,
      candidateId: target.candidateId,
      projectId: target.projectId,
      installedVersion: detail.project.version || target.projectVersion || null,
      worldbookName: target.worldbookName,
      entryCount: prepared.length,
      regexCount: preparedRegexes.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateRepairRecord(repairId, { status: 'failed', error: message });
    throw error;
  }
}
