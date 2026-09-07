import type { ProjectEntryKind } from '../utils/project-content';

export const PROJECT_BASE_TAGS = ['系统', '扩展', '角色', '事件'] as const;
export type ProjectBaseTag = (typeof PROJECT_BASE_TAGS)[number];

export type ProjectContentPresence = Record<ProjectEntryKind, boolean>;

type ProjectContentRule = {
  required: readonly ProjectEntryKind[];
  anyOf: readonly ProjectEntryKind[];
};

/**
 * Creative Workshop gameplay/content policy.
 *
 * Keep changeable gameplay rules here instead of scattering them across UI,
 * upload endpoints, and review logic. File-format validity (what counts as a
 * SillyTavern worldbook/regex JSON) belongs in utils/project-content.ts.
 *
 * Stored tag `系统` is the current "系统核心" category.
 */
export const PROJECT_CONTENT_POLICY: Record<ProjectBaseTag, ProjectContentRule> = {
  系统: { required: ['worldbook'], anyOf: [] },
  角色: { required: ['worldbook'], anyOf: [] },
  事件: { required: ['worldbook'], anyOf: [] },
  扩展: { required: [], anyOf: ['worldbook', 'regex'] },
};

export function resolveProjectBaseTag(tags: readonly string[] | null | undefined): ProjectBaseTag {
  const matched = PROJECT_BASE_TAGS.filter(tag => tags?.includes(tag));
  const strictMatch = matched.find(tag => tag !== '扩展');
  // Match the existing UI fallback and fail closed: unknown/missing base tags
  // inherit the stricter system policy rather than silently allowing regex-only.
  return strictMatch ?? (matched.includes('扩展') ? '扩展' : '系统');
}

export type ProjectContentPolicyValidation =
  | { valid: true; baseTag: ProjectBaseTag }
  | { valid: false; baseTag: ProjectBaseTag; error: string };

export function validateProjectContentPolicy(
  tags: readonly string[] | null | undefined,
  presence: ProjectContentPresence,
): ProjectContentPolicyValidation {
  const baseTag = resolveProjectBaseTag(tags);
  const rule = PROJECT_CONTENT_POLICY[baseTag];

  for (const kind of rule.required) {
    if (!presence[kind]) {
      return {
        valid: false,
        baseTag,
        error: `${baseTag}项目必须包含有效世界书`,
      };
    }
  }

  if (rule.anyOf.length > 0 && !rule.anyOf.some(kind => presence[kind])) {
    return {
      valid: false,
      baseTag,
      error: `${baseTag}项目必须包含有效世界书或正则`,
    };
  }

  return { valid: true, baseTag };
}
