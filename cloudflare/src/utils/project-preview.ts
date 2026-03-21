import type { RegexEntryPreviewType, WorldbookEntryPreviewType } from '../types';

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function parseWorldbookEntriesPreview(projectFileText: string): WorldbookEntryPreviewType[] {
  const raw = safeParseJson(projectFileText);
  const entries = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { entries?: unknown[] })?.entries)
      ? (raw as { entries: unknown[] }).entries
      : (raw as { entries?: Record<string, unknown> })?.entries &&
          typeof (raw as { entries?: Record<string, unknown> }).entries === 'object'
        ? Object.values((raw as { entries: Record<string, unknown> }).entries)
        : [];

  return entries.map((entry, index) => {
    const item = entry as Record<string, unknown>;
    return {
      uid: typeof item.uid === 'string' ? item.uid : String(index),
      comment: typeof item.comment === 'string' ? item.comment : typeof item.name === 'string' ? item.name : '无标题',
      content: typeof item.content === 'string' ? item.content : typeof item.text === 'string' ? item.text : '',
      key: Array.isArray(item.key)
        ? item.key.filter(key => typeof key === 'string')
        : Array.isArray(item.keys)
          ? item.keys.filter(key => typeof key === 'string')
          : [],
      keysecondary: Array.isArray(item.keysecondary)
        ? item.keysecondary.filter(key => typeof key === 'string')
        : Array.isArray(item.key_secondary)
          ? item.key_secondary.filter(key => typeof key === 'string')
          : [],
      constant: Boolean(item.constant),
      selective: Boolean(item.selective),
      selectiveLogic:
        typeof item.selectiveLogic === 'number'
          ? item.selectiveLogic
          : typeof item.selective_logic === 'number'
            ? item.selective_logic
            : 0,
      enabled: typeof item.enabled === 'boolean' ? item.enabled : !item.disable,
      disable: Boolean(item.disable),
      scanDepth: typeof item.scanDepth === 'number' ? item.scanDepth : item.scanDepth === null ? null : null,
      position: typeof item.position === 'number' ? item.position : 0,
      role: typeof item.role === 'string' ? item.role : null,
      depth: typeof item.depth === 'number' ? item.depth : 4,
      order: typeof item.order === 'number' ? item.order : index,
      probability: typeof item.probability === 'number' ? item.probability : 100,
      useProbability: Boolean(item.useProbability),
      sticky: typeof item.sticky === 'number' ? item.sticky : 0,
      cooldown: typeof item.cooldown === 'number' ? item.cooldown : 0,
      delay: typeof item.delay === 'number' ? item.delay : 0,
      excludeRecursion: Boolean(item.excludeRecursion),
      preventRecursion: Boolean(item.preventRecursion),
      delayUntilRecursion: Boolean(item.delayUntilRecursion),
      extra: typeof item.extensions === 'object' && item.extensions ? item.extensions : {},
    };
  });
}

export function parseRegexEntriesPreview(regexFileText: string): RegexEntryPreviewType[] {
  const raw = safeParseJson(regexFileText);
  const entries = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { entries?: unknown[] })?.entries)
      ? (raw as { entries: unknown[] }).entries
      : raw
        ? [raw]
        : [];
  return entries.map((entry, index) => {
    const item = entry as Record<string, unknown>;
    return {
      id: typeof item.id === 'string' ? item.id : String(index),
      scriptName:
        typeof item.scriptName === 'string'
          ? item.scriptName
          : typeof item.script_name === 'string'
            ? item.script_name
            : undefined,
      findRegex:
        typeof item.findRegex === 'string'
          ? item.findRegex
          : typeof item.find_regex === 'string'
            ? item.find_regex
            : undefined,
      replaceString:
        typeof item.replaceString === 'string'
          ? item.replaceString
          : typeof item.replace_string === 'string'
            ? item.replace_string
            : undefined,
      trimStrings: Array.isArray(item.trimStrings)
        ? item.trimStrings.filter(value => typeof value === 'string')
        : Array.isArray(item.trim_strings)
          ? item.trim_strings.filter(value => typeof value === 'string')
          : [],
      disabled: Boolean(item.disabled),
      markdownOnly: Boolean(item.markdownOnly ?? item.markdown_only),
      promptOnly: Boolean(item.promptOnly ?? item.prompt_only),
      runOnEdit: Boolean(item.runOnEdit ?? item.run_on_edit),
      substituteRegex:
        typeof item.substituteRegex === 'number' || typeof item.substituteRegex === 'boolean'
          ? item.substituteRegex
          : typeof item.substitute_regex === 'number' || typeof item.substitute_regex === 'boolean'
            ? item.substitute_regex
            : 0,
      minDepth:
        typeof item.minDepth === 'number' ? item.minDepth : typeof item.min_depth === 'number' ? item.min_depth : null,
      maxDepth:
        typeof item.maxDepth === 'number' ? item.maxDepth : typeof item.max_depth === 'number' ? item.max_depth : null,
      placement: Array.isArray(item.placement) ? item.placement.filter(value => typeof value === 'number') : [],
    };
  });
}
