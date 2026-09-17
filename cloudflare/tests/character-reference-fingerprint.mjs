import assert from 'node:assert/strict';
import {
  fingerprintRegexEntry,
  fingerprintWorldbookEntry,
  matchCharacterReferenceFingerprint,
} from '../src/utils/character-reference-fingerprint.ts';
import { parseRegexEntriesPreview, parseWorldbookEntriesPreview } from '../src/utils/project-preview.ts';

function parseWorldbook(entry) {
  return parseWorldbookEntriesPreview(JSON.stringify({ entries: { arbitrary_storage_key: entry } }))[0];
}

{
  const first = parseWorldbook({
    uid: 123,
    comment: '  Original Status  ',
    content: 'line 1\r\nline 2   ',
    key: ['beta', 'alpha'],
    keysecondary: ['secondary'],
    selective: true,
    selectiveLogic: 1,
    position: { type: 'after_char', role: 'system', depth: 4, order: 99 },
    probability: 80,
    useProbability: true,
    extensions: { temporary: 'ignored' },
  });
  const second = parseWorldbook({
    uid: 'totally-different-uid',
    comment: 'Original   Status',
    content: 'line 1\nline 2',
    key: ['alpha', 'beta'],
    keysecondary: ['secondary'],
    selective: true,
    selective_logic: 1,
    position: { type: 'after_character_definition', role: 0, depth: 4, order: 1 },
    probability: 80,
    useProbability: true,
  });

  const firstFingerprint = await fingerprintWorldbookEntry(first);
  const secondFingerprint = await fingerprintWorldbookEntry(second);
  assert.equal(firstFingerprint.exactHash, secondFingerprint.exactHash, 'UID/order/line-ending/key-order noise must be ignored');
  assert.deepEqual(matchCharacterReferenceFingerprint(firstFingerprint, secondFingerprint), {
    level: 'exact',
    reasons: ['exact_hash'],
  });

  const changed = parseWorldbook({
    comment: 'Original Status',
    content: 'line 1\nline 2\nnew behavior text',
    key: ['alpha', 'beta'],
    keysecondary: ['secondary'],
    selective: true,
    selectiveLogic: 1,
    position: { type: 'after_character_definition', role: 'system', depth: 4 },
    probability: 80,
    useProbability: true,
  });
  const changedFingerprint = await fingerprintWorldbookEntry(changed);
  assert.equal(matchCharacterReferenceFingerprint(firstFingerprint, changedFingerprint).level, 'changed-high-confidence');

  const sameNameOnly = parseWorldbook({
    comment: 'Original Status',
    content: 'completely unrelated',
    key: ['other'],
    constant: true,
    position: { type: 'before_character_definition', role: 'assistant', depth: 9 },
  });
  assert.equal(
    matchCharacterReferenceFingerprint(firstFingerprint, await fingerprintWorldbookEntry(sameNameOnly)).level,
    'uncertain',
    'name-only match must never become high confidence',
  );
}

{
  const first = parseRegexEntriesPreview(JSON.stringify({
    id: 'one',
    scriptName: 'Status Cleaner',
    findRegex: '/foo\\s+/gi',
    replaceString: 'bar',
    placement: [1, 2],
    markdownOnly: true,
    promptOnly: false,
    disabled: false,
  }))[0];
  const second = parseRegexEntriesPreview(JSON.stringify({
    id: 'another-id',
    script_name: 'Status Cleaner',
    find_regex: '/foo\\s+/gi',
    replace_string: 'bar',
    placement: [1, 2],
    markdown_only: true,
    prompt_only: false,
    disabled: true,
  }))[0];
  const firstFingerprint = await fingerprintRegexEntry(first);
  const secondFingerprint = await fingerprintRegexEntry(second);
  assert.equal(firstFingerprint.exactHash, secondFingerprint.exactHash, 'regex IDs/enabled state and field aliases must not define identity');
  assert.equal(matchCharacterReferenceFingerprint(firstFingerprint, secondFingerprint).level, 'exact');

  const unrelated = parseRegexEntriesPreview(JSON.stringify({
    scriptName: 'Another Script',
    findRegex: '/different/',
    replaceString: 'different',
    placement: [9],
    markdownOnly: false,
  }))[0];
  assert.equal(matchCharacterReferenceFingerprint(firstFingerprint, await fingerprintRegexEntry(unrelated)).level, 'no-match');
}

console.log('character reference fingerprint: ok');
