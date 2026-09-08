export const PROJECT_TYPES = ['事件', '系统核心', '角色', '扩展'] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const EXTENSION_TYPES = ['规则', '内容'] as const;
export type ExtensionType = (typeof EXTENSION_TYPES)[number];

export const MAX_CUSTOM_TAGS = 4;

export const SYSTEM_SIGNAL_DISPLAY_POLICY = {
  ejs: { label: 'EJS', card: true, detail: true },
  characterArtwork: { label: '👍🏻有角色立绘', card: true, detail: true },
} as const;

export const CHARACTER_FACET_OPTIONS = {
  种族: [
    '人类',
    '精灵/半精灵',
    '兽族',
    '翼民',
    '龙裔/龙姬',
    '人鱼',
    '血族',
    '妖精',
    '人造人/人偶',
    '构装体',
    '不死生物',
    '魔物',
    '异域生物',
    '神明',
    '英灵/诗灵',
  ],
  身份: [
    '冒险者',
    '战士',
    '骑士',
    '法师',
    '牧师/神官',
    '圣女',
    '修女',
    '炼金术士',
    '猎魔人',
    '佣兵',
    '猎人/游侠',
    '刺客/杀手',
    '盗贼',
    '商人',
    '工匠',
    '学者/研究员',
    '学生/学徒',
    '教师',
    '女仆',
    '贵族',
    '王族',
    '领主',
    '勇者',
    '旅行者',
    '侦探',
    '吟游诗人',
    '人妻',
    '老板娘',
  ],
  个性: [
    '大姐姐',
    '妈妈系',
    '妹妹系',
    '大小姐',
    '傲娇',
    '三无',
    '病娇',
    '腹黑',
    '天然呆',
    '元气',
    '温柔',
    '冷淡',
    '毒舌',
    '雌小鬼',
    '疯批',
    '笨蛋',
    '成熟',
    'cbz',
    'hnh',
  ],
  外貌特征: ['1011', '少女', '熟女', '巨乳', '贫乳', '肌肉', '男娘', 'TS/性转', '白发红瞳'],
  组织: [
    '冒险者公会',
    '魔法协会',
    '炼金公会',
    '锻造协会',
    '金狮商会',
    '苍棘之塔',
    '阴影势力',
    '雾晶学院',
    '凛冬学院',
    '教会/神殿',
  ],
  势力: ['帝国', '兽盟', '翼民圣国', '精灵王庭', '王国', '诺斯加德', '法环', '萨赫拉', '瓦伦蒂亚'],
} as const;

export type CharacterFacetKey = keyof typeof CHARACTER_FACET_OPTIONS;
export type ProjectFacets = Partial<Record<CharacterFacetKey, string[]>>;

export const PROJECT_TAXONOMY = {
  projectTypes: PROJECT_TYPES,
  extensionTypes: EXTENSION_TYPES,
  characterFacets: CHARACTER_FACET_OPTIONS,
  maxCustomTags: MAX_CUSTOM_TAGS,
  systemSignals: SYSTEM_SIGNAL_DISPLAY_POLICY,
} as const;

const LEGACY_BASE_TAG_BY_PROJECT_TYPE: Record<ProjectType, string> = {
  事件: '事件',
  系统核心: '系统',
  角色: '角色',
  扩展: '扩展',
};

const LEGACY_BASE_TAGS = new Set(Object.values(LEGACY_BASE_TAG_BY_PROJECT_TYPE));

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

export function normalizeProjectType(value: unknown): ProjectType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (normalized === '系统') return '系统核心';
  return PROJECT_TYPES.includes(normalized as ProjectType) ? (normalized as ProjectType) : null;
}

export function resolveProjectType(
  explicitValue: unknown,
  legacyTags: readonly string[] | null | undefined,
): ProjectType {
  const explicit = normalizeProjectType(explicitValue);
  if (explicit) return explicit;

  const tags = normalizeStringList(legacyTags);
  // Legacy data should fail closed: any strict category beats 扩展 so a dirty
  // multi-base-tag row cannot accidentally inherit the looser regex-only rule.
  if (tags.includes('系统') || tags.includes('系统核心')) return '系统核心';
  if (tags.includes('角色')) return '角色';
  if (tags.includes('事件')) return '事件';
  if (tags.includes('扩展')) return '扩展';

  // Preserve the historical fail-closed fallback for unknown legacy projects.
  return '系统核心';
}

export function normalizeExtensionType(value: unknown): ExtensionType | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return EXTENSION_TYPES.includes(normalized as ExtensionType) ? (normalized as ExtensionType) : null;
}

