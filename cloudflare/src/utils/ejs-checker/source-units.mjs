import { tokenizeEjs } from './vendor/ejs-tokenizer.mjs';
import { decodeHTML, decodeHTMLAttribute } from 'entities';
import { parseFragment } from 'parse5';

export function sourceLocation(source, index) {
  index = Math.max(0, Math.min(source.length, index));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < index; i++) {
    if (source[i] === '\r') {
      if (source[i + 1] === '\n' && i + 1 < index) i++;
      line++;
      lineStart = i + 1;
    } else if (source[i] === '\n' || source[i] === '\u2028' || source[i] === '\u2029') {
      line++;
      lineStart = i + 1;
    }
  }
  return { index, line, column: index - lineStart + 1 };
}

// A compact segment map avoids an array entry for every character of a book.
// All offsets and columns use JavaScript UTF-16 units, including surrogate pairs.
class SourceBuilder {
  constructor(rawContent) {
    this.rawContent = rawContent;
    this.parts = [];
    this.segments = [];
    this.codeRanges = [];
    this.length = 0;
  }

  append(text, originalStart, original = false, mode = '', linear = true, originalEnd = originalStart + (original ? text.length : 0)) {
    if (!text) return;
    const start = this.length;
    this.parts.push(text);
    this.length += text.length;
    const segment = { start, end: this.length, originalStart, originalEnd, original, linear };
    this.segments.push(segment);
    if (original) this.codeRanges.push({ start, end: this.length, originalStart, originalEnd, mode });
  }

  finish(kind, extra = {}) {
    const segments = this.segments;
    const rawContent = this.rawContent;
    function segmentAt(offset) {
      let low = 0;
      let high = segments.length - 1;
      while (low <= high) {
        const mid = (low + high) >>> 1;
        const segment = segments[mid];
        if (offset < segment.start) high = mid - 1;
        else if (offset >= segment.end) low = mid + 1;
        else return segment;
      }
      return null;
    }
    const sourceMap = {
      map(offset) {
        const segment = segmentAt(offset);
        if (!segment) return segments.length ? segments[segments.length - 1].originalEnd : rawContent.length;
        return Math.min(rawContent.length, segment.originalStart + (segment.original && segment.linear ? offset - segment.start : 0));
      },
      isOriginal(offset) { return Boolean(segmentAt(offset)?.original); },
      location(offset) { return sourceLocation(rawContent, this.map(offset)); }
    };
    return { kind, rawContent, code: this.parts.join(''), codeRanges: this.codeRanges, sourceMap, ...extra };
  }
}

function decoratorEnd(source) {
  let cursor = 0;
  while (source.startsWith('@@', cursor) && !source.startsWith('@@@', cursor)) {
    const newline = source.indexOf('\n', cursor);
    cursor = newline < 0 ? source.length : newline + 1;
  }
  return cursor;
}

function isOpening(token) { return token.delimiter && token.value.startsWith('<%') && token.value !== '<%%'; }
function isClosing(token) { return token.delimiter && ['%>', '-%>', '_%>'].includes(token.value); }

export class TemplateSyntaxError extends SyntaxError {
  constructor(message, index) {
    super(message);
    this.index = index;
  }
}

export function buildEjsUnit(rawContent, { privateScope = false } = {}) {
  const builder = new SourceBuilder(rawContent);
  const templateRanges = [];
  const start = decoratorEnd(rawContent);
  const tokens = tokenizeEjs(rawContent.slice(start)).map(token => ({ ...token, start: token.start + start, end: token.end + start }));
  // No strict directive: ST uses async, non-module execution. This artificial
  // expression/function is never called and is excluded from policy traversal.
  builder.append('(async function(){\nvoid 0;\n', start);
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (isOpening(token)) {
      // ST permits embedded EJS delimiters in JS strings. Independently group
      // paired nested delimiters before parsing the outer JavaScript fragment.
      let depth = 1;
      let closing = null;
      let j = i + 1;
      for (; j < tokens.length; j++) {
        if (isOpening(tokens[j])) depth++;
        else if (isClosing(tokens[j]) && --depth === 0) { closing = tokens[j]; break; }
      }
      if (!closing) throw new TemplateSyntaxError('EJS 标签缺少对应的结束标签。', token.start);
      const mode = token.value.slice(2);
      templateRanges.push({start:token.start,end:closing.end,mode});
      if (mode !== '#') {
        let end = closing.start;
        if (mode === '=' || mode === '-') {
          const fragment = rawContent.slice(token.end, end);
          const semi = /;(\s*)$/.exec(fragment);
          if (semi) end = token.end + semi.index;
          builder.append(';void(\n', token.start);
          builder.append(rawContent.slice(token.end, end), token.end, true, mode);
          builder.append('\n);\n', closing.start);
        } else {
          builder.append(';', token.start);
          builder.append(rawContent.slice(token.end, end), token.end, true, mode);
          builder.append('\n', closing.start);
        }
      }
      i = j;
      continue;
    }
    // Text has an output statement at runtime, so leaving it entirely empty
    // would incorrectly accept e.g. an unfinished `if (...)` or `else` chain.
    if (!isClosing(token)) builder.append(';void 0;\n', token.start);
  }
  builder.append('\n})', rawContent.length);
  return builder.finish('ejs', { privateScope, sourceType: 'script', wrapped: true, async: true, templateRanges });
}

