import type { AppContext } from '../../types';
import { projectDb } from '../../utils/db';
import type { ProjectEntryKind } from '../../utils/project-content';
import { parseRegexEntriesPreview, parseWorldbookEntriesPreview, summarizeProjectInspection } from '../../utils/project-preview';

export async function computeProjectInspectionSummary(
  c: AppContext,
  projectId: string,
  overrides: Partial<Record<ProjectEntryKind, string>> = {},
) {
  const project = await projectDb.get(c, projectId);
  if (!project) throw new Error(`Project not found while computing inspection summary: ${projectId}`);

  const readText = async (kind: ProjectEntryKind) => {
    const override = overrides[kind];
    if (override !== undefined) return override;
    const object = await readProjectContentForEdit(c, project, kind);
    return object ? object.text() : null;
  };

  const [worldbookText, regexText] = await Promise.all([readText('worldbook'), readText('regex')]);
  return summarizeProjectInspection(
    worldbookText ? parseWorldbookEntriesPreview(worldbookText) : [],
    regexText ? parseRegexEntriesPreview(regexText) : [],
  );
}

function getProjectContentKey(projectId: string, kind: ProjectEntryKind): string {
  const fileName = kind === 'worldbook' ? `project-${projectId}.json` : `regex-${projectId}.json`;
  return `projects/${projectId}/${fileName}`;
}

export async function readProjectContentForEdit(
  c: AppContext,
  project: { id: string; publishedProjectId?: string | null },
  kind: ProjectEntryKind,
) {
  const targetObject = await c.env.R2_BUCKET.get(getProjectContentKey(project.id, kind));
  if (targetObject) return targetObject;
  if (project.publishedProjectId) {
    return c.env.R2_BUCKET.get(getProjectContentKey(project.publishedProjectId, kind));
  }
  return null;
}
