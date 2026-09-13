import type { AppContext } from '../types';
import { DISCOVERY_COOLDOWN_DAYS } from './project-ranking.ts';

const DAY_MS = 86_400_000;

export function getProjectRankingDay(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function getProjectRankingRetentionCutoffDay(rankingDay: string): string {
  const dayMs = Date.parse(`${rankingDay}T00:00:00.000Z`);
  if (!Number.isFinite(dayMs)) throw new Error(`Invalid ranking day: ${rankingDay}`);
  return getProjectRankingDay(dayMs - DISCOVERY_COOLDOWN_DAYS * DAY_MS);
}

/**
 * Daily rankings are immutable once published. Approval changes become visible
 * on the next daily board instead of forcing repeated full-board rebuilds.
 */
export async function invalidateCurrentDiscoveryRankingSnapshot(
  _c: AppContext,
  _nowMs = Date.now(),
): Promise<void> {
  return;
}

export async function pruneOldProjectRankingDays(c: AppContext, rankingDay: string): Promise<void> {
  const cutoffDay = getProjectRankingRetentionCutoffDay(rankingDay);
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM project_daily_rankings WHERE ranking_day < ?`).bind(cutoffDay),
    c.env.DB.prepare(`DELETE FROM project_ranking_days WHERE ranking_day < ?`).bind(cutoffDay),
  ]);
}
