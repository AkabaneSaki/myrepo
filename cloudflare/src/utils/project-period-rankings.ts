import type { AppContext } from '../types';

type RankingContext = Pick<AppContext, 'env'>;
export const PERIOD_SORT_MODES = ['downloads7', 'downloads30', 'likes7', 'likes30'] as const;
export type PeriodSortMode = typeof PERIOD_SORT_MODES[number];

export type PeriodRankEntry = { id: string; type: string; score: number };
type PeriodBoards = Record<PeriodSortMode, PeriodRankEntry[]>;

const MAX_ACTIVITY_ROWS = 20_000;
const MAX_RANKED_PROJECTS = 1_000;
const DAY_MS = 86_400_000;

export function isPeriodSortMode(value: string): value is PeriodSortMode {
  return (PERIOD_SORT_MODES as readonly string[]).includes(value);
}

function utcDay(nowMs: number, dayOffset: number): string {
  return new Date(Math.floor(nowMs / DAY_MS) * DAY_MS + dayOffset * DAY_MS).toISOString().slice(0, 10);
}

export function buildPeriodBoards(
  activity: Array<{ day_key: string; project_id: string; downloads_count: number; likes_added: number; likes_removed: number }>,
  projects: Array<{ id: string; project_type: string }>,
  nowMs = Date.now(),
): PeriodBoards {
  const sevenDayStart = utcDay(nowMs, -7);
  const thirtyDayStart = utcDay(nowMs, -30);
  const allowedTypes = new Map(projects.map(project => [project.id, project.project_type]));
  const totals = new Map<string, { downloads7: number; downloads30: number; likes7: number; likes30: number }>();

  for (const row of activity) {
    if (row.day_key < thirtyDayStart || row.day_key >= utcDay(nowMs, 0)) continue;
    if (!allowedTypes.has(row.project_id)) continue;
    const current = totals.get(row.project_id) || { downloads7: 0, downloads30: 0, likes7: 0, likes30: 0 };
    const downloads = Math.max(0, Number(row.downloads_count || 0));
    const netLikes = Number(row.likes_added || 0) - Number(row.likes_removed || 0);
    current.downloads30 += downloads;
    current.likes30 += netLikes;
    if (row.day_key >= sevenDayStart) {
      current.downloads7 += downloads;
      current.likes7 += netLikes;
    }
    totals.set(row.project_id, current);
  }

  const boards = {} as PeriodBoards;
  for (const kind of PERIOD_SORT_MODES) {
    boards[kind] = [...totals.entries()]
      .filter(([, value]) => value[kind] > 0)
      .map(([id, value]) => ({ id, type: allowedTypes.get(id)!, score: value[kind] }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, MAX_RANKED_PROJECTS);
  }
  return boards;
}

export async function readPeriodBoard(c: RankingContext, kind: PeriodSortMode): Promise<PeriodRankEntry[]> {
  const snapshot = await c.env.DB.prepare(
    'SELECT board_json FROM project_period_rank_snapshots ORDER BY period_end_day DESC LIMIT 1',
  ).first<{ board_json: string }>();
  if (!snapshot) return [];
  const payload = JSON.parse(snapshot.board_json) as Partial<PeriodBoards> | null;
  const board = payload?.[kind];
  if (!Array.isArray(board) || board.length > MAX_RANKED_PROJECTS ||
    !board.every(entry => entry && typeof entry.id === 'string' &&
      typeof entry.type === 'string' && Number.isFinite(entry.score) && entry.score > 0)) {
    throw new Error('Invalid period ranking snapshot');
  }
  return board;
}

/** Called only by the separate once-daily cron. Never on a browse request. */
export async function generatePeriodBoards(c: RankingContext, nowMs = Date.now()): Promise<string | null> {
  const endDay = utcDay(nowMs, -1);
  const existing = await c.env.DB.prepare(
    'SELECT 1 AS built FROM project_period_rank_snapshots WHERE period_end_day = ?',
  ).bind(endDay).first();
  if (existing) return endDay;

  const activityResult = await c.env.DB.prepare(
    `SELECT day_key, project_id, downloads_count, likes_added, likes_removed
       FROM project_daily_interactions
       WHERE day_key BETWEEN ? AND ?
       ORDER BY day_key DESC
       LIMIT ?`,
  ).bind(utcDay(nowMs, -30), endDay, MAX_ACTIVITY_ROWS + 1)
    .all<{ day_key: string; project_id: string; downloads_count: number; likes_added: number; likes_removed: number }>();
  const activity = activityResult.results || [];
  if (activity.length > MAX_ACTIVITY_ROWS) {
    // Publishing an incomplete board is worse than leaving the previous day's.
    console.warn('Period ranking build skipped: activity row budget exceeded');
    return null;
  }

  const projectsResult = await c.env.DB.prepare(
    `SELECT id, project_type FROM projects
     WHERE status = 'approved' AND is_published = 1 AND visibility = 1`,
  ).all<{ id: string; project_type: string }>();
  const boards = buildPeriodBoards(activity, projectsResult.results || [], nowMs);
  await c.env.DB.prepare(
    `INSERT OR IGNORE INTO project_period_rank_snapshots (period_end_day, board_json, built_at)
     VALUES (?, ?, ?)`,
  ).bind(endDay, JSON.stringify(boards), new Date(nowMs).toISOString()).run();
  // Keep a short fallback history only; detailed activity remains intact.
  await c.env.DB.prepare(
    'DELETE FROM project_period_rank_snapshots WHERE period_end_day < ?',
  ).bind(utcDay(nowMs, -8)).run();
  return endDay;
}
