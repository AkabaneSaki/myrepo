import assert from 'node:assert/strict';

const { reconcileCreativeWorkshopWorldbookEntries } = await import(
  '../../src/CreativeWorkshop/services/worldbook-reconcile.ts'
);

function entry({ uid, name, comment = name, content = '', extra = {} }) {
  return { uid, name, comment, content, extra };
}

function desired({ payload, stableKey, legacyKey, sourceName }) {
  return { payload, stableKey, legacyKey, sourceName };
}

const projectId = 'project-123';
const options = { projectName: 'AAA', legacyProjectName: 'AAA-old', pruneMissing: true };

{
  const worldbook = [
    entry({
      uid: 10,
      name: '[DLC][角色][AAA]爱丽丝',
      comment: '爱丽丝',
      content: 'old',
      extra: { cw_project_id: projectId, cw_entry_key: `${projectId}:uid:1`, keep_me: 'yes' },
    }),
    entry({
      uid: 11,
      name: '[DLC][角色][AAA]旧条目',
      comment: '旧条目',
      extra: { cw_project_id: projectId, cw_entry_key: `${projectId}:uid:gone` },
    }),
    entry({
      uid: 12,
      name: '[DLC][角色][AAA]重复爱丽丝',
      comment: '爱丽丝 duplicate',
      extra: { cw_project_id: projectId, cw_entry_key: `${projectId}:uid:1` },
    }),
    entry({ uid: 99, name: '其他项目', extra: { cw_project_id: 'other-project' } }),
  ];

  const result = reconcileCreativeWorkshopWorldbookEntries(
    worldbook,
    [
      desired({
        stableKey: `${projectId}:uid:1`,
        legacyKey: `${projectId}:0`,
        sourceName: '爱丽丝',
        payload: entry({
          name: '[WS][DLC][角色]爱丽丝',
          comment: '爱丽丝',
          content: 'new',
          extra: { cw_project_id: projectId, cw_entry_key: `${projectId}:uid:1`, cw_name_format_version: 4 },
        }),
      }),
      desired({
        stableKey: `${projectId}:uid:2`,
        legacyKey: `${projectId}:1`,
        sourceName: '新增',
        payload: entry({
          name: '[WS][DLC][角色]新增',
          comment: '新增',
          content: 'added',
          extra: { cw_project_id: projectId, cw_entry_key: `${projectId}:uid:2`, cw_name_format_version: 4 },
        }),
      }),
    ],
    projectId,
    options,
  );

  const updated = result.find(item => item.extra?.cw_entry_key === `${projectId}:uid:1`);
  assert.ok(updated);
  assert.equal(updated.uid, 10, 'existing entry uid must be preserved');
  assert.equal(updated.content, 'new');
  assert.equal(updated.name, '[WS][DLC][角色]爱丽丝', 'existing legacy entry must be renamed to the current WS-first format');
  assert.equal(updated.extra.keep_me, 'yes', 'unrelated extra metadata must be preserved');
  assert.equal(updated.extra.cw_name_format_version, 4);
  assert.equal(result.filter(item => item.extra?.cw_entry_key === `${projectId}:uid:1`).length, 1, 'duplicates must be removed');
  assert.equal(result.some(item => item.extra?.cw_entry_key === `${projectId}:uid:gone`), false, 'removed remote entry must be deleted');
  assert.equal(result.some(item => item.extra?.cw_project_id === 'other-project'), true, 'unrelated project entry must remain');
  assert.equal(result.some(item => item.extra?.cw_entry_key === `${projectId}:uid:2`), true, 'new remote entry must be added');
}

{
  const worldbook = [
    entry({
      uid: 20,
      name: '[DLC][角色][AAA]旧索引条目',
      comment: '旧索引条目',
      extra: { cw_project_id: projectId, cw_entry_key: `${projectId}:0` },
    }),
  ];

  const result = reconcileCreativeWorkshopWorldbookEntries(
    worldbook,
    [
      desired({
        stableKey: `${projectId}:uid:stable`,
        legacyKey: `${projectId}:0`,
        sourceName: '旧索引条目',
        payload: entry({
          name: '[WS][DLC][角色]旧索引条目',
          comment: '旧索引条目',
          extra: { cw_project_id: projectId, cw_entry_key: `${projectId}:uid:stable` },
        }),
      }),
    ],
    projectId,
    options,
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].uid, 20, 'legacy index key migration must preserve uid');
  assert.equal(result[0].name, '[WS][DLC][角色]旧索引条目');
  assert.equal(result[0].extra.cw_entry_key, `${projectId}:uid:stable`);
}

{
  const worldbook = [
    entry({
      uid: 30,
      name: '[DLC][角色][AAA]远古条目',
      comment: '远古条目',
      extra: { fate_project_name: 'AAA-old', custom_flag: true },
    }),
  ];

  const result = reconcileCreativeWorkshopWorldbookEntries(
    worldbook,
    [
      desired({
        stableKey: `${projectId}:uid:ancient`,
        legacyKey: `${projectId}:0`,
        sourceName: '远古条目',
        payload: entry({
          name: '[WS][DLC][角色]远古条目',
          comment: '远古条目',
          extra: { cw_project_id: projectId, cw_entry_key: `${projectId}:uid:ancient` },
        }),
      }),
    ],
    projectId,
    options,
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].uid, 30, 'very old entry without cw_entry_key must be adopted in place');
  assert.equal(result[0].extra.custom_flag, true);
  assert.equal(result[0].extra.cw_entry_key, `${projectId}:uid:ancient`);
}

{
  const worldbook = [
    entry({ uid: 40, name: '将被清空', extra: { cw_project_id: projectId, cw_entry_key: `${projectId}:uid:old` } }),
    entry({ uid: 41, name: '其他项目', extra: { cw_project_id: 'other-project' } }),
  ];

  const result = reconcileCreativeWorkshopWorldbookEntries(worldbook, [], projectId, options);
  assert.equal(result.length, 1, 'empty remote worldbook must remove this project entries only');
  assert.equal(result[0].uid, 41);
}

console.log('Creative Workshop worldbook reconcile matrix OK');
