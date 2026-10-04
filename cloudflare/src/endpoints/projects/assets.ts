import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import type { AppContext } from '../../types';
import { projectDb } from '../../utils/db';
import { getCurrentUserFromRequest } from '../../utils/jwt';
import { WORKSHOP_LIMITS } from '../../config/runtime-limits';
import {
  removeProjectEntryFromJson,
  validateProjectContentText,
  type ProjectEntryKind,
} from '../../utils/project-content';
import { r2Storage } from '../../utils/r2';
import { analyzeProjectCode, formatUploaderCodeCheckError, toUploaderCodeCheck } from '../../utils/ejs-preflight.mjs';
import { bumpProjectVersionWithLegacyFallback } from '../../utils/version.js';
import { computeProjectInspectionSummary, readProjectContentForEdit } from './content';

const MAX_UPLOAD_SIZE = WORKSHOP_LIMITS.projectUploadBytes;
const MAX_COVER_REQUEST_SIZE = MAX_UPLOAD_SIZE + WORKSHOP_LIMITS.coverRequestOverheadBytes;
const UPLOAD_SIZE_ERROR = `文件过大，最大 ${WORKSHOP_LIMITS.projectUploadLabel}`;

export class ProjectCoverPresentationUpdate extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Adjust Project Cover Presentation',
    request: {
      params: z.object({ projectId: Str({ description: 'Project ID' }) }),
      headers: z.object({ authorization: z.string().describe('Session ID') }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              coverPositionX: z.number().min(0).max(100),
              coverPositionY: z.number().min(0).max(100),
              coverZoom: z.number().min(1).max(3),
            }),
          },
        },
      },
    },
    responses: {
      '200': { description: 'Cover presentation updated' },
      '403': { description: 'Author or admin only' },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload) return c.json({ error: 'Unauthorized' }, 401);
    const data = await this.getValidatedData<typeof this.schema>();
    const { projectId } = data.params;
    const project = await projectDb.get(c, projectId, payload);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    if (project.authorId !== payload.userId && !payload.isAdmin) {
      return c.json({ error: 'Permission denied' }, 403);
    }

    const presentation = {
      coverPositionX: data.body.coverPositionX,
      coverPositionY: data.body.coverPositionY,
      coverZoom: data.body.coverZoom,
    };
    const linkedId = project.publishedProjectId || project.draftProjectId || null;
    await projectDb.setCoverPresentation(c, [project.id, linkedId || ''], presentation);
    return { success: true, ...presentation };
  }
}

/**
 * 上传项目文件
 */
