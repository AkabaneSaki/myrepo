import type { AppContext } from '../types';
import {
  DISCOVERY_COOLDOWN_DAYS,
  DISCOVERY_FEATURED_COUNT,
  rankDiscoveryProjects,
  rankPlayerRatedProjects,
  type ProjectRankingCandidate,
} from './project-ranking';
import { getProjectRankingDay } from './project-ranking-snapshots';

const DAY_MS = 86_400_000;
const STALE_BUILD_MS = 30 * 60_000;
type RankingContext = Pick<AppContext, 'env'>;

type DailyRankingCandidate = ProjectRankingCandidate & {
  projectType: string;
  authorId: string;
};

type PersistedDailyRanking = {
  projectId: string;
  projectType: string;
  discoverRank: number;
  discoverTypeRank: number;
  ratingRank: number;
  ratingTypeRank: number;
};

export type ReadyProjectRankingBoard = {
  rankingDay: string;
  projectCount: number;
  typeCounts: Record<string, number>;
};

function shiftDay(rankingDay: string, dayDelta: number): string {
  const dayMs = Date.parse(`${rankingDay}T00:00:00.000Z`);
  if (!Number.isFinite(dayMs)) throw new Error(`Invalid ranking day: ${rankingDay}`);
  return getProjectRankingDay(dayMs + dayDelta * DAY_MS);
}

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

function parseTypeCounts(value: string | null | undefined): Record<string, number> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result: Record<string, number> = {};
    for (const [key, count] of Object.entries(parsed as Record<string, unknown>)) {
      const numericCount = Number(count);
      if (Number.isInteger(numericCount) && numericCount >= 0) result[key] = numericCount;
    }
    return result;
  } catch {
    return {};
  }
}

export async function getReadyProjectRankingBoard(
  c: RankingContext,
  nowMs = Date.now(),
): Promise<ReadyProjectRankingBoard | null> {
  const throughDay = getProjectRankingDay(nowMs);
  const fallbackCutoffDay = shiftDay(throughDay, -1);
  const row = await c.env.DB.prepare(
    `SELECT ranking_day, project_count, type_counts
     FROM project_ranking_builds
     WHERE status = 'complete' AND ranking_day >= ? AND ranking_day <= ?
     ORDER BY ranking_day DESC
     LIMIT 1`,
  )
    .bind(fallbackCutoffDay, throughDay)
    .first<{ ranking_day: string; project_count: number; type_counts: string }>();
  if (!row?.ranking_day) return null;
  return {
    rankingDay: row.ranking_day,
    projectCount: Number(row.project_count || 0),
    typeCounts: parseTypeCounts(row.type_counts),
  };
}

/** Read-only browse helper retained for callers that only need the day key. */
export async function getReadyProjectRankingDay(c: RankingContext, nowMs = Date.now()): Promise<string | null> {
  return (await getReadyProjectRankingBoard(c, nowMs))?.rankingDay || null;
}

