import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

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
    expected: '[WS][DLC][角色]爱丽丝',
  },
  {
    name: '角色：作者路径标签原样保留',
    source: '[角色][变量]初始变量',
    project: project('角色'),
    projectName: 'AAA',
    expected: '[WS][DLC][角色][角色][变量]初始变量',
  },
  {
    name: '真实扩展源：第三段就是条目标题，绝不能当项目名吃掉',
    source: '[DLC][扩展][种族-地精]',
    project: project('扩展'),
    projectName: '【种族扩展】地精与哥布林',
    expected: '[WS][DLC][扩展][种族-地精]',
  },
  {
    name: '真实扩展源：规则条目名称保留',
    source: '[DLC][扩展][哥布林繁衍规则]',
    project: project('扩展'),
    projectName: '【种族扩展】地精与哥布林',
    expected: '[WS][DLC][扩展][哥布林繁衍规则]',
  },
  {
    name: '真实角色源：作者原始短名称保留',
    source: '[DLC][角色]姚（圣堂,廿廿）',
    project: project('扩展'),
    projectName: '（9.13，适配4.3.3，看详情）穿越者势力+多位角色DLC：圣堂，堂堂登场！',
    expected: '[WS][DLC][角色]姚（圣堂,廿廿）',
  },
  {
    name: 'v2 旧格式迁移到 v4，不保留超长项目名',
    source: '[DLC][角色][很长很长的旧项目营销标题][WS][角色]爱丽丝',
    project: project('角色'),
    projectName: '新的更长营销标题',
    expected: '[WS][DLC][角色][角色]爱丽丝',
  },
  {
    name: 'v2 已损坏且没有条目尾名时保留旧第三段作为 fallback',
    source: '[DLC][扩展][地精与哥布林][WS]',
    project: project('扩展'),
    projectName: '【种族扩展】地精与哥布林',
    expected: '[WS][DLC][扩展][地精与哥布林]',
  },
  {
    name: 'v3 旧格式迁移到 v4',
    source: '[DLC][角色][WS][角色]爱丽丝',
    project: project('角色'),
    projectName: '任何项目名都不应写进可见名称',
    expected: '[WS][DLC][角色][角色]爱丽丝',
  },
  {
    name: 'v4 已有 Header 幂等',
    source: '[WS][DLC][角色][角色]爱丽丝',
    project: project('角色'),
    projectName: '任何项目名都不应写进可见名称',
    expected: '[WS][DLC][角色][角色]爱丽丝',
  },
  {
    name: '事件：类别正确',
    source: '王都庆典',
    project: project('事件'),
    projectName: '秋日祭',
    expected: '[WS][DLC][事件]王都庆典',
  },
  {
    name: '规则扩展：协议类别统一为扩展',
    source: '[规则]战斗协议',
    project: project('扩展', '规则'),
    projectName: '战斗包',
    expected: '[WS][DLC][扩展][规则]战斗协议',
  },
  {
    name: '内容扩展：协议类别统一为扩展',
    source: '[内容]新区域',
    project: project('扩展', '内容'),
    projectName: '区域包',
    expected: '[WS][DLC][扩展][内容]新区域',
  },
  {
    name: '命定系统：普通名称',
    source: '梅林核心',
    project: project('系统核心'),
    projectName: '梅林核心',
    expected: '[WS][DLC][命定系统]梅林核心',
  },
  {
    name: '命定系统：剥离旧命定系统-前缀',
    source: '命定系统-梅林核心',
    project: project('系统核心'),
    projectName: '梅林核心',
    expected: '[WS][DLC][命定系统]梅林核心',
  },
  {
    name: '命定系统：剥离旧[命定系统]前缀',
    source: '[命定系统]梅林核心',
    project: project('系统核心'),
    projectName: '梅林核心',
    expected: '[WS][DLC][命定系统]梅林核心',
  },
];

assert.equal(CREATIVE_WORKSHOP_NAME_FORMAT_VERSION, 4);
assert.equal(getCreativeWorkshopDlcCategory(project('系统核心')), '命定系统');
assert.equal(getCreativeWorkshopDlcCategory(project('角色')), '角色');
assert.equal(getCreativeWorkshopDlcCategory(project('事件')), '事件');
assert.equal(getCreativeWorkshopDlcCategory(project('扩展', '规则')), '扩展');
assert.equal(getCreativeWorkshopDlcCategory(project('扩展', '内容')), '扩展');

const repairSource = await readFile(new URL('../../src/CreativeWorkshop/services/repair.ts', import.meta.url), 'utf8');
assert.ok(
  repairSource.includes("const v4 = value.match(/^\\[WS\\]\\[DLC\\]"),
  'Repair must recognize WS-first v4 entry names',
);
assert.ok(
  repairSource.includes("const v3 = value.match(/^\\[DLC\\]\\[([^\\]]+)\\]\\[WS\\]"),
  'Repair must keep v3 compatibility',
);
assert.ok(
  repairSource.includes("const v2 = value.match(/^\\[DLC\\]\\[([^\\]]+)\\]\\[([^\\]]+)\\]\\[WS\\]"),
  'Repair must keep v2 compatibility',
);

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

console.log(`Creative Workshop entry-name v4 matrix OK (${cases.length} cases)`);
