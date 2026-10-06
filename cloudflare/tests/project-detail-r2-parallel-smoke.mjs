import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/endpoints/projects/read.ts', import.meta.url), 'utf8');
const start = source.indexOf('async function readProjectPreview(');
const end = source.indexOf('export class ProjectInstallInfo', start);
assert.ok(start >= 0 && end > start, 'readProjectPreview section must exist');
const section = source.slice(start, end);

assert.match(section, /const \[projectObject, regexObject\] = await Promise\.all\(\[/);
assert.match(section, /readProjectContentForEdit\(c, project, 'worldbook'\)/);
assert.match(section, /readProjectContentForEdit\(c, project, 'regex'\)/);
assert.match(section, /const \[worldbookText, regexText\] = await Promise\.all\(\[/);
assert.match(section, /projectObject \? projectObject\.text\(\) : Promise\.resolve\(null\)/);
assert.match(section, /regexObject \? regexObject\.text\(\) : Promise\.resolve\(null\)/);
assert.doesNotMatch(section, /const projectObject = await readProjectContentForEdit/);
assert.doesNotMatch(section, /await projectObject\.text\(\)/);
assert.doesNotMatch(section, /await regexObject\.text\(\)/);

console.log('project detail R2 parallel reads: ok');
