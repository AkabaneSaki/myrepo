import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import type { AppContext } from '../../types';
import { getCurrentUserFromRequest } from '../../utils/jwt';
import { PROJECT_TYPES } from '../../config/project-taxonomy';

const DAILY_DRAW_LIMIT = 10;
const RECENT_DRAW_LIMIT = 20;
const MAX_LOCAL_EXCLUSIONS = 500;
const MAX_DISCOVER_EXCLUSIONS = 20;
const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAILY_RESET_HOUR = 5;

type DailyRandomDrawStateRow = {
  draw_day: string;
  daily_count: number;
  recent_project_ids: string;
};

function getDailyDrawDay(nowMs = Date.now()): string {
  const shifted = nowMs + UTC8_OFFSET_MS - DAILY_RESET_HOUR * 60 * 60 * 1000;
  return new Date(shifted).toISOString().slice(0, 10);
}

function getNextDailyDrawResetAt(nowMs = Date.now()): string {
  const utc8Now = new Date(nowMs + UTC8_OFFSET_MS);
  let resetLocalMs = Date.UTC(
    utc8Now.getUTCFullYear(),
    utc8Now.getUTCMonth(),
    utc8Now.getUTCDate(),
    DAILY_RESET_HOUR,
  );
  if (utc8Now.getUTCHours() >= DAILY_RESET_HOUR) resetLocalMs += 24 * 60 * 60 * 1000;
  return new Date(resetLocalMs - UTC8_OFFSET_MS).toISOString();
}

function normalizeProjectIds(values: unknown, limit: number): string[] {
  if (!Array.isArray(values)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const id = String(value || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= limit) break;
  }
  return result;
}

function parseRecentProjectIds(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    return normalizeProjectIds(JSON.parse(value), RECENT_DRAW_LIMIT);
  } catch {
    return [];
  }
}

async function readDailyRandomDrawState(c: AppContext, userId: string) {
  return c.env.DB.prepare(
    `SELECT draw_day, daily_count, recent_project_ids
     FROM daily_random_draw_state
     WHERE user_id = ?
     LIMIT 1`,
  )
    .bind(userId)
    .first<DailyRandomDrawStateRow>();
}

function buildDailyDrawStatus(row: DailyRandomDrawStateRow | null, nowMs = Date.now()) {
  const drawDay = getDailyDrawDay(nowMs);
  const count = row?.draw_day === drawDay
    ? Math.min(DAILY_DRAW_LIMIT, Math.max(0, Number(row.daily_count || 0)))
    : 0;
  return {
    drawDay,
    count,
    limit: DAILY_DRAW_LIMIT,
    remaining: Math.max(0, DAILY_DRAW_LIMIT - count),
    resetAt: getNextDailyDrawResetAt(nowMs),
    recentProjectIds: parseRecentProjectIds(row?.recent_project_ids),
  };
}

function makeRandomProjectPivot(): string {
  return crypto.randomUUID();
}

async function findRandomProjectFromPivot(
  c: AppContext,
  pivot: string,
  excludedProjectIds: string[],
  projectType?: string,
): Promise<string | null> {
  const excludedJson = JSON.stringify(excludedProjectIds);
  const indexName = projectType ? 'idx_projects_public_type_id' : 'idx_projects_public_id';
  const typeFilter = projectType ? 'AND p.project_type = ?' : '';
  const bindValues = projectType ? [projectType, pivot, excludedJson] : [pivot, excludedJson];
  const afterPivot = await c.env.DB.prepare(
    `SELECT p.id
     FROM projects p INDEXED BY ${indexName}
     WHERE p.status = 'approved'
       AND p.is_published = 1
       AND p.visibility = 1
       ${typeFilter}
       AND p.id >= ?
       AND NOT EXISTS (
         SELECT 1
         FROM json_each(?) excluded
         WHERE excluded.value = p.id
       )
     ORDER BY p.id ASC
     LIMIT 1`,
  )
    .bind(...bindValues)
    .first<{ id: string }>();
  if (afterPivot?.id) return String(afterPivot.id);

  const wrapped = await c.env.DB.prepare(
    `SELECT p.id
     FROM projects p INDEXED BY ${indexName}
     WHERE p.status = 'approved'
       AND p.is_published = 1
       AND p.visibility = 1
       ${typeFilter}
       AND p.id < ?
       AND NOT EXISTS (
         SELECT 1
         FROM json_each(?) excluded
         WHERE excluded.value = p.id
       )
     ORDER BY p.id ASC
     LIMIT 1`,
  )
    .bind(...bindValues)
    .first<{ id: string }>();
  return wrapped?.id ? String(wrapped.id) : null;
}

