import type { AppContext } from '../types';

const DAY_MS = 86_400_000;
export const PERIOD_POPULARITY_SORTS = ['downloads_7d', 'downloads_30d', 'likes_7d', 'likes_30d'] as const;
export type PeriodPopularitySort = (typeof PERIOD_POPULARITY_SORTS)[number];

export function isPeriodPopularitySort(value: string): value is PeriodPopularitySort {
  return (PERIOD_POPULARITY_SORTS as readonly string[]).includes(value);
}

type MetricRow = { project_id: string; downloads7: number; downloads30: number; likes7: number; likes30: number };

/** Four snapshot rows, built by cron rather than on every public browse request. */
export async function generatePeriodPopularitySnapshots(
  c: Pick<AppContext, 'env'>,
  nowMs = Date.now(),
): Promise<void> {
  const day = (offset: number) => new Date(nowMs - offset * DAY_MS).toISOString().slice(0, 10);
  const sevenDaysAgo = day(6);
  const thirtyDaysAgo = day(29);
  const result = await c.env.DB.prepare(
    'SELECT m.project_id, ' +
    'SUM(CASE WHEN m.day_key >= ? THEN m.downloads ELSE 0 END) AS downloads7, ' +
    'SUM(m.downloads) AS downloads30, ' +
    'SUM(CASE WHEN m.day_key >= ? THEN m.likes_delta ELSE 0 END) AS likes7, ' +
    'SUM(m.likes_delta) AS likes30 ' +
    'FROM project_metric_daily m JOIN projects p ON p.id = m.project_id ' +
    "WHERE m.day_key >= ? AND p.status = 'approved' AND p.is_published = 1 AND p.visibility = 1 " +
    'GROUP BY m.project_id',
  ).bind(sevenDaysAgo, sevenDaysAgo, thirtyDaysAgo).all<MetricRow>();
  const rows = result.results || [];
  const specs: { sort: PeriodPopularitySort; key: keyof Omit<MetricRow, 'project_id'> }[] = [
    { sort: 'downloads_7d', key: 'downloads7' },
    { sort: 'downloads_30d', key: 'downloads30' },
    { sort: 'likes_7d', key: 'likes7' },
    { sort: 'likes_30d', key: 'likes30' },
  ];
  const generatedAt = new Date(nowMs).toISOString();
  const statements = specs.map(({ sort, key }) => {
    const ids = rows.filter(row => Number(row[key] || 0) > 0)
      .sort((a, b) => Number(b[key] || 0) - Number(a[key] || 0) || a.project_id.localeCompare(b.project_id))
      .map(row => row.project_id);
    return c.env.DB.prepare(
      'INSERT OR REPLACE INTO project_period_popularity (sort_mode, project_ids, generated_at) VALUES (?, ?, ?)',
    ).bind(sort, JSON.stringify(ids), generatedAt);
  });
  statements.push(c.env.DB.prepare('DELETE FROM project_metric_daily WHERE day_key < ?').bind(thirtyDaysAgo));
  await c.env.DB.batch(statements);
}

/** A public sort reads one small snapshot row, never raw daily counters. */
export async function getPeriodPopularityIds(
  c: Pick<AppContext, 'env'>, sort: PeriodPopularitySort,
): Promise<string[]> {
  const snapshot = await c.env.DB.prepare(
    'SELECT project_ids FROM project_period_popularity WHERE sort_mode = ?',
  ).bind(sort).first<{ project_ids: string }>();
  if (!snapshot) return [];
  try {
    const ids: unknown = JSON.parse(snapshot.project_ids);
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
