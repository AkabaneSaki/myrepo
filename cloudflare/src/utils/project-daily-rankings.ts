import type { AppContext } from '../types';

const ROTATION_HOURS = 6;
const ROTATION_MS = ROTATION_HOURS * 60 * 60 * 1000;
const UTC8_OFFSET_MS = 8 * 60 * 60 * 1000;
const UTC8_FIRST_SLOT_HOUR = 4;
const DISCOVERY_PICK_COUNT = 10;
const HISTORY_SLOTS = 28; // 7 days * 4 rotations/day
const STALE_BUILD_MS = 30 * 60_000;

type RankingContext = Pick<AppContext, 'env'>;

type DiscoveryCandidate = {
  id: string;
  authorId: string;
  projectType: string;
};

type PersistedDiscoveryPick = {
  projectId: string;
  projectType: string;
  discoverRank: number;
  discoverTypeRank: number;
};

export type ReadyProjectRankingBoard = {
  rankingDay: string;
  projectCount: number;
  typeCounts: Record<string, number>;
};

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

function buildTypeCounts(candidates: DiscoveryCandidate[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const project of candidates) counts[project.projectType] = (counts[project.projectType] || 0) + 1;
  return counts;
}

function assignTypeRanks(ranked: DiscoveryCandidate[]): Map<string, number> {
  const nextRankByType = new Map<string, number>();
  const rankById = new Map<string, number>();
  for (const project of ranked) {
    const nextRank = (nextRankByType.get(project.projectType) || 0) + 1;
    nextRankByType.set(project.projectType, nextRank);
    rankById.set(project.id, nextRank);
  }
  return rankById;
}

