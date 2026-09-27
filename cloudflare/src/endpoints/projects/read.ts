import { Bool, Num, OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import type { AppContext } from '../../types';
import { PROJECT_TYPES } from '../../config/project-taxonomy';
import { projectDb } from '../../utils/db';
import { getCurrentUserFromRequest } from '../../utils/jwt';
import { attachWorldbookEjsLengthEstimates } from '../../utils/project-entry-estimates';
import { parseRegexEntriesPreview, parseWorldbookEntriesPreview } from '../../utils/project-preview';
import { readProjectContentForEdit } from './content';

const projectListSortSchema = z.enum(['discover', 'published', 'rating', 'updated', 'likes', 'subscribes', 'downloads']);

/**
 * 获取项目列表 (公开 - 只返回已审核通过的项目)
 */
export class ProjectList extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'List Approved Projects',
    request: {
      query: z.object({
        page: Num({ description: 'Page number', default: 0 }),
        pageSize: Num({ description: 'Page size', default: 20 }),
        projectType: z.enum(PROJECT_TYPES).optional().describe('Filter by project type'),
        tag: Str({ required: false }).describe('Filter by tag'),
        tags: Str({ required: false }).describe('Filter by multiple tags (AND, comma-separated)'),
        search: Str({ required: false }).describe('Search keyword'),
        minLikes: z.coerce.number().int().min(0).max(1_000_000).optional().describe('Minimum likes'),
        minDownloads: z.coerce.number().int().min(0).max(1_000_000).optional().describe('Minimum downloads'),
        sort: projectListSortSchema.default('discover').describe('Sort mode'),
      }),
    },
    responses: {
      '200': {
        description: 'Returns project list',
        content: {
          'application/json': {
            schema: z.object({
              success: Bool(),
              hasMore: z.boolean(),
              page: z.number(),
              pageSize: z.number(),
              projects: z.array(
                z.object({
                  id: z.string(),
                  name: z.string(),
                  description: z.string().nullable(),
                  version: z.string(),
                  authorId: z.string(),
                  authorName: z.string(),
                  authorGlobalName: z.string(),
                  authorAvatar: z.string().nullable(),
                  downloadUrl: z.string().nullable(),
                  fileSize: z.number().nullable(),
                  downloadsCount: z.number(),
                  hasEjs: z.boolean(),
                  hasCharacterArtwork: z.boolean(),
                  projectType: z.enum(PROJECT_TYPES),
                  extensionType: z.enum(['规则', '内容']).nullable(),
                  facets: z.record(z.array(z.string())),
                  customTags: z.array(z.string()),
                  displayTags: z.array(z.string()),
                  tags: z.array(z.string()),
                  coverImage: z.string().nullable(),
                  likesCount: z.number(),
                  subscribesCount: z.number(),
                  userLiked: z.boolean(),
                  userSubscribed: z.boolean(),
                  createdAt: z.string(),
                  updatedAt: z.string(),
                  latestApprovedAt: z.string().nullable().optional(),
                }),
              ),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const { page, pageSize, projectType, tag, tags, search, minLikes, minDownloads, sort } = data.query;
    const payload = await getCurrentUserFromRequest(c);
    const tagFilters = String(tags || '')
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
      .slice(0, 12);

    const result = await projectDb.list(c, {
      page,
      pageSize,
      approvedOnly: true, // 只返回已审核通过的项目
      projectType,
      tag,
      tags: tagFilters,
      search,
      minLikes,
      minDownloads,
      sort,
      currentUser: payload,
    });

    // 添加作者头像 URL
    const projects = result.projects.map(p => ({
      ...p,
      authorAvatar: p.authorAvatar
        ? `https://cdn.discordapp.com/avatars/${p.authorId}/${p.authorAvatar}.webp?size=100`
        : null,
    }));

    return {
      success: true,
      ...result,
      projects,
    };
  }
}

/**
 * 批量获取指定项目摘要。主要用于本地已安装项目筛选，不读取 R2 项目内容。
 */
export class ProjectBatchFetch extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Get Project Summaries By IDs',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              projectIds: z.array(z.string().min(1)).min(1).max(50),
            }),
          },
        },
      },
    },
    responses: {
      '200': { description: 'Returns project summaries for requested IDs' },
    },
  };

  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const payload = await getCurrentUserFromRequest(c);
    const projectIds = Array.from(new Set(data.body.projectIds.map(value => value.trim()).filter(Boolean))).slice(0, 50);
    const projects = await projectDb.getMany(c, projectIds, payload);

    const visibleProjects = projects.filter(project => {
      if (project.status === 'approved') return true;
      return Boolean(payload && (project.authorId === payload.userId || payload.isAdmin));
    });

    return {
      success: true,
      projects: visibleProjects.map(project => ({
        ...project,
        authorAvatar: project.authorAvatar
          ? `https://cdn.discordapp.com/avatars/${project.authorId}/${project.authorAvatar}.webp?size=100`
          : null,
      })),
    };
  }
}


