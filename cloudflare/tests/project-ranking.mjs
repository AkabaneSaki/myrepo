import assert from 'node:assert/strict';
import {
  DISCOVERY_FEATURED_COUNT,
  PLAYER_RATING_BAYESIAN_K,
  getGlobalLikeRate,
  getPlayerRatingScore,
  rankDiscoveryProjects,
  rankPlayerRatedProjects,
} from '../src/utils/project-ranking.ts';

const project = (id, likesCount, downloadsCount, latestApprovedAt, authorId = `author-${id}`) => ({
  id,
  authorId,
  likesCount,
  downloadsCount,
  latestApprovedAt,
});

{
  assert.equal(PLAYER_RATING_BAYESIAN_K, 100);
  const sample = [
    project('tiny', 1, 1, '2026-09-12T00:00:00Z'),
    project('established', 9, 99, '2026-09-01T00:00:00Z'),
  ];
  const globalLikeRate = getGlobalLikeRate(sample);
  assert.equal(globalLikeRate, 0.1);
  assert.ok(Math.abs(getPlayerRatingScore(sample[0], globalLikeRate) - 11 / 101) < 1e-12);
  assert.ok(Math.abs(getPlayerRatingScore(sample[1], globalLikeRate) - 19 / 199) < 1e-12);
}

{
  const candidates = [
    project('perfect-at-200', 200, 200, '2026-09-01T00:00:00Z'),
    project('diluted-at-300', 204, 300, '2026-09-01T00:00:00Z'),
    project('one-of-one', 1, 1, '2026-09-12T00:00:00Z'),
    project('zero-sample', 0, 0, '2026-09-12T00:00:00Z'),
  ];
  const ranked = rankPlayerRatedProjects(candidates);
  assert.equal(ranked.length, candidates.length, 'every published project must receive a rating rank');
  assert.equal(ranked[0].id, 'perfect-at-200', 'a trusted high-satisfaction project should lead this sample');
  assert.notEqual(ranked[0].id, 'one-of-one', '1/1 must not jump to the top from a 100% raw rate');
  assert.ok(ranked.some(item => item.id === 'zero-sample'), 'zero-sample projects still receive a Bayesian rank');
}

{
  const now = Date.parse('2026-09-15T00:00:00Z');
  const tiedHigh = Array.from({ length: 20 }, (_, index) =>
    project(`tied-${index}`, 20, 200, '2026-09-10T00:00:00Z', `creator-${index}`),
  );
  const lowBaseline = Array.from({ length: 20 }, (_, index) =>
    project(`baseline-${index}`, 0, 1000, '2026-01-01T00:00:00Z', `baseline-creator-${index}`),
  );
  const candidates = [...tiedHigh, ...lowBaseline];
  const first = rankDiscoveryProjects(candidates, new Map(), now);
  const second = rankDiscoveryProjects(candidates, new Map(), now);
  assert.deepEqual(first.map(item => item.id), second.map(item => item.id), 'one UTC day must have deterministic discovery order');

  const cooled = rankDiscoveryProjects(candidates, new Map([[first[0].id, [1]]]), now);
  assert.notEqual(cooled[0].id, first[0].id, 'yesterday exposure should rotate otherwise-equal qualified candidates');
  assert.equal(cooled.length, candidates.length, 'cooldown must never ban a project from the complete board');
}

{
  const now = Date.parse('2026-09-15T00:00:00Z');
  const candidates = Array.from({ length: 36 }, (_, index) =>
    project(
      `quality-${index}`,
      Math.max(1, 80 - index),
      120 + index * 3,
      index < 18 ? '2026-09-10T00:00:00Z' : '2026-07-01T00:00:00Z',
      `creator-${Math.floor(index / 3)}`,
    ),
  );
  candidates.push(project('low-quality-outsider', 0, 5000, '2025-01-01T00:00:00Z', 'creator-outsider'));

  const ranked = rankDiscoveryProjects(candidates, new Map(), now);
  assert.equal(ranked.length, candidates.length, 'all visible published projects must remain in the complete discovery board');
  assert.ok(
    ranked.findIndex(item => item.id === 'low-quality-outsider') >= DISCOVERY_FEATURED_COUNT,
    'quality floor must keep an obvious low-quality outsider out of the featured Top 12',
  );

  const top12 = ranked.slice(0, DISCOVERY_FEATURED_COUNT);
  const authorCounts = new Map();
  for (const item of top12) authorCounts.set(item.authorId, (authorCounts.get(item.authorId) || 0) + 1);
  assert.ok([...authorCounts.values()].every(count => count <= 2), 'Top 12 must cap one creator at two projects');
  assert.equal(new Set(ranked.slice(0, 6).map(item => item.authorId)).size, 6, 'Top 6 should prefer distinct creators when enough exist');
}

console.log('project ranking OK');