async function claimRankingBuild(
  c: RankingContext,
  rankingDay: string,
  nowMs: number,
): Promise<{ buildToken: string | null; alreadyComplete: boolean }> {
  const staleBefore = new Date(nowMs - STALE_BUILD_MS).toISOString();
  const startedAt = new Date(nowMs).toISOString();
  const buildToken = crypto.randomUUID();
  const current = await c.env.DB.prepare(
    `SELECT status, started_at
     FROM project_ranking_builds
     WHERE ranking_day = ?`,
  )
    .bind(rankingDay)
    .first<{ status: 'building' | 'complete'; started_at: string }>();

  if (current?.status === 'complete') return { buildToken: null, alreadyComplete: true };
  if (current?.status === 'building' && current.started_at >= staleBefore) {
    return { buildToken: null, alreadyComplete: false };
  }

  if (current?.status === 'building') {
    // Reclaim a stale build with one conditional update. Only the invocation whose
    // token wins may clear stale rows, so a losing cron cannot erase a new builder.
    await c.env.DB.prepare(
      `UPDATE project_ranking_builds
       SET started_at = ?, completed_at = NULL, build_token = ?, project_count = 0, type_counts = '{}'
       WHERE ranking_day = ? AND status = 'building' AND started_at < ?`,
    )
      .bind(startedAt, buildToken, rankingDay, staleBefore)
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT OR IGNORE INTO project_ranking_builds (
         ranking_day, status, project_count, type_counts, started_at, completed_at, build_token
       ) VALUES (?, 'building', 0, '{}', ?, NULL, ?)`,
    )
      .bind(rankingDay, startedAt, buildToken)
      .run();
  }

  const claimed = await c.env.DB.prepare(
    `SELECT status, build_token
     FROM project_ranking_builds
     WHERE ranking_day = ?`,
  )
    .bind(rankingDay)
    .first<{ status: 'building' | 'complete'; build_token: string }>();
  if (claimed?.status === 'complete') return { buildToken: null, alreadyComplete: true };
  if (claimed?.build_token !== buildToken) return { buildToken: null, alreadyComplete: false };

  await c.env.DB.batch([
    c.env.DB.prepare(
      `DELETE FROM project_daily_rankings
       WHERE ranking_day = ?
         AND EXISTS (
           SELECT 1 FROM project_ranking_builds
           WHERE ranking_day = ? AND status = 'building' AND build_token = ?
         )`,
    ).bind(rankingDay, rankingDay, buildToken),
    c.env.DB.prepare(
      `DELETE FROM discovery_feature_history
       WHERE ranking_day = ?
         AND EXISTS (
           SELECT 1 FROM project_ranking_builds
           WHERE ranking_day = ? AND status = 'building' AND build_token = ?
         )`,
    ).bind(rankingDay, rankingDay, buildToken),
  ]);
  return { buildToken, alreadyComplete: false };
}

function buildTypeCounts(candidates: DailyRankingCandidate[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const project of candidates) counts[project.projectType] = (counts[project.projectType] || 0) + 1;
  return counts;
}

async function validateRankingRows(
  c: RankingContext,
  rankingDay: string,
  expectedCount: number,
  expectedTypeCounts: Record<string, number>,
): Promise<void> {
  const global = await c.env.DB.prepare(
    `SELECT
       COUNT(*) AS row_count,
       MIN(discover_rank) AS min_discover,
       MAX(discover_rank) AS max_discover,
       COUNT(DISTINCT discover_rank) AS distinct_discover,
       MIN(rating_rank) AS min_rating,
       MAX(rating_rank) AS max_rating,
       COUNT(DISTINCT rating_rank) AS distinct_rating
     FROM project_daily_rankings
     WHERE ranking_day = ?`,
  )
    .bind(rankingDay)
    .first<Record<string, number | null>>();

  const rowCount = Number(global?.row_count || 0);
  if (rowCount !== expectedCount) {
    throw new Error(`Ranking day ${rankingDay} row count ${rowCount} != ${expectedCount}`);
  }
  if (expectedCount > 0) {
    if (
      Number(global?.min_discover) !== 1
      || Number(global?.max_discover) !== expectedCount
      || Number(global?.distinct_discover) !== expectedCount
      || Number(global?.min_rating) !== 1
      || Number(global?.max_rating) !== expectedCount
      || Number(global?.distinct_rating) !== expectedCount
    ) {
      throw new Error(`Ranking day ${rankingDay} global ranks are not contiguous and unique`);
    }
  }

  const typeRows = await c.env.DB.prepare(
    `SELECT
       project_type,
       COUNT(*) AS row_count,
       MIN(discover_type_rank) AS min_discover,
       MAX(discover_type_rank) AS max_discover,
       COUNT(DISTINCT discover_type_rank) AS distinct_discover,
       MIN(rating_type_rank) AS min_rating,
       MAX(rating_type_rank) AS max_rating,
       COUNT(DISTINCT rating_type_rank) AS distinct_rating
     FROM project_daily_rankings
     WHERE ranking_day = ?
     GROUP BY project_type`,
  )
    .bind(rankingDay)
    .all<Record<string, string | number | null>>();

  const seenTypes = new Set<string>();
  for (const row of typeRows.results || []) {
    const projectType = String(row.project_type || '');
    const expected = expectedTypeCounts[projectType] || 0;
    seenTypes.add(projectType);
    if (
      Number(row.row_count) !== expected
      || (expected > 0 && (
        Number(row.min_discover) !== 1
        || Number(row.max_discover) !== expected
        || Number(row.distinct_discover) !== expected
        || Number(row.min_rating) !== 1
        || Number(row.max_rating) !== expected
        || Number(row.distinct_rating) !== expected
      ))
    ) {
      throw new Error(`Ranking day ${rankingDay} type ${projectType} ranks are invalid`);
    }
  }
  for (const projectType of Object.keys(expectedTypeCounts)) {
    if (!seenTypes.has(projectType)) throw new Error(`Ranking day ${rankingDay} missing type ${projectType}`);
  }
}

async function buildProjectRankingDay(
  c: RankingContext,
  rankingDay: string,
  buildToken: string,
  nowMs: number,
): Promise<void> {
  const candidatesResult = await c.env.DB.prepare(
    `SELECT id, author_id, project_type, likes_count, downloads_count, latest_approved_at
     FROM projects
     WHERE status = 'approved' AND is_published = 1 AND visibility = 1`,
  ).all<{
    id: string;
    author_id: string;
    project_type: string;
    likes_count: number | null;
    downloads_count: number | null;
    latest_approved_at: string | null;
  }>();

  const candidates: DailyRankingCandidate[] = (candidatesResult.results || []).map(row => ({
    id: String(row.id),
    authorId: String(row.author_id || ''),
    projectType: String(row.project_type || ''),
    likesCount: Number(row.likes_count || 0),
    downloadsCount: Number(row.downloads_count || 0),
    latestApprovedAt: row.latest_approved_at,
  }));

  const historyCutoffDay = shiftDay(rankingDay, -DISCOVERY_COOLDOWN_DAYS);
  const recentFeatured = await c.env.DB.prepare(
    `SELECT ranking_day, project_id
     FROM discovery_feature_history
     WHERE ranking_day >= ? AND ranking_day < ?
     ORDER BY ranking_day DESC, featured_rank ASC`,
  )
    .bind(historyCutoffDay, rankingDay)
    .all<{ ranking_day: string; project_id: string }>();

  const exposureHistory = new Map<string, number[]>();
  for (const row of recentFeatured.results || []) {
    const age = dayDistance(rankingDay, row.ranking_day);
    const ages = exposureHistory.get(row.project_id) || [];
    ages.push(age);
    exposureHistory.set(row.project_id, ages);
  }

  const rankingNowMs = Date.parse(`${rankingDay}T00:00:00.000Z`);
  const discoverRanked = rankDiscoveryProjects(candidates, exposureHistory, rankingNowMs) as DailyRankingCandidate[];
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
    ratingRank: ratingRankById.get(project.id)!,
    ratingTypeRank: ratingTypeRankById.get(project.id)!,
  }));
  const typeCounts = buildTypeCounts(candidates);
  const rowsJson = JSON.stringify(rows);

  // Writing rows while the build marker is `building` is safe: browse queries only
  // resolve boards whose marker is `complete`.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `DELETE FROM project_daily_rankings
       WHERE ranking_day = ?
         AND EXISTS (
           SELECT 1 FROM project_ranking_builds
           WHERE ranking_day = ? AND status = 'building' AND build_token = ?
         )`,
    ).bind(rankingDay, rankingDay, buildToken),
    c.env.DB.prepare(
      `INSERT INTO project_daily_rankings (
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
       FROM json_each(?)
       WHERE EXISTS (
         SELECT 1 FROM project_ranking_builds
         WHERE ranking_day = ? AND status = 'building' AND build_token = ?
       )`,
    ).bind(rankingDay, rowsJson, rankingDay, buildToken),
  ]);

  await validateRankingRows(c, rankingDay, rows.length, typeCounts);

  const featuredJson = JSON.stringify(
    discoverRanked.slice(0, Math.min(DISCOVERY_FEATURED_COUNT, discoverRanked.length)).map((project, index) => ({
      projectId: project.id,
      featuredRank: index + 1,
    })),
  );
  const completedAt = new Date(nowMs).toISOString();
  const fullRankingCutoffDay = shiftDay(rankingDay, -1);

  // D1 batch is transactional. The complete marker becomes visible atomically with
  // feature history and retention cleanup; failed publication leaves the old board live.
  await c.env.DB.batch([
    c.env.DB.prepare(
      `DELETE FROM discovery_feature_history
       WHERE ranking_day = ?
         AND EXISTS (
           SELECT 1 FROM project_ranking_builds
           WHERE ranking_day = ? AND status = 'building' AND build_token = ?
         )`,
    ).bind(rankingDay, rankingDay, buildToken),
    c.env.DB.prepare(
      `INSERT INTO discovery_feature_history (ranking_day, project_id, featured_rank)
       SELECT ?, json_extract(value, '$.projectId'), CAST(json_extract(value, '$.featuredRank') AS INTEGER)
       FROM json_each(?)
       WHERE EXISTS (
         SELECT 1 FROM project_ranking_builds
         WHERE ranking_day = ? AND status = 'building' AND build_token = ?
       )`,
    ).bind(rankingDay, featuredJson, rankingDay, buildToken),
    c.env.DB.prepare(
      `UPDATE project_ranking_builds
       SET status = 'complete', project_count = ?, type_counts = ?, completed_at = ?
       WHERE ranking_day = ? AND status = 'building' AND build_token = ?`,
    ).bind(rows.length, JSON.stringify(typeCounts), completedAt, rankingDay, buildToken),
    c.env.DB.prepare(
      `DELETE FROM project_daily_rankings
       WHERE ranking_day < ?
         AND EXISTS (
           SELECT 1 FROM project_ranking_builds current_build
           WHERE current_build.ranking_day = ? AND current_build.status = 'complete' AND current_build.build_token = ?
         )`,
    ).bind(fullRankingCutoffDay, rankingDay, buildToken),
    c.env.DB.prepare(
      `DELETE FROM project_ranking_builds
       WHERE ranking_day < ?
         AND EXISTS (
           SELECT 1 FROM project_ranking_builds current_build
           WHERE current_build.ranking_day = ? AND current_build.status = 'complete' AND current_build.build_token = ?
         )`,
    ).bind(fullRankingCutoffDay, rankingDay, buildToken),
    c.env.DB.prepare(
      `DELETE FROM discovery_feature_history
       WHERE ranking_day < ?
         AND EXISTS (
           SELECT 1 FROM project_ranking_builds current_build
           WHERE current_build.ranking_day = ? AND current_build.status = 'complete' AND current_build.build_token = ?
         )`,
    ).bind(historyCutoffDay, rankingDay, buildToken),
  ]);

  const published = await c.env.DB.prepare(
    `SELECT status, project_count
     FROM project_ranking_builds
     WHERE ranking_day = ? AND build_token = ?`,
  )
    .bind(rankingDay, buildToken)
    .first<{ status: string; project_count: number }>();
  if (published?.status !== 'complete' || Number(published.project_count) !== rows.length) {
    throw new Error(`Ranking day ${rankingDay} was not published atomically`);
  }
}

/** Cron-only generator. Request paths never calculate or repair a ranking. */
export async function generateProjectRankingDay(c: RankingContext, nowMs = Date.now()): Promise<string> {
  const rankingDay = getProjectRankingDay(nowMs);
  const claim = await claimRankingBuild(c, rankingDay, nowMs);
  if (claim.alreadyComplete) return rankingDay;
  if (!claim.buildToken) {
    // Another scheduled invocation owns today's build. Do not duplicate O(N) work.
    return (await getReadyProjectRankingDay(c, nowMs)) || rankingDay;
  }

  await buildProjectRankingDay(c, rankingDay, claim.buildToken, nowMs);
  return rankingDay;
}
