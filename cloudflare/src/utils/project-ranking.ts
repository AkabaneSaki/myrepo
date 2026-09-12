export const PLAYER_RATING_MIN_DOWNLOADS = 100;
export const DISCOVERY_BUCKET_HOURS = 12;
export const DISCOVERY_COOLDOWN_DAYS = 7;
export const DISCOVERY_FEATURED_COUNT = 12;
export const DISCOVERY_CANDIDATE_COUNT = 60;

export type ProjectRankingCandidate = {
  id: string;
  likesCount: number;
  downloadsCount: number;
  latestApprovedAt?: string | null;
};

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function approvedAtMs(project: ProjectRankingCandidate): number {
  const value = project.latestApprovedAt ? Date.parse(project.latestApprovedAt) : 0;
  return Number.isFinite(value) ? value : 0;
}

export function getPlayerRatingScore(project: ProjectRankingCandidate): number | null {
  const downloads = finiteNonNegative(project.downloadsCount);
  if (downloads < PLAYER_RATING_MIN_DOWNLOADS) return null;
  return finiteNonNegative(project.likesCount) / downloads;
}

export function rankPlayerRatedProjects(projects: ProjectRankingCandidate[]): ProjectRankingCandidate[] {
  return projects
    .map(project => ({ project, score: getPlayerRatingScore(project) }))
    .filter((entry): entry is { project: ProjectRankingCandidate; score: number } => entry.score !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const likeDelta = finiteNonNegative(b.project.likesCount) - finiteNonNegative(a.project.likesCount);
      if (likeDelta !== 0) return likeDelta;
      const dateDelta = approvedAtMs(b.project) - approvedAtMs(a.project);
      if (dateDelta !== 0) return dateDelta;
      return a.project.id.localeCompare(b.project.id);
    })
    .map(entry => entry.project);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function discoveryFreshnessBonus(project: ProjectRankingCandidate, nowMs: number): number {
  const publishedAt = approvedAtMs(project);
  if (!publishedAt) return 0;
  const ageDays = Math.max(0, (nowMs - publishedAt) / 86_400_000);
  if (ageDays <= 7) return 4;
  if (ageDays <= 30) return 2;
  if (ageDays <= 90) return 1;
  return 0;
}

function discoveryScore(project: ProjectRankingCandidate, nowMs: number): number {
  const quality = Math.sqrt(finiteNonNegative(project.likesCount) + 1);
  const bucket = Math.floor(nowMs / (DISCOVERY_BUCKET_HOURS * 60 * 60 * 1000));
  const jitter = (hashString(`${bucket}:${project.id}`) % 1000) / 4000;
  return quality + discoveryFreshnessBonus(project, nowMs) + jitter;
}

function compareDiscoveryBase(a: ProjectRankingCandidate, b: ProjectRankingCandidate, nowMs: number): number {
  const scoreDelta = discoveryScore(b, nowMs) - discoveryScore(a, nowMs);
  if (scoreDelta !== 0) return scoreDelta;

  const dateDelta = approvedAtMs(b) - approvedAtMs(a);
  if (dateDelta !== 0) return dateDelta;
  return a.id.localeCompare(b.id);
}

export function rankDiscoveryProjects(
  projects: ProjectRankingCandidate[],
  recentlyFeaturedAgeById: ReadonlyMap<string, number>,
  nowMs: number,
): ProjectRankingCandidate[] {
  const baseRanked = [...projects].sort((a, b) => compareDiscoveryBase(a, b, nowMs));
  const candidatePool = baseRanked.slice(0, DISCOVERY_CANDIDATE_COUNT);
  const remainder = baseRanked.slice(DISCOVERY_CANDIDATE_COUNT);

  candidatePool.sort((a, b) => {
    const aAge = recentlyFeaturedAgeById.get(a.id);
    const bAge = recentlyFeaturedAgeById.get(b.id);
    const aCooled = aAge !== undefined;
    const bCooled = bAge !== undefined;
    if (aCooled !== bCooled) return aCooled ? 1 : -1;
    if (aCooled && bCooled && aAge !== bAge) return bAge - aAge;
    return compareDiscoveryBase(a, b, nowMs);
  });

  return [...candidatePool, ...remainder];
}
