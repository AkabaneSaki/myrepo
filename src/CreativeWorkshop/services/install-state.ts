export type CreativeWorkshopInstalledProject = {
  projectId: string;
  name: string;
  localVersion: string | null;
  remoteVersion: string | null;
  entryCount: number;
  regexCount: number;
  canUpdate: boolean;
  hasUpdate: boolean;
};

export async function listInstalledCreativeWorkshopProjects(): Promise<CreativeWorkshopInstalledProject[]> {
  const charWorldbooks = getCharWorldbookNames('current');
  if (!charWorldbooks.primary) {
    return [];
  }

  const entries = await getWorldbook(charWorldbooks.primary);
  const groupedEntries = _.groupBy(
    entries.filter(
      entry => _.isString(_.get(entry, 'extra.cw_project_id')) || _.isString(_.get(entry, 'extra.fate_project_name')),
    ),
    entry => String(_.get(entry, 'extra.cw_project_id') || _.get(entry, 'extra.fate_project_name')),
  );

  const regexes = getTavernRegexes({ scope: 'character', enable_state: 'all' });
  const groupedRegexes = _.groupBy(
    regexes.filter(regex => String(regex.id || '').startsWith('creative_workshop:')),
    regex => String(regex.id || '').split(':')[1] || '',
  );

  return _(groupedEntries)
    .entries()
    .map(([projectId, projectEntries]) => {
      const projectRegexes = groupedRegexes[projectId] || [];
      const firstEntry = projectEntries[0];
      const localVersion = _.get(firstEntry, 'extra.cw_project_version', null);
      const remoteVersion = _.get(firstEntry, 'extra.cw_remote_version', localVersion);
      return {
        projectId,
        name: _.get(firstEntry, 'extra.cw_project_name_display', _.get(firstEntry, 'name', '未命名项目')),
        localVersion,
        remoteVersion,
        entryCount: projectEntries.length,
        regexCount: projectRegexes.length,
        canUpdate: Boolean(localVersion && remoteVersion && localVersion !== remoteVersion),
        hasUpdate: Boolean(localVersion && remoteVersion && localVersion !== remoteVersion),
      } satisfies CreativeWorkshopInstalledProject;
    })
    .value();
}
