import { OpenAPIRoute, Str } from 'chanfana';
import { z } from 'zod';
import type { AppContext } from '../types';
import { parseProjectRow, projectDb } from '../utils/db';
import { getCurrentUserFromRequest } from '../utils/jwt';
import { r2Storage } from '../utils/r2';

type RecommendationRow = Record<string, unknown> & {
  project_id: string;
};

function normalizeDlcKitchenCoverImage(c: AppContext, coverImage: string | null): string | null {
  if (!coverImage) return null;
  if (/^https?:\/\//i.test(coverImage) && !coverImage.includes('/api/files/')) return coverImage;
  const key = coverImage.replace(/^.*\/api\/files\//, '').replace(/^\/+/, '');
  return r2Storage.getProxyUrl(c, key);
}

const DLC_KITCHEN_CACHE_TTL_SECONDS = 5 * 60;

async function getDlcKitchenCacheRevision(c: AppContext): Promise<string> {
  const row = await c.env.DB.prepare(`
    SELECT
      COALESCE((SELECT revision FROM public_project_counts WHERE scope = '*'), 0) AS public_revision,
      COALESCE((SELECT CAST(value AS INTEGER) FROM site_settings WHERE key = 'dlc_kitchen_revision'), 0) AS kitchen_revision
  `).first<{ public_revision: number; kitchen_revision: number }>();
  return `${Number(row?.public_revision || 0)}:${Number(row?.kitchen_revision || 0)}`;
}

function prepareDlcKitchenRevision(c: AppContext, actorId: string) {
  return c.env.DB.prepare(`
    INSERT INTO site_settings (key, value, updated_at, updated_by)
    VALUES ('dlc_kitchen_revision', '1', CURRENT_TIMESTAMP, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = CAST(COALESCE(site_settings.value, '0') AS INTEGER) + 1,
      updated_at = CURRENT_TIMESTAMP,
      updated_by = excluded.updated_by
  `).bind(actorId);
}

async function applyDlcKitchenViewerLikes(c: AppContext, response: any, userId?: string) {
  if (!userId || !Array.isArray(response?.recommendations)) return response;
  const projectIds: string[] = response.recommendations.map((project: any) => String(project?.id || '').trim()).filter(Boolean);
  const likedProjectIds = new Set<string>();
  for (let offset = 0; offset < projectIds.length; offset += 50) {
    const batch = await projectDb.getLikedProjectIds(c, projectIds.slice(offset, offset + 50), userId);
    batch.forEach(projectId => likedProjectIds.add(projectId));
  }
  return {
    ...response,
    recommendations: response.recommendations.map((project: any) => ({ ...project, userLiked: likedProjectIds.has(project.id) })),
  };
}

export class DevTeamRecommendationList extends OpenAPIRoute {
  schema = {
    tags: ['Recommendations'],
    summary: 'Get DevTeam Recommendations',
    responses: { '200': { description: 'Returns unified editor picks' } },
  };

  async handle(c: AppContext) {
    const currentUser = await getCurrentUserFromRequest(c);
    const cacheRevision = await getDlcKitchenCacheRevision(c);
    const cacheUrl = new URL(c.req.url);
    cacheUrl.pathname = '/__cache/editor-picks';
    cacheUrl.search = new URLSearchParams({ revision: cacheRevision }).toString();
    const cacheRequest = new Request(cacheUrl.toString());
    const cached = await caches.default.match(cacheRequest);
    let publicResponse: any = cached ? await cached.json() : null;

    if (!publicResponse) {
    const result = await c.env.DB.prepare(
      `SELECT
         p.*,
         author_user.global_name AS global_name,
         0 AS user_liked,
         r.project_id
       FROM devteam_recommendations r INDEXED BY idx_devteam_recommendations_updated
       JOIN devteam_curators curator ON curator.user_id = r.curator_id
       JOIN users curator_user ON curator_user.id = r.curator_id
       JOIN projects p ON p.id = r.project_id
       LEFT JOIN users author_user ON author_user.id = p.author_id
       -- Viewer likes are overlaid after the shared public payload is loaded.

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
       GROUP BY r.project_id
       ORDER BY MAX(r.updated_at) DESC, r.project_id
       LIMIT 100`,
    ).bind(c.env.SUPER_ADMIN_USER_ID?.trim() || '').all<RecommendationRow>();

    const rows = result.results || [];
    const projects = rows.map(row => {
      const parsedProject = parseProjectRow(row);
      return {
        ...parsedProject,
        downloadUrl: null,
        coverImage: normalizeDlcKitchenCoverImage(c, parsedProject.coverImage),
      };
    });
    publicResponse = { success: true, recommendations: projects };
      await caches.default.put(cacheRequest, new Response(JSON.stringify(publicResponse), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${DLC_KITCHEN_CACHE_TTL_SECONDS}`,
        },
      }));
    }

    const response = await applyDlcKitchenViewerLikes(c, publicResponse, currentUser?.userId);
    if (!currentUser?.isAdmin) return response;
    const mine = await c.env.DB.prepare(
      'SELECT project_id FROM devteam_recommendations WHERE curator_id = ?',
    ).bind(currentUser.userId).all<{ project_id: string }>();
    return { ...response, myRecommendedProjectIds: (mine.results || []).map(row => row.project_id) };
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
              comment: z.string().trim().max(500).optional(),
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
      `SELECT id, name FROM projects
       WHERE id = ? AND status = 'approved' AND is_published = 1 AND visibility = 1`,
    ).bind(data.params.projectId).first<{ id: string; name: string }>();
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
        data.body.comment ?? '',
        data.body.reactionLabel ?? null,
        data.body.reactionLabel ?? null,
      ),
      projectDb.prepareAdminAction(c, {
        action: 'editor_pick_saved', targetType: 'project', targetId: data.params.projectId,
        actorId: payload.userId, actorName: payload.globalName || payload.username,
        detail: { projectName: project.name },
      }),
      prepareDlcKitchenRevision(c, payload.userId),
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
    await c.env.DB.batch([
      c.env.DB.prepare(
        'DELETE FROM devteam_recommendations WHERE curator_id = ? AND project_id = ?',
      ).bind(payload.userId, data.params.projectId),
      projectDb.prepareAdminAction(c, {
        action: 'editor_pick_removed', targetType: 'project', targetId: data.params.projectId,
        actorId: payload.userId, actorName: payload.globalName || payload.username,
      }, true),
      prepareDlcKitchenRevision(c, payload.userId),
    ]);
    return { success: true };
  }
}
