import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import type { AppContext } from '../../types';
import { normalizeProjectTaxonomyInput, PROJECT_TYPES } from '../../config/project-taxonomy';
import { generateId, projectDb, userDb } from '../../utils/db';
import { validateWorldbookEjsLengthEstimatesInput } from '../../utils/project-entry-estimates';
import { resolveProjectCompatibilitySelection, validateOriginalConflictReferenceItems } from '../../utils/character-reference.ts';
import { getCurrentUserFromRequest } from '../../utils/jwt';
import { r2Storage } from '../../utils/r2';
import { bumpProjectVersionWithLegacyFallback, LEGACY_PROJECT_VERSION_BASE } from '../../utils/version.js';

/**
 * 创建项目 (需要上传文件)
 */
export class ProjectCreate extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Create New Project',
    request: {
      headers: z.object({
        authorization: z.string().describe('Session ID'),
      }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              name: Str({ description: 'Project name' }),
              description: Str({ required: false }).describe('Project description'),
              versionLabel: z.string().max(80).nullable().optional(),
              builtForReferenceVersionId: z.string().max(120).nullable().optional(),
              compatibilityConfirmed: z.boolean().optional(),
              conflictsWithOriginal: z.boolean().optional(),
              originalConflictReferenceItemIds: z.array(z.string()).max(500).optional(),
              projectType: z.enum(PROJECT_TYPES).optional(),
              extensionType: z.enum(['规则', '内容']).nullable().optional(),
              facets: z.record(z.array(z.string())).optional(),
              customTags: z.array(z.string()).optional(),
              displayTags: z.array(z.string()).optional(),
              tags: z.array(z.string()).default([]),
              coverImage: Str({ required: false }),
              worldbookEjsLengthEstimates: z.record(z.string().max(160)).optional(),
            }),
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Returns upload URL',
      },
    },
  };

  async handle(c: AppContext) {
    try {
      const authHeader = c.req.header('authorization');
      if (!authHeader) {
        return c.json({ error: 'Unauthorized' }, 401);
      }

      const payload = await getCurrentUserFromRequest(c);
      if (!payload) {
        return c.json({ error: 'Unauthorized' }, 401);
      }

      const rawBody = await c.req.json().catch(() => null);
      if (!rawBody || typeof rawBody !== 'object') {
        return c.json({ error: 'Invalid JSON body' }, 400);
      }

      const name = typeof rawBody.name === 'string' ? rawBody.name.trim() : '';
      const description = typeof rawBody.description === 'string' ? rawBody.description : undefined;
      const rawPrecautions = rawBody.precautions;
      if (rawPrecautions !== undefined && rawPrecautions !== null && typeof rawPrecautions !== 'string') {
        return c.json({ error: '安装注意事项必须是文字' }, 400);
      }
      const precautions = typeof rawPrecautions === 'string' ? rawPrecautions.trim() || null : rawPrecautions;
      if (typeof precautions === 'string' && precautions.length > 2000) {
        return c.json({ error: '安装注意事项最多 2000 字符' }, 400);
      }
      const rawVersionLabel = rawBody.versionLabel;
      if (rawVersionLabel !== undefined && rawVersionLabel !== null && typeof rawVersionLabel !== 'string') {
        return c.json({ error: 'Version label must be text' }, 400);
      }
      const versionLabel = typeof rawVersionLabel === 'string' ? rawVersionLabel.trim() || null : rawVersionLabel;
      const rawBuiltForReferenceVersionId = rawBody.builtForReferenceVersionId;
      if (
        rawBuiltForReferenceVersionId !== undefined
        && rawBuiltForReferenceVersionId !== null
        && typeof rawBuiltForReferenceVersionId !== 'string'
      ) {
        return c.json({ error: '角色卡版本格式不正确，请重新选择' }, 400);
      }
      const builtForReferenceVersionId = typeof rawBuiltForReferenceVersionId === 'string'
        ? rawBuiltForReferenceVersionId.trim() || null
        : rawBuiltForReferenceVersionId;
      const coverImage = typeof rawBody.coverImage === 'string' ? rawBody.coverImage : undefined;
      const estimateResult = validateWorldbookEjsLengthEstimatesInput(rawBody.worldbookEjsLengthEstimates);
      if (estimateResult.error) return c.json({ error: estimateResult.error }, 400);

      const taxonomyResult = normalizeProjectTaxonomyInput(rawBody as Record<string, unknown>, {
        requireExtensionSubtypeForExplicitType: false,
      });
      if (!taxonomyResult.value) {
        return c.json({ error: taxonomyResult.error || 'Invalid project taxonomy' }, 400);
      }
      const taxonomy = taxonomyResult.value;

      if (!name) {
        return c.json({ error: 'Project name is required' }, 400);
      }

      if (name.length > 100) {
        return c.json({ error: 'Project name must be 100 characters or fewer' }, 400);
      }
      if (typeof versionLabel === 'string' && versionLabel.length > 80) {
        return c.json({ error: 'Version label must be 80 characters or fewer' }, 400);
      }

      const compatibilityConfirmed = rawBody.compatibilityConfirmed === true;
      const conflictsWithOriginal = rawBody.conflictsWithOriginal === true;
      const requestedConflictItemIds = Array.isArray(rawBody.originalConflictReferenceItemIds)
        ? rawBody.originalConflictReferenceItemIds.map(String)
        : [];

      let compatibilitySelection;
      let originalConflictReferenceItemIds: string[] = [];
      try {
        compatibilitySelection = await resolveProjectCompatibilitySelection(c, {
          builtForReferenceVersionId,
          testedThroughReferenceVersionId: compatibilityConfirmed ? builtForReferenceVersionId : null,
        });
        originalConflictReferenceItemIds = conflictsWithOriginal
          ? await validateOriginalConflictReferenceItems(c, compatibilitySelection.builtForReferenceVersionId, requestedConflictItemIds)
          : [];
        if (conflictsWithOriginal && originalConflictReferenceItemIds.length === 0) {
          return c.json({ error: '请选择需要暂时关闭的原版内容' }, 400);
        }
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : '角色卡版本无效，请重新选择' }, 400);
      }

      const projectId = generateId();
      const existingUser = await userDb.get(c, payload.userId);

      await userDb.upsert(c, {
        id: payload.userId,
        username: payload.username,
        global_name: payload.globalName,
        avatar: payload.avatar || '',
        discriminator: '0000',
        guilds: existingUser?.guilds || [],
        isAdmin: payload.isAdmin,
      });

      await projectDb.create(c, {
        id: projectId,
        name,
        description,
        precautions,
        version: LEGACY_PROJECT_VERSION_BASE,
        versionLabel,
        characterReferenceId: compatibilitySelection.characterReferenceId,
        builtForReferenceVersionId: compatibilitySelection.builtForReferenceVersionId,
        testedThroughReferenceVersionId: compatibilitySelection.testedThroughReferenceVersionId,
        compatibilityStatus: compatibilitySelection.compatibilityStatus,
        compatibilityKnownIncompatible: false,
        compatibilityGraceUntil: compatibilitySelection.compatibilityGraceUntil,
        compatibilityUpdatedAt: compatibilitySelection.builtForReferenceVersionId ? new Date().toISOString() : null,
        conflictsWithOriginal,
        originalConflictReferenceItemIds,
        worldbookEjsLengthEstimates: estimateResult.value,
        authorId: payload.userId,
        authorName: payload.username,
        authorAvatar: payload.avatar || '',
        projectType: taxonomy.projectType,
        extensionType: taxonomy.extensionType,
        facets: taxonomy.facets,
        customTags: taxonomy.customTags,
        displayTags: taxonomy.displayTags,
        tags: taxonomy.legacyTags,
        coverImage,
      });

      return {
        success: true,
        projectId,
        message: 'Project created. Please upload the project file using the upload endpoint.',
      };
    } catch (error) {
      console.error('ProjectCreate failed:', error);
      return c.json(
        {
          error: error instanceof Error ? `ProjectCreate failed: ${error.message}` : 'ProjectCreate failed',
        },
        500,
      );
    }
  }
}

