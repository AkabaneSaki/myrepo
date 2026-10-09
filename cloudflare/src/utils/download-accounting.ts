// Only successful retrievals of the project's own installable JSON count.
// No heuristic suffix matching or cover/gallery file counting.
export function isCountedProjectDownload(key: string, projectId: string): boolean {
  return key === 'projects/' + projectId + '/project-' + projectId + '.json' ||
    key === 'projects/' + projectId + '/regex-' + projectId + '.json';
}