function appendHtmlText(builder, source, start, end, { attribute = false, foreign = false } = {}) {
  const text = source.slice(start, end);
  const entities = /<!\[CDATA\[|\]\]>|&(?:#x[0-9a-f]+;?|#[0-9]+;?|[a-z][a-z0-9]*;?)|\r\n?|\u0000/gi;
  let cursor = 0;
  let inCdata = false;
  let match;
  while ((match = entities.exec(text))) {
    let decoded = match[0];
    if (foreign && match[0] === '<![CDATA[') { inCdata = true; decoded = ''; }
    else if (foreign && inCdata && match[0] === ']]>') { inCdata = false; decoded = ''; }
    else if (match[0][0] === '\r') decoded = '\n';
    else if (match[0] === '\0') decoded = '\ufffd';
    else if (!inCdata && (attribute || foreign) && match[0][0] === '&') {
      // A semicolonless named reference followed by '=' is literal in an
      // attribute. The following character is outside this regex match.
      const ambiguousAttribute = attribute && /^&[a-z]+$/i.test(match[0]) && text[entities.lastIndex] === '=';
      if (!ambiguousAttribute) decoded = attribute ? decodeHTMLAttribute(match[0]) : decodeHTML(match[0]);
    }
    if (decoded === match[0]) continue;
    builder.append(text.slice(cursor, match.index), start + cursor, true, attribute ? 'attribute' : 'script');
    // Decoded characters anchor to the original entity; following characters
    // resume their actual source positions rather than losing columns.
    builder.append(decoded, start + match.index, true, attribute ? 'attribute' : 'script', false, start + entities.lastIndex);
    cursor = entities.lastIndex;
  }
  builder.append(text.slice(cursor), start + cursor, true, attribute ? 'attribute' : 'script');
}

function attributeRange(source, location, value) {
  let cursor = location.startOffset;
  while (cursor < location.endOffset && source[cursor] !== '=') cursor++;
  if (cursor === location.endOffset) return { start: cursor, end: cursor, value };
  cursor++;
  while (/[\t\n\f\r ]/.test(source[cursor] || '') && cursor < location.endOffset) cursor++;
  const quoted = source[cursor] === '"' || source[cursor] === "'";
  if (quoted) cursor++;
  return { start: cursor, end: location.endOffset - (quoted && source[location.endOffset - 1] === source[cursor - 1] ? 1 : 0), value };
}

function firstAttributeLocations(source, tagLocation) {
  if (!tagLocation) return new Map();
  const tag = source.slice(tagLocation.startOffset,tagLocation.endOffset);
  const nameEnd = /^<[^\t\n\f\r />]+/.exec(tag)?.[0].length ?? 0;
  const locations = new Map();
  // parse5 keeps the first duplicate value but the last occurrence's location.
  // Locate the first spelling in its parsed start tag to keep evidence aligned.
  const spelling = /([^\t\n\f\r /=>]+)(?:[\t\n\f\r ]*=[\t\n\f\r ]*(?:"[^"]*"|'[^']*'|[^\t\n\f\r >]*))?/g;
  spelling.lastIndex=nameEnd;
  let match;
  while((match=spelling.exec(tag))){
    const name=match[1].toLowerCase();
    if(!locations.has(name))locations.set(name,{startOffset:tagLocation.startOffset+match.index,endOffset:tagLocation.startOffset+spelling.lastIndex});
  }
  return locations;
}

// HTML GlobalEventHandlers plus the event-handler extensions for pointer,
// touch, animation and transitions. Unknown "on..." attributes are plain data.
// https://html.spec.whatwg.org/multipage/webappapis.html#globaleventhandlers
const EVENT_ATTRIBUTES = new Set(('abort auxclick beforeinput beforematch beforetoggle blur cancel canplay canplaythrough change click close command contextlost contextmenu contextrestored copy cuechange cut dblclick drag dragend dragenter dragexit dragleave dragover dragstart drop durationchange emptied ended error focus focusin focusout formdata input invalid keydown keypress keyup load loadeddata loadedmetadata loadstart mousedown mouseenter mouseleave mousemove mouseout mouseover mouseup paste pause play playing progress ratechange reset resize scroll scrollend securitypolicyviolation seeked seeking select selectionchange selectstart slotchange stalled submit suspend timeupdate toggle volumechange waiting webkitanimationend webkitanimationiteration webkitanimationstart webkittransitionend wheel animationcancel animationend animationiteration animationstart transitioncancel transitionend transitionrun transitionstart gotpointercapture lostpointercapture pointercancel pointerdown pointerenter pointerleave pointermove pointerout pointerover pointerrawupdate pointerup touchcancel touchend touchmove touchstart scrollsnapchange scrollsnapchanging').split(' ').map(name=>'on'+name));
const WINDOW_EVENT_ATTRIBUTES = new Set(('afterprint beforeprint beforeunload hashchange languagechange message messageerror offline online pagehide pagereveal pageshow pageswap popstate rejectionhandled storage unhandledrejection unload').split(' ').map(name=>'on'+name));
function eventAttribute(node,name) {
  if (EVENT_ATTRIBUTES.has(name)) return true;
  if (WINDOW_EVENT_ATTRIBUTES.has(name)) return ['body','frameset','svg'].includes(node.tagName);
  // SVG animation events only apply to animation elements.
  // https://www.w3.org/TR/SVG2/interact.html#AnimationEvents
  return node.namespaceURI==='http://www.w3.org/2000/svg' && ['animate','animateMotion','animateTransform','set'].includes(node.tagName) && ['onbegin','onend','onrepeat'].includes(name);
}

function attributeUnit(rawContent, attribute, kind) {
  const builder = new SourceBuilder(rawContent);
  const wrapped = kind === 'event';
  if (wrapped) builder.append('(function(){\nvoid 0;\n', attribute.start);
  const codeStart = builder.length;
  appendHtmlText(builder, rawContent, attribute.start, attribute.end, { attribute: true });
  if (builder.parts.join('').slice(codeStart) !== attribute.value) throw new Error('HTML attribute source map did not match parsed content');
  let unit = builder.finish(kind, { sourceType: 'script', wrapped, async: false });
  if (kind === 'javascript-url') {
    const prefix = /^[\u0000-\u0020]*javascript:/i.exec(unit.code.replace(/[\t\r\n]/g, ''));
    if (!prefix) return null;
    // Find the colon in the decoded source without deleting its mapping.
    const colon = unit.code.indexOf(':');
    const prefixLength = colon + 1;
    unit.code = ' '.repeat(prefixLength) + unit.code.slice(prefixLength);
  }
  if (wrapped) {
    builder.append('\n})', attribute.end);
    unit = builder.finish(kind, { sourceType: 'script', wrapped, async: false });
  }
  return unit;
}

export function buildRegexUnits(rawContent) {
  const units = [];
  // parse5 parses text into an inert HTML tree; no DOM is created, mounted or
  // executed. Its WHATWG tokenizer handles raw-text and script escape states.
  const fragment = parseFragment(rawContent, { sourceCodeLocationInfo: true, scriptingEnabled: true });
  const pending = [...fragment.childNodes].reverse();
  while (pending.length) {
    const node = pending.pop();
    if (!node.tagName) continue;
    const location = node.sourceCodeLocation;
    const attributeLocations = firstAttributeLocations(rawContent,location?.startTag);
    for (const parsedAttribute of node.attrs ?? []) {
      const name = parsedAttribute.prefix ? parsedAttribute.prefix + ':' + parsedAttribute.name : parsedAttribute.name;
      const attributeLocation = attributeLocations.get(name);
      if (!attributeLocation) continue;
      const attribute = attributeRange(rawContent, attributeLocation, parsedAttribute.value);
      if (eventAttribute(node,name)) units.push(attributeUnit(rawContent, attribute, 'event'));
      else if (['href', 'src', 'action', 'formaction', 'xlink:href'].includes(name)) {
        const unit = attributeUnit(rawContent, attribute, 'javascript-url');
        if (unit) units.push(unit);
      }
    }
    if (node.tagName === 'script' && location) {
      const type = node.attrs.find(attribute => attribute.name === 'type');
      const language = node.attrs.find(attribute => attribute.name === 'language');
      const value = type ? type.value.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '').toLowerCase() : language?.value ? 'text/' + language.value.toLowerCase() : '';
      const executable = !value || value === 'module' || /^(?:application\/(?:x-)?(?:java|ecma)script|text\/(?:(?:x-)?(?:java|ecma)script|javascript1\.[0-5]|jscript|livescript))$/.test(value);
      if (executable && !node.attrs.some(attribute => attribute.name === 'src')) {
        const builder = new SourceBuilder(rawContent);
        const textNodes = [...(node.childNodes ?? [])].reverse();
        while (textNodes.length) {
          const text = textNodes.pop();
          if (text.nodeName === '#text' && text.sourceCodeLocation) {
            const codeStart = builder.length;
            appendHtmlText(builder, rawContent, text.sourceCodeLocation.startOffset, text.sourceCodeLocation.endOffset, { foreign: node.namespaceURI !== 'http://www.w3.org/1999/xhtml' });
            if (builder.parts.join('').slice(codeStart) !== text.value) throw new Error('HTML script source map did not match parsed content');
          } else if (text.childNodes) textNodes.push(...text.childNodes.slice().reverse());
        }
        // Preserve a meaningful EOF location even for an empty script.
        builder.append('\n', location.endTag?.startOffset ?? location.endOffset);
        units.push(builder.finish(value === 'module' ? 'module' : 'script', { sourceType: value === 'module' ? 'module' : 'script', wrapped: false, async: false }));
      }
    }
    // Template descendants are inert HTML content, not executable regions.
    if (node.tagName !== 'template') pending.push(...(node.childNodes ?? []).slice().reverse());
  }
  return units;
}
