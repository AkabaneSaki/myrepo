import { Num, OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { validateProjectContentPolicy } from '../config/project-content-policy';
import type { AppContext } from '../types';
import { projectDb, userDb } from '../utils/db';
import { getCurrentUserFromRequest } from '../utils/jwt';
import { isEmptyProjectContentText, validateProjectContentText, type ProjectEntryKind } from '../utils/project-content';
import { parseRegexEntriesPreview, parseWorldbookEntriesPreview } from '../utils/project-preview';
import { buildProjectReviewDiff } from '../utils/project-review-diff';
import { r2Storage } from '../utils/r2';
import { bumpProjectVersionWithLegacyFallback } from '../utils/version.js';

function getReviewContentKey(projectId: string, kind: ProjectEntryKind): string {
  const fileName = kind === 'worldbook' ? `project-${projectId}.json` : `regex-${projectId}.json`;
  return `projects/${projectId}/${fileName}`;
}

async function readReviewContent(
  c: AppContext,
  projectId: string,
  publishedProjectId: string | null | undefined,
  kind: ProjectEntryKind,
) {
  const ownObject = await c.env.R2_BUCKET.get(getReviewContentKey(projectId, kind));
  if (ownObject) return ownObject;
  if (publishedProjectId) {
    return c.env.R2_BUCKET.get(getReviewContentKey(publishedProjectId, kind));
  }
  return null;
}

async function readReviewContentText(
  c: AppContext,
  projectId: string,
  publishedProjectId: string | null | undefined,
  kind: ProjectEntryKind,
): Promise<string | null> {
  const object = await readReviewContent(c, projectId, publishedProjectId, kind);
  return object ? object.text() : null;
}

async function readDirectReviewContentText(
  c: AppContext,
  projectId: string | null | undefined,
  kind: ProjectEntryKind,
): Promise<string | null> {
  if (!projectId) return null;
  const object = await c.env.R2_BUCKET.get(getReviewContentKey(projectId, kind));
  return object ? object.text() : null;
}

async function validateReviewPayloads(
  c: AppContext,
  project: { id: string; publishedProjectId?: string | null; tags?: string[] },
): Promise<{ valid: true } | { valid: false; error: string }> {
  const presence = { worldbook: false, regex: false };

  for (const kind of ['worldbook', 'regex'] as const) {
    const object = await readReviewContent(c, project.id, project.publishedProjectId, kind);
    if (!object) continue;

    const text = await object.text();
    if (isEmptyProjectContentText(text, kind)) continue;

    const validation = validateProjectContentText(text, kind);
    if (validation.valid === false) {
      return { valid: false, error: validation.error };
    }
    presence[kind] = true;
  }

  const policyValidation = validateProjectContentPolicy(project.tags, presence);
  if (policyValidation.valid === false) {
    return { valid: false, error: policyValidation.error };
  }

  return { valid: true };
}

/**
 * 获取待审核项目列表 (仅管理员)
 */
export class AdminPendingList extends OpenAPIRoute {
  schema = {
    tags: ['Admin'],
    summary: 'Get Pending Projects (Admin Only)',
    request: {
      headers: z.object({
        authorization: z.string().describe('Session ID'),
      }),
      query: z.object({
        page: Num({ description: 'Page number', default: 0 }),
        pageSize: Num({ description: 'Page size', default: 20 }),
      }),
    },
    responses: {
      '200': {
        description: 'Returns pending projects',
      },
      '403': {
        description: 'Admin only',
      },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload || !payload.isAdmin) {
      return c.json({ error: 'Admin only' }, 403);
    }

    const data = await this.getValidatedData<typeof this.schema>();
    const { page, pageSize } = data.query;

    const result = await projectDb.getPendingList(c, page, pageSize, payload);

    // 统一作者显示字段，便于前端卡片/详情直接复用
    const projects = result.projects.map(p => ({
      ...p,
      authorGlobalName: p.authorGlobalName || p.authorName,
      authorAvatar:
        p.authorAvatar &&
        !String(p.authorAvatar).startsWith('http://') &&
        !String(p.authorAvatar).startsWith('https://')
          ? `https://cdn.discordapp.com/avatars/${p.authorId}/${p.authorAvatar}.webp?size=100`
          : p.authorAvatar,
    }));

    return {
      success: true,
      ...result,
      projects,
    };
  }
}

/**
 * 审核项目 (仅管理员)
 */
export class AdminReviewDetail extends OpenAPIRoute {
  schema = {
    tags: ['Admin'],
    summary: 'Get Review Detail and Entry Diff (Admin Only)',
    request: {
      params: z.object({
        projectId: Str({ description: 'Project ID' }),
      }),
      headers: z.object({
        authorization: z.string().describe('Session ID'),
      }),
    },
    responses: {
      '200': { description: 'Returns review detail and diff' },
      '403': { description: 'Admin only' },
      '404': { description: 'Project not found' },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload || !payload.isAdmin) {
      return c.json({ error: 'Admin only' }, 403);
    }

    const data = await this.getValidatedData<typeof this.schema>();
    const { projectId } = data.params;
    const project = await projectDb.get(c, projectId, payload);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    const isUpdate = project.reviewTarget === 'draft' && Boolean(project.publishedProjectId);
    const [
      currentWorldbookText,
      currentRegexText,
      previousWorldbookText,
      previousRegexText,
    ] = await Promise.all([
      readReviewContentText(c, project.id, project.publishedProjectId, 'worldbook'),
      readReviewContentText(c, project.id, project.publishedProjectId, 'regex'),
      isUpdate ? readDirectReviewContentText(c, project.publishedProjectId, 'worldbook') : Promise.resolve(null),
      isUpdate ? readDirectReviewContentText(c, project.publishedProjectId, 'regex') : Promise.resolve(null),
    ]);

    const worldbookEntriesPreview = currentWorldbookText ? parseWorldbookEntriesPreview(currentWorldbookText) : [];
    const regexEntriesPreview = currentRegexText ? parseRegexEntriesPreview(currentRegexText) : [];
    const reviewDiff = buildProjectReviewDiff({
      previousWorldbookText,
      currentWorldbookText,
      previousRegexText,
      currentRegexText,
      isUpdate,
    });

    return {
      success: true,
      project: {
        ...project,
        worldbookEntriesPreview,
        regexEntriesPreview,
        authorGlobalName: project.authorGlobalName || project.authorName,
        authorAvatar:
          project.authorAvatar &&
          !String(project.authorAvatar).startsWith('http://') &&
          !String(project.authorAvatar).startsWith('https://')
            ? `https://cdn.discordapp.com/avatars/${project.authorId}/${project.authorAvatar}.webp?size=100`
            : project.authorAvatar,
      },
      worldbookEntriesPreview,
      regexEntriesPreview,
      reviewDiff,
    };
  }
}

export class AdminReview extends OpenAPIRoute {
  schema = {
    tags: ['Admin'],
    summary: 'Review Project (Admin Only)',
    request: {
      params: z.object({
        projectId: Str({ description: 'Project ID' }),
      }),
      headers: z.object({
        authorization: z.string().describe('Session ID'),
      }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              action: z.enum(['approve', 'reject']),
              rejectReason: Str({ required: false }),
              expectedRevision: z.number().int().min(1).optional(),
            }),
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Review successful',
      },
      '403': {
        description: 'Admin only',
      },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload || !payload.isAdmin) {
      return c.json({ error: 'Admin only' }, 403);
    }

    const data = await this.getValidatedData<typeof this.schema>();
    const { projectId } = data.params;
    const { action, rejectReason, expectedRevision } = data.body;

    // 检查项目是否存在
    const project = await projectDb.get(c, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    if (!expectedRevision || expectedRevision !== project.draftRevision) {
        return c.json(
          { error: 'Draft changed while under review. Refresh and review the latest revision.' },
          409,
        );
    }

    // 如果是拒绝操作，必须提供拒绝原因
    if (action === 'reject' && !rejectReason) {
      return c.json({ error: 'Reject reason required' }, 400);
    }

    if (action === 'approve') {
      const contentValidation = await validateReviewPayloads(c, project);
      if (contentValidation.valid === false) {
        return c.json({ error: contentValidation.error }, 409);
      }
    }

    let approvedVersion: string | null = null;
    let publishedVersionBeforeApproval: string | null = null;
    if (action === 'approve' && project.reviewTarget === 'draft' && project.publishedProjectId) {
      const published = await projectDb.get(c, project.publishedProjectId);
      if (!published) {
        return c.json({ error: 'Published project not found for draft' }, 409);
      }
      publishedVersionBeforeApproval = published.version;
      approvedVersion = bumpProjectVersionWithLegacyFallback(published.version, 'patch');
    }

    // 执行审核
    const reviewedAt = await projectDb.review(c, projectId, payload.userId, action, rejectReason);

    if (action === 'approve' && project.reviewTarget === 'draft' && project.publishedProjectId) {
      const publishedAssets = await r2Storage.copyProjectFilesToPublished(
        c,
        projectId,
        project.publishedProjectId,
        project.coverImage || undefined,
      );

      await projectDb.update(c, project.publishedProjectId, {
        name: project.name,
        description: project.description || '',
        version: approvedVersion || project.version,
        versionLabel: project.versionLabel ?? null,
        tags: project.tags,
        coverImage: publishedAssets.coverImage || project.coverImage || undefined,
        downloadUrl: publishedAssets.downloadUrl || project.downloadUrl || undefined,
        fileSize: publishedAssets.fileSize || project.fileSize || undefined,
        hasEjs: project.hasEjs,
        hasCharacterArtwork: project.hasCharacterArtwork,
        status: 'approved',
        draftProjectId: null,
        visibility: project.visibility,
        isPublished: true,
        latestApprovedAt: reviewedAt,
      });

      await projectDb.delete(c, projectId);
    } else if (action === 'reject' && project.reviewTarget === 'draft' && project.publishedProjectId) {
      await projectDb.update(c, project.publishedProjectId, {
        draftProjectId: projectId,
      });
    } else if (action === 'approve') {
      await projectDb.update(c, projectId, {
        version: project.version,
        versionLabel: project.versionLabel ?? null,
        isPublished: true,
        visibility: project.visibility,
        latestApprovedAt: reviewedAt,
      });
    }

    await projectDb.logAdminAction(c, {
      action: action === 'approve' ? 'project_approved' : 'project_rejected',
      targetType: project.reviewTarget === 'draft' ? 'project_draft' : 'project',
      targetId: projectId,
      actorId: payload.userId,
      actorName: payload.globalName || payload.username,
      detail: {
        rejectReason: rejectReason || null,
        projectName: project.name,
        version: approvedVersion || project.version,
        previousVersion: publishedVersionBeforeApproval,
        versionLabel: project.versionLabel ?? null,
      },
    });

    return {
      success: true,
      message: action === 'approve' ? 'Project approved successfully' : 'Project rejected',
    };
  }
}

