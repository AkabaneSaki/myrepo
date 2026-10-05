import { Num, OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import { validateProjectContentPolicy } from '../config/project-content-policy';
import type { AppContext } from '../types';
import { projectDb, userDb, acceptedCodeCheckKey } from '../utils/db';
import { getCurrentUserFromRequest } from '../utils/jwt';
import { isEmptyProjectContentText, validateProjectContentText, type ProjectEntryKind } from '../utils/project-content';
import { attachWorldbookEjsLengthEstimates } from '../utils/project-entry-estimates';
import { parseRegexEntriesPreview, parseWorldbookEntriesPreview } from '../utils/project-preview';
import { analyzeProjectCodeCached } from '../utils/ejs-checker/cache.mjs';
import { buildAuditSnapshot, applyAuditBaseline, buildReviewToken } from '../utils/ejs-checker/audit.mjs';
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
  project: {
    id: string;
    publishedProjectId?: string | null;
    projectType?: unknown;
    project_type?: unknown;
    tags?: string[];
    draftRevision: number;
  },
): Promise<{ valid: true; snapshot: Record<string, unknown>; reviewToken: string; codeFiles: Array<{ type: ProjectEntryKind; text: string }> } | { valid: false; error: string }> {
  const presence = { worldbook: false, regex: false };
  const codeCheckInputs: Array<{ fileName: string; type: ProjectEntryKind; text: string }> = [];

  for (const kind of ['worldbook', 'regex'] as const) {
    const object = await readReviewContent(c, project.id, project.publishedProjectId, kind);
    if (!object) continue;

    const text = await object.text();
    const empty = isEmptyProjectContentText(text, kind);
    if (!empty) {
      const validation = validateProjectContentText(text, kind);
      if (validation.valid === false) {
        return { valid: false, error: validation.error };
      }
    }
    presence[kind] = !empty;
    codeCheckInputs.push({
      fileName: kind === 'worldbook' ? `project-${project.id}.json` : `regex-${project.id}.json`,
      type: kind,
      text,
    });
  }

  const policyValidation = validateProjectContentPolicy(project, presence);
  if (policyValidation.valid === false) {
    return { valid: false, error: policyValidation.error };
  }

  const codeCheck = await analyzeProjectCodeCached(codeCheckInputs);
  if (codeCheck.gate === 'reject') {
    const firstBlocker = codeCheck.findings.find(finding => finding.severity === 'high');
    const label = firstBlocker ? `[${firstBlocker.ruleId}] ${firstBlocker.title}` : '脚本未通过自动检查';
    return { valid: false, error: `项目仍有自动检查阻断项：${label}。请在审核详情查看后要求 Creator 修改。` };
  }

  const snapshot = await buildAuditSnapshot(codeCheckInputs, codeCheck);
  return { valid: true, snapshot, reviewToken: await buildReviewToken(snapshot, project.draftRevision), codeFiles: codeCheckInputs };
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
        sort: z.enum(['oldest', 'latest']).default('oldest'),
        projectType: z.enum(['事件', '系统核心', '角色', '扩展']).optional(),
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
    const { page, pageSize, sort, projectType } = data.query;

    const result = await projectDb.getPendingList(c, page, pageSize, payload, { sort, projectType });

    // 审核队列必须保持轻量：这里只返回数据库 metadata。
    // 完整 R2 读取、内容解析、diff、外链/EJS 检查仅在进入单条审核详情时执行。
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
 * 清理已经被新通过版本取代的旧审核请求 (仅管理员)
 */
export class AdminPendingCleanup extends OpenAPIRoute {
  schema = {
    tags: ['Admin'],
    summary: 'Cleanup Outdated Pending Drafts (Admin Only)',
    request: {
      headers: z.object({
        authorization: z.string().describe('Session ID'),
      }),
    },
    responses: {
      '200': {
        description: 'Returns the number of outdated drafts retired',
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

    const cleanedCount = await projectDb.rejectOutdatedDrafts(c);
    if (cleanedCount > 0) {
      await projectDb.logAdminAction(c, {
        action: 'outdated_review_drafts_cleaned',
        targetType: 'project_draft',
        actorId: payload.userId,
        actorName: payload.globalName || payload.username,
        detail: { cleanedCount },
      });
    }

    return {
      success: true,
      cleanedCount,
    };
  }
}

export class AdminPublicCountsRecount extends OpenAPIRoute {
  schema = {
    tags: ['Admin'],
    summary: 'Recount public projects (Admin Only)',
    request: { headers: z.object({ authorization: z.string() }) },
    responses: { '200': { description: 'Updated public project counts' }, '403': { description: 'Admin only' } },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload?.isAdmin) return c.json({ error: '只有管理员可以重新统计项目数量' }, 403);
    const counts = await projectDb.recountPublicCounts(c);
    await projectDb.logAdminAction(c, {
      action: 'public_project_counts_recounted',
      targetType: 'project',
      actorId: payload.userId,
      actorName: payload.globalName || payload.username,
      detail: { total: counts.total },
    });
    return { success: true, publicCounts: { total: counts.total, byType: counts.byType } };
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

    const worldbookEntriesPreview = currentWorldbookText
      ? attachWorldbookEjsLengthEstimates(
          parseWorldbookEntriesPreview(currentWorldbookText),
          project.worldbookEjsLengthEstimates || {},
        )
      : [];
    const regexEntriesPreview = currentRegexText ? parseRegexEntriesPreview(currentRegexText) : [];
    const codeCheckInputs = [
      ...(currentWorldbookText
        ? [{ fileName: `project-${project.id}.json`, type: 'worldbook', text: currentWorldbookText }]
        : []),
      ...(currentRegexText ? [{ fileName: `regex-${project.id}.json`, type: 'regex', text: currentRegexText }] : []),
    ];
    const rawCodeCheck = await analyzeProjectCodeCached(codeCheckInputs);
    const snapshot = rawCodeCheck.gate === 'reject' ? null : await buildAuditSnapshot(codeCheckInputs, rawCodeCheck);
    const baseline = project[acceptedCodeCheckKey] ? JSON.parse(project[acceptedCodeCheckKey]) : null;
    const codeCheck = snapshot ? applyAuditBaseline(rawCodeCheck, snapshot, baseline) : rawCodeCheck;
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
      codeCheck,
      reviewToken: snapshot ? await buildReviewToken(snapshot, project.draftRevision) : null,
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
              reviewToken: z.string().regex(/^[a-f0-9]{64}$/).optional(),
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
    const { action, rejectReason, expectedRevision, reviewToken } = data.body;

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

    let acceptedSnapshot: Record<string, unknown> | undefined;
    let reviewedCodeFiles: Array<{ type: ProjectEntryKind; text: string }> | undefined;
    if (action === 'approve') {
      const contentValidation = await validateReviewPayloads(c, project);
      if (contentValidation.valid === false) {
        return c.json({ error: contentValidation.error }, 409);
      }
      if (!reviewToken || reviewToken !== contentValidation.reviewToken) {
        return c.json({ error: '文件内容或检查依据已变化，请重新打开审核详情，确认后再通过。' }, 409);
      }
      acceptedSnapshot = contentValidation.snapshot;
      reviewedCodeFiles = contentValidation.codeFiles;
    }

    let approvedVersion: string | null = null;
    let publishedVersionBeforeApproval: string | null = null;
    let supersededDraftCount = 0;
    if (action === 'approve' && project.reviewTarget === 'draft' && project.publishedProjectId) {
      const published = await projectDb.get(c, project.publishedProjectId);
      if (!published) {
        return c.json({ error: 'Published project not found for draft' }, 409);
      }
      publishedVersionBeforeApproval = published.version;
      const expectedTargetVersion = bumpProjectVersionWithLegacyFallback(published.version, 'patch');
      if (project.version !== expectedTargetVersion) {
        return c.json(
          {
            error: `This review request is outdated. Current project is v${published.version}; this request targets v${project.version}.`,
          },
          409,
        );
      }
      approvedVersion = project.version;
    }

    // 执行审核。status + draft_revision 必须在同一条 D1 UPDATE 里原子校验，
    // 否则两个管理员的旧页面可以先后覆盖审核结果。
    const reviewedAt = await projectDb.review(
      c,
      projectId,
      payload.userId,
      action,
      rejectReason,
      expectedRevision,
      acceptedSnapshot,
    );
    if (!reviewedAt) {
      return c.json({ error: 'Review conflict: project was changed or already reviewed. Refresh and retry.' }, 409);
    }

    if (action === 'approve' && project.reviewTarget === 'draft' && project.publishedProjectId) {
      let publishedAssets: Awaited<ReturnType<typeof r2Storage.copyProjectFilesToPublished>> | null = null;
      try {
        publishedAssets = await r2Storage.copyProjectFilesToPublished(
          c,
          projectId,
          project.publishedProjectId,
          project.coverImage || undefined,
          reviewedCodeFiles,
        );

        try {
          await projectDb.update(c, project.publishedProjectId, {
            name: project.name,
            description: project.description || '',
            precautions: project.precautions ?? null,
            discordThreadUrl: project.discordThreadUrl ?? null,
            version: approvedVersion || project.version,
            versionLabel: project.versionLabel ?? null,
            characterReferenceId: project.characterReferenceId ?? null,
            builtForReferenceVersionId: project.builtForReferenceVersionId ?? null,
            testedThroughReferenceVersionId: project.testedThroughReferenceVersionId ?? null,
            compatibilityStatus: project.compatibilityStatus ?? null,
            compatibilityKnownIncompatible: project.compatibilityKnownIncompatible,
            compatibilityNote: project.compatibilityNote ?? null,
            compatibilityGraceUntil: project.compatibilityGraceUntil ?? null,
            compatibilityUpdatedAt: project.compatibilityUpdatedAt ?? null,
            conflictsWithOriginal: project.conflictsWithOriginal,
            originalConflictReferenceItemIds: project.originalConflictReferenceItemIds,
            originalConflictEntryNames: project.originalConflictEntryNames,
            worldbookEjsLengthEstimates: project.worldbookEjsLengthEstimates,
            projectType: project.projectType,
            extensionType: project.extensionType,
            facets: project.facets,
            customTags: project.customTags,
            displayTags: project.displayTags,
            tags: project.tags,
            coverImage: publishedAssets.coverImage || project.coverImage || undefined,
            coverPositionX: project.coverPositionX,
            coverPositionY: project.coverPositionY,
            coverZoom: project.coverZoom,
            downloadUrl: publishedAssets.downloadUrl || project.downloadUrl || undefined,
            fileSize: publishedAssets.fileSize || project.fileSize || undefined,
            hasEjs: project.hasEjs,
            hasCharacterArtwork: project.hasCharacterArtwork,
            status: 'approved',
            draftProjectId: null,
            visibility: project.visibility,
            isPublished: true,
            latestApprovedAt: reviewedAt,
            acceptedCodeCheck: JSON.stringify({ ...acceptedSnapshot, reviewerId: payload.userId, reviewedAt, revision: expectedRevision }),
          });
        } catch (error) {
          try {
            await publishedAssets.rollback();
          } catch (rollbackError) {
            console.error('Failed to rollback published R2 assets after D1 publish failure', {
              projectId,
              publishedProjectId: project.publishedProjectId,
              rollbackError,
            });
          }
          throw error;
        }
      } catch (error) {
        const restored = await projectDb.restoreApprovedReviewToPending(
          c,
          projectId,
          payload.userId,
          expectedRevision,
          reviewedAt,
          project.latestApprovedAt ?? null,
          project[acceptedCodeCheckKey],
        );
        if (!restored) {
          console.error('Failed to restore draft review state after publication failure', {
            projectId,
            expectedRevision,
            reviewedAt,
          });
        }
        throw error;
      }

      try {
        supersededDraftCount = await projectDb.rejectSupersededSiblingDrafts(
          c,
          project.publishedProjectId,
          projectId,
          project.latestApprovedAt ?? null,
          payload.userId,
          reviewedAt,
        );
      } catch (error) {
        console.error('Failed to auto-reject superseded sibling drafts after approval', {
          projectId,
          publishedProjectId: project.publishedProjectId,
          error,
        });
      }

      await projectDb.delete(c, projectId);
    } else if (action === 'approve') {
      try {
        await projectDb.update(c, projectId, {
          version: project.version,
          versionLabel: project.versionLabel ?? null,
          isPublished: true,
          visibility: project.visibility,
          latestApprovedAt: reviewedAt,
        });
      } catch (error) {
        await projectDb.restoreApprovedReviewToPending(
          c,
          projectId,
          payload.userId,
          expectedRevision,
          reviewedAt,
          project.latestApprovedAt ?? null,
          project[acceptedCodeCheckKey],
        );
        throw error;
      }
    }

    // Discovery/rating boards are immutable during the UTC day; newly approved projects
    // appear in 最新 immediately and enter public rankings on the next scheduled build.

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
        draftRevision: project.draftRevision,
        reviewTarget: project.reviewTarget,
        publishedProjectId: project.publishedProjectId || null,
        projectCreatedAt: project.createdAt,
        projectUpdatedAt: project.updatedAt,
        supersededDraftCount,
      },
    });

    return {
      success: true,
      message: action === 'approve' ? 'Project approved successfully' : 'Project rejected',
      supersededDraftCount,
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