export class ProjectUpload extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Upload Project File',
    request: {
      params: z.object({
        projectId: Str({ description: 'Project ID' }),
      }),
      headers: z.object({
        authorization: z.string().describe('Session ID'),
        'content-type': z.string().describe('File content type'),
      }),
    },
    responses: {
      '200': {
        description: 'Upload successful',
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

    if (project.authorId !== payload.userId && !payload.isAdmin) {
      return c.json({ error: 'Permission denied' }, 403);
    }

    const contentLengthHeader = c.req.header('content-length');
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : Number.NaN;

    if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_SIZE) {
      return c.json({ error: UPLOAD_SIZE_ERROR }, 413);
    }

    // 获取文件内容
    const arrayBuffer = await c.req.arrayBuffer();
    const contentType = c.req.header('content-type') || 'application/json';

    if (arrayBuffer.byteLength > MAX_UPLOAD_SIZE) {
      return c.json({ error: UPLOAD_SIZE_ERROR }, 413);
    }

    // 验证文件类型
    if (!contentType.includes('application/json')) {
      return c.json({ error: 'Only JSON files are allowed' }, 400);
    }

    const worldbookText = new TextDecoder().decode(arrayBuffer);
    const validation = validateProjectContentText(worldbookText, 'worldbook');
    const codeCheck = validation.valid === false
      ? null
      : analyzeProjectCode([{ fileName: `project-${projectId}.json`, type: 'worldbook', text: worldbookText }]);
    if (codeCheck?.gate === 'reject') {
      return c.json(
        { error: formatUploaderCodeCheckError(codeCheck), codeCheck: toUploaderCodeCheck(codeCheck) },
        422,
      );
    }
    if (validation.valid === false) {
      return c.json({ error: validation.error }, 400);
    }

    if (project.isPublished && project.status === 'approved') {
      const draftId = await projectDb.createDraftFromPublished(c, projectId, {});
      if (!draftId) {
        return c.json({ error: 'Draft creation failed' }, 500);
      }

      const inspectionSummary = await computeProjectInspectionSummary(c, draftId, { worldbook: worldbookText });
      const draftFileName = `project-${draftId}.json`;
      const draftResult = await r2Storage.uploadProjectFile(c, draftId, arrayBuffer, draftFileName, contentType);
      if (!draftResult) {
        return c.json({ error: 'Upload failed' }, 500);
      }

      await projectDb.update(c, draftId, {
        downloadUrl: draftResult.url,
        fileSize: draftResult.size,
        hasEjs: inspectionSummary.hasEjs,
        hasCharacterArtwork: inspectionSummary.hasCharacterArtwork,
        status: 'pending',
      });

      return {
        success: true,
        projectId: draftId,
        downloadUrl: draftResult.url,
        fileSize: draftResult.size,
        message: '草稿版本已提交审核，主页仍显示旧版本。',
      };
    }

    const inspectionSummary = await computeProjectInspectionSummary(c, projectId, { worldbook: worldbookText });
    const fileName = `project-${projectId}.json`;

    // 上传到 R2
    const result = await r2Storage.uploadProjectFile(c, projectId, arrayBuffer, fileName, contentType);
    if (!result) {
      return c.json({ error: 'Upload failed' }, 500);
    }

    const updateData: {
      downloadUrl: string;
      fileSize: number;
      hasEjs: boolean;
      hasCharacterArtwork: boolean;
      status?: string;
    } = {
      downloadUrl: result.url,
      fileSize: result.size,
      hasEjs: inspectionSummary.hasEjs,
      hasCharacterArtwork: inspectionSummary.hasCharacterArtwork,
    };

    await projectDb.update(c, projectId, updateData);
    await projectDb.bumpDraftRevision(c, projectId);

    return {
      success: true,
      downloadUrl: result.url,
      fileSize: result.size,
      message: undefined,
    };
  }
}

export class ProjectCoverUpload extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Upload Project Cover Image',
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
        description: 'Cover uploaded successfully',
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

    const project = await projectDb.get(c, projectId, payload);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    if (project.authorId !== payload.userId && !payload.isAdmin) {
      return c.json({ error: 'Permission denied' }, 403);
    }

    const contentLengthHeader = c.req.header('content-length');
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : Number.NaN;
    if (Number.isFinite(contentLength) && contentLength > MAX_COVER_REQUEST_SIZE) {
      return c.json({ error: UPLOAD_SIZE_ERROR }, 413);
    }

    const formData = await c.req.formData();
    const cover = formData.get('cover');

    if (!(cover instanceof File)) {
      return c.json({ error: 'Cover file is required' }, 400);
    }

    if (cover.size > MAX_UPLOAD_SIZE) {
      return c.json({ error: UPLOAD_SIZE_ERROR }, 413);
    }

    const contentType = cover.type || 'application/octet-stream';
    const extension =
      contentType === 'image/png'
        ? 'png'
        : contentType === 'image/webp'
          ? 'webp'
          : contentType === 'image/jpeg'
            ? 'jpg'
            : null;

    if (!extension) {
      return c.json({ error: 'Only jpg/png/webp images are allowed' }, 400);
    }

    let targetProjectId = projectId;
    let newlyCreatedDraftId: string | null = null;
    let reusedDraft = false;

    if (project.isPublished && project.status === 'approved') {
      const existingDraft = project.draftProjectId ? await projectDb.get(c, project.draftProjectId, payload) : null;
      const draftId = existingDraft?.id || (await projectDb.createDraftFromPublished(c, projectId, {}));
      if (!draftId) {
        return c.json({ error: 'Draft creation failed' }, 500);
      }
      targetProjectId = draftId;
      reusedDraft = Boolean(existingDraft);
      if (!existingDraft) {
        newlyCreatedDraftId = draftId;
      }
    }

    const key = `projects/${targetProjectId}/cover.${extension}`;
    const uploadResult = await r2Storage.upload(c, key, await cover.arrayBuffer(), contentType);

    if (!uploadResult) {
      if (newlyCreatedDraftId) {
        await projectDb.delete(c, newlyCreatedDraftId);
      }
      return c.json({ error: 'Upload failed' }, 500);
    }

    await projectDb.setCoverImage(c, targetProjectId, key);
    if (reusedDraft) {
      await projectDb.bumpDraftRevision(c, targetProjectId);
    }

    if (targetProjectId !== projectId) {
      return {
        success: true,
        coverImage: uploadResult.url,
        projectId: targetProjectId,
        message: '封面修改已进入审核区，主页仍显示旧版本。',
      };
    }

    await projectDb.bumpDraftRevision(c, projectId);
    return {
      success: true,
      coverImage: uploadResult.url,
    };
  }
}

