export const CREATIVE_WORKSHOP_PROJECT_TYPES = ['系统核心', '扩展', '角色', '事件'] as const;
export const CREATIVE_WORKSHOP_EXTENSION_TYPES = ['规则', '内容'] as const;

export type CreativeWorkshopProjectType = (typeof CREATIVE_WORKSHOP_PROJECT_TYPES)[number];
export type CreativeWorkshopExtensionType = (typeof CREATIVE_WORKSHOP_EXTENSION_TYPES)[number];

function normalizeProjectType(value: unknown): CreativeWorkshopProjectType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (normalized === '系统') return '系统核心';
  return CREATIVE_WORKSHOP_PROJECT_TYPES.includes(normalized as CreativeWorkshopProjectType)
    ? (normalized as CreativeWorkshopProjectType)
    : null;
}

function normalizeExtensionType(value: unknown): CreativeWorkshopExtensionType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return CREATIVE_WORKSHOP_EXTENSION_TYPES.includes(normalized as CreativeWorkshopExtensionType)
    ? (normalized as CreativeWorkshopExtensionType)
    : null;
}

function normalizeLegacyTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((tag): tag is string => typeof tag === 'string')
    .map(tag => tag.trim())
    .filter(Boolean);
}

export function resolveCreativeWorkshopProjectType(
  project: Record<string, any> | null | undefined,
): CreativeWorkshopProjectType {
  if (!project || typeof project !== 'object') return '系统核心';

  const explicitType = normalizeProjectType(project.projectType ?? project.project_type);
  if (explicitType) return explicitType;

  const tags = normalizeLegacyTags(project.tags);
  if (tags.includes('系统') || tags.includes('系统核心')) return '系统核心';
  if (tags.includes('角色')) return '角色';
  if (tags.includes('事件')) return '事件';
  if (tags.includes('扩展')) return '扩展';

  return '系统核心';
}

export function resolveCreativeWorkshopExtensionType(
  project: Record<string, any> | null | undefined,
): CreativeWorkshopExtensionType | null {
  if (!project || resolveCreativeWorkshopProjectType(project) !== '扩展') return null;
  return normalizeExtensionType(project.extensionType ?? project.extension_type);
}

export function getCreativeWorkshopProjectTypeLabel(project: Record<string, any> | null | undefined): string {
  const projectType = resolveCreativeWorkshopProjectType(project);
  if (projectType !== '扩展') return projectType;
  const extensionType = resolveCreativeWorkshopExtensionType(project);
  return extensionType ? `${extensionType}扩展` : '扩展';
}

export function formatCreativeWorkshopEntryName(
  entryName: string,
  project: Record<string, any> | null | undefined,
  projectName: string,
): string {
  const projectType = resolveCreativeWorkshopProjectType(project);
  if (projectType === '系统核心') {
    return entryName.startsWith('命定系统-') ? entryName : `命定系统-${entryName}`;
  }

  const typeLabel = getCreativeWorkshopProjectTypeLabel(project);
  return entryName.startsWith('[DLC]') ? entryName : `[DLC][${typeLabel}][${projectName}]${entryName}`;
}