/**
 * 轻量检查本机已安装 DLC 是否有新版本。
 * 单次请求最多 500 个项目，只读取 id/name/version，不做项目 enrich。
 */
export class ProjectVersionCheck extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Check Installed Project Versions',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              projects: z.array(z.object({
                id: z.string().min(1).max(200),
                installedVersion: z.string().max(120).nullable().optional(),
              })).min(1).max(500),
            }),
          },
        },
      },
    },
    responses: {
      '200': { description: 'Returns current update availability for installed projects' },
    },
  };

  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const byId = new Map<string, string | null>();
    for (const item of data.body.projects) {
      const id = String(item.id || '').trim();
      if (!id || byId.has(id)) continue;
      const installedVersion = String(item.installedVersion || '').trim();
      byId.set(id, installedVersion || null);
    }
    const ids = Array.from(byId.keys());
    if (!ids.length) return { success: true, hasUpdate: false, updates: [] };

    const result = await c.env.DB.prepare(
      `
        SELECT p.id, p.name, p.version
        FROM json_each(?1) requested
        JOIN projects p INDEXED BY idx_projects_public_id ON p.id = requested.value
        WHERE p.status = 'approved'
          AND p.is_published = 1
          AND p.visibility = 1
      `,
    )
      .bind(JSON.stringify(ids))
      .all<{ id: string; name: string; version: string }>();

    const updates = (result.results || []).flatMap(row => {
      const installedVersion = byId.get(String(row.id)) || null;
      const latestVersion = String(row.version || '').trim();
      if (installedVersion && latestVersion && installedVersion === latestVersion) return [];
      return [{
        id: String(row.id),
        name: String(row.name || ''),
        installedVersion,
        latestVersion: latestVersion || null,
      }];
    });

    return {
      success: true,
      hasUpdate: updates.length > 0,
      updates,
    };
  }
}

/**
 * 获取当前用户的所有项目
 */
export class MyProjects extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Get My Projects',
    request: {
      headers: z.object({
        authorization: z.string().describe('Session ID'),
      }),
    },
    responses: {
      '200': {
        description: "Returns user's projects",
      },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const projects = await projectDb.getByAuthor(c, payload.userId, payload);

    return {
      success: true,
      projects: projects.map(p => ({
        ...p,
        authorAvatar: p.authorAvatar
          ? `https://cdn.discordapp.com/avatars/${p.authorId}/${p.authorAvatar}.webp?size=100`
          : null,
      })),
    };
  }
}

/**
 * 获取当前用户的项目更新订阅
 */
export class MySubscriptions extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Get My Project Update Subscriptions',
    request: {
      headers: z.object({
        authorization: z.string().describe('Session ID'),
      }),
    },
    responses: {
      '200': { description: "Returns user's subscribed project IDs" },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    return {
      success: true,
      projectIds: await projectDb.getSubscribedProjectIds(c, payload.userId),
    };
  }
}

