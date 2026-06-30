export function getReadableRegexName(projectName: string, entry: Record<string, any>, index: number) {
  const name = entry.scriptName || entry.script_name || entry.id || `正则${index + 1}`;
  return String(name).startsWith('[工坊]') ? String(name) : `[工坊] ${projectName} - ${name}`;
}

export function getCreativeWorkshopRegexId(regex: Record<string, any>) {
  return String(regex.id || regex.script_name || '');
}
