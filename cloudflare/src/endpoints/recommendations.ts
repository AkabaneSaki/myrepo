import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import type { AppContext } from '../types';
import { parseProjectRow } from '../utils/db';
import { getCurrentUserFromRequest } from '../utils/jwt';

type RecommendationRow = Record<string, unknown> & {
  curator_id: string;
  project_id: string;
  comment_text: string;
  reaction_label: string | null;
  recommendation_updated_at: string;
  curator_title: string | null;
  curator_bio: string | null;
  curator_username: string;
  curator_global_name: string | null;
  curator_avatar: string | null;
};

function getCuratorAvatarUrl(row: RecommendationRow): string {
  if (!row.curator_avatar) return 'https://cdn.discordapp.com/embed/avatars/0.png';
  if (/^https?:\/\//i.test(row.curator_avatar)) return row.curator_avatar;
  return `https://cdn.discordapp.com/avatars/${row.curator_id}/${row.curator_avatar}.webp?size=100`;
}

type CuratorProfileRow = {
  title: string | null;
  bio: string | null;
  reaction_presets: string | null;
};

function parseReactionPresets(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map(item => item.trim())
      .filter(Boolean)
      .slice(0, 12);
  } catch {
    return [];
  }
}

function normalizeReactionPresets(items: string[]): string[] {
  return Array.from(new Set(items.map(item => item.trim()).filter(Boolean))).slice(0, 12);
}

export class DevTeamRecommendationList extends OpenAPIRoute {
  schema = {
    tags: ['Recommendations'],
    summary: 'Get DevTeam Recommendations',
    responses: { '200': { description: 'Returns active DevTeam curators and recommendations' } },
  };

  async handle(c: AppContext) {
    const currentUser = await getCurrentUserFromRequest(c);
    const result = await c.env.DB.prepare(
      `SELECT
         p.*,
         author_user.global_name AS global_name,
         CASE WHEN viewer_like.user_id IS NULL THEN 0 ELSE 1 END AS user_liked,
         r.curator_id,
         r.project_id,
         r.comment_text,
         r.reaction_label,
         r.updated_at AS recommendation_updated_at,
         curator.title AS curator_title,
         curator.bio AS curator_bio,
         curator_user.username AS curator_username,
         curator_user.global_name AS curator_global_name,
         curator_user.avatar AS curator_avatar
       FROM devteam_recommendations r INDEXED BY idx_devteam_recommendations_updated
       JOIN devteam_curators curator ON curator.user_id = r.curator_id
       JOIN users curator_user ON curator_user.id = r.curator_id
       JOIN projects p ON p.id = r.project_id
       LEFT JOIN users author_user ON author_user.id = p.author_id
       LEFT JOIN project_likes viewer_like
         ON viewer_like.project_id = p.id AND viewer_like.user_id = ?
       WHERE curator.enabled = 1
         AND (
           curator_user.is_admin = 1
           OR r.curator_id = ?
           OR EXISTS (
             SELECT 1 FROM super_admins super_admin
             WHERE super_admin.user_id = r.curator_id
           )
         )
         AND p.status = 'approved'
         AND p.is_published = 1
         AND p.visibility = 1
       ORDER BY r.updated_at DESC
       LIMIT 100`,
    ).bind(currentUser?.userId || '', c.env.SUPER_ADMIN_USER_ID?.trim() || '').all<RecommendationRow>();

    const rows = result.results || [];
    const curators = new Map<string, any>();

    for (const row of rows) {
      const project = { ...parseProjectRow(row), downloadUrl: null };
      if (!curators.has(row.curator_id)) {
        curators.set(row.curator_id, {
          id: row.curator_id,
          name: row.curator_global_name || row.curator_username,
          avatarUrl: getCuratorAvatarUrl(row),
          title: row.curator_title || '',
          bio: row.curator_bio || '',
          recommendations: [],
        });
      }
      curators.get(row.curator_id).recommendations.push({
        project,
        comment: row.comment_text,
        reactionLabel: row.reaction_label || '',
        updatedAt: row.recommendation_updated_at,
      });
    }

    return { success: true, curators: Array.from(curators.values()) };
  }
}

export class AdminDevTeamCuratorProfileGet extends OpenAPIRoute {
  schema = {
    tags: ['Admin'],
    summary: 'Get own DLC kitchen curator profile',
    request: {
      headers: z.object({ authorization: z.string().describe('Session ID') }),
    },
    responses: {
      '200': { description: 'Curator profile returned' },
      '403': { description: 'Admin only' },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload?.isAdmin) return c.json({ error: 'Admin only' }, 403);

    const row = await c.env.DB.prepare(
      'SELECT title, bio, reaction_presets FROM devteam_curators WHERE user_id = ?',
    ).bind(payload.userId).first<CuratorProfileRow>();

    return {
      success: true,
      profile: {
        title: row?.title || '',
        bio: row?.bio || '',
        reactionPresets: parseReactionPresets(row?.reaction_presets),
      },
    };
  }
}