/**
 * 上传项目正则文件
 */
export class ProjectRegexUpload extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Upload Project Regex File',
    request: {
      params: z.object({
        projectId: Str({ description: 'Project ID' }),
      }),
      headers: z.object({
        authorization: z.string().describe('Session ID'),
        'content-type': z.string().describe('File content type'),
      }),
    },
    responses: {
      '200': {
        description: 'Upload successful',
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

    if (project.authorId !== payload.userId && !payload.isAdmin) {
      return c.json({ error: 'Permission denied' }, 403);
    }

    const contentLengthHeader = c.req.header('content-length');
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : Number.NaN;
    if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_SIZE) {
      return c.json({ error: UPLOAD_SIZE_ERROR }, 413);
    }

    // 获取文件内容
    const arrayBuffer = await c.req.arrayBuffer();
    const contentType = c.req.header('content-type') || 'application/json';

    if (arrayBuffer.byteLength > MAX_UPLOAD_SIZE) {
      return c.json({ error: UPLOAD_SIZE_ERROR }, 413);
    }

    // 验证文件类型
    if (!contentType.includes('application/json')) {
      return c.json({ error: 'Only JSON files are allowed' }, 400);
    }

    const regexText = new TextDecoder().decode(arrayBuffer);
    const validation = validateProjectContentText(regexText, 'regex');
    const codeCheck = validation.valid === false
      ? null
      : analyzeProjectCode([{ fileName: `regex-${projectId}.json`, type: 'regex', text: regexText }]);
    if (codeCheck?.gate === 'reject') {
      return c.json(
        { error: formatUploaderCodeCheckError(codeCheck), codeCheck: toUploaderCodeCheck(codeCheck) },
        422,
      );
    }
    if (validation.valid === false) {
      return c.json({ error: validation.error }, 400);
    }

    let targetProjectId = projectId;
    if (project.isPublished && project.status === 'approved') {
      const draftId = await projectDb.createDraftFromPublished(c, projectId, {});
      if (!draftId) {
        return c.json({ error: 'Draft creation failed' }, 500);
      }
      targetProjectId = draftId;
    }

    const inspectionSummary = await computeProjectInspectionSummary(c, targetProjectId, { regex: regexText });
    const fileName = `regex-${targetProjectId}.json`;

    // 上传到 R2
    const result = await r2Storage.uploadProjectFile(c, targetProjectId, arrayBuffer, fileName, contentType);
    if (!result) {
      return c.json({ error: 'Upload failed' }, 500);
    }
    await projectDb.update(c, targetProjectId, {
      hasEjs: inspectionSummary.hasEjs,
      hasCharacterArtwork: inspectionSummary.hasCharacterArtwork,
    });
    if (!(project.isPublished && project.status === 'approved')) {
      await projectDb.bumpDraftRevision(c, targetProjectId);
    }

    return {
      success: true,
      downloadUrl: result.url,
      fileSize: result.size,
      projectId: targetProjectId,
    };
  }
}

