import type { Context } from 'hono';
import { z } from 'zod';
import { CHARACTER_FACET_OPTIONS, EXTENSION_TYPES, MAX_CUSTOM_TAGS, PROJECT_TYPES } from './config/project-taxonomy';
import type { Env } from './env';

export type AppContext = Context<{ Bindings: Env }>;

// ============ 枚举定义 ============
export const ProjectStatus = z.enum(['pending', 'approved', 'rejected']);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

export const ProjectReviewTarget = z.enum(['project', 'draft']);
export type ProjectReviewTarget = z.infer<typeof ProjectReviewTarget>;

export const ProjectCategory = z.enum(PROJECT_TYPES);
export type ProjectCategory = z.infer<typeof ProjectCategory>;

export const ProjectExtensionType = z.enum(EXTENSION_TYPES);
export type ProjectExtensionType = z.infer<typeof ProjectExtensionType>;

export const ProjectFacets = z.object({
  种族: z.array(z.enum(CHARACTER_FACET_OPTIONS.种族)).optional(),
  身份: z.array(z.enum(CHARACTER_FACET_OPTIONS.身份)).optional(),
  个性: z.array(z.enum(CHARACTER_FACET_OPTIONS.个性)).optional(),
  外貌特征: z.array(z.enum(CHARACTER_FACET_OPTIONS.外貌特征)).optional(),
  组织: z.array(z.enum(CHARACTER_FACET_OPTIONS.组织)).optional(),
  势力: z.array(z.enum(CHARACTER_FACET_OPTIONS.势力)).optional(),
});
export type ProjectFacets = z.infer<typeof ProjectFacets>;

const ProjectEntryInspection = z.object({
  hasEjs: z.boolean().default(false).describe('系统检测到条目包含 EJS'),
  hasCharacterArtwork: z.boolean().default(false).describe('系统检测到完整角色立绘模板'),
  characterArtworkBlockCount: z.number().int().min(0).default(0).describe('完整角色立绘模板块数量'),
  inspectionWarnings: z.array(z.string()).default([]).describe('内容静态检查警告'),
  externalLinks: z
    .array(
      z.object({
        url: z.string(),
        hostname: z.string(),
      }),
    )
    .default([])
    .describe('静态检测到的 HTTP/HTTPS 外链；未验证远端内容'),
});

export const WorldbookEntryPreview = z.object({
  entryKey: z.string().optional(),
  uid: z.string().optional(),
  comment: z.string().optional(),
  content: z.string().optional(),
  key: z.array(z.string()).optional(),
  keysecondary: z.array(z.string()).optional(),
  constant: z.boolean().optional(),
  vectorized: z.boolean().optional(),
  selective: z.boolean().optional(),
  selectiveLogic: z.number().optional(),
  secondaryLogic: z.enum(['and_any', 'not_all', 'not_any', 'and_all']).optional(),
  strategyType: z.enum(['constant', 'selective', 'vectorized']).optional(),
  position: z.number().optional(),
  positionType: z.string().optional(),
  outletName: z.string().optional(),
  role: z.union([z.number(), z.string()]).nullable().optional(),
  depth: z.number().optional(),
  order: z.number().optional(),
  enabled: z.boolean().optional(),
  disable: z.boolean().optional(),
  scanDepth: z.number().nullable().optional(),
  ...ProjectEntryInspection.shape,
});

export const RegexEntryPreview = z.object({
  entryKey: z.string().optional(),
  id: z.string().optional(),
  scriptName: z.string().optional(),
  findRegex: z.string().optional(),
  replaceString: z.string().optional(),
  disabled: z.boolean().optional(),
  markdownOnly: z.boolean().optional(),
  promptOnly: z.boolean().optional(),
  ...ProjectEntryInspection.shape,
});

// ============ 用户相关类型 ============
export const DiscordUser = z.object({
  id: z.string().describe('Discord 用户 ID'),
  username: z.string().describe('Discord 用户名'),
  global_name: z.string().optional().describe('Discord 全局昵称'),
  avatar: z.string().describe('Discord 头像 ID'),
  discriminator: z.string().describe('Discord discriminator'),
});

export const User = DiscordUser.extend({
  guilds: z.array(z.string()).describe('用户所在的 Discord 服务器 ID 列表'),
  isAdmin: z.boolean().default(false).describe('是否为管理员'),
  createdAt: z.string().describe('创建时间'),
  updatedAt: z.string().describe('更新时间'),
  globalName: z.string().optional().describe('用户昵称/全局名称'),
});