export class AdminDevTeamCuratorProfileSet extends OpenAPIRoute {
  schema = {
    tags: ['Admin'],
    summary: 'Update own DLC kitchen curator profile',
    request: {
      headers: z.object({ authorization: z.string().describe('Session ID') }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              title: z.string().trim().max(48),
              bio: z.string().trim().max(160),
              reactionPresets: z.array(z.string().trim().min(1).max(32)).max(12),
            }),
          },
        },
      },
    },
    responses: {
      '200': { description: 'Curator profile saved' },
      '403': { description: 'Admin only' },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload?.isAdmin) return c.json({ error: 'Admin only' }, 403);
    const data = await this.getValidatedData<typeof this.schema>();
    const reactionPresets = normalizeReactionPresets(data.body.reactionPresets);

    await c.env.DB.prepare(
      `INSERT INTO devteam_curators (user_id, title, bio, reaction_presets, enabled, updated_at)
       VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         title = excluded.title,
         bio = excluded.bio,
         reaction_presets = excluded.reaction_presets,
         enabled = 1,
         updated_at = CURRENT_TIMESTAMP`,
    ).bind(
      payload.userId,
      data.body.title,
      data.body.bio,
      JSON.stringify(reactionPresets),
    ).run();

    return {
      success: true,
      profile: {
        title: data.body.title,
        bio: data.body.bio,
        reactionPresets,
      },
    };
  }
}

export class AdminDevTeamRecommendationSet extends OpenAPIRoute {
  schema = {
    tags: ['Admin'],
    summary: 'Create or update own DevTeam recommendation',
    request: {
      params: z.object({ projectId: Str({ description: 'Project ID' }) }),
      headers: z.object({ authorization: z.string().describe('Session ID') }),
      body: {
        content: {
          'application/json': {
            schema: z.object({
              comment: z.string().trim().min(1).max(500),
              reactionLabel: z.string().trim().max(32).optional(),
            }),
          },
        },
      },
    },
    responses: {
      '200': { description: 'Recommendation saved' },
      '403': { description: 'Admin only' },
      '404': { description: 'Public project not found' },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload?.isAdmin) return c.json({ error: 'Admin only' }, 403);
    const data = await this.getValidatedData<typeof this.schema>();
    const project = await c.env.DB.prepare(
      `SELECT id FROM projects
       WHERE id = ? AND status = 'approved' AND is_published = 1 AND visibility = 1`,
    ).bind(data.params.projectId).first<{ id: string }>();
    if (!project) return c.json({ error: '只能推荐已经公开发布的项目' }, 404);

    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO devteam_curators (user_id, enabled, updated_at)
         VALUES (?, 1, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id) DO UPDATE SET
           enabled = 1,
           updated_at = CURRENT_TIMESTAMP`,
      ).bind(payload.userId),
      c.env.DB.prepare(
        `INSERT INTO devteam_recommendations (curator_id, project_id, comment_text, reaction_label, updated_at)
         VALUES (?, ?, ?, COALESCE(?, ''), CURRENT_TIMESTAMP)
         ON CONFLICT(curator_id, project_id) DO UPDATE SET
           comment_text = excluded.comment_text,
           reaction_label = COALESCE(?, devteam_recommendations.reaction_label),
           updated_at = CURRENT_TIMESTAMP`,
      ).bind(
        payload.userId,
        data.params.projectId,
        data.body.comment,
        data.body.reactionLabel ?? null,
        data.body.reactionLabel ?? null,
      ),
    ]);

    return { success: true };
  }
}

export class AdminDevTeamRecommendationDelete extends OpenAPIRoute {
  schema = {
    tags: ['Admin'],
    summary: 'Delete own DevTeam recommendation',
    request: {
      params: z.object({ projectId: Str({ description: 'Project ID' }) }),
      headers: z.object({ authorization: z.string().describe('Session ID') }),
    },
    responses: {
      '200': { description: 'Recommendation deleted' },
      '403': { description: 'Admin only' },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload?.isAdmin) return c.json({ error: 'Admin only' }, 403);
    const data = await this.getValidatedData<typeof this.schema>();
    await c.env.DB.prepare(
      'DELETE FROM devteam_recommendations WHERE curator_id = ? AND project_id = ?',
    ).bind(payload.userId, data.params.projectId).run();
    return { success: true };
  }
}
