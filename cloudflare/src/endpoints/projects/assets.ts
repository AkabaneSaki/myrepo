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
import {
  hashContentText,
  issueCreatorAttestation,
  verifyCreatorAttestation,
} from '../../utils/ejs-checker/attestation.mjs';
import { CHECKER_VERSION } from '../../utils/ejs-checker/index.mjs';
import { bumpProjectVersionWithLegacyFallback } from '../../utils/version.js';
import { computeProjectInspectionSummary, readProjectContentForEdit } from './content';

const MAX_UPLOAD_SIZE = WORKSHOP_LIMITS.projectUploadBytes;
const MAX_COVER_REQUEST_SIZE = MAX_UPLOAD_SIZE + WORKSHOP_LIMITS.coverRequestOverheadBytes;
const UPLOAD_SIZE_ERROR = `文件过大，最大 ${WORKSHOP_LIMITS.projectUploadLabel}`;
const CONTENT_CHANGED_ERROR = '文件正在保存或项目已变化，请稍后刷新再试。';
const ATTESTATION_ERROR = '这份文件的本地检查结果已经失效，请重新选择文件并等待本地检查通过后再提交。';

/** Advertised checker revision the device bundles were built from. A receipt issued
 * for a different build must not authorise an upload. */
const DEVICE_CHECKER_REVISION = `${CHECKER_VERSION.engine}:${CHECKER_VERSION.policyVersion}`;

/**
 * #42: the Worker performs only cheap authoritative validation here. In the normal
 * Workshop flow the complete rule analysis runs on the creator device first. This
 * function does not certify that browser verdict; it only validates a server-stamped
 * receipt bound to the exact uploaded bytes.
 */
async function validateAttestedUpload(
  c: AppContext,
  userId: string,
  kind: ProjectEntryKind,
  text: string,
  attestation: unknown,
): Promise<{ valid: true; contentHash: string } | { valid: false; error: string }> {
  const contentHash = await hashContentText(text);
  const verified = await verifyCreatorAttestation(c.env.JWT_SECRET, String(attestation ?? ''), {
    userId,
    kind,
    checkerRevision: DEVICE_CHECKER_REVISION,
    contentHash,
  });
  if (!verified.ok) return { valid: false, error: ATTESTATION_ERROR };
  return { valid: true, contentHash };
}


async function writeProjectContent(
  c: AppContext,
  project: { id: string; draftRevision: number; status: string; publishedProjectId?: string | null },
  kind: ProjectEntryKind,
  loadContent: () => Promise<{ text: string; body: ArrayBuffer; contentType: string }>,
) {
  const mutation = await projectDb.beginContentMutation(c, project);
  if (!mutation) return null;
  try {
    const content = await loadContent();
    const inspection = await computeProjectInspectionSummary(c, project.id, { [kind]: content.text });
    const fileName = kind === 'worldbook' ? `project-${project.id}.json` : `regex-${project.id}.json`;
    const result = await r2Storage.uploadProjectFile(c, project.id, content.body, fileName, content.contentType);
    if (!result) throw new Error('文件保存失败，请稍后重新上传。');
    const completed = await projectDb.finishContentMutation(c, project.id, mutation, {
      ...(kind === 'worldbook' ? { downloadUrl: result.url, fileSize: result.size } : {}),
      hasEjs: inspection.hasEjs,
      hasCharacterArtwork: inspection.hasCharacterArtwork,
    });
    if (!completed) throw new Error(CONTENT_CHANGED_ERROR);
    return result;
  } catch (error) {
    await projectDb.cancelContentMutation(c, project.id, mutation);
    throw error;
  }
}