// ============ 项目相关类型 ============
export const Project = z.object({
  id: z.string().describe('项目唯一标识符'),
  rootProjectId: z.string().optional().describe('项目根标识符'),
  publishedProjectId: z.string().optional().describe('已发布项目 ID'),
  draftProjectId: z.string().optional().describe('草稿项目 ID'),
  name: z.string().describe('项目名称'),
  description: z.string().optional().describe('项目描述'),
  version: z.string().default('1.0.0').describe('工坊内部机器版本'),
  versionLabel: z.string().nullable().optional().describe('作者自定义显示版本，仅展示'),
  publishedVersion: z.string().optional().describe('关联正式内部版本号，仅用于 draft 状态'),
  authorId: z.string().describe('作者 Discord ID'),
  authorName: z.string().describe('作者用户名'),
  authorGlobalName: z.string().describe('作者优先展示名'),
  authorAvatar: z.string().describe('作者头像 ID'),
  status: ProjectStatus.default('pending'),
  downloadUrl: z.string().optional().describe('R2 中的下载链接'),
  fileSize: z.number().int().min(0).optional().describe('文件大小(字节)'),
  downloadsCount: z.number().int().min(0).default(0).describe('下载次数'),
  hasEjs: z.boolean().default(false).describe('项目内容静态检测到 EJS'),
  hasCharacterArtwork: z.boolean().default(false).describe('项目内容静态检测到完整角色立绘模板'),
  projectType: ProjectCategory.default('系统核心').describe('项目基础分类'),
  extensionType: ProjectExtensionType.nullable().optional().describe('扩展子类型，仅扩展项目使用'),
  facets: ProjectFacets.default({}).describe('角色官方属性标签'),
  customTags: z.array(z.string()).max(MAX_CUSTOM_TAGS).default([]).describe('创作者自定义标签'),
  tags: z.array(z.string()).default([]).describe('旧客户端兼容标签镜像'),
  coverImage: z.string().optional().describe('封面图片 URL'),
  worldbookEntriesPreview: z.array(WorldbookEntryPreview).default([]).describe('世界书条目预览'),
  regexEntriesPreview: z.array(RegexEntryPreview).default([]).describe('正则条目预览'),
  likesCount: z.number().int().min(0).default(0).describe('点赞数'),
  subscribesCount: z.number().int().min(0).default(0).describe('订阅数'),
  userLiked: z.boolean().default(false).describe('当前用户是否已点赞'),
  userSubscribed: z.boolean().default(false).describe('当前用户是否已订阅'),
  createdAt: z.string().describe('创建时间'),
  updatedAt: z.string().describe('更新时间'),
  reviewedAt: z.string().optional().describe('审核时间'),
  reviewerId: z.string().optional().describe('审核人 ID'),
  rejectReason: z.string().optional().describe('拒绝原因'),
  reviewTarget: ProjectReviewTarget.default('project').describe('审核目标'),
  visibility: z.boolean().default(true).describe('项目是否对其他用户可见'),
  isPublished: z.boolean().default(false).describe('是否为当前发布版本'),
  hasPendingDraft: z.boolean().default(false).describe('是否存在待审核草稿'),
  draftRevision: z.number().int().min(1).default(1).describe('草稿修订号'),

  latestApprovedAt: z.string().optional().describe('最近审核通过时间'),
});

// ============ API 请求/响应类型 ============

// 项目列表查询
export const ProjectListQuery = z.object({
  page: z.number().int().min(0).default(0).describe('页码'),
  pageSize: z.number().int().min(1).max(50).default(20).describe('每页数量'),
  status: ProjectStatus.optional().describe('审核状态筛选'),
  authorId: z.string().optional().describe('作者 ID 筛选'),
  projectType: ProjectCategory.optional().describe('项目基础分类筛选'),
  tag: z.string().optional().describe('旧标签筛选'),
  search: z.string().optional().describe('搜索关键词'),
  sort: z.enum(['published', 'updated', 'likes', 'subscribes', 'downloads']).default('published').describe('排序方式'),
});

// 项目创建请求
export const ProjectCreateRequest = z.object({
  name: z.string().describe('项目名称'),
  description: z.string().optional().describe('项目描述'),
  versionLabel: z.string().max(80).nullable().optional().describe('作者自定义显示版本'),
  projectType: ProjectCategory.optional().describe('项目基础分类；旧客户端可继续只发送 tags'),
  extensionType: ProjectExtensionType.nullable().optional().describe('扩展子类型'),
  facets: ProjectFacets.optional().describe('角色官方属性标签'),
  customTags: z.array(z.string()).max(MAX_CUSTOM_TAGS).optional().describe('创作者自定义标签'),
  tags: z.array(z.string()).default([]).describe('旧客户端兼容标签'),
  coverImage: z.string().optional().describe('封面图片 URL'),
});

// 项目更新请求
export const ProjectUpdateRequest = z.object({
  name: z.string().optional().describe('项目名称'),
  description: z.string().optional().describe('项目描述'),
  versionLabel: z.string().max(80).nullable().optional().describe('作者自定义显示版本'),
  projectType: ProjectCategory.optional().describe('项目基础分类'),
  extensionType: ProjectExtensionType.nullable().optional().describe('扩展子类型'),
  facets: ProjectFacets.optional().describe('角色官方属性标签'),
  customTags: z.array(z.string()).max(MAX_CUSTOM_TAGS).optional().describe('创作者自定义标签'),
  tags: z.array(z.string()).optional().describe('旧客户端兼容标签'),
  coverImage: z.string().optional().describe('封面图片 URL'),
});

// 审核请求
export const ReviewRequest = z.object({
  action: z.enum(['approve', 'reject']).describe('审核操作'),
  rejectReason: z.string().optional().describe('拒绝原因(仅 reject 时需要)'),
  expectedRevision: z.number().int().min(1).optional().describe('审核时看到的草稿修订号'),

});

// ============ 认证相关类型 ============

// OAuth 回调后的用户信息
export const AuthCallbackQuery = z.object({
  code: z.string().describe('Discord OAuth code'),
  state: z.string().optional().describe('防 CSRF state'),
});

// 会话信息
export const Session = z.object({
  userId: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string(),
});

// ============ 导出类型 ============
export type DiscordUserType = z.infer<typeof DiscordUser>;
export type UserType = z.infer<typeof User>;
export type ProjectType = z.infer<typeof Project>;
export type WorldbookEntryPreviewType = z.infer<typeof WorldbookEntryPreview>;
export type RegexEntryPreviewType = z.infer<typeof RegexEntryPreview>;
export type ProjectListQueryType = z.infer<typeof ProjectListQuery>;
export type ProjectCreateRequestType = z.infer<typeof ProjectCreateRequest>;
export type ProjectUpdateRequestType = z.infer<typeof ProjectUpdateRequest>;
export type ReviewRequestType = z.infer<typeof ReviewRequest>;
export type SessionType = z.infer<typeof Session>;