async function readPrivateProjectRatingState(
  c: AppContext,
  project: { id: string; authorId: string; status: string; isPublished?: boolean; visibility?: boolean },
  payload: Awaited<ReturnType<typeof getCurrentUserFromRequest>>,
) {
  if (!payload) {
    return { myRating: null, myComment: '', canRate: false, reason: '登录并安装后可评分', summary: null };
  }

  if (project.authorId === payload.userId) {
    const summary = await c.env.DB.prepare(
      `SELECT COUNT(*) AS rating_count,
              AVG(rating) AS average_rating,
              SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS star_1,
              SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) AS star_2,
              SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) AS star_3,
              SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) AS star_4,
              SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) AS star_5,
              SUM(CASE WHEN comment_text IS NOT NULL AND TRIM(comment_text) <> '' THEN 1 ELSE 0 END) AS comment_count
       FROM project_ratings
       WHERE project_id = ?`,
    )
      .bind(project.id)
      .first<Record<string, number | null>>();
    const comments = await c.env.DB.prepare(
      `SELECT rating, comment_text
       FROM project_ratings
       WHERE project_id = ?
         AND comment_text IS NOT NULL
         AND TRIM(comment_text) <> ''
       ORDER BY updated_at DESC
       LIMIT 20`,
    )
      .bind(project.id)
      .all<{ rating: number; comment_text: string }>();
    const count = Number(summary?.rating_count || 0);
    return {
      myRating: null,
      myComment: '',
      canRate: false,
      reason: '作者可以查看匿名评分统计',
      summary: {
        count,
        average: count > 0 ? Math.round(Number(summary?.average_rating || 0) * 10) / 10 : null,
        commentCount: Number(summary?.comment_count || 0),
        comments: (comments.results || []).map(item => ({
          rating: Number(item.rating || 0),
          comment: String(item.comment_text || ''),
        })),
        distribution: {
          1: Number(summary?.star_1 || 0),
          2: Number(summary?.star_2 || 0),
          3: Number(summary?.star_3 || 0),
          4: Number(summary?.star_4 || 0),
          5: Number(summary?.star_5 || 0),
        },
      },
    };
  }

  const viewerState = await c.env.DB.prepare(
    `SELECT
       (SELECT rating FROM project_ratings WHERE project_id = ?1 AND user_id = ?2) AS my_rating,
       (SELECT comment_text FROM project_ratings WHERE project_id = ?1 AND user_id = ?2) AS my_comment,
       EXISTS(SELECT 1 FROM project_subscribes WHERE project_id = ?1 AND user_id = ?2) AS installed
    `,
  )
    .bind(project.id, payload.userId)
    .first<{ my_rating: number | null; my_comment: string | null; installed: number }>();
  const installed = Number(viewerState?.installed || 0) === 1;
  const projectRateable = project.status === 'approved' && project.isPublished !== false && project.visibility !== false;
  return {
    myRating: viewerState?.my_rating == null ? null : Number(viewerState.my_rating),
    myComment: String(viewerState?.my_comment || ''),
    canRate: installed && projectRateable,
    reason: installed ? (projectRateable ? '' : '这个项目当前不能评分') : '安装这个 DLC 后才能评分',
    summary: null,
  };
}

async function readProjectPreview(
  c: AppContext,
  project: {
    downloadUrl?: string | null;
    id: string;
    publishedProjectId?: string | null;
    worldbookEjsLengthEstimates?: Record<string, string>;
  },
) {
  const projectObject = await readProjectContentForEdit(c, project, 'worldbook');
  const regexObject = await readProjectContentForEdit(c, project, 'regex');
  const worldbookEntriesPreview = projectObject
    ? attachWorldbookEjsLengthEstimates(
        parseWorldbookEntriesPreview(await projectObject.text()),
        project.worldbookEjsLengthEstimates || {},
      )
    : [];
  const regexEntriesPreview = regexObject ? parseRegexEntriesPreview(await regexObject.text()) : [];
  return { worldbookEntriesPreview, regexEntriesPreview };
}

/**
 * 获取项目详情
 */
export class ProjectFetch extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Get Project Details',
    request: {
      params: z.object({
        projectId: Str({ description: 'Project ID' }),
      }),
      query: z.object({
        v: Str({ required: false }).describe('Expected project version cache key'),
      }),
    },
    responses: {
      '200': {
        description: 'Returns project details',
      },
      '404': {
        description: 'Project not found',
      },
    },
  };

  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const { projectId } = data.params;
    const payload = await getCurrentUserFromRequest(c);

    const project = await projectDb.get(c, projectId, payload);

    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    // 未审核通过的项目只能作者或管理员查看
    if (project.status !== 'approved') {
      let canView = false;

      if (payload) {
        canView = project.authorId === payload.userId || payload.isAdmin;
      }

      if (!canView) {
        return c.json({ error: 'Project not found' }, 404);
      }
    }

    const [preview, privateRating] = await Promise.all([
      readProjectPreview(c, project),
      readPrivateProjectRatingState(c, project, payload),
    ]);

    return {
      success: true,
      project: {
        ...project,
        ...preview,
        privateRating,
        authorAvatar: project.authorAvatar
          ? `https://cdn.discordapp.com/avatars/${project.authorId}/${project.authorAvatar}.webp?size=100`
          : null,
      },
      worldbookEntriesPreview: preview.worldbookEntriesPreview,
      regexEntriesPreview: preview.regexEntriesPreview,
    };
  }
}
