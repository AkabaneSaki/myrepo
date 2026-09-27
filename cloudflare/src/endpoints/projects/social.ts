import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import type { AppContext } from '../../types';
import { projectDb } from '../../utils/db';
import { getCurrentUserFromRequest } from '../../utils/jwt';

export class ProjectRatingSet extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Set Private Project Rating',
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
              rating: z.number().int().min(1).max(5),
              comment: z.string().trim().max(500).optional(),
            }),
          },
        },
      },
    },
    responses: {
      '200': { description: 'Private rating saved' },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload) return c.json({ error: '请先登录' }, 401);
    const data = await this.getValidatedData<typeof this.schema>();
    const { projectId } = data.params;
    const project = await c.env.DB.prepare(
      `SELECT author_id, status, is_published, visibility FROM projects WHERE id = ?`,
    )
      .bind(projectId)
      .first<{ author_id: string; status: string; is_published: number; visibility: number }>();

    if (!project || project.status !== 'approved' || Number(project.is_published) !== 1 || Number(project.visibility) !== 1) {
      return c.json({ error: '找不到这个项目' }, 404);
    }
    if (project.author_id === payload.userId) {
      return c.json({ error: '作者不能给自己的项目评分' }, 400);
    }

    const rating = Number(data.body.rating);
    const commentProvided = data.body.comment !== undefined;
    const commentText = commentProvided ? String(data.body.comment || '').trim() : null;
    await c.env.DB.prepare(
      `INSERT INTO project_ratings (project_id, user_id, rating, comment_text, created_at, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(project_id, user_id) DO UPDATE SET
         rating = excluded.rating,
         comment_text = CASE WHEN ? = 1 THEN excluded.comment_text ELSE project_ratings.comment_text END,
         updated_at = CURRENT_TIMESTAMP`,
    )
      .bind(projectId, payload.userId, rating, commentText || null, commentProvided ? 1 : 0)
      .run();

    return { success: true, rating, ...(commentProvided ? { comment: commentText } : {}) };
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