export class ProjectEntryRemove extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Remove One Project Entry',
    request: {
      params: z.object({ projectId: Str({ description: 'Project ID' }) }),
      headers: z.object({ authorization: z.string().describe('Session ID') }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              kind: z.enum(['worldbook', 'regex']),
              entryKey: z.string().min(1),
            }),
          },
        },
      },
    },
    responses: { '200': { description: 'Entry removed' } },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload) return c.json({ error: 'Unauthorized' }, 401);

    const data = await this.getValidatedData<typeof this.schema>();
    const { projectId } = data.params;
    const { kind, entryKey } = data.body;
    const project = await projectDb.get(c, projectId, payload);
    if (!project) return c.json({ error: 'Project not found' }, 404);
    if (project.authorId !== payload.userId && !payload.isAdmin) {
      return c.json({ error: 'Permission denied' }, 403);
    }

    let targetProjectId = project.id;
    const existingDraft =
      project.isPublished && project.status === 'approved' && project.draftProjectId
        ? await projectDb.get(c, project.draftProjectId, payload)
        : null;
    const sourceProject =
      project.isPublished && project.status === 'approved'
        ? existingDraft || project
        : project;
    const sourceObject = await readProjectContentForEdit(c, sourceProject, kind as ProjectEntryKind);
    if (!sourceObject) return c.json({ error: 'Project content file not found' }, 404);
    const changed = removeProjectEntryFromJson(await sourceObject.text(), kind as ProjectEntryKind, entryKey);

    if (project.isPublished && project.status === 'approved') {
      const targetVersion = existingDraft?.version || bumpProjectVersionWithLegacyFallback(project.version, 'patch');
      const draftId = await projectDb.createDraftFromPublished(c, project.id, { version: targetVersion });
      if (!draftId) return c.json({ error: 'Draft creation failed' }, 500);
      targetProjectId = draftId;
    }

    const inspectionSummary = await computeProjectInspectionSummary(c, targetProjectId, { [kind]: changed.text });
    const result = await r2Storage.uploadProjectFile(
      c,
      targetProjectId,
      await new Response(changed.text).arrayBuffer(),
      kind === 'worldbook' ? `project-${targetProjectId}.json` : `regex-${targetProjectId}.json`,
      'application/json',
    );
    if (!result) return c.json({ error: 'Upload failed' }, 500);

    if (kind === 'worldbook') {
      await projectDb.update(c, targetProjectId, {
        downloadUrl: result.url,
        fileSize: result.size,
        hasEjs: inspectionSummary.hasEjs,
        hasCharacterArtwork: inspectionSummary.hasCharacterArtwork,
      });
    } else {
      await projectDb.update(c, targetProjectId, {
        hasEjs: inspectionSummary.hasEjs,
        hasCharacterArtwork: inspectionSummary.hasCharacterArtwork,
      });
    }
    if (!(project.isPublished && project.status === 'approved')) {
      await projectDb.bumpDraftRevision(c, targetProjectId);
    }

    if (payload.isAdmin && project.authorId !== payload.userId) {
      await projectDb.logAdminAction(c, {
        action: 'project_entry_removed',
        targetType: project.reviewTarget === 'draft' || project.isPublished ? 'project_draft' : 'project',
        targetId: targetProjectId,
        actorId: payload.userId,
        actorName: payload.globalName || payload.username,
        detail: { kind, entryKey, projectName: project.name },
      });
    }

    return {
      success: true,
      projectId: targetProjectId,
    };
  }
}
