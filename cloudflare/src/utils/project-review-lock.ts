import type { ProjectType } from '../types';

type ReviewLockProject = Pick<
  ProjectType,
  'id' | 'status' | 'reviewTarget' | 'publishedProjectId' | 'isPublished'
>;

export const PROJECT_REVIEW_FINALIZING_ERROR = 'Project review is being finalized. Please retry shortly.';

export function isFinalizingReviewDraft(project: ReviewLockProject): boolean {
  return project.reviewTarget === 'draft' && project.status === 'approved' && Boolean(project.publishedProjectId);
}

export async function isProjectMutationReviewLocked(
  project: ReviewLockProject,
  findLinkedDraft: (publishedProjectId: string) => Promise<ReviewLockProject | null>,
): Promise<boolean> {
  if (isFinalizingReviewDraft(project)) return true;
  if (!(project.isPublished && project.status === 'approved')) return false;

  const linkedDraft = await findLinkedDraft(project.id);
  return Boolean(linkedDraft && isFinalizingReviewDraft(linkedDraft));
}