/**
 * 获取所有项目 (管理员可查看所有状态)
 */
export class AdminProjectList extends OpenAPIRoute {
  schema = {
    tags: ['Admin'],
    summary: 'Get All Projects (Admin Only)',
    request: {
      headers: z.object({
        authorization: z.string().describe('Session ID'),
      }),
      query: z.object({
        page: Num({ description: 'Page number', default: 0 }),
        pageSize: Num({ description: 'Page size', default: 20 }),
        status: Str({ required: false }).describe('Filter by status: pending/approved/rejected'),
        authorId: Str({ required: false }).describe('Filter by author'),
      }),
    },
    responses: {
      '200': {
        description: 'Returns all projects',
      },
      '403': {
        description: 'Admin only',
      },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload || !payload.isAdmin) {
      return c.json({ error: 'Admin only' }, 403);
    }

    const data = await this.getValidatedData<typeof this.schema>();
    const { page, pageSize, status, authorId } = data.query;

    const result = await projectDb.list(c, {
      page,
      pageSize,
      approvedOnly: false, // 管理员可以看到所有状态的项目
      status,
      authorId,
      currentUser: payload,
    });

    // 统一作者显示字段，便于前端卡片/详情直接复用
    const projects = result.projects.map(p => ({
      ...p,
      authorGlobalName: p.authorGlobalName || p.authorName,
      authorAvatar:
        p.authorAvatar &&
        !String(p.authorAvatar).startsWith('http://') &&
        !String(p.authorAvatar).startsWith('https://')
          ? `https://cdn.discordapp.com/avatars/${p.authorId}/${p.authorAvatar}.webp?size=100`
          : p.authorAvatar,
    }));

    return {
      success: true,
      ...result,
      projects,
    };
  }
}

