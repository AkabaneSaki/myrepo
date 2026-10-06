import assert from 'node:assert/strict';
import { analyzeProjectCodeV2 } from '../src/utils/ejs-checker/index.mjs';

function worldbook(entries) {
  return [{
    fileName: 'l1-l7-rules.json',
    type: 'worldbook',
    text: JSON.stringify({
      entries: Object.fromEntries(entries.map((item, index) => [
        String(index),
        { uid: index + 1, comment: item.name, content: item.content },
      ])),
    }),
  }];
}

function report(entries) {
  return analyzeProjectCodeV2(worldbook(entries));
}

function rules(result, id) {
  return result.findings.filter(item => item.ruleId === id);
}

// Case A: ordinary top-level let/const must be localized.
const caseA = report([{
  name: 'Case A',
  content: "<%_\nlet relations = {};\nlet key = 'x';\n_%>",
}]);
assert.ok(rules(caseA, 'L2').length >= 1, JSON.stringify(caseA.findings));

const caseAFixed = report([{
  name: 'Case A fixed',
  content: "<%_\n{\n  const relations = {};\n  const key = 'x';\n}\n_%>",
}]);
assert.equal(rules(caseAFixed, 'L2').length, 0);
assert.equal(rules(caseAFixed, 'L6').length, 0);

// Case B/C: multiple EJS blocks inside one worldbook entry remain one entry/scope.
const caseB = report([{
  name: 'Case B',
  content: "<%_\nlet found = false;\n_%>\n\n正文\n\n<%_ if (!found) { _%>\n内容\n<%_ } _%>",
}]);
assert.ok(rules(caseB, 'L2').length >= 1, JSON.stringify(caseB.findings));
assert.equal(caseB.files[0].items, 1);

const caseBFixed = report([{
  name: 'Case B fixed',
  content: "<%_\n{\n  let found = false;\n_%>\n\n正文\n\n<%_ if (!found) { _%>\n内容\n<%_ }\n} _%>",
}]);
assert.equal(rules(caseBFixed, 'L2').length, 0, JSON.stringify(caseBFixed.findings));
assert.equal(caseBFixed.files[0].items, 1);

// Case D: a single clean entry has no L6 collision.
const caseD = report([{
  name: 'Case D',
  content: '<%_ { const localOnly = 1; } _%>',
}]);
assert.equal(rules(caseD, 'L6').length, 0);

// Case E: same local name in different entries is not a collision.
const caseE = report([
  { name: 'Case E1', content: '<%_ { const data = 1; } _%>' },
  { name: 'Case E2', content: '<%_ { const data = 2; } _%>' },
]);
assert.equal(rules(caseE, 'L6').length, 0, JSON.stringify(caseE.findings));

// Case F: the same truly exposed/shared name across entries is an L6 conflict.
const caseF = report([
  { name: 'Case F1', content: '<%_ globalThis.projectSharedState = { from: 1 }; _%>' },
  { name: 'Case F2', content: '<%_ globalThis.projectSharedState = { from: 2 }; _%>' },
]);
const caseFCollision = rules(caseF, 'L6')[0];
assert.ok(caseFCollision, JSON.stringify(caseF.findings));
assert.match(caseFCollision.detail, /projectSharedState/);
assert.deepEqual(caseFCollision.relatedEntryIds?.length, 2);

// Case G: ordinary braces do not localize var.
const caseG = report([{
  name: 'Case G',
  content: '<%_ { var test = 1; } _%>',
}]);
assert.ok(rules(caseG, 'L1').some(item => item.severity === 'high'), JSON.stringify(caseG.findings));

// Existing frozen behavior: valid @@private remains an intentional scope exception.
const privateEntry = report([{
  name: 'Private',
  content: '@@private\n<%_ const own = 1; function helper(){} _%>',
}]);
assert.equal(rules(privateEntry, 'L2').length, 0);
assert.equal(rules(privateEntry, 'L3').length, 0);

// JSON mode also accepts worldbook entries nested inside a character-card character_book.
const characterCard = analyzeProjectCodeV2([{
  fileName: 'character-card.json',
  type: 'worldbook',
  text: JSON.stringify({ data: { character_book: { entries: [
    { uid: 1, comment: 'Card lore', content: '<%_ let cardFlag = false; _%>' },
  ] } } }),
}]);
assert.equal(characterCard.files[0].items, 1);
assert.ok(rules(characterCard, 'L2').length >= 1, JSON.stringify(characterCard.findings));

console.log('EJS L1-L7 workshop rule regressions A-G + character-card JSON: ok');