export class ProjectVisibilityUpdate extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Update Project Visibility',
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
              visibility: z.boolean(),
            }),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const data = await this.getValidatedData<typeof this.schema>();
    const project = await projectDb.get(c, data.params.projectId, payload);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    if (project.authorId !== payload.userId && !payload.isAdmin) {
      return c.json({ error: 'Permission denied' }, 403);
    }

    await projectDb.setVisibility(c, project.id, data.body.visibility);

    return {
      success: true,
      visibility: data.body.visibility,
    };
  }
}

/**
 * 更新项目信息
 */
export class ProjectUpdate extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Update Project',
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
              name: Str({ required: false }),
              description: Str({ required: false }),
              versionLabel: z.string().max(80).nullable().optional(),
              builtForReferenceVersionId: z.string().max(120).nullable().optional(),
              compatibilityConfirmed: z.boolean().optional(),
              conflictsWithOriginal: z.boolean().optional(),
              originalConflictReferenceItemIds: z.array(z.string()).max(500).optional(),
              projectType: z.enum(PROJECT_TYPES).optional(),
              extensionType: z.enum(['规则', '内容']).nullable().optional(),
              facets: z.record(z.array(z.string())).optional(),
              customTags: z.array(z.string()).optional(),
              displayTags: z.array(z.string()).optional(),
              tags: z.array(z.string()).optional(),
              coverImage: Str({ required: false }),
              worldbookEjsLengthEstimates: z.record(z.string().max(160)).optional(),
            }),
          },
        },
      },
    },
    responses: {
      '200': {
        description: 'Update successful',
      },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const data = await this.getValidatedData<typeof this.schema>();
    const { projectId } = data.params;
    const estimateResult = validateWorldbookEjsLengthEstimatesInput(data.body.worldbookEjsLengthEstimates);
    if (estimateResult.error) return c.json({ error: estimateResult.error }, 400);

    // 检查项目是否存在且属于当前用户
    const project = await projectDb.get(c, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    if (project.authorId !== payload.userId && !payload.isAdmin) {
      return c.json({ error: 'Permission denied' }, 403);
    }

    const taxonomyInput: Record<string, unknown> = {
      tags: data.body.tags ?? project.tags,
    };
    if (data.body.projectType !== undefined) {
      taxonomyInput.projectType = data.body.projectType;
    } else if (data.body.tags === undefined) {
      taxonomyInput.projectType = project.projectType;
    }

    const targetProjectType = data.body.projectType
      ?? (data.body.tags !== undefined ? undefined : project.projectType);
    if (data.body.extensionType !== undefined) {
      taxonomyInput.extensionType = data.body.extensionType;
    } else if (targetProjectType === '扩展' || (targetProjectType === undefined && project.projectType === '扩展')) {
      taxonomyInput.extensionType = project.extensionType;
    }

    if (data.body.facets !== undefined) {
      taxonomyInput.facets = data.body.facets;
    } else if (targetProjectType === '角色' || (targetProjectType === undefined && project.projectType === '角色')) {
      taxonomyInput.facets = project.facets;
    }

    if (data.body.customTags !== undefined) {
      taxonomyInput.customTags = data.body.customTags;
    } else if (data.body.tags === undefined) {
      taxonomyInput.customTags = project.customTags;
    }

    const tagPoolChanged = data.body.projectType !== undefined
      || data.body.facets !== undefined
      || data.body.customTags !== undefined
      || data.body.tags !== undefined;
    if (data.body.displayTags !== undefined) {
      taxonomyInput.displayTags = data.body.displayTags;
    } else if (!tagPoolChanged) {
      taxonomyInput.displayTags = project.displayTags;
    }

    const taxonomyResult = normalizeProjectTaxonomyInput(taxonomyInput, {
      requireExtensionSubtypeForExplicitType: false,
    });
    if (!taxonomyResult.value) {
      return c.json({ error: taxonomyResult.error || 'Invalid project taxonomy' }, 400);
    }
    const taxonomy = taxonomyResult.value;
    const targetBuiltForReferenceVersionId = data.body.builtForReferenceVersionId !== undefined
      ? data.body.builtForReferenceVersionId
      : project.builtForReferenceVersionId;
    const shouldRefreshCompatibility = data.body.builtForReferenceVersionId !== undefined
      || data.body.compatibilityConfirmed !== undefined;
    let compatibilityUpdates: Record<string, unknown> = {};
    let conflictUpdates: Record<string, unknown> = {};
    try {
      if (shouldRefreshCompatibility) {
        const confirmed = data.body.compatibilityConfirmed === true;
        const selection = await resolveProjectCompatibilitySelection(c, {
          builtForReferenceVersionId: targetBuiltForReferenceVersionId,
          testedThroughReferenceVersionId: confirmed ? targetBuiltForReferenceVersionId : null,
        });
        compatibilityUpdates = {
          characterReferenceId: selection.characterReferenceId,
          builtForReferenceVersionId: selection.builtForReferenceVersionId,
          testedThroughReferenceVersionId: selection.testedThroughReferenceVersionId,
          compatibilityStatus: selection.compatibilityStatus,
          compatibilityKnownIncompatible: false,
          compatibilityNote: null,
          compatibilityGraceUntil: selection.compatibilityGraceUntil,
          compatibilityUpdatedAt: selection.builtForReferenceVersionId ? new Date().toISOString() : null,
        };
      }

      if (data.body.conflictsWithOriginal !== undefined || data.body.originalConflictReferenceItemIds !== undefined) {
        const conflictsWithOriginal = data.body.conflictsWithOriginal ?? project.conflictsWithOriginal;
        const requestedIds = data.body.originalConflictReferenceItemIds ?? project.originalConflictReferenceItemIds;
        const validatedIds = conflictsWithOriginal
          ? await validateOriginalConflictReferenceItems(c, targetBuiltForReferenceVersionId, requestedIds)
          : [];
        if (conflictsWithOriginal && validatedIds.length === 0) {
          return c.json({ error: '请选择需要暂时关闭的原版内容' }, 400);
        }
        conflictUpdates = {
          conflictsWithOriginal,
          originalConflictReferenceItemIds: validatedIds,
        };
      }
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : '角色卡版本无效，请重新选择' }, 400);
    }

    const { compatibilityConfirmed: _compatibilityConfirmed, ...bodyUpdates } = data.body;
    const updates = {
      ...bodyUpdates,
      ...(data.body.worldbookEjsLengthEstimates !== undefined
        ? { worldbookEjsLengthEstimates: estimateResult.value }
        : {}),
      ...compatibilityUpdates,
      ...conflictUpdates,
      projectType: taxonomy.projectType,
      extensionType: taxonomy.extensionType,
      facets: taxonomy.facets,
      customTags: taxonomy.customTags,
      displayTags: taxonomy.displayTags,
      tags: taxonomy.legacyTags,
      ...(data.body.versionLabel !== undefined
        ? { versionLabel: typeof data.body.versionLabel === 'string' ? data.body.versionLabel.trim() || null : null }
        : {}),
    };

    if (project.isPublished && project.status === 'approved') {
      const targetVersion = bumpProjectVersionWithLegacyFallback(project.version, 'patch');
      const draftId = await projectDb.createDraftFromPublished(c, projectId, { ...updates, version: targetVersion });
      if (!draftId) {
        return c.json({ error: 'Draft creation failed' }, 500);
      }

      return {
        success: true,
        projectId: draftId,
        draftProjectId: draftId,
        targetVersion,
        message: '修改后的新版本已进入审核区，主界面仍显示旧版本。',
      };
    }

    if (project.reviewTarget === 'draft' && project.publishedProjectId) {
      const published = await projectDb.get(c, project.publishedProjectId);
      if (!published) {
        return c.json({ error: 'Published project not found for draft' }, 409);
      }

      const targetVersion = bumpProjectVersionWithLegacyFallback(published.version, 'patch');
      await projectDb.update(c, projectId, { ...updates, version: targetVersion, status: 'pending' });
      await projectDb.bumpDraftRevision(c, projectId);
      return {
        success: true,
        projectId,
        draftProjectId: projectId,
        targetVersion,
        message: 'Draft updated and resubmitted for review',
      };
    }

    await projectDb.update(c, projectId, { ...updates, version: LEGACY_PROJECT_VERSION_BASE, status: 'pending' });
    await projectDb.bumpDraftRevision(c, projectId);

    return {
      success: true,
      projectId,
      targetVersion: LEGACY_PROJECT_VERSION_BASE,
      message: 'Project updated successfully',
    };
  }
}