/**
 * 设置管理员 (仅管理员)
 */
export class AdminSetAdmin extends OpenAPIRoute {
  schema = {
    tags: ['Admin'],
    summary: 'Set User as Admin (Admin Only)',
    request: {
      headers: z.object({
        authorization: z.string().describe('Session ID'),
      }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              userId: z.string().describe('User ID to set as admin'),
              isAdmin: z.boolean().describe('True to set as admin, false to remove'),
            }),
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Success',
      },
      '403': {
        description: 'Admin only',
      },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload || !payload.isAdmin) {
      return c.json({ error: 'Admin only' }, 403);
    }

    const canManageAdmins = await userDb.isSuperAdmin(c, payload.userId);
    if (!canManageAdmins) {
      return c.json({ error: 'Super admin only' }, 403);
    }

    const data = await this.getValidatedData<typeof this.schema>();
    const { userId, isAdmin: shouldBeAdmin } = data.body;

    if (userId === c.env.SUPER_ADMIN_USER_ID && !shouldBeAdmin) {
      return c.json({ error: 'Cannot remove super admin privileges' }, 400);
    }

    // 更新用户权限
    await c.env.DB.prepare("UPDATE users SET is_admin = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(shouldBeAdmin ? 1 : 0, userId)
      .run();

    await projectDb.logAdminAction(c, {
      action: shouldBeAdmin ? 'admin_added' : 'admin_removed',
      targetType: 'user',
      targetId: userId,
      actorId: payload.userId,
      actorName: payload.globalName || payload.username,
      detail: { isAdmin: shouldBeAdmin },
    });

    return {
      success: true,
      message: shouldBeAdmin ? 'User is now an admin' : 'Admin role removed',
    };
  }
}