function hash32(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function deterministicUnit(seed: string): number {
  return (hash32(seed) + 1) / 4_294_967_297;
}

export function getDiscoveryRotationKey(nowMs = Date.now()): string {
  const utc8Ms = nowMs + UTC8_OFFSET_MS;
  const shifted = utc8Ms - UTC8_FIRST_SLOT_HOUR * 60 * 60 * 1000;
  const slotLocalMs = Math.floor(shifted / ROTATION_MS) * ROTATION_MS
    + UTC8_FIRST_SLOT_HOUR * 60 * 60 * 1000;
  return new Date(slotLocalMs).toISOString().slice(0, 13);
}

function shiftRotation(rotationKey: string, slotDelta: number): string {
  const base = Date.parse(`${rotationKey}:00:00.000Z`);
  if (!Number.isFinite(base)) throw new Error(`Invalid discovery rotation key: ${rotationKey}`);
  return new Date(base + slotDelta * ROTATION_MS).toISOString().slice(0, 13);
}

function rotationDistance(newerKey: string, olderKey: string): number | null {
  const newer = Date.parse(`${newerKey}:00:00.000Z`);
  const older = Date.parse(`${olderKey}:00:00.000Z`);
  if (!Number.isFinite(newer) || !Number.isFinite(older)) return null;
  return Math.max(0, Math.round((newer - older) / ROTATION_MS));
}

function pickWeightedDiscovery(
  candidates: DiscoveryCandidate[],
  exposureHistory: Map<string, string[]>,
  rotationKey: string,
): DiscoveryCandidate[] {
  return candidates
    .map((project, originalIndex) => {
      const history = exposureHistory.get(project.id) || [];
      let recentExposure = 0;
      for (const historyKey of history) {
        const age = rotationDistance(rotationKey, historyKey);
        if (age === null || age <= 0 || age > HISTORY_SLOTS) continue;
        recentExposure += Math.exp(-(age - 1) / 4);
      }
      const weight = 1 / (1 + 3 * recentExposure);
      const unit = deterministicUnit(`${rotationKey}:${project.id}`);
      return {
        project,
        originalIndex,
        key: -Math.log(unit) / weight,
      };
    })
    .sort((a, b) => a.key - b.key || a.originalIndex - b.originalIndex)
    .slice(0, DISCOVERY_PICK_COUNT)
    .map(entry => entry.project);
}

export async function getReadyProjectRankingBoard(
  c: RankingContext,
  nowMs = Date.now(),
): Promise<ReadyProjectRankingBoard | null> {
  const throughRotation = getDiscoveryRotationKey(nowMs);
  const fallbackCutoff = shiftRotation(throughRotation, -HISTORY_SLOTS);
  const row = await c.env.DB.prepare(
    `SELECT ranking_day, project_count, type_counts
     FROM project_ranking_builds
     WHERE status = 'complete'
       AND ranking_day >= ?
       AND ranking_day <= ?
       AND ranking_day LIKE '____-__-__T__'
     ORDER BY ranking_day DESC
     LIMIT 1`,
  )
    .bind(fallbackCutoff, throughRotation)
    .first<{ ranking_day: string; project_count: number; type_counts: string }>();

  if (!row?.ranking_day) return null;
  return {
    rankingDay: row.ranking_day,
    projectCount: Number(row.project_count || 0),
    typeCounts: parseTypeCounts(row.type_counts),
  };
}

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

async function buildDiscoveryRotation(
  c: RankingContext,
  rotationKey: string,
  buildToken: string,
  nowMs: number,
): Promise<void> {
  const candidatesResult = await c.env.DB.prepare(
    `SELECT id, author_id, project_type
     FROM projects
     WHERE status = 'approved' AND is_published = 1 AND visibility = 1`,
  ).all<{ id: string; author_id: string; project_type: string }>();

  const candidates: DiscoveryCandidate[] = (candidatesResult.results || []).map(row => ({
    id: String(row.id),
    authorId: String(row.author_id || ''),
    projectType: String(row.project_type || ''),
  }));

  const historyCutoff = shiftRotation(rotationKey, -HISTORY_SLOTS);
  const recentFeatured = await c.env.DB.prepare(
    `SELECT ranking_day, project_id
     FROM discovery_feature_history
     WHERE ranking_day >= ? AND ranking_day < ?
     ORDER BY ranking_day DESC, featured_rank ASC`,
  )
    .bind(historyCutoff, rotationKey)
    .all<{ ranking_day: string; project_id: string }>();

  const exposureHistory = new Map<string, string[]>();
  for (const row of recentFeatured.results || []) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(String(row.ranking_day || ''))) continue;
    const history = exposureHistory.get(row.project_id) || [];
    history.push(row.ranking_day);
    exposureHistory.set(row.project_id, history);
  }

  const selected = pickWeightedDiscovery(candidates, exposureHistory, rotationKey);
  const typeRankById = assignTypeRanks(selected);
  const rows: PersistedDiscoveryPick[] = selected.map((project, index) => ({
    projectId: project.id,
    projectType: project.projectType,
    discoverRank: index + 1,
    discoverTypeRank: typeRankById.get(project.id)!,
  }));
  const typeCounts = buildTypeCounts(selected);
  const rowsJson = JSON.stringify(rows);
  const completedAt = new Date(nowMs).toISOString();

  await c.env.DB.batch([
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
              NULL,
              NULL
       FROM json_each(?)
       WHERE EXISTS (
         SELECT 1 FROM project_ranking_builds
         WHERE ranking_day = ? AND status = 'building' AND build_token = ?
       )`,
    ).bind(rotationKey, rowsJson, rotationKey, buildToken),
    c.env.DB.prepare(
      `INSERT INTO discovery_feature_history (ranking_day, project_id, featured_rank)
       SELECT ?, json_extract(value, '$.projectId'), CAST(json_extract(value, '$.discoverRank') AS INTEGER)
       FROM json_each(?)
       WHERE EXISTS (
         SELECT 1 FROM project_ranking_builds
         WHERE ranking_day = ? AND status = 'building' AND build_token = ?
       )`,
    ).bind(rotationKey, rowsJson, rotationKey, buildToken),
    c.env.DB.prepare(
      `UPDATE project_ranking_builds
       SET status = 'complete', project_count = ?, type_counts = ?, completed_at = ?
       WHERE ranking_day = ? AND status = 'building' AND build_token = ?`,
    ).bind(rows.length, JSON.stringify(typeCounts), completedAt, rotationKey, buildToken),
  ]);

  const published = await c.env.DB.prepare(
    `SELECT status, project_count
     FROM project_ranking_builds
     WHERE ranking_day = ? AND build_token = ?`,
  )
    .bind(rotationKey, buildToken)
    .first<{ status: string; project_count: number }>();

  if (published?.status !== 'complete' || Number(published.project_count) !== rows.length) {
    throw new Error(`Discovery rotation ${rotationKey} was not published atomically`);
  }

  const retentionCutoff = shiftRotation(rotationKey, -HISTORY_SLOTS);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM project_daily_rankings WHERE ranking_day < ?').bind(retentionCutoff),
    c.env.DB.prepare('DELETE FROM project_ranking_builds WHERE ranking_day < ?').bind(retentionCutoff),
    c.env.DB.prepare('DELETE FROM discovery_feature_history WHERE ranking_day < ?').bind(retentionCutoff),
  ]);
}

export async function generateProjectRankingDay(c: RankingContext, nowMs = Date.now()): Promise<string> {
  const rotationKey = getDiscoveryRotationKey(nowMs);
  const claim = await claimRankingBuild(c, rotationKey, nowMs);
  if (claim.alreadyComplete) return rotationKey;
  if (!claim.buildToken) return (await getReadyProjectRankingDay(c, nowMs)) || rotationKey;
  await buildDiscoveryRotation(c, rotationKey, claim.buildToken, nowMs);
  return rotationKey;
}