export class ProjectDailyRandomDrawState extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Get Daily Random Draw State',
    responses: {
      '200': { description: 'Returns daily draw state' },
      '401': { description: 'Discord login required' },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload) return c.json({ error: '请先 Discord 登录' }, 401);

    const row = await readDailyRandomDrawState(c, payload.userId);
    const status = buildDailyDrawStatus(row || null);
    return {
      success: true,
      count: status.count,
      limit: status.limit,
      remaining: status.remaining,
      drawDay: status.drawDay,
      resetAt: status.resetAt,
    };
  }
}

export class ProjectDailyRandomDraw extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Draw One Random Discoverable Project',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              installedProjectIds: z.array(z.string().min(1).max(200)).max(MAX_LOCAL_EXCLUSIONS).default([]),
              discoverProjectIds: z.array(z.string().min(1).max(200)).max(MAX_DISCOVER_EXCLUSIONS).default([]),
              projectType: z.enum(PROJECT_TYPES).optional(),
            }),
          },
        },
      },
    },
    responses: {
      '200': { description: 'Returns one random project id' },
      '401': { description: 'Discord login required' },
      '409': { description: 'No candidate or draw state changed concurrently' },
      '429': { description: 'Daily draw limit reached' },
    },
  };

  async handle(c: AppContext) {
    const payload = await getCurrentUserFromRequest(c);
    if (!payload) return c.json({ error: '请先 Discord 登录' }, 401);

    const data = await this.getValidatedData<typeof this.schema>();
    const installedProjectIds = normalizeProjectIds(data.body.installedProjectIds, MAX_LOCAL_EXCLUSIONS);
    const discoverProjectIds = normalizeProjectIds(data.body.discoverProjectIds, MAX_DISCOVER_EXCLUSIONS);
    const projectType = data.body.projectType;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const nowMs = Date.now();
      const nowIso = new Date(nowMs).toISOString();
      const row = await readDailyRandomDrawState(c, payload.userId);
      const status = buildDailyDrawStatus(row || null, nowMs);

      if (status.count >= DAILY_DRAW_LIMIT) {
        return c.json({
          error: '今天的 10 次抽卡已经用完啦',
          code: 'DAILY_DRAW_LIMIT',
          count: status.count,
          limit: status.limit,
          remaining: 0,
          drawDay: status.drawDay,
          resetAt: status.resetAt,
        }, 429);
      }

      const excludedProjectIds = normalizeProjectIds(
        [...installedProjectIds, ...discoverProjectIds, ...status.recentProjectIds],
        MAX_LOCAL_EXCLUSIONS + MAX_DISCOVER_EXCLUSIONS + RECENT_DRAW_LIMIT,
      );
      const projectId = await findRandomProjectFromPivot(c, makeRandomProjectPivot(), excludedProjectIds, projectType);
      if (!projectId) {
        return c.json({
          error: '暂时没有新的项目可以抽了',
          code: 'NO_RANDOM_DRAW_CANDIDATE',
          count: status.count,
          limit: status.limit,
          remaining: status.remaining,
          drawDay: status.drawDay,
          resetAt: status.resetAt,
        }, 409);
      }

      const nextRecentProjectIds = normalizeProjectIds(
        [...status.recentProjectIds.filter(id => id !== projectId), projectId],
        RECENT_DRAW_LIMIT + 1,
      ).slice(-RECENT_DRAW_LIMIT);
      const nextCount = status.count + 1;
      const nextRecentJson = JSON.stringify(nextRecentProjectIds);

      let writeResult;
      if (!row) {
        writeResult = await c.env.DB.prepare(
          `INSERT OR IGNORE INTO daily_random_draw_state (
             user_id, draw_day, daily_count, recent_project_ids, updated_at
           ) VALUES (?, ?, ?, ?, ?)`,
        )
          .bind(payload.userId, status.drawDay, nextCount, nextRecentJson, nowIso)
          .run();
      } else {
        writeResult = await c.env.DB.prepare(
          `UPDATE daily_random_draw_state
           SET draw_day = ?, daily_count = ?, recent_project_ids = ?, updated_at = ?
           WHERE user_id = ?
             AND draw_day = ?
             AND daily_count = ?
             AND recent_project_ids = ?`,
        )
          .bind(
            status.drawDay,
            nextCount,
            nextRecentJson,
            nowIso,
            payload.userId,
            row.draw_day,
            Number(row.daily_count || 0),
            row.recent_project_ids || '[]',
          )
          .run();
      }

      if (Number(writeResult.meta?.changes || 0) !== 1) continue;

      return {
        success: true,
        projectId,
        count: nextCount,
        limit: DAILY_DRAW_LIMIT,
        remaining: Math.max(0, DAILY_DRAW_LIMIT - nextCount),
        drawDay: status.drawDay,
        resetAt: status.resetAt,
      };
    }

    return c.json({
      error: '刚刚已经抽过一次了，请再按一次',
      code: 'DAILY_DRAW_RETRY',
    }, 409);
  }
}
