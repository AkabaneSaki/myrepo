import type { AppContext } from '../types';
import {
  DISCOVERY_FEATURED_COUNT,
  rankDiscoveryProjects,
  rankPlayerRatedProjects,
  type ProjectRankingCandidate,
} from './project-ranking';
import {
  getProjectRankingDay,
  getProjectRankingRetentionCutoffDay,
} from './project-ranking-snapshots';

const DAY_MS = 86_400_000;
type RankingContext = Pick<AppContext, 'env'>;

type DailyRankingCandidate = ProjectRankingCandidate & {
  projectType: string;
};

type PersistedDailyRanking = {
  projectId: string;
  projectType: string;
  discoverRank: number;
  discoverTypeRank: number;
  ratingRank: number | null;
  ratingTypeRank: number | null;
};

function dayDistance(newerDay: string, olderDay: string): number {
  const newer = Date.parse(`${newerDay}T00:00:00.000Z`);
  const older = Date.parse(`${olderDay}T00:00:00.000Z`);
  if (!Number.isFinite(newer) || !Number.isFinite(older)) return 0;
  return Math.max(0, Math.round((newer - older) / DAY_MS));
}

function assignTypeRanks(ranked: DailyRankingCandidate[]): Map<string, number> {
  const nextRankByType = new Map<string, number>();
  const rankById = new Map<string, number>();
  for (const project of ranked) {
    const nextRank = (nextRankByType.get(project.projectType) || 0) + 1;
    nextRankByType.set(project.projectType, nextRank);
    rankById.set(project.id, nextRank);
  }
  return rankById;
}

async function latestReadyRankingDay(c: RankingContext, throughDay: string): Promise<string | null> {
  const cutoffDay = getProjectRankingRetentionCutoffDay(throughDay);
  const row = await c.env.DB.prepare(
    `SELECT ranking_day
     FROM project_ranking_days
     WHERE ranking_day >= ? AND ranking_day <= ?
     ORDER BY ranking_day DESC
     LIMIT 1`,
  )
    .bind(cutoffDay, throughDay)
    .first<{ ranking_day: string }>();
  return row?.ranking_day || null;
}

async function buildProjectRankingDay(c: RankingContext, rankingDay: string): Promise<void> {
  const candidatesResult = await c.env.DB.prepare(
    `SELECT id, project_type, likes_count, downloads_count, latest_approved_at
     FROM projects
     WHERE status = 'approved' AND is_published = 1 AND visibility = 1`,
  ).all<{
    id: string;
    project_type: string;
    likes_count: number | null;
    downloads_count: number | null;
    latest_approved_at: string | null;
  }>();

  const candidates: DailyRankingCandidate[] = (candidatesResult.results || []).map(row => ({
    id: String(row.id),
    projectType: String(row.project_type || ''),
    likesCount: Number(row.likes_count || 0),
    downloadsCount: Number(row.downloads_count || 0),
    latestApprovedAt: row.latest_approved_at,
  }));

  const cutoffDay = getProjectRankingRetentionCutoffDay(rankingDay);
  const recentFeatured = await c.env.DB.prepare(
    `SELECT ranking_day, project_id
     FROM project_daily_rankings
     WHERE ranking_day >= ? AND ranking_day < ? AND discover_rank <= ?
     ORDER BY ranking_day DESC, discover_rank ASC`,
  )
    .bind(cutoffDay, rankingDay, DISCOVERY_FEATURED_COUNT)
    .all<{ ranking_day: string; project_id: string }>();

  const recentlyFeaturedAgeById = new Map<string, number>();
  for (const row of recentFeatured.results || []) {
    if (!recentlyFeaturedAgeById.has(row.project_id)) {
      recentlyFeaturedAgeById.set(row.project_id, dayDistance(rankingDay, row.ranking_day));
    }
  }

  // Pin the discovery jitter to the UTC day boundary. Concurrent builders for
  // the same day therefore calculate the same ordering from the same inputs.
  const rankingNowMs = Date.parse(`${rankingDay}T00:00:00.000Z`);
  const discoverRanked = rankDiscoveryProjects(candidates, recentlyFeaturedAgeById, rankingNowMs) as DailyRankingCandidate[];
  const ratingRanked = rankPlayerRatedProjects(candidates) as DailyRankingCandidate[];

  const discoverRankById = new Map(discoverRanked.map((project, index) => [project.id, index + 1]));
  const discoverTypeRankById = assignTypeRanks(discoverRanked);
  const ratingRankById = new Map(ratingRanked.map((project, index) => [project.id, index + 1]));
  const ratingTypeRankById = assignTypeRanks(ratingRanked);

  const rows: PersistedDailyRanking[] = candidates.map(project => ({
    projectId: project.id,
    projectType: project.projectType,
    discoverRank: discoverRankById.get(project.id)!,
    discoverTypeRank: discoverTypeRankById.get(project.id)!,
    ratingRank: ratingRankById.get(project.id) ?? null,
    ratingTypeRank: ratingTypeRankById.get(project.id) ?? null,
  }));

  // D1 batch is atomic: retention cleanup, board rows, and the ready marker
  // commit together. A failed build leaves the previous complete board intact.
  const rowsJson = JSON.stringify(rows);
  const generatedAt = new Date().toISOString();
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM project_daily_rankings WHERE ranking_day < ?`).bind(cutoffDay),
    c.env.DB.prepare(`DELETE FROM project_ranking_days WHERE ranking_day < ?`).bind(cutoffDay),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO project_daily_rankings (
         ranking_day, project_id, project_type,
         discover_rank, discover_type_rank, rating_rank, rating_type_rank
       )
       SELECT ?,
              json_extract(value, '$.projectId'),
              json_extract(value, '$.projectType'),
              CAST(json_extract(value, '$.discoverRank') AS INTEGER),
              CAST(json_extract(value, '$.discoverTypeRank') AS INTEGER),
              CAST(json_extract(value, '$.ratingRank') AS INTEGER),
              CAST(json_extract(value, '$.ratingTypeRank') AS INTEGER)
       FROM json_each(?)`,
    ).bind(rankingDay, rowsJson),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO project_ranking_days (ranking_day, generated_at, project_count)
       VALUES (?, ?, ?)`,
    ).bind(rankingDay, generatedAt, rows.length),
  ]);
}

/** Read-only browse path: never calculates a ranking. */
export async function getReadyProjectRankingDay(c: RankingContext, nowMs = Date.now()): Promise<string | null> {
  return latestReadyRankingDay(c, getProjectRankingDay(nowMs));
}

/** Cron-only generator. Repeated calls are cheap once today's ready marker exists. */
export async function generateProjectRankingDay(c: RankingContext, nowMs = Date.now()): Promise<string> {
  const rankingDay = getProjectRankingDay(nowMs);
  const existing = await c.env.DB.prepare(
    `SELECT ranking_day FROM project_ranking_days WHERE ranking_day = ?`,
  )
    .bind(rankingDay)
    .first<{ ranking_day: string }>();
  if (existing?.ranking_day) return existing.ranking_day;

  await buildProjectRankingDay(c, rankingDay);
  const ready = await c.env.DB.prepare(
    `SELECT ranking_day FROM project_ranking_days WHERE ranking_day = ?`,
  )
    .bind(rankingDay)
    .first<{ ranking_day: string }>();
  if (!ready?.ranking_day) throw new Error(`Ranking day ${rankingDay} was not published`);
  return ready.ranking_day;
}