export class ProjectUploadPreflight extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Check Project File Before Upload',
    request: {
      params: z.object({
        kind: z.enum(['worldbook', 'regex']),
      }),
      headers: z.object({
        authorization: z.string().describe('Session ID'),
        'content-type': z.string().describe('File content type'),
      }),
    },
    responses: {
      '200': { description: 'Preflight passed' },
      '400': { description: 'Invalid file' },
      '413': { description: 'File too large' },
      '422': { description: 'Script check rejected the file' },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const data = await this.getValidatedData<typeof this.schema>();
    const kind = data.params.kind;
    const contentLengthHeader = c.req.header('content-length');
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : Number.NaN;
    if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_SIZE) {
      return c.json({ error: UPLOAD_SIZE_ERROR }, 413);
    }

    const arrayBuffer = await c.req.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_UPLOAD_SIZE) {
      return c.json({ error: UPLOAD_SIZE_ERROR }, 413);
    }

    const contentType = c.req.header('content-type') || 'application/json';
    if (!contentType.includes('application/json')) {
      return c.json({ error: '只支持 JSON 文件' }, 400);
    }

    const text = new TextDecoder().decode(arrayBuffer);
    const validation = validateProjectContentText(text, kind);
    if (validation.valid === false) {
      return c.json({ error: validation.error }, 400);
    }

    // Cheap authoritative validation only. The normal Workshop UI has already run
    // the complete creator-device checker before calling this endpoint. The receipt
    // is stamped from these exact bytes, so different content cannot reuse it.
    const contentHash = await hashContentText(text);
    return {
      success: true,
      message: '文件完整性检查通过，可以继续。',
      contentHash,
      checkerRevision: DEVICE_CHECKER_REVISION,
      attestation: await issueCreatorAttestation(c.env.JWT_SECRET, {
        userId: payload.userId,
        kind,
        checkerRevision: DEVICE_CHECKER_REVISION,
        contentHash,
      }),
    };
  }
}

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
    if (validation.valid === false) {
      return c.json({ error: validation.error }, 400);
    }

    // #42: no heavy checker on this path. The receipt binds this upload to exactly
    // these bytes and carries no checker verdict. A creator can bypass the normal UI
    // only to submit pending content; publication still requires trusted human review
    // against the exact stored content.
    const attested = await validateAttestedUpload(
      c,
      payload.userId,
      'worldbook',
      worldbookText,
      c.req.header('x-workshop-content-attestation'),
    );
    if (attested.valid === false) {
      return c.json({ error: attested.error }, 409);
    }

    let targetProject = project;
    if (project.isPublished && project.status === 'approved') {
      const draftId = await projectDb.createDraftFromPublished(c, projectId, {});
      if (!draftId) {
        return c.json({ error: 'Draft creation failed' }, 500);
      }

      const draft = await projectDb.get(c, draftId);
      if (!draft) return c.json({ error: CONTENT_CHANGED_ERROR }, 409);
      targetProject = draft;
    }

    const result = await writeProjectContent(c, targetProject, 'worldbook', async () => ({ text: worldbookText, body: arrayBuffer, contentType }));
    if (!result) return c.json({ error: CONTENT_CHANGED_ERROR }, 409);

    return {
      success: true,
      downloadUrl: result.url,
      fileSize: result.size,
      ...(targetProject.id !== projectId ? { projectId: targetProject.id, message: '草稿版本已提交审核，主页仍显示旧版本。' } : {}),
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
    if (validation.valid === false) {
      return c.json({ error: validation.error }, 400);
    }

    const attested = await validateAttestedUpload(
      c,
      payload.userId,
      'regex',
      regexText,
      c.req.header('x-workshop-content-attestation'),
    );
    if (attested.valid === false) {
      return c.json({ error: attested.error }, 409);
    }

    let targetProject = project;
    if (project.isPublished && project.status === 'approved') {
      const draftId = await projectDb.createDraftFromPublished(c, projectId, {});
      if (!draftId) {
        return c.json({ error: 'Draft creation failed' }, 500);
      }
      const draft = await projectDb.get(c, draftId);
      if (!draft) return c.json({ error: CONTENT_CHANGED_ERROR }, 409);
      targetProject = draft;
    }

    const result = await writeProjectContent(c, targetProject, 'regex', async () => ({ text: regexText, body: arrayBuffer, contentType }));
    if (!result) return c.json({ error: CONTENT_CHANGED_ERROR }, 409);

    return {
      success: true,
      downloadUrl: result.url,
      fileSize: result.size,
      projectId: targetProject.id,
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

    let targetProject = project;
    if (project.isPublished && project.status === 'approved') {
      const existingDraft = project.draftProjectId ? await projectDb.get(c, project.draftProjectId, payload) : null;
      const targetVersion = existingDraft?.version || bumpProjectVersionWithLegacyFallback(project.version, 'patch');
      const draftId = await projectDb.createDraftFromPublished(c, project.id, { version: targetVersion });
      if (!draftId) return c.json({ error: 'Draft creation failed' }, 500);
      const draft = await projectDb.get(c, draftId, payload);
      if (!draft) return c.json({ error: CONTENT_CHANGED_ERROR }, 409);
      targetProject = draft;
    }

    const result = await writeProjectContent(c, targetProject, kind, async () => {
      const sourceObject = await readProjectContentForEdit(c, targetProject, kind);
      if (!sourceObject) throw new Error('找不到项目文件，请刷新后重试。');
      const changed = removeProjectEntryFromJson(await sourceObject.text(), kind, entryKey);
      return { text: changed.text, body: await new Response(changed.text).arrayBuffer(), contentType: 'application/json' };
    });
    if (!result) return c.json({ error: CONTENT_CHANGED_ERROR }, 409);

    if (payload.isAdmin && project.authorId !== payload.userId) {
      await projectDb.logAdminAction(c, {
        action: 'project_entry_removed',
        targetType: project.reviewTarget === 'draft' || project.isPublished ? 'project_draft' : 'project',
        targetId: targetProject.id,
        actorId: payload.userId,
        actorName: payload.globalName || payload.username,
        detail: { kind, entryKey, projectName: project.name },
      });
    }

    return {
      success: true,
      projectId: targetProject.id,
    };
  }
}
