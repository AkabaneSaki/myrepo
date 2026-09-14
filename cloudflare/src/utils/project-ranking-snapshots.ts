import type { AppContext } from '../types';
import {
  DISCOVERY_BUCKET_HOURS,
  DISCOVERY_COOLDOWN_DAYS,
  DISCOVERY_FEATURED_COUNT,
  rankDiscoveryProjects,
  rankPlayerRatedProjects,
  type ProjectRankingCandidate,
} from './project-ranking.ts';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

type RankingContext = Pick<AppContext, 'env'>;
export type ProjectRankingSnapshotKind = 'discover' | 'rating';

type SnapshotCandidate = ProjectRankingCandidate & {
  projectType: string;
};

export type ProjectRankingSnapshotPayload = {
  version: 1 | 2;
  all: string[];
  byType: Record<string, string[]>;
  featured: string[];
};

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item || '')).filter(Boolean);
}

export function parseProjectRankingSnapshot(value: string | null | undefined): ProjectRankingSnapshotPayload | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      const all = normalizeIdList(parsed);
      return { version: 1, all, byType: {}, featured: all.slice(0, DISCOVERY_FEATURED_COUNT) };
    }
    if (!parsed || typeof parsed !== 'object') return null;

    const source = parsed as Record<string, unknown>;
    const all = normalizeIdList(source.all);
    const byTypeSource = source.byType && typeof source.byType === 'object'
      ? source.byType as Record<string, unknown>
      : {};
    const byType: Record<string, string[]> = {};
    for (const [projectType, ids] of Object.entries(byTypeSource)) {
      byType[projectType] = normalizeIdList(ids);
    }
    return {
      version: 2,
      all,
      byType,
      featured: normalizeIdList(source.featured).slice(0, DISCOVERY_FEATURED_COUNT),
    };
  } catch {
    return null;
  }
}

function makeSnapshotPayload(ranked: SnapshotCandidate[], includeFeatured: boolean): ProjectRankingSnapshotPayload {
  const all = ranked.map(project => project.id);
  const byType: Record<string, string[]> = {};
  for (const project of ranked) {
    const projectType = project.projectType || '';
    if (!byType[projectType]) byType[projectType] = [];
    byType[projectType].push(project.id);
  }
  return {
    version: 2,
    all,
    byType,
    featured: includeFeatured ? all.slice(0, DISCOVERY_FEATURED_COUNT) : [],
  };
}

