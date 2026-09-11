import { creativeWorkshopDiag, creativeWorkshopDiagError } from './diagnostic-log';
import { getCreativeWorkshopInstallRecords, getCreativeWorkshopRelevantWorldbookNames } from './install-registry';
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

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function readWorldbookEntries(worldbookName: string) {
  try {
    return await getWorldbook(worldbookName);
  } catch (error) {
    creativeWorkshopDiagError('install-state:worldbook-read-error', {
      worldbookName,
      error: error instanceof Error ? error.message : String(error),
    });
    return [] as WorldbookEntry[];
  }
}

export async function listInstalledCreativeWorkshopProjects(): Promise<CreativeWorkshopInstalledProject[]> {
  const registry = getCreativeWorkshopInstallRecords();
  const worldbookNames = getCreativeWorkshopRelevantWorldbookNames();

  creativeWorkshopDiag('install-state:scan:start', {
    registryProjectIds: Object.keys(registry),
    worldbookNames,
  });

  const worldbooks = await Promise.all(
    worldbookNames.map(async worldbookName => ({
      worldbookName,
      entries: await readWorldbookEntries(worldbookName),
    })),
  );

  worldbooks.forEach(({ worldbookName, entries }) => {
    const workshopEntryCount = entries.filter(
      entry => _.isString(_.get(entry, 'extra.cw_project_id')) || _.isString(_.get(entry, 'extra.fate_project_name')),
    ).length;
    const suspiciousIdentitylessCount = entries.filter(entry => {
      const name = String(_.get(entry, 'name', ''));
      const hasWorkshopIdentity =
        _.isString(_.get(entry, 'extra.cw_project_id')) || _.isString(_.get(entry, 'extra.fate_project_name'));
      return !hasWorkshopIdentity && (name.startsWith('[DLC]') || name.startsWith('命定系统-'));
    }).length;
    if (workshopEntryCount === 0 && suspiciousIdentitylessCount === 0) return;
    creativeWorkshopDiag('install-state:worldbook', {
      worldbookName,
      totalEntries: entries.length,
      workshopEntryCount,
      suspiciousIdentitylessCount,
    });
  });

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
      const localVersion = firstEntry ? _.get(firstEntry, 'extra.cw_project_version', null) : null;
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

  const detectedProjectIds = new Set(projects.map(project => project.projectId));
  Object.entries(registry).forEach(([projectId, record]) => {
    if (detectedProjectIds.has(projectId)) return;
    const recordedWorldbook = worldbooks.find(({ worldbookName }) => worldbookName === record.worldbookName);
    const recordedEntries = recordedWorldbook?.entries || [];
    const identityMatchCount = recordedEntries.filter(
      entry =>
        _.get(entry, 'extra.cw_project_id') === projectId || _.get(entry, 'extra.fate_project_name') === projectId,
    ).length;
    const identitylessDlcCount = recordedEntries.filter(entry => {
      const name = String(_.get(entry, 'name', ''));
      const hasWorkshopIdentity =
        _.isString(_.get(entry, 'extra.cw_project_id')) || _.isString(_.get(entry, 'extra.fate_project_name'));
      return !hasWorkshopIdentity && (name.startsWith('[DLC]') || name.startsWith('命定系统-'));
    }).length;
    creativeWorkshopDiag('install-state:registry-missing-identity', {
      projectId,
      recordedWorldbookName: record.worldbookName,
      recordedWorldbookWasScanned: Boolean(recordedWorldbook),
      recordedWorldbookEntryCount: recordedWorldbook?.entries.length ?? null,
      identityMatchCount,
      identitylessDlcCount,
    });
  });

  projects.forEach(project => creativeWorkshopDiag('install-state:project', ({
    projectId: project.projectId,
    name: project.name,
    legacyProjectName: project.legacyProjectName,
    localVersion: project.localVersion,
    entryCount: project.entryCount,
    regexCount: project.regexCount,
    worldbookName: project.worldbookName,
  })));
  creativeWorkshopDiag('install-state:scan:complete', {
    detectedProjectCount: projects.length,
    detectedProjectIds: projects.map(project => project.projectId),
  });
  return projects;
}
