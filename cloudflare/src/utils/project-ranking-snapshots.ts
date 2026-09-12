import type { AppContext } from '../types';
import { DISCOVERY_BUCKET_HOURS, DISCOVERY_COOLDOWN_DAYS } from './project-ranking.ts';

export function getProjectRankingBucket(nowMs = Date.now()): number {
  return Math.floor(nowMs / (DISCOVERY_BUCKET_HOURS * 60 * 60 * 1000));
}

export function getProjectRankingRetentionCutoffBucket(bucket: number): number {
  const retainedBucketCount = Math.ceil((DISCOVERY_COOLDOWN_DAYS * 24) / DISCOVERY_BUCKET_HOURS);
  return bucket - retainedBucketCount;
}

export async function invalidateCurrentDiscoveryRankingSnapshot(
  c: AppContext,
  nowMs = Date.now(),
): Promise<void> {
  const bucket = getProjectRankingBucket(nowMs);
  await c.env.DB.prepare(
    `DELETE FROM project_rank_snapshots
     WHERE kind = 'discover' AND bucket = ?`,
  )
    .bind(bucket)
    .run();
}

export async function pruneOldProjectRankingSnapshots(c: AppContext, bucket: number): Promise<void> {
  await c.env.DB.prepare(
    `DELETE FROM project_rank_snapshots
     WHERE bucket < ?`,
  )
    .bind(getProjectRankingRetentionCutoffBucket(bucket))
    .run();
}