/**
 * 获取管理员列表 (仅管理员)
 */
export class AdminList extends OpenAPIRoute {
  schema = {
    tags: ['Admin'],
    summary: 'Get Admin List (Admin Only)',
    request: {
      headers: z.object({
        authorization: z.string().describe('Session ID'),
      }),
    },
    responses: {
      '200': {
        description: 'Returns admin list',
      },
      '403': {
        description: 'Admin only',
      },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload || !payload.isAdmin) {
      return c.json({ error: 'Admin only' }, 403);
    }

    const canManageAdmins = await userDb.isSuperAdmin(c, payload.userId);
    if (!canManageAdmins) {
      return c.json({ error: 'Super admin only' }, 403);
    }

    const admins = await userDb.getAdmins(c);

    return {
      success: true,
      admins,
    };
  }
}

export class AdminActionLogList extends OpenAPIRoute {
  schema = {
    tags: ['Admin'],
    summary: 'Get Admin Logs (Super Admin Only)',
    request: {
      headers: z.object({
        authorization: z.string().describe('Session ID'),
      }),
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload || !payload.isAdmin) {
      return c.json({ error: 'Admin only' }, 403);
    }

    const canManageAdmins = await userDb.isSuperAdmin(c, payload.userId);
    if (!canManageAdmins) {
      return c.json({ error: 'Super admin only' }, 403);
    }

    const logs = await projectDb.getAdminLogs(c, 200);

    return {
      success: true,
      logs,
    };
  }
}
