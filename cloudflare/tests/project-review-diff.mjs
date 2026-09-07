import assert from 'node:assert/strict';
import { buildProjectReviewDiff } from '../src/utils/project-review-diff.ts';

function json(value) {
  return JSON.stringify(value);
}

{
  const result = buildProjectReviewDiff({
    isUpdate: true,
    previousWorldbookText: json({
      entries: [
        { uid: 1, comment: '角色设定', content: '年龄：18\n喜欢红茶' },
        { uid: 2, comment: '地点', content: '王都' },
      ],
    }),
    currentWorldbookText: json({
      entries: [
        { uid: 1, comment: '角色设定', content: '年龄：19\n喜欢红茶' },
        { uid: 2, comment: '地点', content: '王都' },
      ],
    }),
  });

  assert.equal(result.mode, 'update');
  assert.deepEqual(result.summary, { added: 0, modified: 1, deleted: 0, unchanged: 1, changed: 1, total: 2 });
  assert.equal(result.worldbook[0].status, 'modified');
  assert.ok(result.worldbook[0].changedFields.includes('content'));
  assert.match(result.worldbook[0].previousReviewText, /content:\n  年龄：18\n  喜欢红茶/);
  assert.match(result.worldbook[0].currentReviewText, /content:\n  年龄：19\n  喜欢红茶/);
  assert.equal(result.worldbook[1].status, 'unchanged');
}

{
  const previous = {
    entries: [
      { comment: 'A', content: 'alpha' },
      { comment: 'B', content: 'beta' },
    ],
  };
  const current = {
    entries: [
      { comment: 'NEW', content: 'new entry' },
      { comment: 'A', content: 'alpha' },
      { comment: 'B', content: 'beta' },
    ],
  };
  const result = buildProjectReviewDiff({
    isUpdate: true,
    previousWorldbookText: json(previous),
    currentWorldbookText: json(current),
  });

  assert.equal(result.summary.added, 1, 'one inserted legacy index-only entry should be added');
  assert.equal(result.summary.unchanged, 2, 'unchanged shifted entries should stay unchanged');
  assert.equal(result.summary.modified, 0, 'insertion must not cascade into false modifications');
}

{
  const result = buildProjectReviewDiff({
    isUpdate: true,
    previousWorldbookText: json({ entries: [{ uid: 'keep', comment: 'Keep', content: 'same' }, { uid: 'gone', comment: 'Gone', content: 'remove me' }] }),
    currentWorldbookText: json({ entries: [{ uid: 'keep', comment: 'Keep', content: 'same' }] }),
  });

  assert.equal(result.summary.deleted, 1);
  const deleted = result.worldbook.find(change => change.status === 'deleted');
  assert.equal(deleted?.previous?.comment, 'Gone');
}

{
  const result = buildProjectReviewDiff({
    isUpdate: true,
    previousRegexText: json([{ id: 'r1', scriptName: '清理', findRegex: 'foo', replaceString: 'bar' }]),
    currentRegexText: json([{ id: 'r1', scriptName: '清理', findRegex: 'foo', replaceString: 'baz' }]),
  });

  assert.equal(result.regex[0].status, 'modified');
  assert.ok(result.regex[0].changedFields.includes('replaceString'));
}

{
  const result = buildProjectReviewDiff({
    isUpdate: true,
    previousWorldbookText: json({ entries: [{ uid: 1, comment: '模板', content: '普通文本' }] }),
    currentWorldbookText: json({ entries: [{ uid: 1, comment: '模板', content: '<%= foo %>' }] }),
  });

  assert.equal(result.riskDelta.newEjs, 1, 'new EJS should be surfaced as a review risk delta');
}

{
  const result = buildProjectReviewDiff({
    isUpdate: false,
    currentWorldbookText: json({ entries: [{ uid: 1, comment: '首次发布', content: 'must review all' }] }),
  });

  assert.equal(result.mode, 'initial');
  assert.equal(result.summary.added, 1);
}

console.log('project review diff OK');