/**
 * 删除项目
 */
export class ProjectDelete extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Delete Project',
    request: {
      params: z.object({
        projectId: Str({ description: 'Project ID' }),
      }),
      headers: z.object({
        authorization: z.string().describe('Session ID'),
      }),
    },
    responses: {
      '200': {
        description: 'Delete successful',
      },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const data = await this.getValidatedData<typeof this.schema>();
    const { projectId } = data.params;

    // 检查项目是否存在且属于当前用户
    const project = await projectDb.get(c, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    // 检查权限 (作者或管理员) - JWT payload 中已有 isAdmin
    if (project.authorId !== payload.userId && !payload.isAdmin) {
      return c.json({ error: 'Permission denied' }, 403);
    }

    if (project.reviewTarget === 'draft' && project.publishedProjectId && project.status === 'pending') {
      const published = await projectDb.get(c, project.publishedProjectId, payload);
      if (!published) return c.json({ error: 'Published project not found for draft' }, 409);
      if (published.draftProjectId && published.draftProjectId !== project.id) {
        return c.json({ error: 'A newer working draft already exists.' }, 409);
      }

      const nextDraftId = generateId();
      const nextVersion = bumpProjectVersionWithLegacyFallback(published.version, 'patch');
      await projectDb.create(c, {
        id: nextDraftId,
        name: project.name,
        description: project.description || undefined,
        precautions: project.precautions ?? null,
        version: nextVersion,
        versionLabel: project.versionLabel ?? null,
        authorId: project.authorId,
        authorName: project.authorName,
        authorAvatar: project.authorAvatar || '',
        projectType: project.projectType,
        extensionType: project.extensionType,
        facets: project.facets,
        customTags: project.customTags,
        displayTags: project.displayTags,
        tags: project.tags,
        coverImage: project.coverImage || undefined,
        coverPositionX: project.coverPositionX,
        coverPositionY: project.coverPositionY,
        coverZoom: project.coverZoom,
        downloadUrl: project.downloadUrl || undefined,
        fileSize: project.fileSize || undefined,
        hasEjs: project.hasEjs,
        hasCharacterArtwork: project.hasCharacterArtwork,
        rootProjectId: project.rootProjectId || published.rootProjectId || published.id,
        publishedProjectId: published.id,
        reviewTarget: 'draft',
        draftRevision: 1,
        visibility: project.visibility,
        isPublished: false,
        latestApprovedAt: published.latestApprovedAt || published.reviewedAt,
        status: 'drafting',
      });

      try {
        const copied = await r2Storage.copyProjectFilesToPublished(
          c,
          project.id,
          nextDraftId,
          project.coverImage || undefined,
        );
        await projectDb.update(c, nextDraftId, {
          downloadUrl: copied.downloadUrl || project.downloadUrl || undefined,
          fileSize: copied.fileSize ?? project.fileSize ?? undefined,
          coverImage: copied.coverImage || project.coverImage || undefined,
        });
        await projectDb.update(c, published.id, { draftProjectId: nextDraftId });
      } catch (error) {
        await projectDb.delete(c, nextDraftId).catch(() => undefined);
        throw error;
      }

      return {
        success: true,
        continuedDraftProjectId: nextDraftId,
        reviewRequestId: project.id,
        message: 'Review snapshot preserved. Continue editing in the new draft.',
      };
    }

    // 删除正式项目时，一并清理当前草稿和历史审核快照。
    let linkedDraftId: string | null = null;
    if (project.isPublished) {
      const linkedDraftIds = await projectDb.listDraftIdsByPublishedId(c, project.id);
      linkedDraftId = project.draftProjectId || linkedDraftIds[0] || null;
      for (const linkedId of linkedDraftIds) {
        await r2Storage.deleteProjectFiles(c, linkedId);
        await projectDb.delete(c, linkedId);
      }
    }

    // 删除目标项目自己的 R2 文件
    await r2Storage.deleteProjectFiles(c, projectId);

    // 删除数据库记录
    await projectDb.delete(c, projectId);

    return {
      success: true,
      deletedDraftProjectId: linkedDraftId,
      message: 'Project deleted successfully',
    };
  }
}
