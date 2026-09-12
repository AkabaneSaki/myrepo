import assert from 'node:assert/strict';

import {
  CREATIVE_WORKSHOP_NAME_FORMAT_VERSION,
  formatCreativeWorkshopEntryName,
  getCreativeWorkshopDlcCategory,
} from '../../src/CreativeWorkshop/services/project-type.ts';

const project = (projectType, extensionType) => ({
  projectType,
  ...(extensionType ? { extensionType } : {}),
});

const cases = [
  {
    name: '角色：无 Header',
    source: '爱丽丝',
    project: project('角色'),
    projectName: 'AAA',
    expected: '[DLC][角色][AAA][WS]爱丽丝',
  },
  {
    name: '角色：作者路径标签原样保留',
    source: '[角色][变量]初始变量',
    project: project('角色'),
    projectName: 'AAA',
    expected: '[DLC][角色][AAA][WS][角色][变量]初始变量',
  },
  {
    name: '角色：错误类别与错误包名 Header 被当前项目覆盖',
    source: '[DLC][扩展核心][BBB][角色][变量]初始变量',
    project: project('角色'),
    projectName: 'AAA',
    expected: '[DLC][角色][AAA][WS][角色][变量]初始变量',
  },
  {
    name: '角色：已有 WS Header 幂等',
    source: '[DLC][角色][AAA][WS][角色]爱丽丝',
    project: project('角色'),
    projectName: 'AAA',
    expected: '[DLC][角色][AAA][WS][角色]爱丽丝',
  },
  {
    name: '角色：Header 后重复作者标签不去重',
    source: '[DLC][角色][AAA][WS][角色][角色]爱丽丝',
    project: project('角色'),
    projectName: 'AAA',
    expected: '[DLC][角色][AAA][WS][角色][角色]爱丽丝',
  },
  {
    name: '角色：关系标签属于作者内容并保留',
    source: '[>梅林核心][角色]爱丽丝',
    project: project('角色'),
    projectName: 'AAA',
    expected: '[DLC][角色][AAA][WS][>梅林核心][角色]爱丽丝',
  },
  {
    name: '事件：类别正确',
    source: '王都庆典',
    project: project('事件'),
    projectName: '秋日祭',
    expected: '[DLC][事件][秋日祭][WS]王都庆典',
  },
  {
    name: '规则扩展：协议类别统一为扩展',
    source: '[规则]战斗协议',
    project: project('扩展', '规则'),
    projectName: '战斗包',
    expected: '[DLC][扩展][战斗包][WS][规则]战斗协议',
  },
  {
    name: '内容扩展：协议类别统一为扩展',
    source: '[内容]新区域',
    project: project('扩展', '内容'),
    projectName: '区域包',
    expected: '[DLC][扩展][区域包][WS][内容]新区域',
  },
  {
    name: '命定系统：普通名称',
    source: '梅林核心',
    project: project('系统核心'),
    projectName: '梅林核心',
    expected: '[DLC][命定系统][梅林核心][WS]梅林核心',
  },
  {
    name: '命定系统：剥离旧命定系统-前缀',
    source: '命定系统-梅林核心',
    project: project('系统核心'),
    projectName: '梅林核心',
    expected: '[DLC][命定系统][梅林核心][WS]梅林核心',
  },
  {
    name: '命定系统：剥离旧[命定系统]前缀',
    source: '[命定系统]梅林核心',
    project: project('系统核心'),
    projectName: '梅林核心',
    expected: '[DLC][命定系统][梅林核心][WS]梅林核心',
  },
  {
    name: '已有 WS 但项目名改变时第三段使用当前 project.name',
    source: '[DLC][角色][旧包名][WS][角色]爱丽丝',
    project: project('角色'),
    projectName: '新包名',
    expected: '[DLC][角色][新包名][WS][角色]爱丽丝',
  },
];

assert.equal(CREATIVE_WORKSHOP_NAME_FORMAT_VERSION, 2);
assert.equal(getCreativeWorkshopDlcCategory(project('系统核心')), '命定系统');
assert.equal(getCreativeWorkshopDlcCategory(project('角色')), '角色');
assert.equal(getCreativeWorkshopDlcCategory(project('事件')), '事件');
assert.equal(getCreativeWorkshopDlcCategory(project('扩展', '规则')), '扩展');
assert.equal(getCreativeWorkshopDlcCategory(project('扩展', '内容')), '扩展');

for (const testCase of cases) {
  const actual = formatCreativeWorkshopEntryName(
    testCase.source,
    testCase.project,
    testCase.projectName,
  );
  assert.equal(actual, testCase.expected, testCase.name);

  const normalizedAgain = formatCreativeWorkshopEntryName(
    actual,
    testCase.project,
    testCase.projectName,
  );
  assert.equal(normalizedAgain, testCase.expected, `${testCase.name}：重复标准化必须幂等`);
}

console.log(`Creative Workshop entry-name v2 matrix OK (${cases.length} cases)`);
