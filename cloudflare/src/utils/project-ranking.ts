export const PLAYER_RATING_BAYESIAN_K = 100;
// Kept for the retired JSON-snapshot helper/tests until that compatibility code is removed.
export const DISCOVERY_BUCKET_HOURS = 12;
export const DISCOVERY_COOLDOWN_DAYS = 7;
export const DISCOVERY_FEATURED_COUNT = 12;
export const DISCOVERY_CANDIDATE_COUNT = 60;

export type ProjectRankingCandidate = {
  id: string;
  authorId?: string | null;
  likesCount: number;
  downloadsCount: number;
  latestApprovedAt?: string | null;
};

type RankingMetrics = {
  project: ProjectRankingCandidate;
  quality: number;
  freshness: number;
  underexposure: number;
};

export type DiscoveryExposureHistory = ReadonlyMap<string, number | readonly number[]>;

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function approvedAtMs(project: ProjectRankingCandidate): number {
  const value = project.latestApprovedAt ? Date.parse(project.latestApprovedAt) : 0;
  return Number.isFinite(value) ? value : 0;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function percentileById(
  projects: ProjectRankingCandidate[],
  valueOf: (project: ProjectRankingCandidate) => number,
): Map<string, number> {
  if (projects.length === 0) return new Map();
  if (projects.length === 1) return new Map([[projects[0].id, 1]]);

  const sorted = projects
    .map(project => ({ project, value: valueOf(project) }))
    .sort((a, b) => a.value - b.value || a.project.id.localeCompare(b.project.id));
  const result = new Map<string, number>();
  const denominator = sorted.length - 1;

  for (let start = 0; start < sorted.length;) {
    let end = start;
    while (end + 1 < sorted.length && sorted[end + 1].value === sorted[start].value) end += 1;
    const percentile = ((start + end) / 2) / denominator;
    for (let index = start; index <= end; index += 1) {
      result.set(sorted[index].project.id, percentile);
    }
    start = end + 1;
  }

  return result;
}

export function getGlobalLikeRate(projects: ProjectRankingCandidate[]): number {
  const totals = projects.reduce(
    (acc, project) => {
      acc.likes += finiteNonNegative(project.likesCount);
      acc.downloads += finiteNonNegative(project.downloadsCount);
      return acc;
    },
    { likes: 0, downloads: 0 },
  );
  return totals.downloads > 0 ? totals.likes / totals.downloads : 0;
}

/** Bayesian-smoothed like rate. Every published project receives a score. */
export function getPlayerRatingScore(
  project: ProjectRankingCandidate,
  globalLikeRate = 0,
): number {
  const likes = finiteNonNegative(project.likesCount);
  const downloads = finiteNonNegative(project.downloadsCount);
  return (likes + PLAYER_RATING_BAYESIAN_K * finiteNonNegative(globalLikeRate))
    / (downloads + PLAYER_RATING_BAYESIAN_K);
}

function buildRankingMetrics(projects: ProjectRankingCandidate[], nowMs: number): RankingMetrics[] {
  const globalLikeRate = getGlobalLikeRate(projects);
  const smoothedRatePercentile = percentileById(
    projects,
    project => getPlayerRatingScore(project, globalLikeRate),
  );
  const likesPercentile = percentileById(projects, project => Math.log1p(finiteNonNegative(project.likesCount)));
  const downloadsPercentile = percentileById(projects, project => Math.log1p(finiteNonNegative(project.downloadsCount)));

  return projects.map(project => ({
    project,
    quality:
      0.85 * (smoothedRatePercentile.get(project.id) ?? 0)
      + 0.15 * (likesPercentile.get(project.id) ?? 0),
    freshness: discoveryFreshness(project, nowMs),
    underexposure: 1 - (downloadsPercentile.get(project.id) ?? 0),
  }));
}

function compareQuality(a: RankingMetrics, b: RankingMetrics): number {
  if (b.quality !== a.quality) return b.quality - a.quality;
  const likeDelta = finiteNonNegative(b.project.likesCount) - finiteNonNegative(a.project.likesCount);
  if (likeDelta !== 0) return likeDelta;
  const dateDelta = approvedAtMs(b.project) - approvedAtMs(a.project);
  if (dateDelta !== 0) return dateDelta;
  return a.project.id.localeCompare(b.project.id);
}

export function rankPlayerRatedProjects(projects: ProjectRankingCandidate[]): ProjectRankingCandidate[] {
  return buildRankingMetrics(projects, Date.now())
    .sort(compareQuality)
    .map(entry => entry.project);
}

function discoveryFreshness(project: ProjectRankingCandidate, nowMs: number): number {
  const publishedAt = approvedAtMs(project);
  if (!publishedAt) return 0;
  const ageDays = Math.max(0, (nowMs - publishedAt) / 86_400_000);
  if (ageDays <= 7) return 1;
  if (ageDays <= 30) return 0.7;
  if (ageDays <= 90) return 0.4;
  if (ageDays <= 180) return 0.2;
  return 0;
}

function dailyJitter(projectId: string, nowMs: number): number {
  const rankingDay = new Date(nowMs).toISOString().slice(0, 10);
  return hashString(`${rankingDay}:${projectId}`) / 0xffffffff;
}

function recentExposurePenalty(projectId: string, history: DiscoveryExposureHistory): number {
  const raw = history.get(projectId);
  if (raw === undefined) return 0;
  const ages = (Array.isArray(raw) ? raw : [raw])
    .map(Number)
    .filter(age => Number.isFinite(age) && age >= 1 && age <= DISCOVERY_COOLDOWN_DAYS);
  const count = ages.length;
  if (count >= 4) return 0.65;
  if (count >= 3) return 0.5;
  if (count >= 2) return 0.35;
  if (ages.includes(1)) return 0.2;
  return 0;
}

function discoveryDailyScore(entry: RankingMetrics, history: DiscoveryExposureHistory, nowMs: number): number {
  return 0.72 * entry.quality
    + 0.12 * entry.freshness
    + 0.10 * entry.underexposure
    + 0.06 * dailyJitter(entry.project.id, nowMs)
    - recentExposurePenalty(entry.project.id, history);
}

function discoveryTailScore(entry: RankingMetrics, nowMs: number): number {
  return 0.80 * entry.quality
    + 0.10 * entry.freshness
    + 0.07 * entry.underexposure
    + 0.03 * dailyJitter(entry.project.id, nowMs);
}

function authorKey(project: ProjectRankingCandidate): string {
  return project.authorId ? `author:${project.authorId}` : `project:${project.id}`;
}

function canEnterFeatured(entry: RankingMetrics): boolean {
  if (entry.quality < 0.55) return false;
  if (finiteNonNegative(entry.project.downloadsCount) >= 30) return true;
  return finiteNonNegative(entry.project.likesCount) >= 5 && entry.quality >= 0.70;
}

export function rankDiscoveryProjects(
  projects: ProjectRankingCandidate[],
  recentExposureHistory: DiscoveryExposureHistory,
  nowMs: number,
): ProjectRankingCandidate[] {
  const metrics = buildRankingMetrics(projects, nowMs);
  const qualityPool = [...metrics].sort(compareQuality).slice(0, DISCOVERY_CANDIDATE_COUNT);
  const eligible = qualityPool
    .filter(canEnterFeatured)
    .sort((a, b) => {
      const scoreDelta = discoveryDailyScore(b, recentExposureHistory, nowMs)
        - discoveryDailyScore(a, recentExposureHistory, nowMs);
      return scoreDelta || compareQuality(a, b);
    });

  const featured: RankingMetrics[] = [];
  const selectedIds = new Set<string>();
  const authorCounts = new Map<string, number>();

  const select = (entry: RankingMetrics) => {
    featured.push(entry);
    selectedIds.add(entry.project.id);
    const key = authorKey(entry.project);
    authorCounts.set(key, (authorCounts.get(key) || 0) + 1);
  };

  // Front six prefer six different creators. If that is impossible, relax to the
  // hard Top-12 limit of at most two projects per creator.
  for (const entry of eligible) {
    if (featured.length >= Math.min(6, DISCOVERY_FEATURED_COUNT)) break;
    if ((authorCounts.get(authorKey(entry.project)) || 0) === 0) select(entry);
  }
  for (const entry of eligible) {
    if (featured.length >= Math.min(6, DISCOVERY_FEATURED_COUNT)) break;
    if (selectedIds.has(entry.project.id)) continue;
    if ((authorCounts.get(authorKey(entry.project)) || 0) < 2) select(entry);
  }
  for (const entry of eligible) {
    if (featured.length >= DISCOVERY_FEATURED_COUNT) break;
    if (selectedIds.has(entry.project.id)) continue;
    if ((authorCounts.get(authorKey(entry.project)) || 0) < 2) select(entry);
  }

  const tail = metrics
    .filter(entry => !selectedIds.has(entry.project.id))
    .sort((a, b) => {
      const scoreDelta = discoveryTailScore(b, nowMs) - discoveryTailScore(a, nowMs);
      return scoreDelta || compareQuality(a, b);
    });

  return [...featured, ...tail].map(entry => entry.project);
}
