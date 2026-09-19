export const CREATIVE_WORKSHOP_PROJECT_TYPES = ['系统核心', '扩展', '角色', '事件'] as const;
export const CREATIVE_WORKSHOP_EXTENSION_TYPES = ['规则', '内容'] as const;
export const CREATIVE_WORKSHOP_NAME_FORMAT_VERSION = 4;

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

export function getCreativeWorkshopDlcCategory(project: Record<string, any> | null | undefined): string {
  const projectType = resolveCreativeWorkshopProjectType(project);
  return projectType === '系统核心' ? '命定系统' : projectType;
}

function readLeadingBracketSegment(value: string, offset: number): { value: string; end: number } | null {
  const match = value.slice(offset).match(/^\[([^\[\]]+)\]/);
  if (!match) return null;
  return { value: match[1], end: offset + match[0].length };
}

function getExistingDlcCategory(entryName: string): string | null {
  const first = readLeadingBracketSegment(entryName, 0);
  if (!first) return null;

  // v4: [WS][DLC][category]author content
  if (first.value === 'WS') {
    const dlc = readLeadingBracketSegment(entryName, first.end);
    if (!dlc || dlc.value !== 'DLC') return null;
    return readLeadingBracketSegment(entryName, dlc.end)?.value || null;
  }

  // v3/v2/legacy: [DLC][category]...
  if (first.value !== 'DLC') return null;
  return readLeadingBracketSegment(entryName, first.end)?.value || null;
}

function stripExistingDlcHeader(entryName: string): string {
  const first = readLeadingBracketSegment(entryName, 0);
  if (!first) return entryName;

  // v4: [WS][DLC][category]author content
  if (first.value === 'WS') {
    const dlc = readLeadingBracketSegment(entryName, first.end);
    if (!dlc || dlc.value !== 'DLC') return entryName;
    const category = readLeadingBracketSegment(entryName, dlc.end);
    return category ? entryName.slice(category.end) : entryName;
  }

  if (first.value !== 'DLC') return entryName;
  const dlc = first;
  const category = readLeadingBracketSegment(entryName, dlc.end);
  if (!category) return entryName.slice(dlc.end);

  const third = readLeadingBracketSegment(entryName, category.end);
  if (!third) return entryName.slice(category.end);

  // v3: [DLC][category][WS]author content
  if (third.value === 'WS') return entryName.slice(third.end);

  const fourth = readLeadingBracketSegment(entryName, third.end);
  // v2: [DLC][category][project][WS]author content
  if (fourth?.value === 'WS') {
    const authorContent = entryName.slice(fourth.end);
    // Some already-damaged v2 names contain no author suffix. Preserve the old
    // third segment as a human-readable fallback rather than returning blank.
    return authorContent || `[${third.value}]`;
  }

  // Source/legacy entries commonly use the third segment as the actual entry
  // title, e.g. [DLC][扩展][种族-地精]. Preserve it instead of eating it.
  return entryName.slice(category.end);
}

function stripLegacyCorePrefix(entryName: string): string {
  if (entryName.startsWith('命定系统-')) return entryName.slice('命定系统-'.length);
  if (entryName.startsWith('[命定系统]')) return entryName.slice('[命定系统]'.length);
  return entryName;
}

export function formatCreativeWorkshopEntryName(
  entryName: string,
  project: Record<string, any> | null | undefined,
  _projectName: string,
): string {
  const projectType = resolveCreativeWorkshopProjectType(project);
  let authorContent = stripExistingDlcHeader(entryName);
  if (projectType === '系统核心') authorContent = stripLegacyCorePrefix(authorContent);

  const category = getExistingDlcCategory(entryName) || getCreativeWorkshopDlcCategory(project);
  return `[WS][DLC][${category}]${authorContent}`;
}
