import {
  getCreativeWorkshopBoundWorldbookNames,
  getCreativeWorkshopInstallRecords,
  getCreativeWorkshopRelevantWorldbookNames,
} from './install-registry';
import { getCreativeWorkshopRegexId } from './regex-name';

export type CreativeWorkshopInstalledProject = {
  projectId: string;
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

async function readWorldbookEntries(worldbookName: string, boundNames: Set<string>): Promise<WorldbookScanRow> {
  if (!getWorldbookNames().includes(worldbookName)) {
    if (!boundNames.has(worldbookName)) {
      return { worldbookName, entries: [], readable: true };
    }
    return { worldbookName, entries: [], readable: false };
  }

  try {
    return { worldbookName, entries: await getWorldbook(worldbookName), readable: true };
  } catch (error) {
    console.warn('[CreativeWorkshop] 无法读取安装目标世界书', { worldbookName, error });
    return { worldbookName, entries: [], readable: false };
  }
}

async function refreshWorldbookReadiness() {
  const tavernContext = (SillyTavern as any).getContext?.() || SillyTavern;
  try {
    await tavernContext.updateWorldInfoList?.();
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
        entry => _.isString(_.get(entry, 'extra.cw_project_id')) || _.isString(_.get(entry, 'extra.fate_project_name')),
      )
      .map(entry => ({ worldbookName, entry })),
  );
  const groupedEntries = _.groupBy(entryRows, row =>
    String(_.get(row.entry, 'extra.cw_project_id') || _.get(row.entry, 'extra.fate_project_name')),
  );

  const regexes = getTavernRegexes({ scope: 'character', enable_state: 'all' });
  const groupedRegexes = _.groupBy(
    regexes.filter(regex => getCreativeWorkshopRegexId(regex).startsWith('creative_workshop:')),
    regex => getCreativeWorkshopRegexId(regex).split(':')[1] || '',
  );

  const projects = _.uniq([...Object.keys(groupedEntries), ...Object.keys(groupedRegexes)])
    .filter(Boolean)
    .map(projectId => {
      const projectRows = groupedEntries[projectId] || [];
      const projectEntries = projectRows.map(row => row.entry);
      const projectRegexes = groupedRegexes[projectId] || [];
      const firstEntry = projectEntries[0];
      const firstRegex = projectRegexes[0];
      const localVersion = registry[projectId]?.installedVersion ||
        (firstEntry ? _.get(firstEntry, 'extra.cw_project_version', null) : null);
      const legacyProjectName =
        projectEntries
          .map(entry => _.get(entry, 'extra.fate_project_name'))
          .find(value => _.isString(value) && Boolean(value)) ||
        (!UUID_PATTERN.test(projectId) ? projectId : null);
      return {
        projectId,
        name: firstEntry
          ? _.get(firstEntry, 'extra.cw_project_name_display', legacyProjectName || _.get(firstEntry, 'name', '未命名项目'))
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
