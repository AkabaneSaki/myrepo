import assert from 'node:assert/strict';
import {
  DISCOVERY_CANDIDATE_COUNT,
  PLAYER_RATING_MIN_DOWNLOADS,
  getPlayerRatingScore,
  rankDiscoveryProjects,
  rankPlayerRatedProjects,
} from '../src/utils/project-ranking.ts';

const project = (id, likesCount, downloadsCount, latestApprovedAt) => ({
  id,
  likesCount,
  downloadsCount,
  latestApprovedAt,
});

{
  assert.equal(PLAYER_RATING_MIN_DOWNLOADS, 100);
  assert.equal(getPlayerRatingScore(project('tiny', 1, 1, '2026-09-12T00:00:00Z')), null);
  assert.equal(getPlayerRatingScore(project('eligible', 5, 100, '2026-09-12T00:00:00Z')), 0.05);
}

{
  const perfectAt200 = getPlayerRatingScore(project('before', 200, 200, '2026-09-12T00:00:00Z'));
  const dilutedAt300 = getPlayerRatingScore(project('after', 204, 300, '2026-09-12T00:00:00Z'));
  assert.equal(perfectAt200, 1);
  assert.equal(dilutedAt300, 0.68);
  assert.ok(dilutedAt300 < perfectAt200, 'downloads growing faster than likes must reduce the rating score');
}

{
  const ranked = rankPlayerRatedProjects([
    project('72-of-5939', 72, 5939, '2026-09-01T00:00:00Z'),
    project('67-of-4826', 67, 4826, '2026-09-01T00:00:00Z'),
    project('14-of-664', 14, 664, '2026-09-01T00:00:00Z'),
    project('20-of-928', 20, 928, '2026-09-01T00:00:00Z'),
    project('1-of-1', 1, 1, '2026-09-12T00:00:00Z'),
  ]);

  assert.deepEqual(ranked.map(item => item.id), [
    '20-of-928',
    '14-of-664',
    '67-of-4826',
    '72-of-5939',
  ]);
}

{
  const now = Date.parse('2026-09-13T00:00:00Z');
  const candidates = [
    project('old-popular', 72, 5939, '2026-05-01T00:00:00Z'),
    project('fresh-liked', 14, 664, '2026-09-10T00:00:00Z'),
    project('fresh-small', 4, 120, '2026-09-12T00:00:00Z'),
  ];

  const first = rankDiscoveryProjects(candidates, new Map(), now);
  const second = rankDiscoveryProjects(candidates, new Map(), now);
  assert.deepEqual(first.map(item => item.id), second.map(item => item.id), 'one discovery bucket must be deterministic');

  const cooled = rankDiscoveryProjects(candidates, new Map([[first[0].id, 0]]), now);
  assert.notEqual(cooled[0].id, first[0].id, 'recently featured projects must rotate out of the first position');

  const allRecentlyFeatured = new Map(first.map((item, index) => [item.id, index]));
  const rotated = rankDiscoveryProjects(candidates, allRecentlyFeatured, now);
  assert.equal(rotated[0].id, first.at(-1).id, 'when every project was featured, the least recently featured project should return first');
}

{
  const now = Date.parse('2026-09-13T00:00:00Z');
  const qualified = Array.from({ length: DISCOVERY_CANDIDATE_COUNT }, (_, index) =>
    project(
      `qualified-${index}`,
      DISCOVERY_CANDIDATE_COUNT - index + 10,
      1000 + index,
      '2026-09-01T00:00:00Z',
    ),
  );
  const spam = project('zero-quality-outsider', 0, 0, '2026-01-01T00:00:00Z');
  const first = rankDiscoveryProjects([...qualified, spam], new Map(), now);
  const cooledTopId = first[0].id;
  const rotated = rankDiscoveryProjects([...qualified, spam], new Map([[cooledTopId, 0]]), now);

  assert.ok(
    rotated.findIndex(item => item.id === cooledTopId) < rotated.findIndex(item => item.id === spam.id),
    'cooldown may rotate within the qualified candidate pool but must not promote a zero-quality outsider above it',
  );
}

console.log('project ranking OK');
