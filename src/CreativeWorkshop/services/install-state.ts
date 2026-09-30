import {
  createCreativeWorkshopRegexIdentityResolver,
  getCreativeWorkshopBoundWorldbookNames,
  getCreativeWorkshopInstallRecords,
  getCreativeWorkshopRelevantWorldbookNames,
} from './install-registry';
import { getCreativeWorkshopWorldbookMetadataString } from './install-identity';


export type CreativeWorkshopInstalledProject = {
  projectId: string;
  installedProjectId: string;
  projectNameHint: string | null;
  name: string;
  legacyProjectName: string | null;
  localVersion: string | null;
  remoteVersion: string | null;
  entryCount: number;
  regexCount: number;
  canUpdate: boolean;
  hasUpdate: boolean;
  worldbookName: string | null;
};

export type CreativeWorkshopInstalledProjectScan = {
  projects: CreativeWorkshopInstalledProject[];
  complete: boolean;
  unreadableWorldbookNames: string[];
};

type WorldbookScanRow = {
  worldbookName: string;
  entries: WorldbookEntry[];
  readable: boolean;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const INSTALL_STATE_STEP_TIMEOUT_MS = 2500;

async function withInstallStateTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`${label} 超时`)),
          INSTALL_STATE_STEP_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

async function readWorldbookEntries(worldbookName: string, boundNames: Set<string>): Promise<WorldbookScanRow> {
  if (!getWorldbookNames().includes(worldbookName)) {
    if (!boundNames.has(worldbookName)) {
      return { worldbookName, entries: [], readable: true };
    }
    return { worldbookName, entries: [], readable: false };
  }

  try {
    return { worldbookName, entries: await withInstallStateTimeout(getWorldbook(worldbookName), `读取世界书「${worldbookName}」`), readable: true };
  } catch (error) {
    console.warn('[CreativeWorkshop] 无法读取安装目标世界书', { worldbookName, error });
    return { worldbookName, entries: [], readable: false };
  }
}

async function refreshWorldbookReadiness() {
  const tavernContext = (SillyTavern as any).getContext?.() || SillyTavern;
  try {
    await withInstallStateTimeout(Promise.resolve(tavernContext.updateWorldInfoList?.()), '刷新世界书列表');
  } catch (error) {
    console.warn('[CreativeWorkshop] 无法刷新世界书列表', error);
  }
}

async function readRelevantWorldbooksWithRetry(): Promise<WorldbookScanRow[]> {
  const initialNames = getCreativeWorkshopRelevantWorldbookNames();
  const initialBoundNames = new Set(getCreativeWorkshopBoundWorldbookNames());
  const firstRows = await Promise.all(
    initialNames.map(worldbookName => readWorldbookEntries(worldbookName, initialBoundNames)),
  );
  const unreadableNames = firstRows.filter(row => !row.readable).map(row => row.worldbookName);
  if (unreadableNames.length === 0) return firstRows;

  await refreshWorldbookReadiness();

  const refreshedNames = _.uniq([...initialNames, ...getCreativeWorkshopRelevantWorldbookNames()]);
  const refreshedBoundNames = new Set(getCreativeWorkshopBoundWorldbookNames());
  const readableRowsByName = new Map(firstRows.filter(row => row.readable).map(row => [row.worldbookName, row]));
  return Promise.all(
    refreshedNames.map(
      worldbookName => readableRowsByName.get(worldbookName) || readWorldbookEntries(worldbookName, refreshedBoundNames),
    ),
  );
}

export async function scanInstalledCreativeWorkshopProjects(): Promise<CreativeWorkshopInstalledProjectScan> {
  const registry = getCreativeWorkshopInstallRecords();
  const worldbookRows = await readRelevantWorldbooksWithRetry();
  const unreadableWorldbookNames = worldbookRows.filter(row => !row.readable).map(row => row.worldbookName);
  const worldbooks = worldbookRows.filter(row => row.readable);

  const entryRows = worldbooks.flatMap(({ worldbookName, entries }) =>
    entries
      .filter(
        entry =>
          Boolean(getCreativeWorkshopWorldbookMetadataString(entry, 'cw_project_id')) ||
          Boolean(getCreativeWorkshopWorldbookMetadataString(entry, 'fate_project_name')),
      )
      .map(entry => ({ worldbookName, entry })),
  );
  const groupedEntries = _.groupBy(entryRows, row =>
    String(
      getCreativeWorkshopWorldbookMetadataString(row.entry, 'cw_project_id') ||
      getCreativeWorkshopWorldbookMetadataString(row.entry, 'fate_project_name') ||
      '',
    ),
  );

  const regexes = getTavernRegexes({ scope: 'character', enable_state: 'all' });
  const resolveRegexIdentity = createCreativeWorkshopRegexIdentityResolver(regexes);
  const managedRegexRows = regexes
    .map(regex => ({ regex, identity: resolveRegexIdentity(regex) }))
    .filter(row => Boolean(row.identity));
  const groupedRegexes = _.groupBy(
    managedRegexRows,
    row => row.identity?.projectId || '',
  );

  const projects = _.uniq([...Object.keys(groupedEntries), ...Object.keys(groupedRegexes)])
    .filter(Boolean)
    .map(projectId => {
      const projectRows = groupedEntries[projectId] || [];
      const projectEntries = projectRows.map(row => row.entry);
      const projectRegexRows = groupedRegexes[projectId] || [];
      const projectRegexes = projectRegexRows.map(row => row.regex);
      const firstEntry = projectEntries[0];
      const firstRegex = projectRegexes[0];
      const regexVersions = _.uniq(
        projectRegexRows
          .map(row => row.identity?.installedVersion || null)
          .filter((value): value is string => Boolean(value)),
      );
      const localVersion = registry[projectId]?.installedVersion ||
        (firstEntry ? getCreativeWorkshopWorldbookMetadataString(firstEntry, 'cw_project_version') : null) ||
        (regexVersions.length === 1 ? regexVersions[0] : null);
      const legacyProjectName =
        projectEntries
          .map(entry => getCreativeWorkshopWorldbookMetadataString(entry, 'fate_project_name'))
          .find(value => _.isString(value) && Boolean(value)) ||
        (!UUID_PATTERN.test(projectId) ? projectId : null);
      const projectNameHint = projectEntries
        .map(entry => getCreativeWorkshopWorldbookMetadataString(entry, 'cw_project_name_display'))
        .find(value => _.isString(value) && Boolean(String(value).trim()));
      return {
        projectId,
        installedProjectId: projectId,
        projectNameHint: _.isString(projectNameHint) ? projectNameHint.trim() : legacyProjectName,
        name: firstEntry
          ? getCreativeWorkshopWorldbookMetadataString(firstEntry, 'cw_project_name_display') ||
            legacyProjectName ||
            _.get(firstEntry, 'name', '未命名项目')
          : legacyProjectName || _.get(firstRegex, 'script_name', '未命名项目'),
        legacyProjectName,
        localVersion,
        remoteVersion: null,
        entryCount: projectEntries.length,
        regexCount: projectRegexes.length,
        canUpdate: false,
        hasUpdate: false,
        worldbookName: registry[projectId]?.worldbookName || projectRows[0]?.worldbookName || null,
      } satisfies CreativeWorkshopInstalledProject;
    });

  return {
    projects,
    complete: unreadableWorldbookNames.length === 0,
    unreadableWorldbookNames,
  };
}

export async function listInstalledCreativeWorkshopProjects(): Promise<CreativeWorkshopInstalledProject[]> {
  return (await scanInstalledCreativeWorkshopProjects()).projects;
}
