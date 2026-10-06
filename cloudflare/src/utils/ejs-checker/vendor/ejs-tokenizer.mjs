/*
 * EJS Embedded JavaScript templates
 * Copyright 2112 Matthew Eernisse (mde@fleegix.org)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Adapted from EJS v3.1.9 lib/ejs.js: _REGEX_STRING / parseTemplateText.
// https://github.com/mde/ejs/blob/v3.1.9/lib/ejs.js
// Changes: fixed default delimiters, ESM export, immutable input and UTF-16
// offsets. No compiler, rendering, filesystem or executable-code constructors.
const DELIMITERS = /(<%%|%%>|<%=|<%-|<%_|<%#|<%|%>|-%>|_%>)/g;

export function tokenizeEjs(source) {
  const tokens = [];
  const pattern = new RegExp(DELIMITERS.source, 'g');
  let cursor = 0;
  let match;
  while ((match = pattern.exec(source))) {
    if (match.index !== cursor) {
      tokens.push({ value: source.slice(cursor, match.index), start: cursor, end: match.index, delimiter: false });
    }
    tokens.push({ value: match[0], start: match.index, end: pattern.lastIndex, delimiter: true });
    cursor = pattern.lastIndex;
  }
  if (cursor < source.length) tokens.push({ value: source.slice(cursor), start: cursor, end: source.length, delimiter: false });
  return tokens;
}
