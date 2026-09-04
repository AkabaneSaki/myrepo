import { Bool, Num, OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import type { AppContext } from '../types';
import { generateId, projectDb, userDb } from '../utils/db';
import { getCurrentUserFromRequest } from '../utils/jwt';
import { removeProjectEntryFromJson, type ProjectEntryKind } from '../utils/project-content';
import { parseRegexEntriesPreview, parseWorldbookEntriesPreview } from '../utils/project-preview';
import { r2Storage } from '../utils/r2';
import { bumpProjectVersionWithLegacyFallback } from '../utils/version.js';

const projectListSortSchema = z.enum(['published', 'updated', 'likes', 'subscribes', 'downloads']);


async function readProjectPreview(
  c: AppContext,
  project: { downloadUrl?: string | null; id: string; publishedProjectId?: string | null },
) {
  const projectObject = await readProjectContentForEdit(c, project, 'worldbook');
  const regexObject = await readProjectContentForEdit(c, project, 'regex');
  const worldbookEntriesPreview = projectObject ? parseWorldbookEntriesPreview(await projectObject.text()) : [];
  const regexEntriesPreview = regexObject ? parseRegexEntriesPreview(await regexObject.text()) : [];
  return { worldbookEntriesPreview, regexEntriesPreview };
}

function getProjectContentKey(projectId: string, kind: ProjectEntryKind): string {
  const fileName = kind === 'worldbook' ? `project-${projectId}.json` : `regex-${projectId}.json`;
  return `projects/${projectId}/${fileName}`;
}

async function readProjectContentForEdit(
  c: AppContext,
  project: { id: string; publishedProjectId?: string | null },
  kind: ProjectEntryKind,
) {
  const targetObject = await c.env.R2_BUCKET.get(getProjectContentKey(project.id, kind));
  if (targetObject) return targetObject;
  if (project.publishedProjectId) {
    return c.env.R2_BUCKET.get(getProjectContentKey(project.publishedProjectId, kind));
  }
  return null;
}

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
        tag: Str({ required: false }).describe('Filter by tag'),
        search: Str({ required: false }).describe('Search keyword'),
        sort: projectListSortSchema.default('published').describe('Sort mode'),
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
    const { page, pageSize, tag, search, sort } = data.query;
    const payload = await getCurrentUserFromRequest(c);

    const result = await projectDb.list(c, {
      page,
      pageSize,
      approvedOnly: true, // 只返回已审核通过的项目
      tag,
      search,
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

    const preview = await readProjectPreview(c, project);

    return {
      success: true,
      project: {
        ...project,
        ...preview,
        authorAvatar: project.authorAvatar
          ? `https://cdn.discordapp.com/avatars/${project.authorId}/${project.authorAvatar}.webp?size=100`
          : null,
      },
      worldbookEntriesPreview: preview.worldbookEntriesPreview,
      regexEntriesPreview: preview.regexEntriesPreview,
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
              tags: z.array(z.string()).default([]),
              coverImage: Str({ required: false }),
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
      const tags = Array.isArray(rawBody.tags) ? rawBody.tags.filter(tag => typeof tag === 'string') : [];
      const coverImage = typeof rawBody.coverImage === 'string' ? rawBody.coverImage : undefined;

      if (!name) {
        return c.json({ error: 'Project name is required' }, 400);
      }

      if (name.length > 100) {
        return c.json({ error: 'Project name must be 100 characters or fewer' }, 400);
      }

      const projectId = generateId();

      await userDb.upsert(c, {
        id: payload.userId,
        username: payload.username,
        global_name: payload.globalName,
        avatar: payload.avatar || '',
        discriminator: '0000',
        guilds: [],
        isAdmin: payload.isAdmin,
      });

      await projectDb.create(c, {
        id: projectId,
        name,
        description,
        version: '1.0.0',
        authorId: payload.userId,
        authorName: payload.username,
        authorAvatar: payload.avatar || '',
        tags,
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

    const maxUploadSize = 10 * 1024 * 1024;
    const contentLengthHeader = c.req.header('content-length');
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : Number.NaN;

    if (Number.isFinite(contentLength) && contentLength > maxUploadSize) {
      return c.json({ error: 'File too large. Maximum size is 10MB' }, 413);
    }

    // 获取文件内容
    const arrayBuffer = await c.req.arrayBuffer();
    const contentType = c.req.header('content-type') || 'application/json';

    if (arrayBuffer.byteLength > maxUploadSize) {
      return c.json({ error: 'File too large. Maximum size is 10MB' }, 413);
    }

    // 验证文件类型
    if (!contentType.includes('application/json')) {
      return c.json({ error: 'Only JSON files are allowed' }, 400);
    }

    if (project.isPublished && project.status === 'approved') {
      const draftId = await projectDb.createDraftFromPublished(c, projectId, {});
      if (!draftId) {
        return c.json({ error: 'Draft creation failed' }, 500);
      }

      const draftFileName = `project-${draftId}.json`;
      const draftResult = await r2Storage.uploadProjectFile(c, draftId, arrayBuffer, draftFileName, contentType);
      if (!draftResult) {
        return c.json({ error: 'Upload failed' }, 500);
      }

      await projectDb.update(c, draftId, {
        downloadUrl: draftResult.url,
        fileSize: draftResult.size,
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

    const fileName = `project-${projectId}.json`;

    // 上传到 R2
    const result = await r2Storage.uploadProjectFile(c, projectId, arrayBuffer, fileName, contentType);
    if (!result) {
      return c.json({ error: 'Upload failed' }, 500);
    }

    const updateData: {
      downloadUrl: string;
      fileSize: number;
      status?: string;
    } = {
      downloadUrl: result.url,
      fileSize: result.size,
    };

    await projectDb.update(c, projectId, updateData);

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

    const formData = await c.req.formData();
    const cover = formData.get('cover');

    if (!(cover instanceof File)) {
      return c.json({ error: 'Cover file is required' }, 400);
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

    const key = `projects/${projectId}/cover.${extension}`;
    const uploadResult = await r2Storage.upload(c, key, await cover.arrayBuffer(), contentType);

    if (!uploadResult) {
      return c.json({ error: 'Upload failed' }, 500);
    }

    if (project.isPublished && project.status === 'approved') {
      const draftId = await projectDb.createDraftFromPublished(c, projectId, { coverImage: key });
      if (!draftId) {
        return c.json({ error: 'Draft creation failed' }, 500);
      }

      await projectDb.setCoverImage(c, draftId, key);

      return {
        success: true,
        coverImage: uploadResult.url,
        projectId: draftId,
        message: '封面修改已进入审核区，主页仍显示旧版本。',
      };
    }

    await projectDb.setCoverImage(c, projectId, key);

    return {
      success: true,
      coverImage: uploadResult.url,
    };
  }
}

export class ProjectLikeToggle extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Toggle Project Like',
    request: {
      params: z.object({
        projectId: Str({ description: 'Project ID' }),
      }),
      headers: z.object({
        authorization: z.string().describe('Session ID'),
      }),
    },
    responses: {
      '200': { description: 'Like toggled successfully' },
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

    const result = await projectDb.toggleLike(c, data.params.projectId, payload.userId);
    return result;
  }
}

export class ProjectSubscribeToggle extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Toggle Project Subscribe (Legacy)',
    request: {
      params: z.object({
        projectId: Str({ description: 'Project ID' }),
      }),
      headers: z.object({
        authorization: z.string().describe('Session ID'),
      }),
    },
    responses: {
      '200': { description: 'Subscribe toggled successfully' },
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

    const result = await projectDb.toggleSubscribe(c, data.params.projectId, payload.userId);
    return result;
  }
}

export class ProjectSubscribeSet extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Set Project Update Subscription',
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
            schema: z.object({ subscribed: z.boolean() }),
          },
        },
      },
    },
    responses: {
      '200': { description: 'Subscription state updated successfully' },
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

    return projectDb.setSubscribe(c, data.params.projectId, payload.userId, data.body.subscribed);
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
              versionBump: z.enum(['patch', 'minor', 'major']).optional().default('patch'),
              tags: z.array(z.string()).optional(),
              coverImage: Str({ required: false }),
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
    const { versionBump = 'patch', ...updates } = data.body;

    // 检查项目是否存在且属于当前用户
    const project = await projectDb.get(c, projectId);
    if (!project) {
      return c.json({ error: 'Project not found' }, 404);
    }

    if (project.authorId !== payload.userId && !payload.isAdmin) {
      return c.json({ error: 'Permission denied' }, 403);
    }

    if (project.isPublished && project.status === 'approved') {
      let targetVersion: string;
      try {
        targetVersion = bumpProjectVersionWithLegacyFallback(project.version, versionBump);
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : 'Invalid project version' }, 409);
      }

      const draftId = await projectDb.createDraftFromPublished(c, projectId, { ...updates, version: targetVersion });
      if (!draftId) {
        return c.json({ error: 'Draft creation failed' }, 500);
      }

      return {
        success: true,
        projectId: draftId,
        draftProjectId: draftId,
        targetVersion,
        versionBump,
        message: '修改后的新版本已进入审核区，主界面仍显示旧版本。',
      };
    }

    if (project.reviewTarget === 'draft' && project.publishedProjectId) {
      const published = await projectDb.get(c, project.publishedProjectId);
      if (!published) {
        return c.json({ error: 'Published project not found for draft' }, 409);
      }

      let targetVersion: string;
      try {
        targetVersion = bumpProjectVersionWithLegacyFallback(published.version, versionBump);
      } catch (error) {
        return c.json({ error: error instanceof Error ? error.message : 'Invalid project version' }, 409);
      }

      await projectDb.update(c, projectId, { ...updates, version: targetVersion, status: 'pending' });
      return {
        success: true,
        projectId,
        draftProjectId: projectId,
        targetVersion,
        versionBump,
        message: 'Draft updated and resubmitted for review',
      };
    }

    await projectDb.update(c, projectId, { ...updates, version: '1.0.0', status: 'pending' });

    return {
      success: true,
      projectId,
      targetVersion: '1.0.0',
      versionBump: 'patch',
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

    // 删除 R2 中的文件
    await r2Storage.deleteProjectFiles(c, projectId);

    // 删除数据库记录
    await projectDb.delete(c, projectId);

    return {
      success: true,
      message: 'Project deleted successfully',
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

    // 获取文件内容
    const arrayBuffer = await c.req.arrayBuffer();
    const contentType = c.req.header('content-type') || 'application/json';

    // 验证文件类型
    if (!contentType.includes('application/json')) {
      return c.json({ error: 'Only JSON files are allowed' }, 400);
    }

    const targetProjectId =
      project.isPublished && project.status === 'approved'
        ? (await projectDb.createDraftFromPublished(c, projectId, {})) || projectId
        : projectId;

    const fileName = `regex-${targetProjectId}.json`;

    // 上传到 R2
    const result = await r2Storage.uploadProjectFile(c, targetProjectId, arrayBuffer, fileName, contentType);
    if (!result) {
      return c.json({ error: 'Upload failed' }, 500);
    }

    return {
      success: true,
      downloadUrl: result.url,
      fileSize: result.size,
      projectId: targetProjectId,
    };
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
      project.isPublished && project.status === 'approved' ? await projectDb.findDraftByPublishedId(c, project.id) : null;
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

    const result = await r2Storage.uploadProjectFile(
      c,
      targetProjectId,
      await new Response(changed.text).arrayBuffer(),
      kind === 'worldbook' ? `project-${targetProjectId}.json` : `regex-${targetProjectId}.json`,
      'application/json',
    );
    if (!result) return c.json({ error: 'Upload failed' }, 500);

    if (kind === 'worldbook') {
      await projectDb.update(c, targetProjectId, { downloadUrl: result.url, fileSize: result.size });
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
