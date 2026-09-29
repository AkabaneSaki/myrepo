import { OpenAPIRoute } from 'chanfana';
import { z } from 'zod';
import type { AppContext } from '../../types';
import { projectDb } from '../../utils/db';
import { getCurrentUserFromRequest } from '../../utils/jwt';

const REPAIR_RESOLVE_DAILY_LIMIT = 40;
const REPAIR_DAILY_LOCK_MESSAGE = '好啦別再点了喵！截图然后去DC找我吧喵！';

function normalizeRepairLookupName(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function getRepairResolveDayWindow(now = new Date()) {
  const dayKey = now.toISOString().slice(0, 10);
  const lockedUntil = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
  return { dayKey, lockedUntil };
}

async function hashRepairBudgetSubject(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function getRepairBudgetSubject(c: AppContext, userId?: string): Promise<string> {
  if (userId) return `user:${userId}`;
  const ip = String(c.req.header('cf-connecting-ip') || 'anonymous').trim();
  const secret = String(c.env.JWT_SECRET || 'creative-workshop');
  return `anon:${(await hashRepairBudgetSubject(`${secret}:${ip}`)).slice(0, 32)}`;
}

async function consumeRepairResolveDailyBudget(c: AppContext, userId?: string) {
  const { dayKey, lockedUntil } = getRepairResolveDayWindow();
  const subjectKey = await getRepairBudgetSubject(c, userId);
  const result = await c.env.DB.prepare(
    `
      INSERT INTO repair_resolve_daily_usage (subject_key, day_key, resolve_count, updated_at)
      VALUES (?1, ?2, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(subject_key, day_key) DO UPDATE SET
        resolve_count = repair_resolve_daily_usage.resolve_count + 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE repair_resolve_daily_usage.resolve_count < ?3
    `,
  )
    .bind(subjectKey, dayKey, REPAIR_RESOLVE_DAILY_LIMIT)
    .run();
  return {
    allowed: Number(result.meta?.changes || 0) > 0,
    lockedUntil,
  };
}

/**
 * Resolve up to 50 local DLC identities in one bounded request.
 * This endpoint intentionally never uses the public fuzzy-search query.
 */
export class ProjectRepairResolve extends OpenAPIRoute {
  schema = {
    tags: ['Projects'],
    summary: 'Resolve DLC Repair Candidates',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              candidates: z.array(z.object({
                candidateId: z.string().min(1).max(200),
                projectId: z.string().max(200).optional(),
                name: z.string().max(300).optional(),
              })).min(1).max(50),
            }),
          },
        },
      },
    },
    responses: {
      '200': { description: 'Returns exact repair identity matches' },
      '429': { description: 'Repair resolve daily budget exhausted' },
    },
  };

  async handle(c: AppContext) {
    const data = await this.getValidatedData<typeof this.schema>();
    const payload = await getCurrentUserFromRequest(c);
    const budget = await consumeRepairResolveDailyBudget(c, payload?.userId);
    if (!budget.allowed) {
      return c.json({
        error: REPAIR_DAILY_LOCK_MESSAGE,
        code: 'REPAIR_DAILY_LOCKED',
        lockedUntil: budget.lockedUntil,
      }, 429);
    }

    const candidates = data.body.candidates.slice(0, 50).map(candidate => ({
      candidateId: String(candidate.candidateId).trim(),
      projectId: String(candidate.projectId || '').trim(),
      normalizedName: normalizeRepairLookupName(candidate.name),
    }));
    const projectIds = candidates.map(candidate => candidate.projectId).filter(Boolean);
    const normalizedNames = candidates.map(candidate => candidate.normalizedName).filter(Boolean);
    const resolved = await projectDb.resolvePublicRepairCandidates(c, projectIds, normalizedNames);
    const safeById = resolved.byId.map(project => ({ ...project, downloadUrl: null }));
    const safeByName = resolved.byName.map(project => ({ ...project, downloadUrl: null }));

    const projectsById = new Map(safeById.map(project => [project.id, project]));
    const projectsByName = new Map<string, typeof safeByName>();
    for (const project of safeByName) {
      const key = normalizeRepairLookupName(project.name);
      const rows = projectsByName.get(key) || [];
      rows.push(project);
      projectsByName.set(key, rows);
    }

    const results = candidates.map(candidate => {
      const exactProject = candidate.projectId ? projectsById.get(candidate.projectId) : null;
      if (exactProject) {
        return { candidateId: candidate.candidateId, status: 'unique', method: 'project_id', projects: [exactProject] };
      }

      const nameMatches = candidate.normalizedName ? (projectsByName.get(candidate.normalizedName) || []) : [];
      if (nameMatches.length === 1) {
        return { candidateId: candidate.candidateId, status: 'unique', method: 'exact_name', projects: nameMatches };
      }
      if (nameMatches.length > 1) {
        return { candidateId: candidate.candidateId, status: 'ambiguous', method: 'exact_name', projects: nameMatches.slice(0, 8) };
      }
      return { candidateId: candidate.candidateId, status: 'none', method: 'exact_name', projects: [] };
    });

    return { success: true, results };
  }
}