export function getProjectRankingDay(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function getProjectRankingRetentionCutoffDay(rankingDay: string): string {
  const dayMs = Date.parse(`${rankingDay}T00:00:00.000Z`);
  if (!Number.isFinite(dayMs)) throw new Error(`Invalid ranking day: ${rankingDay}`);
  return getProjectRankingDay(dayMs - DISCOVERY_COOLDOWN_DAYS * DAY_MS);
}

export function getProjectRankingBucket(nowMs = Date.now()): number {
  return Math.floor(nowMs / HOUR_MS);
}

export function getProjectRankingRetentionCutoffBucket(bucket: number): number {
  return bucket - DISCOVERY_COOLDOWN_DAYS * 24;
}

export async function getProjectRankingSnapshotIds(
  c: RankingContext,
  kind: ProjectRankingSnapshotKind,
  projectType?: string,
  nowMs = Date.now(),
): Promise<string[] | null> {
  const bucket = getProjectRankingBucket(nowMs);
  const cutoffBucket = getProjectRankingRetentionCutoffBucket(bucket);
  const row = await c.env.DB.prepare(
    `SELECT project_ids
     FROM project_rank_snapshots
     WHERE kind = ? AND bucket >= ? AND bucket <= ?
     ORDER BY bucket DESC
     LIMIT 1`,
  )
    .bind(kind, cutoffBucket, bucket)
    .first<{ project_ids: string }>();
  const payload = parseProjectRankingSnapshot(row?.project_ids);
  if (!payload) return null;
  if (projectType) {
    if (payload.version < 2) return null;
    return payload.byType[projectType] ?? null;
  }
  return payload.all;
}

/**
 * Request-time mutations never rebuild ranking snapshots. The hourly cron pays
 * the bounded precomputation cost once so browse requests only read one snapshot
 * row plus the small page of project rows they actually render.
 */
export async function invalidateCurrentDiscoveryRankingSnapshot(
  _c: AppContext,
  _nowMs = Date.now(),
): Promise<void> {
  return;
}

export async function pruneOldProjectRankingSnapshots(c: RankingContext, bucket: number): Promise<void> {
  await c.env.DB.prepare(`DELETE FROM project_rank_snapshots WHERE bucket < ?`)
    .bind(getProjectRankingRetentionCutoffBucket(bucket))
    .run();
}

/** Retained for the older daily-ranking migration/test helpers. */
export async function pruneOldProjectRankingDays(c: AppContext, rankingDay: string): Promise<void> {
  const cutoffDay = getProjectRankingRetentionCutoffDay(rankingDay);
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM project_daily_rankings WHERE ranking_day < ?`).bind(cutoffDay),
    c.env.DB.prepare(`DELETE FROM project_ranking_days WHERE ranking_day < ?`).bind(cutoffDay),
  ]);
}

/** Build both public ranking snapshots at most once per UTC hour. */
export async function generateProjectRankingSnapshots(c: RankingContext, nowMs = Date.now()): Promise<number> {
  const bucket = getProjectRankingBucket(nowMs);
  const existing = await c.env.DB.prepare(
    `SELECT kind FROM project_rank_snapshots
     WHERE bucket = ? AND kind IN ('discover', 'rating')`,
  )
    .bind(bucket)
    .all<{ kind: ProjectRankingSnapshotKind }>();
  const existingKinds = new Set((existing.results || []).map(row => row.kind));
  if (existingKinds.has('discover') && existingKinds.has('rating')) return bucket;

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
  const candidates: SnapshotCandidate[] = (candidatesResult.results || []).map(row => ({
    id: String(row.id),
    projectType: String(row.project_type || ''),
    likesCount: Number(row.likes_count || 0),
    downloadsCount: Number(row.downloads_count || 0),
    latestApprovedAt: row.latest_approved_at,
  }));

  const cutoffBucket = getProjectRankingRetentionCutoffBucket(bucket);
  const recentFeatured = await c.env.DB.prepare(
    `SELECT bucket, project_ids
     FROM project_rank_snapshots
     WHERE kind = 'discover' AND bucket >= ? AND bucket < ?
     ORDER BY bucket DESC`,
  )
    .bind(cutoffBucket, bucket)
    .all<{ bucket: number; project_ids: string }>();
  const recentlyFeaturedAgeById = new Map<string, number>();
  const currentFeatureWindow = Math.floor(bucket / DISCOVERY_BUCKET_HOURS);
  const seenFeatureWindows = new Set<number>();
  for (const row of recentFeatured.results || []) {
    const featureWindow = Math.floor(Number(row.bucket) / DISCOVERY_BUCKET_HOURS);
    // Hourly snapshots refresh ranking inputs, but discovery cooldown keeps the
    // original 12-hour feature cadence. Only the latest completed snapshot from
    // each 12-hour window contributes featured IDs.
    if (featureWindow >= currentFeatureWindow || seenFeatureWindows.has(featureWindow)) continue;
    seenFeatureWindows.add(featureWindow);
    const ids = parseProjectRankingSnapshot(row.project_ids)?.featured || [];
    for (const projectId of ids) {
      if (!recentlyFeaturedAgeById.has(projectId)) {
        recentlyFeaturedAgeById.set(projectId, currentFeatureWindow - featureWindow);
      }
    }
  }

  const discoverRanked = rankDiscoveryProjects(candidates, recentlyFeaturedAgeById, nowMs) as SnapshotCandidate[];
  const ratingRanked = rankPlayerRatedProjects(candidates) as SnapshotCandidate[];
  const generatedAt = new Date(nowMs).toISOString();
  const discoverPayload = JSON.stringify(makeSnapshotPayload(discoverRanked, true));
  const ratingPayload = JSON.stringify(makeSnapshotPayload(ratingRanked, false));

  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM project_rank_snapshots WHERE bucket < ?`).bind(cutoffBucket),
    c.env.DB.prepare(
      `INSERT OR REPLACE INTO project_rank_snapshots (kind, bucket, project_ids, generated_at)
       VALUES ('discover', ?, ?, ?)`,
    ).bind(bucket, discoverPayload, generatedAt),
    c.env.DB.prepare(
      `INSERT OR REPLACE INTO project_rank_snapshots (kind, bucket, project_ids, generated_at)
       VALUES ('rating', ?, ?, ?)`,
    ).bind(bucket, ratingPayload, generatedAt),
  ]);

  const ready = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM project_rank_snapshots
     WHERE bucket = ? AND kind IN ('discover', 'rating')`,
  )
    .bind(bucket)
    .first<{ count: number }>();
  if (Number(ready?.count || 0) !== 2) throw new Error(`Ranking bucket ${bucket} was not fully published`);
  return bucket;
}
