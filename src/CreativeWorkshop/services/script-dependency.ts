export type CreativeWorkshopScriptScope = 'global' | 'preset' | 'character';

export type CreativeWorkshopScriptRefKind =
  | 'semver'
  | 'floating'
  | 'commit'
  | 'other-ref'
  | 'unversioned'
  | 'unknown';

export type CreativeWorkshopScriptDependency = {
  scope: CreativeWorkshopScriptScope;
  scriptId: string;
  scriptName: string;
  scriptEnabled: boolean;
  importUrl: string;
  repository: string | null;
  ref: string | null;
  installedVersion: string | null;
  refKind: CreativeWorkshopScriptRefKind;
};

export type CreativeWorkshopInstalledScript = {
  scope: CreativeWorkshopScriptScope;
  scriptId: string;
  scriptName: string;
  scriptEnabled: boolean;
  dependencies: CreativeWorkshopScriptDependency[];
};

export type CreativeWorkshopScriptDependencySnapshot = {
  supported: boolean;
  scripts: CreativeWorkshopInstalledScript[];
};

type UnknownScriptTree = {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  enabled?: unknown;
  content?: unknown;
  scripts?: unknown;
};

type ScriptTreeGetter = (option: { type: CreativeWorkshopScriptScope }) => unknown;

const SCRIPT_SCOPES: CreativeWorkshopScriptScope[] = ['character', 'preset', 'global'];
const FLOATING_REFS = new Set(['main', 'master', 'latest', 'dev', 'develop', 'development', 'staging', 'next', 'canary']);
const SEMVER_RE = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;
const COMMIT_RE = /^[0-9a-f]{7,40}$/i;

function getScriptTreeGetter(): ScriptTreeGetter | null {
  const candidate = (globalThis as typeof globalThis & { getScriptTrees?: unknown }).getScriptTrees;
  return typeof candidate === 'function' ? (candidate as ScriptTreeGetter) : null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeBoolean(value: unknown): boolean {
  return value !== false;
}

function normalizeScript(tree: UnknownScriptTree, scope: CreativeWorkshopScriptScope): CreativeWorkshopInstalledScript | null {
  if (tree.type !== 'script') return null;
  const scriptId = normalizeText(tree.id).trim();
  const scriptName = normalizeText(tree.name).trim();
  const content = normalizeText(tree.content);
  const scriptEnabled = normalizeBoolean(tree.enabled);

  if (!scriptId && !scriptName) return null;

  const dependencies = extractScriptDependencies({ scope, scriptId, scriptName, scriptEnabled, content });
  if (dependencies.length === 0) return null;

  return {
    scope,
    scriptId,
    scriptName,
    scriptEnabled,
    dependencies,
  };
}

function flattenScriptTrees(value: unknown, scope: CreativeWorkshopScriptScope): CreativeWorkshopInstalledScript[] {
  if (!Array.isArray(value)) return [];

  const scripts: CreativeWorkshopInstalledScript[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const tree = item as UnknownScriptTree;
    const script = normalizeScript(tree, scope);
    if (script) {
      scripts.push(script);
      continue;
    }

    if (tree.type === 'folder' && Array.isArray(tree.scripts)) {
      for (const child of tree.scripts) {
        const nestedScript = child && typeof child === 'object'
          ? normalizeScript(child as UnknownScriptTree, scope)
          : null;
        if (nestedScript) scripts.push(nestedScript);
      }
    }
  }
  return scripts;
}

function extractStaticImportUrls(content: string): string[] {
  const urls = new Set<string>();
  const patterns = [
    /\bimport\s+(?:[^'";]*?\s+from\s+)?['"](https?:\/\/[^'"\s]+)['"]/g,
    /\bimport\s*\(\s*['"](https?:\/\/[^'"\s]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content))) {
      if (match[1]) urls.add(match[1]);
    }
  }
  return [...urls];
}

function safelyDecodeRef(ref: string): string {
  try {
    return decodeURIComponent(ref).trim();
  } catch {
    return ref.trim();
  }
}

function normalizeRef(ref: string | null): {
  ref: string | null;
  installedVersion: string | null;
  refKind: CreativeWorkshopScriptRefKind;
} {
  if (!ref) {
    return { ref: null, installedVersion: null, refKind: 'unversioned' };
  }

  const decoded = safelyDecodeRef(ref);
  const semverMatch = decoded.match(SEMVER_RE);
  if (semverMatch) {
    return { ref: decoded, installedVersion: semverMatch[1], refKind: 'semver' };
  }
  if (FLOATING_REFS.has(decoded.toLowerCase())) {
    return { ref: decoded, installedVersion: null, refKind: 'floating' };
  }
  if (COMMIT_RE.test(decoded)) {
    return { ref: decoded, installedVersion: null, refKind: 'commit' };
  }
  return { ref: decoded, installedVersion: null, refKind: 'other-ref' };
}

export function inspectScriptImportUrl(importUrl: string): {
  repository: string | null;
  ref: string | null;
  installedVersion: string | null;
  refKind: CreativeWorkshopScriptRefKind;
} {
  let url: URL;
  try {
    url = new URL(importUrl);
  } catch {
    return { repository: null, ref: null, installedVersion: null, refKind: 'unknown' };
  }

  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);

  if (host.endsWith('jsdelivr.net') && segments[0] === 'gh' && segments.length >= 3) {
    const owner = segments[1];
    const repoAndRef = segments[2];
    const atIndex = repoAndRef.lastIndexOf('@');
    const repo = atIndex >= 0 ? repoAndRef.slice(0, atIndex) : repoAndRef;
    const ref = atIndex >= 0 ? repoAndRef.slice(atIndex + 1) : null;
    return {
      repository: owner && repo ? `${owner}/${repo}` : null,
      ...normalizeRef(ref),
    };
  }

  if (host === 'raw.githubusercontent.com' && segments.length >= 4) {
    const [owner, repo, ref] = segments;
    return {
      repository: owner && repo ? `${owner}/${repo}` : null,
      ...normalizeRef(ref || null),
    };
  }

  return { repository: null, ref: null, installedVersion: null, refKind: 'unknown' };
}

function extractScriptDependencies(input: {
  scope: CreativeWorkshopScriptScope;
  scriptId: string;
  scriptName: string;
  scriptEnabled: boolean;
  content: string;
}): CreativeWorkshopScriptDependency[] {
  return extractStaticImportUrls(input.content).map(importUrl => ({
    scope: input.scope,
    scriptId: input.scriptId,
    scriptName: input.scriptName,
    scriptEnabled: input.scriptEnabled,
    importUrl,
    ...inspectScriptImportUrl(importUrl),
  }));
}

export function listCreativeWorkshopScriptDependencies(): CreativeWorkshopScriptDependencySnapshot {
  const getTrees = getScriptTreeGetter();
  if (!getTrees) {
    return { supported: false, scripts: [] };
  }

  const scripts: CreativeWorkshopInstalledScript[] = [];
  for (const scope of SCRIPT_SCOPES) {
    try {
      scripts.push(...flattenScriptTrees(getTrees({ type: scope }), scope));
    } catch (error) {
      console.warn('[CreativeWorkshop] failed to inspect TavernHelper script tree', { scope, error });
    }
  }

  return { supported: true, scripts };
}