export function normalizeProjectFacets(value: unknown, projectType: ProjectType): ProjectFacets {
  if (projectType !== '角色' || !value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const result: ProjectFacets = {};

  for (const key of Object.keys(CHARACTER_FACET_OPTIONS) as CharacterFacetKey[]) {
    const allowed = new Set<string>(CHARACTER_FACET_OPTIONS[key]);
    const values = normalizeStringList(input[key]).filter(item => allowed.has(item));
    if (values.length > 0) result[key] = values;
  }

  return result;
}

export function getUnknownProjectFacetValues(value: unknown, projectType: ProjectType): string[] {
  if (projectType !== '角色' || !value || typeof value !== 'object' || Array.isArray(value)) return [];
  const input = value as Record<string, unknown>;
  const unknown: string[] = [];

  for (const [rawKey, rawValues] of Object.entries(input)) {
    if (!(rawKey in CHARACTER_FACET_OPTIONS)) {
      if (Array.isArray(rawValues) && rawValues.length > 0) unknown.push(`${rawKey}: ${rawValues.join(', ')}`);
      else unknown.push(rawKey);
      continue;
    }
    const key = rawKey as CharacterFacetKey;
    const allowed = new Set<string>(CHARACTER_FACET_OPTIONS[key]);
    for (const item of normalizeStringList(rawValues)) {
      if (!allowed.has(item)) unknown.push(`${key}: ${item}`);
    }
  }

  return unknown;
}

export function normalizeCustomTags(value: unknown, legacyTags?: readonly string[] | null): string[] {
  const source = value === undefined ? legacyTags : value;
  return normalizeStringList(source).filter(tag => !LEGACY_BASE_TAGS.has(tag) && tag !== '系统核心');
}

export function buildLegacyProjectTags(projectType: ProjectType, customTags: readonly string[]): string[] {
  return [LEGACY_BASE_TAG_BY_PROJECT_TYPE[projectType], ...normalizeStringList(customTags)];
}

export type NormalizedProjectTaxonomy = {
  projectType: ProjectType;
  extensionType: ExtensionType | null;
  facets: ProjectFacets;
  customTags: string[];
  legacyTags: string[];
};

export function normalizeProjectTaxonomyInput(
  input: Record<string, unknown>,
  options: { requireExtensionSubtypeForExplicitType?: boolean } = {},
): { value: NormalizedProjectTaxonomy | null; error?: string } {
  const legacyTags = normalizeStringList(input.tags);
  const explicitProjectTypeValue = input.projectType ?? input.project_type;
  const explicitProjectType = normalizeProjectType(explicitProjectTypeValue);
  const projectType = resolveProjectType(explicitProjectTypeValue, legacyTags);
  const rawExtensionType = input.extensionType ?? input.extension_type;
  const extensionType = projectType === '扩展' ? normalizeExtensionType(rawExtensionType) : null;
  const rawFacets = input.facets ?? input.projectFacets ?? input.project_facets;
  const unknownFacets = getUnknownProjectFacetValues(rawFacets, projectType);
  const facets = normalizeProjectFacets(rawFacets, projectType);
  const customTags = normalizeCustomTags(input.customTags ?? input.custom_tags, legacyTags);

  if (explicitProjectTypeValue !== undefined && explicitProjectTypeValue !== null && !explicitProjectType) {
    return { value: null, error: '无效的项目分类' };
  }
  if (projectType !== '扩展' && rawExtensionType !== undefined && rawExtensionType !== null && String(rawExtensionType).trim()) {
    return { value: null, error: '只有扩展项目可以选择「规则」或「内容」' };
  }
  if (options.requireExtensionSubtypeForExplicitType && explicitProjectType === '扩展' && !extensionType) {
    return { value: null, error: '扩展项目必须选择「规则」或「内容」' };
  }
  if (projectType !== '角色' && rawFacets && typeof rawFacets === 'object' && Object.keys(rawFacets as object).length > 0) {
    return { value: null, error: '只有角色项目可以使用角色官方标签' };
  }
  if (unknownFacets.length > 0) {
    return { value: null, error: `包含未定义的官方标签：${unknownFacets.join('；')}` };
  }
  if (customTags.length > MAX_CUSTOM_TAGS) {
    return { value: null, error: `自定义标签最多 ${MAX_CUSTOM_TAGS} 个` };
  }

  return {
    value: {
      projectType,
      extensionType,
      facets,
      customTags,
      legacyTags: buildLegacyProjectTags(projectType, customTags),
    },
  };
}
