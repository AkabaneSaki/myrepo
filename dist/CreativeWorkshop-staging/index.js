/******/ (() => { // webpackBootstrap
/******/ 	"use strict";

;// ./util/iframe_srcdoc.html
const iframe_srcdoc_namespaceObject = "<!doctype html>\r\n<html>\r\n<head>\r\n  <meta charset=\"utf-8\">\r\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\r\n</head>\r\n<body></body>\r\n</html>\r\n";
;// ./util/script.ts

function teleportStyle(appendTo = 'head') {
    const $div = $('<div>')
        .attr('script_id', getScriptId())
        .append($('head > style', document).clone())
        .appendTo(appendTo);
    return {
        destroy: () => $div.remove(),
    };
}
function createScriptIdIframe() {
    return $('<iframe>').attr({
        script_id: getScriptId(),
        frameborder: 0,
        srcdoc: iframe_srcdoc_namespaceObject,
    });
}

;// ./src/CreativeWorkshop/services/config.ts
const DEFAULT_CREATIVE_WORKSHOP_URL = "https://workshop-test.uika.cc.cd";
const CREATIVE_WORKSHOP_URL_VARIABLE_KEY = 'creative_workshop_worker_url';
function normalizeCreativeWorkshopUrl(url) {
    return url.trim().replace(/\/+$/, '');
}
function getCreativeWorkshopUrl() {
    const scriptId = getScriptId();
    const variables = getVariables({ type: 'script', script_id: scriptId });
    const customUrl = _.get(variables, CREATIVE_WORKSHOP_URL_VARIABLE_KEY);
    if (_.isString(customUrl) && customUrl.trim()) {
        return normalizeCreativeWorkshopUrl(customUrl);
    }
    return normalizeCreativeWorkshopUrl(DEFAULT_CREATIVE_WORKSHOP_URL);
}
function getCreativeWorkshopOrigin() {
    return new URL(getCreativeWorkshopUrl()).origin;
}

;// ./src/CreativeWorkshop/services/context.ts
function getCurrentCreativeWorkshopContext() {
    const charWorldbooks = getCharWorldbookNames('current');
    return {
        connected: true,
        characterName: getCurrentCharacterName(),
        worldbooks: {
            primary: charWorldbooks.primary,
            additional: charWorldbooks.additional || [],
            available: getWorldbookNames(),
        },
        regexEnabled: isCharacterTavernRegexesEnabled(),
        chatId: SillyTavern.getCurrentChatId(),
    };
}

;// ./src/CreativeWorkshop/version.ts
const CREATIVE_WORKSHOP_CLIENT_VERSION = "2.2.0-dev";

;// ./src/CreativeWorkshop/services/install-registry.ts
const CREATIVE_WORKSHOP_INSTALL_REGISTRY_KEY = 'creative_workshop_install_registry';
function getRegistryScopeKey() {
    return getCurrentCharacterName() || '__no_character__';
}
function readInstallRegistry() {
    const variables = getVariables({ type: 'script', script_id: getScriptId() });
    const raw = _.get(variables, CREATIVE_WORKSHOP_INSTALL_REGISTRY_KEY);
    return _.isObject(raw) ? raw : {};
}
function writeInstallRegistry(registry) {
    updateVariablesWith(variables => {
        _.set(variables, CREATIVE_WORKSHOP_INSTALL_REGISTRY_KEY, registry);
        return variables;
    }, { type: 'script', script_id: getScriptId() });
}
function getCreativeWorkshopInstallRecords() {
    return readInstallRegistry()[getRegistryScopeKey()] || {};
}
function getCreativeWorkshopInstallRecord(projectId) {
    return getCreativeWorkshopInstallRecords()[projectId] || null;
}
function getCreativeWorkshopBoundWorldbookNames() {
    const charWorldbooks = getCharWorldbookNames('current');
    let chatWorldbook = null;
    try {
        chatWorldbook = getChatWorldbookName('current');
    }
    catch {
        chatWorldbook = null;
    }
    return _.uniq([
        charWorldbooks.primary,
        ...(charWorldbooks.additional || []),
        ...getGlobalWorldbookNames(),
        chatWorldbook,
    ]).filter((name) => _.isString(name) && Boolean(name));
}
function getCreativeWorkshopRelevantWorldbookNames(projectId, legacyProjectName) {
    const charWorldbooks = getCharWorldbookNames('current');
    const registry = getCreativeWorkshopInstallRecords();
    const registryNames = projectId
        ? [registry[projectId]?.worldbookName, legacyProjectName ? registry[legacyProjectName]?.worldbookName : null]
        : Object.values(registry).map(record => record.worldbookName);
    let chatWorldbook = null;
    try {
        chatWorldbook = getChatWorldbookName('current');
    }
    catch {
        chatWorldbook = null;
    }
    return _.uniq([
        ...registryNames,
        charWorldbooks.primary,
        ...(charWorldbooks.additional || []),
        ...getGlobalWorldbookNames(),
        chatWorldbook,
    ]).filter((name) => _.isString(name) && Boolean(name));
}
async function resolveCreativeWorkshopInstallWorldbook(projectId, legacyProjectName) {
    const recorded = getCreativeWorkshopInstallRecord(projectId) ||
        (legacyProjectName ? getCreativeWorkshopInstallRecord(legacyProjectName) : null);
    if (recorded?.worldbookName)
        return recorded.worldbookName;
    if (recorded && recorded.worldbookName === null)
        return null;
    const candidates = getCreativeWorkshopRelevantWorldbookNames(projectId, legacyProjectName);
    const existingNames = new Set(getWorldbookNames());
    for (const worldbookName of candidates) {
        if (!existingNames.has(worldbookName))
            continue;
        const entries = await getWorldbook(worldbookName);
        if (entries.some(entry => _.get(entry, 'extra.cw_project_id') === projectId ||
            _.get(entry, 'extra.fate_project_name') === projectId ||
            Boolean(legacyProjectName && _.get(entry, 'extra.cw_project_id') === legacyProjectName) ||
            Boolean(legacyProjectName && _.get(entry, 'extra.fate_project_name') === legacyProjectName))) {
            return worldbookName;
        }
    }
    return null;
}
function setCreativeWorkshopInstallRecord(projectId, patch) {
    const registry = readInstallRegistry();
    const scopeKey = getRegistryScopeKey();
    registry[scopeKey] = registry[scopeKey] || {};
    const current = registry[scopeKey][projectId];
    registry[scopeKey][projectId] = {
        projectId,
        worldbookName: patch.worldbookName !== undefined ? patch.worldbookName : current?.worldbookName ?? null,
        installedVersion: patch.installedVersion !== undefined ? patch.installedVersion : current?.installedVersion ?? null,
        originalEntryStates: patch.originalEntryStates !== undefined ? patch.originalEntryStates : current?.originalEntryStates ?? [],
        installedAt: Date.now(),
    };
    writeInstallRegistry(registry);
}
function deleteCreativeWorkshopInstallRecord(projectId) {
    const registry = readInstallRegistry();
    const scopeKey = getRegistryScopeKey();
    if (!registry[scopeKey]?.[projectId])
        return;
    delete registry[scopeKey][projectId];
    if (Object.keys(registry[scopeKey]).length === 0) {
        delete registry[scopeKey];
    }
    writeInstallRegistry(registry);
}

;// ./src/CreativeWorkshop/services/project-fetch.ts

const CREATIVE_WORKSHOP_CACHE_KEY = 'creative_workshop_cache';
const PROJECT_DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;
const WORLDBOOK_SOURCE_CACHE_TTL_MS = 30 * 60 * 1000;
function getCreativeWorkshopCacheStore() {
    const variables = getVariables({ type: 'script', script_id: getScriptId() });
    const cache = _.get(variables, CREATIVE_WORKSHOP_CACHE_KEY);
    return _.isObject(cache) ? cache : {};
}
function writeCreativeWorkshopCacheStore(cache) {
    updateVariablesWith(variables => {
        _.set(variables, CREATIVE_WORKSHOP_CACHE_KEY, cache);
        return variables;
    }, { type: 'script', script_id: getScriptId() });
}
function pruneCreativeWorkshopCacheStore(cache) {
    const now = Date.now();
    cache.projectDetails = _.pickBy(cache.projectDetails || {}, entry => now - entry.cachedAt <= PROJECT_DETAIL_CACHE_TTL_MS * 3);
    cache.worldbookSources = _.pickBy(cache.worldbookSources || {}, entry => now - entry.cachedAt <= WORLDBOOK_SOURCE_CACHE_TTL_MS * 3);
    return cache;
}
function invalidateCreativeWorkshopProjectCache(projectId) {
    const cache = getCreativeWorkshopCacheStore();
    if (cache.projectDetails)
        delete cache.projectDetails[projectId];
    if (cache.worldbookSources)
        delete cache.worldbookSources[projectId];
    writeCreativeWorkshopCacheStore(cache);
}
function getCachedProjectDetail(projectId, expectedVersion) {
    const cache = getCreativeWorkshopCacheStore();
    const entry = cache.projectDetails?.[projectId];
    if (!entry ||
        Date.now() - entry.cachedAt > PROJECT_DETAIL_CACHE_TTL_MS ||
        (expectedVersion && _.get(entry.data, 'project.version') !== expectedVersion)) {
        return null;
    }
    return entry.data;
}
function setCachedProjectDetail(projectId, data) {
    const cache = pruneCreativeWorkshopCacheStore(getCreativeWorkshopCacheStore());
    cache.projectDetails = cache.projectDetails || {};
    cache.projectDetails[projectId] = {
        cachedAt: Date.now(),
        data,
    };
    writeCreativeWorkshopCacheStore(cache);
}
function getCachedWorldbookSource(projectId, downloadUrl, projectVersion) {
    const cache = getCreativeWorkshopCacheStore();
    const entry = cache.worldbookSources?.[projectId];
    if (!entry ||
        entry.downloadUrl !== downloadUrl ||
        Date.now() - entry.cachedAt > WORLDBOOK_SOURCE_CACHE_TTL_MS ||
        (projectVersion && entry.projectVersion !== projectVersion)) {
        return null;
    }
    return entry.data;
}
function getAnyCachedWorldbookSource(projectId, downloadUrl, projectVersion) {
    const cache = getCreativeWorkshopCacheStore();
    const entry = cache.worldbookSources?.[projectId];
    return entry?.downloadUrl === downloadUrl && (!projectVersion || entry.projectVersion === projectVersion)
        ? entry.data
        : null;
}
function setCachedWorldbookSource(projectId, downloadUrl, projectVersion, data) {
    const cache = pruneCreativeWorkshopCacheStore(getCreativeWorkshopCacheStore());
    cache.worldbookSources = cache.worldbookSources || {};
    cache.worldbookSources[projectId] = {
        cachedAt: Date.now(),
        downloadUrl,
        projectVersion,
        data,
    };
    writeCreativeWorkshopCacheStore(cache);
}
function normalizeWorldbookSourceEntries(raw) {
    const entryKey = (entry, index, objectKey) => {
        if (objectKey !== undefined)
            return `object:${objectKey}`;
        const uid = entry.uid ?? _.get(entry, 'extensions.cw_entry_id');
        return uid !== undefined && uid !== null ? `uid:${String(uid)}` : `index:${index}`;
    };
    if (Array.isArray(raw)) {
        return raw
            .filter(_.isObject)
            .map((entry, index) => ({ ...entry, __cwEntryKey: entryKey(entry, index) }));
    }
    const container = _.get(raw, 'entries');
    if (Array.isArray(container)) {
        return container
            .filter(_.isObject)
            .map((entry, index) => ({ ...entry, __cwEntryKey: entryKey(entry, index) }));
    }
    if (_.isObject(container)) {
        return Object.entries(container)
            .filter(([, entry]) => _.isObject(entry))
            .map(([objectKey, entry], index) => ({
            ...entry,
            __cwEntryKey: entryKey(entry, index, objectKey),
        }));
    }
    return [];
}
async function fetchCreativeWorkshopProjectWorldbookSource(projectDetail) {
    const projectId = _.get(projectDetail, 'project.id');
    const downloadUrl = _.get(projectDetail, 'project.downloadUrl');
    const projectVersion = _.isString(_.get(projectDetail, 'project.version'))
        ? String(_.get(projectDetail, 'project.version'))
        : null;
    if (!_.isString(downloadUrl) || !downloadUrl) {
        return [];
    }
    if (_.isString(projectId) && projectId) {
        const cached = getCachedWorldbookSource(projectId, downloadUrl, projectVersion || undefined);
        if (cached) {
            return cached;
        }
    }
    try {
        const response = await fetch(downloadUrl, {
            cache: 'no-store',
        });
        if (!response.ok) {
            throw new Error(`获取世界书原始配置失败: ${response.status}`);
        }
        const raw = await response.json();
        const normalized = normalizeWorldbookSourceEntries(raw);
        if (_.isString(projectId) && projectId) {
            setCachedWorldbookSource(projectId, downloadUrl, projectVersion, normalized);
        }
        return normalized;
    }
    catch (error) {
        if (_.isString(projectId) && projectId) {
            const fallback = getAnyCachedWorldbookSource(projectId, downloadUrl, projectVersion || undefined);
            if (fallback) {
                console.warn('[CreativeWorkshop] 使用缓存的世界书源文件', { projectId, error });
                return fallback;
            }
        }
        throw error;
    }
}
async function fetchCreativeWorkshopProjectDetail(projectId, expectedVersion) {
    const cached = getCachedProjectDetail(projectId, expectedVersion);
    if (cached) {
        return cached;
    }
    let receivedVersionMismatch = false;
    try {
        const versionQuery = expectedVersion ? `?v=${encodeURIComponent(expectedVersion)}` : '';
        const response = await fetch(`${getCreativeWorkshopUrl()}/api/projects/${projectId}${versionQuery}`, {
            cache: expectedVersion ? 'no-store' : 'no-cache',
        });
        if (!response.ok) {
            throw new Error(`获取云端项目详情失败: ${response.status}`);
        }
        const data = await response.json();
        if (!data?.project) {
            throw new Error('云端项目详情数据异常');
        }
        if (expectedVersion && data.project.version !== expectedVersion) {
            receivedVersionMismatch = true;
            throw new Error(`云端项目版本不一致：期望 ${expectedVersion}，实际 ${data.project.version || '未知'}，已中止安装以避免使用旧缓存`);
        }
        const normalized = {
            project: data.project,
            worldbookEntriesPreview: Array.isArray(data.worldbookEntriesPreview) ? data.worldbookEntriesPreview : [],
            regexEntriesPreview: Array.isArray(data.regexEntriesPreview) ? data.regexEntriesPreview : [],
        };
        setCachedProjectDetail(projectId, normalized);
        return normalized;
    }
    catch (error) {
        if (receivedVersionMismatch)
            throw error;
        const fallback = getCreativeWorkshopCacheStore().projectDetails?.[projectId]?.data;
        if (fallback && (!expectedVersion || _.get(fallback, 'project.version') === expectedVersion)) {
            console.warn('[CreativeWorkshop] 使用缓存的项目详情', { projectId, expectedVersion, error });
            return fallback;
        }
        throw error;
    }
}
async function fetchCreativeWorkshopReferenceVersionItems(referenceVersionId) {
    if (!referenceVersionId)
        return [];
    const response = await fetch(`${getCreativeWorkshopUrl()}/api/character-references/versions/${encodeURIComponent(referenceVersionId)}/items`, { cache: 'no-store' });
    if (!response.ok) {
        throw new Error(`读取原版内容失败: ${response.status}`);
    }
    const data = await response.json();
    return Array.isArray(data?.items)
        ? data.items
            .filter((item) => _.isObject(item))
            .map((item) => ({
            id: String(item.id || ''),
            referenceVersionId: String(item.referenceVersionId || referenceVersionId),
            kind: item.kind === 'regex' ? 'regex' : 'worldbook',
            sourceKey: _.isString(item.sourceKey) ? String(item.sourceKey) : null,
            displayName: String(item.displayName || ''),
        }))
            .filter((item) => Boolean(item.id && item.displayName))
        : [];
}

;// ./src/CreativeWorkshop/services/project-type.ts
const CREATIVE_WORKSHOP_PROJECT_TYPES = ['系统核心', '扩展', '角色', '事件'];
const CREATIVE_WORKSHOP_EXTENSION_TYPES = (/* unused pure expression or super */ null && (['规则', '内容']));
const CREATIVE_WORKSHOP_NAME_FORMAT_VERSION = 3;
function normalizeProjectType(value) {
    if (typeof value !== 'string')
        return null;
    const normalized = value.trim();
    if (normalized === '系统')
        return '系统核心';
    return CREATIVE_WORKSHOP_PROJECT_TYPES.includes(normalized)
        ? normalized
        : null;
}
function normalizeExtensionType(value) {
    if (typeof value !== 'string')
        return null;
    const normalized = value.trim();
    return CREATIVE_WORKSHOP_EXTENSION_TYPES.includes(normalized)
        ? normalized
        : null;
}
function normalizeLegacyTags(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .filter((tag) => typeof tag === 'string')
        .map(tag => tag.trim())
        .filter(Boolean);
}
function resolveCreativeWorkshopProjectType(project) {
    if (!project || typeof project !== 'object')
        return '系统核心';
    const explicitType = normalizeProjectType(project.projectType ?? project.project_type);
    if (explicitType)
        return explicitType;
    const tags = normalizeLegacyTags(project.tags);
    if (tags.includes('系统') || tags.includes('系统核心'))
        return '系统核心';
    if (tags.includes('角色'))
        return '角色';
    if (tags.includes('事件'))
        return '事件';
    if (tags.includes('扩展'))
        return '扩展';
    return '系统核心';
}
function resolveCreativeWorkshopExtensionType(project) {
    if (!project || resolveCreativeWorkshopProjectType(project) !== '扩展')
        return null;
    return normalizeExtensionType(project.extensionType ?? project.extension_type);
}
function getCreativeWorkshopProjectTypeLabel(project) {
    const projectType = resolveCreativeWorkshopProjectType(project);
    if (projectType !== '扩展')
        return projectType;
    const extensionType = resolveCreativeWorkshopExtensionType(project);
    return extensionType ? `${extensionType}扩展` : '扩展';
}
function getCreativeWorkshopDlcCategory(project) {
    const projectType = resolveCreativeWorkshopProjectType(project);
    return projectType === '系统核心' ? '命定系统' : projectType;
}
function readLeadingBracketSegment(value, offset) {
    const match = value.slice(offset).match(/^\[([^\[\]]+)\]/);
    if (!match)
        return null;
    return { value: match[1], end: offset + match[0].length };
}
function getExistingDlcCategory(entryName) {
    const dlc = readLeadingBracketSegment(entryName, 0);
    if (!dlc || dlc.value !== 'DLC')
        return null;
    return readLeadingBracketSegment(entryName, dlc.end)?.value || null;
}
function stripExistingDlcHeader(entryName) {
    const dlc = readLeadingBracketSegment(entryName, 0);
    if (!dlc || dlc.value !== 'DLC')
        return entryName;
    const category = readLeadingBracketSegment(entryName, dlc.end);
    if (!category)
        return entryName.slice(dlc.end);
    const third = readLeadingBracketSegment(entryName, category.end);
    if (!third)
        return entryName.slice(category.end);
    // v3: [DLC][category][WS]author content
    if (third.value === 'WS')
        return entryName.slice(third.end);
    const fourth = readLeadingBracketSegment(entryName, third.end);
    // v2: [DLC][category][project][WS]author content
    if (fourth?.value === 'WS') {
        const authorContent = entryName.slice(fourth.end);
        // Some already-damaged v2 names contain no author suffix. Preserve the old
        // third segment as a human-readable fallback rather than returning blank.
        return authorContent || `[${third.value}]`;
    }
    // Source/legacy entries commonly use the third segment as the actual entry
    // title, e.g. [DLC][扩展][种族-地精]. Preserve it instead of eating it.
    return entryName.slice(category.end);
}
function stripLegacyCorePrefix(entryName) {
    if (entryName.startsWith('命定系统-'))
        return entryName.slice('命定系统-'.length);
    if (entryName.startsWith('[命定系统]'))
        return entryName.slice('[命定系统]'.length);
    return entryName;
}
function formatCreativeWorkshopEntryName(entryName, project, _projectName) {
    const projectType = resolveCreativeWorkshopProjectType(project);
    let authorContent = stripExistingDlcHeader(entryName);
    if (projectType === '系统核心')
        authorContent = stripLegacyCorePrefix(authorContent);
    const category = getExistingDlcCategory(entryName) || getCreativeWorkshopDlcCategory(project);
    return `[DLC][${category}][WS]${authorContent}`;
}

;// ./src/CreativeWorkshop/services/regex-name.ts
function getReadableRegexName(projectName, entry, index) {
    const name = entry.scriptName || entry.script_name || entry.id || `正则${index + 1}`;
    return String(name).startsWith('[工坊]') ? String(name) : `[工坊] ${projectName} - ${name}`;
}
function getCreativeWorkshopRegexEntryKey(entry, index) {
    if (typeof entry.entryKey === 'string' && entry.entryKey)
        return entry.entryKey;
    if (entry.id !== undefined && entry.id !== null)
        return `id:${String(entry.id)}`;
    return `index:${index}`;
}
function getCreativeWorkshopManagedRegexId(projectId, entry, index) {
    return `creative_workshop:${projectId}:${getCreativeWorkshopRegexEntryKey(entry, index)}`;
}
function getCreativeWorkshopRegexId(regex) {
    return String(regex.id || regex.script_name || '');
}

;// ./src/CreativeWorkshop/services/diff.ts




const CREATIVE_WORKSHOP_DIFF_CACHE_KEY = 'creative_workshop_diff_cache';
const PROJECT_DIFF_CACHE_TTL_MS = 5 * 60 * 1000;
const DIFF_IDENTITY_VERSION = 2;
function getCreativeWorkshopDiffCache() {
    const variables = getVariables({ type: 'script', script_id: getScriptId() });
    const cache = _.get(variables, CREATIVE_WORKSHOP_DIFF_CACHE_KEY);
    return _.isObject(cache) ? cache : {};
}
function writeCreativeWorkshopDiffCache(cache) {
    updateVariablesWith(variables => {
        _.set(variables, CREATIVE_WORKSHOP_DIFF_CACHE_KEY, cache);
        return variables;
    }, { type: 'script', script_id: getScriptId() });
}
function pruneCreativeWorkshopDiffCache(cache) {
    const now = Date.now();
    return _.pickBy(cache, entry => now - entry.cachedAt <= PROJECT_DIFF_CACHE_TTL_MS * 3);
}
function normalizeWorldbookEntry(entry) {
    const comment = _.get(entry, 'comment', entry.name);
    const entryKey = _.get(entry, 'extra.cw_entry_key');
    return {
        entryKey: _.isString(entryKey) && entryKey ? entryKey : comment,
        name: entry.name,
        comment,
        content: entry.content,
        key: JSON.stringify(entry.strategy.keys || []),
        keysecondary: JSON.stringify(entry.strategy.keys_secondary?.keys || []),
    };
}
function normalizeRemoteEntry(entry, projectId, index, project, projectName) {
    const comment = entry.comment || '无标题';
    const rawEntryKey = _.get(entry, 'entryKey');
    const entryKey = _.isString(rawEntryKey) && rawEntryKey ? `${projectId}:${rawEntryKey}` : `${projectId}:${index}`;
    return {
        entryKey,
        name: formatCreativeWorkshopEntryName(comment, project, projectName),
        comment,
        content: entry.content || '',
        key: JSON.stringify(Array.isArray(entry.key) ? entry.key : []),
        keysecondary: JSON.stringify(Array.isArray(entry.keysecondary) ? entry.keysecondary : []),
    };
}
function diffByKey(localItems, remoteItems, keyGetter) {
    const localMap = new Map(localItems.map(item => [keyGetter(item), item]));
    const remoteMap = new Map(remoteItems.map(item => [keyGetter(item), item]));
    const added = remoteItems.filter(item => !localMap.has(keyGetter(item)));
    const removed = localItems.filter(item => !remoteMap.has(keyGetter(item)));
    const modified = remoteItems.filter(item => {
        const key = keyGetter(item);
        return localMap.has(key) && JSON.stringify(localMap.get(key)) !== JSON.stringify(item);
    });
    return { added, removed, modified };
}
async function getCreativeWorkshopProjectDiff(projectId, expectedVersion, legacyProjectName) {
    const detail = await fetchCreativeWorkshopProjectDetail(projectId, expectedVersion);
    const charWorldbooks = getCharWorldbookNames('current');
    const worldbookName = (await resolveCreativeWorkshopInstallWorldbook(projectId, legacyProjectName)) || charWorldbooks.primary;
    const worldbookEntries = worldbookName && getWorldbookNames().includes(worldbookName)
        ? await getWorldbook(worldbookName)
        : [];
    const localEntries = worldbookEntries
        .filter(entry => _.get(entry, 'extra.cw_project_id') === projectId ||
        _.get(entry, 'extra.fate_project_name') === projectId ||
        Boolean(legacyProjectName && _.get(entry, 'extra.cw_project_id') === legacyProjectName) ||
        Boolean(legacyProjectName && _.get(entry, 'extra.fate_project_name') === legacyProjectName))
        .map(normalizeWorldbookEntry);
    const localEntryKeys = new Set(localEntries.map(entry => entry.entryKey));
    const remoteEntries = (detail.worldbookEntriesPreview || []).map((entry, index) => {
        const normalized = normalizeRemoteEntry(entry, projectId, index, detail.project, detail.project.name || legacyProjectName || '未命名项目');
        const legacyEntryKey = `${projectId}:${index}`;
        return !localEntryKeys.has(normalized.entryKey) && localEntryKeys.has(legacyEntryKey)
            ? { ...normalized, entryKey: legacyEntryKey }
            : normalized;
    });
    const localRegexes = getTavernRegexes({ scope: 'character', enable_state: 'all' })
        .filter(regex => {
        const regexId = getCreativeWorkshopRegexId(regex);
        return regexId.startsWith(`creative_workshop:${projectId}:`) ||
            Boolean(legacyProjectName && regexId.startsWith(`creative_workshop:${legacyProjectName}:`));
    })
        .map(regex => ({
        id: getCreativeWorkshopRegexId(regex),
        scriptName: String(regex.script_name || regex.id || ''),
        findRegex: regex.find_regex,
        replaceString: regex.replace_string,
    }));
    const remoteRegexes = (detail.regexEntriesPreview || []).map((entry, index) => ({
        id: getCreativeWorkshopManagedRegexId(projectId, entry, index),
        scriptName: getReadableRegexName(detail.project.name || '未命名项目', entry, index),
        findRegex: entry.findRegex || '',
        replaceString: entry.replaceString || '',
    }));
    const localSignature = JSON.stringify({
        identityVersion: DIFF_IDENTITY_VERSION,
        localEntries,
        localRegexes,
    });
    const remoteVersion = _.get(detail, 'project.version', null);
    const cached = getCreativeWorkshopDiffCache()[projectId];
    if (cached &&
        cached.localSignature === localSignature &&
        cached.remoteVersion === remoteVersion &&
        Date.now() - cached.cachedAt <= PROJECT_DIFF_CACHE_TTL_MS) {
        return cached.data;
    }
    const entryDiff = diffByKey(localEntries, remoteEntries, item => item.entryKey);
    const regexDiff = diffByKey(localRegexes, remoteRegexes, item => item.id);
    const result = {
        projectId,
        diff: {
            added: {
                worldbookEntries: entryDiff.added,
                regexEntries: regexDiff.added,
            },
            modified: {
                worldbookEntries: entryDiff.modified,
                regexEntries: regexDiff.modified,
            },
            removed: {
                worldbookEntries: entryDiff.removed,
                regexEntries: regexDiff.removed,
            },
        },
    };
    const cache = pruneCreativeWorkshopDiffCache(getCreativeWorkshopDiffCache());
    cache[projectId] = {
        cachedAt: Date.now(),
        localSignature,
        remoteVersion,
        data: result,
    };
    writeCreativeWorkshopDiffCache(cache);
    return result;
}

;// ./src/CreativeWorkshop/services/install-state.ts


const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
async function readWorldbookEntries(worldbookName, boundNames) {
    if (!getWorldbookNames().includes(worldbookName)) {
        if (!boundNames.has(worldbookName)) {
            return { worldbookName, entries: [], readable: true };
        }
        return { worldbookName, entries: [], readable: false };
    }
    try {
        return { worldbookName, entries: await getWorldbook(worldbookName), readable: true };
    }
    catch (error) {
        console.warn('[CreativeWorkshop] 无法读取安装目标世界书', { worldbookName, error });
        return { worldbookName, entries: [], readable: false };
    }
}
async function refreshWorldbookReadiness() {
    const tavernContext = SillyTavern.getContext?.() || SillyTavern;
    try {
        await tavernContext.updateWorldInfoList?.();
    }
    catch (error) {
        console.warn('[CreativeWorkshop] 无法刷新世界书列表', error);
    }
}
async function readRelevantWorldbooksWithRetry() {
    const initialNames = getCreativeWorkshopRelevantWorldbookNames();
    const initialBoundNames = new Set(getCreativeWorkshopBoundWorldbookNames());
    const firstRows = await Promise.all(initialNames.map(worldbookName => readWorldbookEntries(worldbookName, initialBoundNames)));
    const unreadableNames = firstRows.filter(row => !row.readable).map(row => row.worldbookName);
    if (unreadableNames.length === 0)
        return firstRows;
    await refreshWorldbookReadiness();
    const refreshedNames = _.uniq([...initialNames, ...getCreativeWorkshopRelevantWorldbookNames()]);
    const refreshedBoundNames = new Set(getCreativeWorkshopBoundWorldbookNames());
    const readableRowsByName = new Map(firstRows.filter(row => row.readable).map(row => [row.worldbookName, row]));
    return Promise.all(refreshedNames.map(worldbookName => readableRowsByName.get(worldbookName) || readWorldbookEntries(worldbookName, refreshedBoundNames)));
}
async function scanInstalledCreativeWorkshopProjects() {
    const registry = getCreativeWorkshopInstallRecords();
    const worldbookRows = await readRelevantWorldbooksWithRetry();
    const unreadableWorldbookNames = worldbookRows.filter(row => !row.readable).map(row => row.worldbookName);
    const worldbooks = worldbookRows.filter(row => row.readable);
    const entryRows = worldbooks.flatMap(({ worldbookName, entries }) => entries
        .filter(entry => _.isString(_.get(entry, 'extra.cw_project_id')) || _.isString(_.get(entry, 'extra.fate_project_name')))
        .map(entry => ({ worldbookName, entry })));
    const groupedEntries = _.groupBy(entryRows, row => String(_.get(row.entry, 'extra.cw_project_id') || _.get(row.entry, 'extra.fate_project_name')));
    const regexes = getTavernRegexes({ scope: 'character', enable_state: 'all' });
    const groupedRegexes = _.groupBy(regexes.filter(regex => getCreativeWorkshopRegexId(regex).startsWith('creative_workshop:')), regex => getCreativeWorkshopRegexId(regex).split(':')[1] || '');
    const projects = _.uniq([...Object.keys(groupedEntries), ...Object.keys(groupedRegexes)])
        .filter(Boolean)
        .map(projectId => {
        const projectRows = groupedEntries[projectId] || [];
        const projectEntries = projectRows.map(row => row.entry);
        const projectRegexes = groupedRegexes[projectId] || [];
        const firstEntry = projectEntries[0];
        const firstRegex = projectRegexes[0];
        const localVersion = registry[projectId]?.installedVersion ||
            (firstEntry ? _.get(firstEntry, 'extra.cw_project_version', null) : null);
        const legacyProjectName = projectEntries
            .map(entry => _.get(entry, 'extra.fate_project_name'))
            .find(value => _.isString(value) && Boolean(value)) ||
            (!UUID_PATTERN.test(projectId) ? projectId : null);
        const projectNameHint = projectEntries
            .map(entry => _.get(entry, 'extra.cw_project_name_display'))
            .find(value => _.isString(value) && Boolean(String(value).trim()));
        return {
            projectId,
            installedProjectId: projectId,
            projectNameHint: _.isString(projectNameHint) ? projectNameHint.trim() : legacyProjectName,
            name: firstEntry
                ? _.get(firstEntry, 'extra.cw_project_name_display', legacyProjectName || _.get(firstEntry, 'name', '未命名项目'))
                : legacyProjectName || _.get(firstRegex, 'script_name', '未命名项目'),
            legacyProjectName,
            localVersion,
            remoteVersion: null,
            entryCount: projectEntries.length,
            regexCount: projectRegexes.length,
            canUpdate: false,
            hasUpdate: false,
            worldbookName: registry[projectId]?.worldbookName || projectRows[0]?.worldbookName || null,
        };
    });
    return {
        projects,
        complete: unreadableWorldbookNames.length === 0,
        unreadableWorldbookNames,
    };
}
async function listInstalledCreativeWorkshopProjects() {
    return (await scanInstalledCreativeWorkshopProjects()).projects;
}

;// ./data/official-card-baselines/poem-of-destiny/v4.3.3/worldbook-fingerprints.json
const worldbook_fingerprints_namespaceObject = /*#__PURE__*/JSON.parse('{"format":"poem-workshop-official-worldbook-fingerprints","format_version":2,"character_version":"V4.3.3","source_png_sha256":"3cfd1900fef981ebe88486ab216a855d5e952f8ff5c25a14bc4a00eeb8e1cca7","fingerprint_fields":["name","content"],"count":97,"entries":[{"source_entry_id":1485,"name":"[DLC][角色][雌小鬼与熟女与龙][雌小鬼与熟女与龙-Spaceperson]奥希莉雅·骸响龙姬","fingerprint":"54e43c5887da580c3e934bffca78c9b2d509510622d868a65bdca1bf7b07b29c","content_sha256":"23c07ad26747234a7b9340c79939478c766d68b205366e73ce2acb7403cd7791"},{"source_entry_id":6042,"name":"[DLC][角色][仲夏夜之梦]诗灵-仲夏夜之梦(Angtuck-诗灵,是仲夏夜之梦，不是仲夏夜之淫梦！！！)","fingerprint":"38fcb0bd5c5ed47f395a36a69dfcd734aa76a0562c51145b4992df61be0a2297","content_sha256":"dd22468958caabc683081dc970206fa591489ee527c9d3e072def1029f1ac6d3"},{"source_entry_id":9217,"name":"[DLC][扩展][男娘扮演功能]男娘扮演功能(快乐柠萌茶-提供男娘形象设定：娇小女性化外表、穿女装、被误认为女性的扮演规则)","fingerprint":"68b66f6116366f42fbd95a25e5fbc4fc373253c5cb049c5e0c79b78a9c61705b","content_sha256":"780be133689cb3c5c7d6961452337603b5f3fce6c01264de2dcb2dfa0542a742"},{"source_entry_id":14450,"name":"[DLC][扩展][种族-羽民]羽民(镜梦幻-添加堕天使羽民，黑色翅膀的翼民)","fingerprint":"3ae1b251e24eb892c73ec7626141c0d9244217ab18acdbaf17d069b8cefc8cd8","content_sha256":"ac1905f31ceb551b80a52788e83253a4480b58d1f4510fe35aebc8663dbc115d"},{"source_entry_id":19348,"name":"[DLC][事件][关于我战败后被血族女王变成女儿的那些事][<莉莉娅丝]【血姬】血姬-入口(Hilo-懒得喷)","fingerprint":"ef79d707a3ec9285c6bf427f0258c3c614c95afd3d864b44ae2aa6c0bcee2875","content_sha256":"2693aeb5332ed94c73e9d6a4759c0c7a72dd854bd84d92879a04bc0352d2eb57"},{"source_entry_id":31541,"name":"[DLC][事件][双子星的咏叹调]【双子】双子星的咏叹调-本体(H一串-略)","fingerprint":"a6a5413517e6a336655e3d3493ac35d3d805aa813a2df661257f06df2c9dd94b","content_sha256":"1c668b69d23016bc2f8bb630db9170d47fdf79ab50238f6ab9f39f5c98af84e7"},{"source_entry_id":31732,"name":"[DLC][角色][维奥莱塔]维奥莱塔(奥古斯提姆女皇)","fingerprint":"2ccc9cfe2a932e45f86f263244f8f4380c081cd0fef2ce4495faaf6b1e43a78d","content_sha256":"432ea1a0dc6ef4b2ec8e8f0eda4060a2250d01cf154638ed58839359cc2f1474"},{"source_entry_id":40467,"name":"[DLC][事件][群山回响]【群山回响】群山回响-本体(Aerra-关于我莫名其妙加入了矮人萝莉组织的远征然后一路干死一堆牛鬼蛇神后成功帮助矮人复国的这件事)","fingerprint":"a19b60f990c154ccb61eb8f893094790342724cfbf650e734075468d2c7e8963","content_sha256":"55cb63d6e3ca10100dc0b01fb1aa959489546816c5c266c0033507cd61497d23"},{"source_entry_id":57682,"name":"[DLC][扩展][迷宫经济生态与冒险产业]迷宫经济生态与冒险产业(Aoo-迷宫饭式地下城设定，地下城经营必开)","fingerprint":"aae36ebb69d155515bafa3f5c4be550ef885036e79f535ffa8b9f70e3453fb26","content_sha256":"10c11a22f0cc5be94eb3431a186aa72163d22de7ea731ad6efeb9484696b5df3"},{"source_entry_id":60504,"name":"[DLC][角色][弗洛洛]弗洛洛角色卡DLC(彼岸花开局必开_作者十七）","fingerprint":"86f3f442cd139429cf24314d1d353af76d7260d31c0e1f6bb0003c2c071e106e","content_sha256":"d84c393ef424d80e6b3378a7b96b752d0a53380ed44fee1cb57d63df2f3febef"},{"source_entry_id":62110,"name":"[DLC][扩展][边陲之国]悲叹之城-迷雾森林","fingerprint":"fd8da1ed3015afa8bd2e1f9a3e17845067cd9be850e5807b53fd4e87d2c5d6f6","content_sha256":"32e71f010b6153c2971966693eec9caca545b8be4dda21081d5b76dbf58d3e1f"},{"source_entry_id":112306,"name":"[DLC][角色][丝特拉]丝特拉(△一串-「燃烧心火，击溃其身」)","fingerprint":"70a7b111601fce7cbaf79c12ecd0cd4a3ae8b3e86dff4991aa42918550b0ac30","content_sha256":"7cbf318983079ed414775f1c0044046f9e1306a2083fdaa45743fdbc5d9cee92"},{"source_entry_id":115333,"name":"[DLC][扩展][种族-英灵]英灵(△一串-历史传说投影, 纯魔力灵基, 执掌宝具与权能, 需定契约补魔体液交换)","fingerprint":"713a531be04d1cb514cdee3d46e865f0113e641124b0b00c0e41fce43c9635b2","content_sha256":"db470da2524ccdc1b0e34c084f1495016e92333edee97b3cacbf4e313fd16ff8"},{"source_entry_id":116217,"name":"[DLC][事件][关于我战败后被血族女王变成女儿的那些事]【血姬】血姬-本体","fingerprint":"f8264067319a7432470c4d33f387f4102a07bbe4d9ab5077ae3fda692f5afbf7","content_sha256":"e8eb918b7f811101cb1f3e1da5199b362f6645578ce4b8917679a6dc02e0f7fa"},{"source_entry_id":130146,"name":"[DLC][扩展][史莱姆扩展]雨(风见幽冷-添加史莱姆雨并完善生态)","fingerprint":"2f92fe1c0bcb4b21c4410ccba6b7d0a7f032dd82cf36cbfd018b03ad55d14467","content_sha256":"f936bf05c5521f5bd4dbc5c1f6b794d0d58802d092f9e768f18104013e020d80"},{"source_entry_id":133715,"name":"[DLC][扩展][克苏鲁扩展]怪物生态-黑山羊幼崽(风见幽冷，Aoo改)","fingerprint":"93f90fc6dfcc4e4bf2cd72c35a8077e6bf13eb6ea21605a291050dd83fc87d97","content_sha256":"e57b88e782016399813a50906f89d461783af0a91cd118a92d7d8fccd8feb49c"},{"source_entry_id":150852,"name":"[DLC][角色][瑞丝]瑞丝(rhys-血族,棺材里的少女,可能被埋在了索伦蒂斯或奥古斯提姆)","fingerprint":"2f8d72a0d885eeddb1337672ecd716f831ac68765019f6e316dd84affb16a135","content_sha256":"1709cfed686c74a433f309ba83a229dac56ef142993d86c427325aec616aa0db"},{"source_entry_id":164431,"name":"[DLC][扩展][无尽地城扩展]无尽地城-详情(Hilo-为无尽树海的无尽地城提供114层15区块的详细设定，包含层级追踪系统、区块环境/怪物/战利品配置，当前已实现前7区块的完整内容)","fingerprint":"6dbab21f7a24e98265fd0abc99479abd9c65fc0efa380b22ee9bb96b83c1b979","content_sha256":"9930f0487dfb035f0809e7c7a0749ee0d08ec8d8d7622ce0e912d0d0799dc025"},{"source_entry_id":170954,"name":"[DLC][扩展][边陲之国]悲叹之城-双生堡垒","fingerprint":"2f7909659438fada8e37454f18e6da7ab6d590fa327ebf10f4d86052b4fa0175","content_sha256":"c913d355ee457f0045c711f2eaab544562b0ae6a214f69077e2f47f42ae9dfbc"},{"source_entry_id":180667,"name":"[DLC][角色][奥琳科·乌尔芬]奥琳科(elfa-北边 很冷的北边)","fingerprint":"38c301f38558daca9dd097fb73456a3a5dc986eb2db7caae721aac66418c411d","content_sha256":"366f90e70498959a70615e1daeff5574fe7dcc8e0f80d37ec254ab5a3d74fdda"},{"source_entry_id":186146,"name":"[DLC][角色][哈桑]哈桑(萨赫拉联邦静寂之王-编者注:唉，又一个写自传的，自恋狂|编者S注:已删了日轻警告，这也日轻？)","fingerprint":"0a7cdb0975ad458b1372c5681c14069c46b9ee0acdf2ada2c1811651407b8216","content_sha256":"2164dc6f57e168d06430a010e93786e5e08c6e9118a06b744f9966ace611f6e9"},{"source_entry_id":194659,"name":"[DLC][扩展][边陲之国]外围村落-白教区","fingerprint":"370af7b77fe0c0076b4f4d99e32bf4bb79f7d835c441d3b6f0f10cb55a206d04","content_sha256":"2d7b8743da08b412bb9b6f32fd9d8e0efbeab9cb5e2dabf001510bd484e5c807"},{"source_entry_id":199544,"name":"[DLC][扩展][克苏鲁扩展]种族-拜亚基(风见幽冷，Aoo改)","fingerprint":"5d9826f31a62a05bea1bb7f421d81fb79d8f1b48cd2ab3a7820e3e1a1c932fe3","content_sha256":"05756d09e983abf43fee29f95e7fda0837b07f9ed3dc8e4d7e60f07c63f63533"},{"source_entry_id":207907,"name":"[DLC][扩展][克苏鲁扩展][深潜者势力]深潜者势力-政治与社会(风见幽冷，Aoo改)","fingerprint":"687b9f76d9e3c55b91d34973a19183086240b9e40b3453ed39ae6030d5f5271c","content_sha256":"b0db82bce1b68aee3b3b627fc4df853095661a7a27e9d4b35ab2063a1b9cf204"},{"source_entry_id":210692,"name":"[DLC][事件][双子星的咏叹调]【双子】幻灵_info","fingerprint":"3e25ee3709e1d1874d130ecf2211a3736fbee1b0736863698681769a656581f1","content_sha256":"2d24f011e08dd4e262d4e406e8b681386408927929bd786abcbcd5981c7366e4"},{"source_entry_id":213754,"name":"[DLC][角色][克瑞西达]克瑞西达(那什么阿法-在哪都可能出现的，也可以变成任何人的 怀表幼女？)","fingerprint":"a7a54f4f346efe63eb02277ba025aea7e6c163a2de0e115e1c17927af54bbdb3","content_sha256":"c989c91d70da671c29c41f2d0564494afacd703264d0790d22f576d93a60a842"},{"source_entry_id":229161,"name":"[DLC][扩展][史莱姆扩展]岛","fingerprint":"f50da8d181ae0359a3a021e7f6a645127a6c63aaa42161fc3c187ed727264af1","content_sha256":"0f7d1f9165a8724f3f0b2a9dbd3899285a32316b11551c98b7b23db8b42276b2"},{"source_entry_id":241402,"name":"[DLC][扩展][克苏鲁扩展]种族-修格斯(风见幽冷，Aoo改)","fingerprint":"e3f0fa55980d3c35af9bbe29e2aa041bacd9b7ccd3277ea9541b1362d4bfdc88","content_sha256":"c40461b74b51563f4a55f009a9c85fc4800a2110745cee3b969fe9fcc3276504"},{"source_entry_id":241539,"name":"[DLC][扩展][种族-食人魔]食人魔(K1nn-很强壮的大家伙，会分裂畸变，无法沟通)","fingerprint":"89ea4b8314b39a850ca8581be36a170bee1d0d79ee8d25c89748614d6286ed20","content_sha256":"d985ed7204b991d15c90a3acdda1145e643a96f5f46db7a89c2ed3764f35b92f"},{"source_entry_id":251573,"name":"[DLC][事件][双子星的咏叹调]【双子】双子星的咏叹调-入口","fingerprint":"205118d9b60181046499d4199dc7d56e893e3017a1b484aaa292a486446c7cd6","content_sha256":"1fdf71923ce8144d190ee0b9c87386eb482fe9da302678a4024f318adfe5148b"},{"source_entry_id":255972,"name":"[DLC][扩展][边陲之国]悲叹之城-地下墓穴","fingerprint":"b8ada81b1aceeeae5bd7898ab7e1b83d2371214af6f1f42a0f248dd370496855","content_sha256":"4428f6dca61cc2f0e0432d940c82d4aa66711b51cd46cfc05f8378cc08da77b6"},{"source_entry_id":259599,"name":"[DLC][角色][天原绘璃奈]天原绘璃奈(OwO-人造龙姬，活跃于艾瑟嘉德学院区)","fingerprint":"29afdd488f65509749ebd7b216bcfd757da5df381a7d1e540be9af450e17e0f7","content_sha256":"1361ae47b8d595958faaf7f43f6015b4c7a942a9095f9e642fc17f18e627f1c1"},{"source_entry_id":261293,"name":"[DLC][扩展][种族-边境精灵]种族-边境精灵(Kaine-在沙漠和在雪原的精灵)","fingerprint":"b6051bbd4ca7d5bf8bba47f359830b71f2a267fa5ca015afd2297f09721e9887","content_sha256":"dc5276fb752f2373125b3dbe8b72d58adeee071fe4206b85a86e33d4f5a801ef"},{"source_entry_id":275509,"name":"[DLC][扩展][克苏鲁扩展][深潜者势力]深潜者势力(风见幽冷，Aoo改)","fingerprint":"af1302299e6b40c17ee1023faf8555f7cea03c9e406dd6acccf80020f1b5b567","content_sha256":"6599cd7ae16c25442ac3da43910607eb30d30c615eb41faba945684c2484a0d4"},{"source_entry_id":284560,"name":"[DLC][扩展][克苏鲁扩展]种族-无形之子(风见幽冷，Aoo改)","fingerprint":"613b4511e832814a58845f73aca9baf901eeae77946cbde79db7f0245d075894","content_sha256":"97ee5bedfd6fa6c3dfe9c6beb0cfdcd5c50264cf68008b0fd9db6ee18b84ce2a"},{"source_entry_id":295961,"name":"[DLC][扩展][克苏鲁扩展][深潜者势力]深潜者势力-地理与治理(风见幽冷，Aoo改)","fingerprint":"b516eca950c240d5637d18204e8e74eb37841ef914ae4fed9e337aa78522a7ba","content_sha256":"43fca204736d4386b7317d891bd8bacb3609c01af72bee0def5c069104e8d0a2"},{"source_entry_id":297557,"name":"[DLC][角色][羡愚酱]羡愚酱(不知道谁写的-翼民,雾晶港市立图书馆馆长)","fingerprint":"d6a2904a4b85b4f8ad548c6f3411b11cb75f19a6c2d1ac5deff944169e39fde5","content_sha256":"0c1b061d475f8eae04f8c924110f1a042390c9e3fc79b3d44115437b0a7789d9"},{"source_entry_id":333407,"name":"[DLC][角色][雌小鬼与熟女与龙]骸响龙姬-骸响之都部分补充(Spaceperson)","fingerprint":"65d2bef656837831ebcec392fc0f8895d2faf03af15e7f014926332308c4505a","content_sha256":"e99beb53d816364224788eabd7ac29db90d5b5269a534cd3d1ef797b90f95e1a"},{"source_entry_id":382803,"name":"[DLC][角色][塞壬]塞壬·赛瑞利亚(△一串,赛瑞利亚领主,大家的妈妈)","fingerprint":"b467da67e58d6216c4bede3b79c4661e20ea2f2b0166b4ac1e219779028ee4b7","content_sha256":"e26616c11a17a85cc1cd72285e842fe4a844c55bf505de2567c7869b4aaa17f5"},{"source_entry_id":389423,"name":"[DLC][扩展][边陲之国]王国都城-禁区","fingerprint":"0a09a4846ea2db046e1677a48a7d80f3e153402e2e1d4019f28ce996f60477a2","content_sha256":"33cb641a801fd602f57f6220d3efc6cc01530a87f6c4b4c5271ec8d52fd4d76e"},{"source_entry_id":393377,"name":"[DLC][角色][艾璃丝]艾璃丝·赛瑞利亚(△一串-汐海妖精,永不长大的孩子王)","fingerprint":"ce89158cd90d154d5f2536633d030dd314e0205d07f227bc45109af27bafeb33","content_sha256":"9a9055532282158e12fa8b2efb524e21a944726c5c54632a4c1d2a6b09887d4a"},{"source_entry_id":408342,"name":"[DLC][角色][缪尔]缪尔(青砚-翼民,翼民前领袖,千万KD拥有者,资源获取地)","fingerprint":"fe0381ad782edbc3d9ecdabc8a5985d72635d4e470f2e434f9a2bf9358d044d2","content_sha256":"e67aa32866d11f5697a6d134e5cec1e4c5f48980fde28f65e265a3534caaabc2"},{"source_entry_id":409135,"name":"[DLC][事件][斯芬克斯猜猜迷]斯芬克斯(aoo-短线剧情，解答斯芬克斯的几个迷)","fingerprint":"133224f8b79f1fe748df6a9422dda5abd8c3c75409c4efcb97cdb5929b29da4e","content_sha256":"d8cca6f42ec881df478ed73943708099e0d739482c01a81c32fae647cfbc3ae2"},{"source_entry_id":412839,"name":"[DLC][扩展][种族-泰坦人族]泰坦人族(K1nn-随地大小变的锻造宗师，神性碎片)","fingerprint":"f730aeb1d4c8c022c9e2836f6f75865d84221e208921579ce06b1cb78f61b980","content_sha256":"ccfbcb874404022fd33312d86bacd83a0c5a85145ddf815e9a598f608032b1a4"},{"source_entry_id":416199,"name":"[DLC][事件][群山回响]【群山回响】群山回响-入口","fingerprint":"1f7150f31f47289ddb8e01dcfd3053d5f0b360463e2107fb4573cc46f0a056ad","content_sha256":"98a1546e0bdcfcea2d0b6cf9c40d2779dff71e7e15e7c4d4c6ec922f424df022"},{"source_entry_id":416682,"name":"[DLC][事件][群山回响]【群山回响】艾波丽斯_info","fingerprint":"b5866e599addc6f212f12fc88db8a64601aee9007bcb4d6db1ec151f54bfe8cb","content_sha256":"18c2434e5373a94b4aaa38323a32b54d4bfbe54034827514324bc246caeefec4"},{"source_entry_id":416987,"name":"[DLC][扩展][种族-黑角民]黑角民(那什么阿法-羊族亚种/部分返祖,恶魔特征,极度禁欲)","fingerprint":"1aff84795af1a93f4dbacf1680be7f73b3217090ea6e125bf5d902aeacf110f6","content_sha256":"1e011f7c0ed2837b511952ecba55f1f7fbb962d6a4817a77d2f0dd444f6afccb"},{"source_entry_id":427072,"name":"[DLC][扩展][克苏鲁扩展]种族-深潜者(风见幽冷，Aoo改)","fingerprint":"bb4761041084492b225b16dbdcd47f298a85350ec3e19512d7ad3e436e3e40bf","content_sha256":"e07dbef4604232265b0bba567799294f1150f8c6ac2aab0996cdeca2b42df267"},{"source_entry_id":451364,"name":"[DLC][事件][双子星的咏叹调]【双子】Serra_info","fingerprint":"c2563ed39762c85a6a7849e8c56bed43d8e5ed7cded14f7c81752926c0eceac8","content_sha256":"814c96c00b0ba95a41044ec40ce6441983f91a40995dfb61a7008f978416d7d2"},{"source_entry_id":477593,"name":"[DLC][事件][瓷化密室]瓷化密室(aoo-密室逃脱，需要动屏幕外的人的脑子来解谜，在雾晶港旧城区搜索入口吧)","fingerprint":"a91b277dace1a87962a10a93773a5f862c7ed89bd04d9c1dfe39e43870747ea4","content_sha256":"8a82623cf062ba1bbaa5dbfea474019d58ffe20105584709171ad93d80a8ffb1"},{"source_entry_id":493150,"name":"[DLC][扩展][边陲之国]死亡之雨","fingerprint":"fa10576c704ae3af9e1fdfd28c5d23b2f99c5b44550416f5bed63a7b605cb178","content_sha256":"6cb6552453a5d2901f282fe1e09d2b4d9c7e8aa0711f19416319327e1579dfdd"},{"source_entry_id":493570,"name":"[DLC][角色][诗灵-套中人]诗灵-套中人(Orchis-诗灵,活跃于诺斯加德联盟白曜城某)","fingerprint":"031e1fa2a2e584bad12692696c4790ac1f0b8d5d0c0b9d8b5e72a2d7be45d6d6","content_sha256":"13213361d75cca54d39dd9d9b3d62955893f1503f72cb5ff3e43c4154e127d62"},{"source_entry_id":499253,"name":"[DLC][扩展][无尽地城扩展]无尽地城-控制","fingerprint":"f0b0b70446dcbb673220d344beb0e15cdf8f9b475549322fb0af0c742e49c505","content_sha256":"98d91a7dc978c57e85b6799294c0455239c2897d92e94fbea6dc1e964f544461"},{"source_entry_id":501119,"name":"[DLC][角色][莱拉·阿尔-费伊]莱拉·阿尔-费伊(Aoo-人类,成熟御姐,暗影杀手,沙漠上的曼陀罗)","fingerprint":"e3f3fa0be9560e73bcbdca3c13a2072c6b1c321fa095d420eb499a58e1ee2c49","content_sha256":"728eb57e1406c6b7ee4cc02e823352e2dac98915bb72bbcd3f4d880b39614129"},{"source_entry_id":502678,"name":"[DLC][角色][雌小鬼与熟女与龙][雌小鬼与熟女与龙-Spaceperson]艾莉希雅·温德米尔(Spaceperson-新增角色：艾莉希雅和奥希莉雅·骸响龙姬)","fingerprint":"cde29f9e6084455dd090991741180a683d1e8a24ab373fb0a1cc309f31153f85","content_sha256":"fb8c1d31bd7bfb02fa32b24271ecd5fbe432aef841f974c9bc8c588f7068d60d"},{"source_entry_id":504624,"name":"[DLC][事件][冰之歌]冰之歌(aoo-长垣崩溃，异神入侵)","fingerprint":"cac309e09552f1f3b2f1b6e3e7e268be76b728fba4dc7e229c98627980745ac6","content_sha256":"3ecc7333e6300ca71ca0ba01f086b99f7cf953eccd0c4683a0f7e93eed61582c"},{"source_entry_id":509529,"name":"[DLC][角色][埃尔薇拉]埃尔薇拉(Ayrault-人偶+炼金灵魂+普通人外表+弱气少女+玩偶师学徒)","fingerprint":"760da2886de5ea7ea8bbf9f9e24bbce033cbb5274a4778e2e76765f8ec211716","content_sha256":"60a0e5a2283a5c8d87775cc8c62d63c15feb6759374709253d07bb8554244095"},{"source_entry_id":509831,"name":"[DLC][扩展][边陲之国]王国都城-地牢","fingerprint":"b72eb0cc59c96949bb2241524b8e54da3c516e5fc8ae57495c8543f138c17e2b","content_sha256":"1c7844ff3d62b360e63b894ce3f4a296300e709453d5ef09d1e4ebc408360ac2"},{"source_entry_id":518833,"name":"[DLC][扩展][克苏鲁扩展][食尸鬼势力]食尸鬼势力(风见幽冷，Aoo改)","fingerprint":"9190f3c2078603cd6abd2abc80ad13b45408df129411a7fb91dd1a23ed82e49d","content_sha256":"645bc2b8285e4204a0a8510efabbe2d5235858b3944c9d868c427e8bb39744f9"},{"source_entry_id":539450,"name":"[DLC][角色][莉利亚・利桑德]莉利亚・利桑德(辻-利桑德家族继承人,活跃于索伦蒂斯)","fingerprint":"8d48038e6e9b9780f983f0ed8d5c468557b3597614c6882173e1cbbb063c7263","content_sha256":"1558e99b876a3b2e3994eab005f1536c91527a3c185c20ceeee7d82d17f1ef81"},{"source_entry_id":554445,"name":"[DLC][扩展][克苏鲁扩展][食尸鬼势力]食尸鬼势力-政治与社会(风见幽冷，Aoo改)","fingerprint":"594a8362bd63e135b9037037137ffb9bd697f95e5abb1b2a7f739715392363c0","content_sha256":"a1f3b8627c643487b9481bbdd4f6978f75158562b070fdbf9e21646e414e61b1"},{"source_entry_id":573448,"name":"[DLC][扩展][边陲之国][mvu_update]莉莉变量更新规则","fingerprint":"261daaf6ce88a1d61c680794b96cd0a254c96b9ba9cefa18d4bcf4e4a9cbf63f","content_sha256":"99d07dafef47b750d63543c684e9f17e32a92fd77e46cb784b9d0b630a211bc5"},{"source_entry_id":605395,"name":"[DLC][角色][千爻][<东方龙裔]千爻(大白兔泡芙-龙裔，游历大陆、测算吉凶的元气少女，或许可以在索伦蒂斯遇到)","fingerprint":"6eb8719c3a7b7e8ebd15217d6a6bc1544bea88c9d3bb8d0f96bd568852a0279a","content_sha256":"25fadf068c71a75a6e7f2d6f66bf69bab9816acb09d3ad5de53bae0c0e959551"},{"source_entry_id":645156,"name":"[DLC][角色][安娜斯塔西娅]安娜斯塔西娅(索伦蒂斯女王)","fingerprint":"f7182b20cfd8ebeeb1b8a382f4f9fa41caf7d3734c886c682bca908b977fa914","content_sha256":"069fa239282f4d595b8bef6e097ea2c6d1a0c11a8141cd88196a4a38173ebbf0"},{"source_entry_id":650217,"name":"[DLC][事件][神选者]神选者(aoo-阿一串大陆的神为你赐福，选一个你最喜欢的吧。还可以打开自定义神的条目自定义一个可信仰的神)","fingerprint":"9fe2142b7b038eccad44c7bc03b9f63d0b56f279c304ad47a9304b08b08af464","content_sha256":"538061385e79919ddd500b01f50fc6764b9e299674127f5f5861ea73ac53427f"},{"source_entry_id":667948,"name":"[DLC][扩展][克苏鲁扩展]概览(风见幽冷，Aoo改-克系外神扩展添加了一些克系相关设定，包含食尸鬼与深潜者等种族，灰土行会、渊洋王庭等组织势力，星之彩、黑山羊幼崽等怪物生态)","fingerprint":"288fd888b8966a6f830cbae2140cf1849de3c41860153232efedffba5a89b0f0","content_sha256":"2e92f0e16aacc50703f1aa9a6cfed13f62b4d75cf4d515b848d89787e904f14d"},{"source_entry_id":675294,"name":"[DLC][角色][索尔希艾拉][<羽民]索尔希艾拉(镜梦幻-女妖,带着大镰刀的神秘少女,活跃于奥古斯提姆帝国)","fingerprint":"2de466c69f6327a3c6947f94b961c8a8889aa01d17d8a0a8d41062bca5f2e101","content_sha256":"25c6fe77c88a123e3bf4507120be2c3bf0c1d272f6b9f3c9afb35a28e736123e"},{"source_entry_id":681613,"name":"[DLC][扩展][种族-东方龙裔]东方龙裔(lili-很中国风的小龙人)","fingerprint":"7385e7a66e038eea58bcdc89cf686ae327be2c42971ea5612f05421793764936","content_sha256":"f1929610a853da5519dd4ee18b8a893d1e7960804af0f68759710de2b4126aad"},{"source_entry_id":688384,"name":"[DLC][扩展][克苏鲁扩展][食尸鬼势力]食尸鬼势力-地理与治理(风见幽冷，Aoo改)","fingerprint":"b4dbd84d3af0c2d908e2cb87d9a5675ed1fca81c397aae25c26f633953723586","content_sha256":"2ea9465f3c50d75840b0e4b6845eccc7686d9cac72ecb5d15d0f8ff7cab8bc45"},{"source_entry_id":689556,"name":"[DLC][事件][神选者]神选者_自定义神(aoo-填写一个自定义神并注入神选者事件)","fingerprint":"a6a1188662011697bd5bb07ca58bee53b832973612402d137ebe5f407fc6bc22","content_sha256":"b0d72fa133b61310c20903a4c6bb616f9bec2d3b65f3ff03059fc187e1f29f0e"},{"source_entry_id":694693,"name":"[DLC][扩展][边陲之国]莉莉","fingerprint":"7caf59d1689c6819c9aa706c65df4e9b00b32357dab49eaf65ee39d17d3fc45b","content_sha256":"bb4e073a23afa5ee8178a1f6d941eab4984be7e046f088fc11a1c0fbbc266e6f"},{"source_entry_id":694882,"name":"[DLC][扩展][种族-花灵]花灵(快乐柠萌茶-头上长着花朵的美少女，没有B！)","fingerprint":"5116e4d93320684431130b01fa41a357520eca71c72509f4c3d1ca1f51b931f1","content_sha256":"da065950c1273e87f12e4f9fe498d4755221459a692de4f54e39d786886d249c"},{"source_entry_id":696417,"name":"[DLC][角色][柳比哈卡]柳比哈卡(K1nn-半龙女,雾晶学院留级生)","fingerprint":"1d0b7ad66ad6e395942a45298d25bc97427919c3ceb446050d89ea6a9892d13e","content_sha256":"3aa22c90e12eeb9c80cb6a9dc89bb56490b93abd444e2c292ffae2455c67bb8d"},{"source_entry_id":702087,"name":"[DLC][扩展][克苏鲁扩展]组织-灰土行会(风见幽冷，Aoo改)","fingerprint":"b83b1dad34193081fc0cb0dc1e3136ea8b1f956012b985f3bdb75378d0850a4a","content_sha256":"c0d672a359531c8b29994545be2ea0359c50c2ed04af4344662867c419b5a14a"},{"source_entry_id":709064,"name":"[DLC][扩展][边陲之国]冒险区域-边陲之国","fingerprint":"3b64be94ae0feca55a0ae3591d442481347f1e30d11fb330553d4d180a070dcd","content_sha256":"43f56053b6a534159d3bdead126b58ef123a0d1a817f2e58cfae83d9da9ddf1e"},{"source_entry_id":719324,"name":"[DLC][扩展][边陲之国]污染核心","fingerprint":"57f982f5302fa73c6cbe4329df528791f888e6e1bd2bf6546cc1170e9fdc7974","content_sha256":"a871a63885d223f6b006f778218fcb5c1e61b5b45b93c56f53a70d3dce3bcb70"},{"source_entry_id":757966,"name":"[DLC][扩展][种族-山妖]山妖(K1nn-很高的看上去像石头的猴子)","fingerprint":"6514358d7314777bceb65d39fbc9754892dbcd5b25a1da196c4a3e5bbf02427a","content_sha256":"c68e21a2fd0e0507d5b5846b4c42ff72840646cef11aca968d5f393b807e1058"},{"source_entry_id":771904,"name":"[DLC][扩展][种族-半巨人]半巨人(K1nn-皮糙肉厚的高高的人)","fingerprint":"58e184c386faa70be1679f1b489bace7d759e3fcaeff8788c1efdfaed53ee8c1","content_sha256":"f971dfa46b2989ee3f7d0f982a0793b9f3a40b4e5e69dca67b1e97ec84627537"},{"source_entry_id":780388,"name":"[DLC][角色][乌雅娅]乌雅娅(k1nn-血族真祖,活跃于银帆城)","fingerprint":"30ed8c42efdc0814752bac1b9101f650db9d2a1718c2dd80e014b8c2641efd4d","content_sha256":"94d50f4282e54b08e9e772a23a5f1d0df88e5c120b61fc38bf1d89594fc9c5d7"},{"source_entry_id":814312,"name":"[DLC][扩展][种族-蛇女]蛇女(△一串-上人下蛇，变温喜热，缠绕求偶，母系氏族)","fingerprint":"8d479ea1d81b9455a9a4143c1b9b751d7678bbeaa20bffc01560e717afab1f5d","content_sha256":"a98e3cbde2209f8974ad4265598406d22cbb61ff1073d6932a9910ff224806fe"},{"source_entry_id":816526,"name":"[DLC][事件][双子星的咏叹调]【双子】Lilim_info","fingerprint":"217b50d7c125ef06307ac9fd41449a4905202944d1e246df46e7b22773eca5fd","content_sha256":"fb8f63dd78fa88c393c85ee504b296343cd4afa5f44d966bfa3c9db86261d2a8"},{"source_entry_id":817781,"name":"[DLC][扩展][克苏鲁扩展]怪物生态-星之彩(风见幽冷，Aoo改)","fingerprint":"c9671e7f7b85d0f6b75cc61d9cd2aa358e033644d049ed79d833e48d021bd8db","content_sha256":"2d74351d38d4f18c8c1052786df7aead191394108267bfe08b059562b96fe3a8"},{"source_entry_id":824305,"name":"[DLC][角色][澪]澪(glen0822（扭曲亚提）-神造人，走出神殿的人偶/候补圣女/旅行者)","fingerprint":"ab081992acfa1a9285ea7cac21cfe7a9f89d701aa524ea0965e823c8516e66c4","content_sha256":"885618317f1f7a72685494d25dd8d49e32b1dfe84a9d1424124bae38947d11c0"},{"source_entry_id":825444,"name":"[DLC][角色][福尔摩斯探案集]福尔摩斯探案集(Angtuck-诗灵;福尔摩斯探案集)","fingerprint":"ebaafb6ab2ca954c292fe268c8041aa3822d8e1896cc4c6d4d0d3c43f56d5dd1","content_sha256":"364e4233a97e37079af62c35e5e788237abeb6995e9bc20882317032e98b4ef7"},{"source_entry_id":838913,"name":"[DLC][扩展][假小子扮演功能]假小子扮演功能(快乐柠萌茶-提供假小子形象设定：高挑匀称体态、中性外表、穿男装、被误认为男性的扮演规则)","fingerprint":"b22bedb6ae4a044af74b69510d4f95443b804be426886f4a20d873369f95d346","content_sha256":"21b299bb5b9b44c0c00e109830982269b40dc685bc10690837b3797cbf0eea40"},{"source_entry_id":840009,"name":"[DLC][扩展][边陲之国]外围村落-悬崖村","fingerprint":"f867a7e3bac7d76cec2848b5ffbbf4ef30aefa019237fb4e22d47b9b8f23e4f8","content_sha256":"dac7d4426f7be30df1958500f22be2ea4fbeb7d57453bd5fecc62cb87b317407"},{"source_entry_id":846410,"name":"[DLC][扩展][克苏鲁扩展]组织-汐链商会联盟(风见幽冷，Aoo改)","fingerprint":"342c790448c447bd08aeff4b24bd69675547f26a64d10ba6232c58f85c0922fe","content_sha256":"968dfe5676371c31cd6bd70031f247ef85a4d23b891cf7355757ce1d62f62e5d"},{"source_entry_id":873554,"name":"[DLC][角色][薇薇拉]薇薇拉(K1nn-半血魔,古代的凡人贵族,常出现于瓦伦蒂亚)","fingerprint":"8a1810c93b1b2a350451d05f0cc533a499c90c09953224663d1c723b0e8945e5","content_sha256":"2856705873c5e6772f4d72d2acd95d514ab6af7172f8b6de10f823ab5e5f8f02"},{"source_entry_id":875816,"name":"[DLC][扩展][边陲之国]王国都城-城区","fingerprint":"9c2765098fa470ff925b5c46009ae5e939f40ef50fba35580ece4e30dd7771fa","content_sha256":"28d9bc63d176fc6956d1969dd48de44f89ec22860e8105edb7b801ca1e6fe87e"},{"source_entry_id":882653,"name":"[DLC][扩展][种族-奶龙]奶龙(快乐柠萌茶-编者注:求你了别开😭)","fingerprint":"949542ee39d4025649e494a461127c155b7e75848ef5f36fecbb181b0a17434d","content_sha256":"431db3bec5d0e8409619b77c5e0200b84e27d240093d104a50a005f374e5681f"},{"source_entry_id":893369,"name":"[DLC][角色][幽露]幽露(仰望星空-史莱姆少女,活跃于瓦伦蒂亚和无尽雨林)","fingerprint":"03d6f70a9424a36d810e8b99b397b4136b1aab90bda480be80408f099b892b9e","content_sha256":"e3a7506cbf64a0357e0963e6085a60dca4885a18da19c168bf290e3c2e2dbb3a"},{"source_entry_id":899558,"name":"[DLC][角色][莉莉娅丝]【血姬】Liliyas_info(Hilo-1011)","fingerprint":"89599a0be0dcc3730bb310b86159c1bc93198df474f6c51fa6d3d1b70b339600","content_sha256":"5abf1fe071045ebc5ba2b28d315d9d4ee98bff61efab5653fc7c0606b0575fc0"},{"source_entry_id":903658,"name":"[DLC][扩展][克苏鲁扩展]种族-食尸鬼(风见幽冷，Aoo改)","fingerprint":"22912aa2b27a8a119eb79b9f4837b4f51bef1720be885ef71881551ccb0cebfc","content_sha256":"3518ea816c5480118e7e2526f3c6c391c7f78a0ec527e45750f93f9d4b3c1581"},{"source_entry_id":914780,"name":"[DLC][扩展][克苏鲁扩展]种族-星之眷族(风见幽冷，Aoo改)","fingerprint":"c50c88c45bd16fe38c16a9dae62d569104a510c936793e39254ec8bfff27ccdd","content_sha256":"aa1cdb32a0f37da3e6a9b284df04c309b616a3bfd154e999808cedafc6fd56db"},{"source_entry_id":940652,"name":"[DLC][扩展][史莱姆扩展]作用","fingerprint":"9c24928a9141020adac04f959de655f3ea582bb1f32653803edc995b1d9a2f92","content_sha256":"e24e27b0d3bf97dd853eecf0c295548714058e7507feb34276ec585d0fb2ac4d"},{"source_entry_id":969115,"name":"[DLC][角色][傲雪][<东方龙裔]龙娘傲雪(Hilo-龙裔,寒潭剑姬,活跃于诺斯加德)","fingerprint":"7b3207e04e9b26a06a0c9dedf26871f56cfa82ccdf37839c17411d9f03296907","content_sha256":"455e01ef6809b428ceb11a1789b6bac0f2ab0c88114a76f8ddccf510bf28aaa5"},{"source_entry_id":999163,"name":"[DLC][扩展][种族-诗灵]诗灵(FIshfish-故事凝聚灵体, 优雅善感)","fingerprint":"c39156bf0f9a49b03ad0b74d7b9a930abf8156d32c5ad5c970f61ec00afb88b9","content_sha256":"473c06049b286c4558ee86f6b96c08a978c30b28515d6a12cc6e8e98148782b5"}]}');
;// ./src/CreativeWorkshop/services/regex.ts



function prepareCreativeWorkshopRegexEntries(detail, selectedEntryKeys) {
    const selected = selectedEntryKeys ? new Set(selectedEntryKeys) : null;
    return (detail.regexEntriesPreview || [])
        .map((entry, originalIndex) => ({
        entry,
        originalIndex,
        entryKey: getCreativeWorkshopRegexEntryKey(entry, originalIndex),
    }))
        .filter(({ entryKey }) => !selected || selected.has(entryKey));
}
async function applyPreparedCreativeWorkshopRegex(projectId, detail, regexEntries, legacyProjectName) {
    const result = await updateTavernRegexesWith(regexes => {
        const filtered = regexes.filter(regex => {
            const regexId = getCreativeWorkshopRegexId(regex);
            return !regexId.startsWith(`creative_workshop:${projectId}:`) &&
                !Boolean(legacyProjectName && regexId.startsWith(`creative_workshop:${legacyProjectName}:`));
        });
        const appended = regexEntries.map(({ entry, originalIndex, entryKey }) => ({
            id: getCreativeWorkshopManagedRegexId(projectId, { ...entry, entryKey }, originalIndex),
            script_name: getReadableRegexName(detail.project.name || '未命名项目', entry, originalIndex),
            enabled: !entry.disabled,
            scope: 'character',
            find_regex: entry.findRegex || '',
            replace_string: entry.replaceString || '',
            trim_strings: Array.isArray(entry.trimStrings) ? entry.trimStrings.join('\n') : '',
            source: {
                user_input: false,
                ai_output: true,
                slash_command: false,
                world_info: false,
            },
            destination: {
                display: !entry.promptOnly,
                prompt: !entry.markdownOnly,
            },
            run_on_edit: Boolean(entry.runOnEdit),
            min_depth: _.isNumber(entry.minDepth) ? entry.minDepth : null,
            max_depth: _.isNumber(entry.maxDepth) ? entry.maxDepth : null,
            placement: Array.isArray(entry.placement) ? entry.placement : [2],
            substitute_regex: entry.substituteRegex ?? 0,
        }));
        return [...filtered, ...appended];
    }, { scope: 'character' });
    return result;
}
async function installCreativeWorkshopRegex(projectId, selectedEntryKeys, expectedVersion, legacyProjectName) {
    const detail = await fetchCreativeWorkshopProjectDetail(projectId, expectedVersion);
    const regexEntries = prepareCreativeWorkshopRegexEntries(detail, selectedEntryKeys);
    if (regexEntries.length === 0) {
        return [];
    }
    const result = await applyPreparedCreativeWorkshopRegex(projectId, detail, regexEntries, legacyProjectName);
    setCreativeWorkshopInstallRecord(projectId, {
        installedVersion: detail.project.version || expectedVersion || null,
    });
    return result;
}
async function uninstallCreativeWorkshopRegex(projectId, legacyProjectName) {
    return updateTavernRegexesWith(regexes => regexes.filter(regex => {
        const regexId = getCreativeWorkshopRegexId(regex);
        return !regexId.startsWith(`creative_workshop:${projectId}:`) &&
            !Boolean(legacyProjectName && regexId.startsWith(`creative_workshop:${legacyProjectName}:`));
    }), { scope: 'character' });
}
async function updateCreativeWorkshopRegex(projectId, expectedVersion, legacyProjectName) {
    await uninstallCreativeWorkshopRegex(projectId, legacyProjectName);
    return installCreativeWorkshopRegex(projectId, undefined, expectedVersion, legacyProjectName);
}

;// ./src/CreativeWorkshop/services/original-conflicts.ts


function getOriginalEntryName(entry) {
    return String(entry.comment || entry.name || '').trim();
}
function getEntryUid(entry) {
    const uid = entry.uid;
    return uid === undefined || uid === null || uid === '' ? null : String(uid);
}
function getEntryEnabled(entry) {
    const enabled = entry.enabled;
    if (typeof enabled === 'boolean')
        return enabled;
    const disable = entry.disable;
    if (typeof disable === 'boolean')
        return !disable;
    return true;
}
function stateClaimKey(state) {
    const localIdentity = state.entryUid ? `uid:${state.entryUid}` : `name:${state.displayName}`;
    return `${state.worldbookName} ${localIdentity}`;
}
function entryMatchesState(entry, state) {
    if (state.entryUid)
        return getEntryUid(entry) === state.entryUid;
    return getOriginalEntryName(entry) === state.displayName;
}
function getOtherOriginalEntryClaims(projectId) {
    const claims = new Map();
    for (const [otherProjectId, record] of Object.entries(getCreativeWorkshopInstallRecords())) {
        if (otherProjectId === projectId)
            continue;
        for (const state of record.originalEntryStates || []) {
            claims.set(stateClaimKey(state), state);
        }
    }
    return claims;
}
async function loadCharacterWorldbooks() {
    const bound = getCharWorldbookNames('current');
    const names = _.uniq([bound.primary, ...(bound.additional || [])]).filter((name) => _.isString(name) && Boolean(name));
    const existing = new Set(getWorldbookNames());
    const loaded = [];
    for (const name of names) {
        if (!existing.has(name))
            continue;
        loaded.push({ name, entries: await getWorldbook(name) });
    }
    return loaded;
}
function resolveUniqueMatch(item, matches, reason) {
    if (matches.length <= 1)
        return matches[0] || null;
    const label = reason === 'uid' ? '同一个 UID' : '同名';
    throw new Error(`原版内容「${item.displayName}」出现多个${label}条目，为避免误关内容已中止`);
}
function findReferenceItemInWorldbooks(item, worldbooks) {
    const nameMatches = worldbooks.flatMap(worldbook => worldbook.entries
        .filter(entry => getOriginalEntryName(entry) === item.displayName)
        .map(entry => ({ worldbookName: worldbook.name, entry })));
    const byName = resolveUniqueMatch(item, nameMatches, 'name');
    if (byName)
        return byName;
    if (item.sourceKey?.startsWith('uid:')) {
        const expectedUid = item.sourceKey.slice(4);
        const uidMatches = worldbooks.flatMap(worldbook => worldbook.entries
            .filter(entry => getEntryUid(entry) === expectedUid)
            .map(entry => ({ worldbookName: worldbook.name, entry })));
        return resolveUniqueMatch(item, uidMatches, 'uid');
    }
    return null;
}
function assertStateIsUnambiguous(worldbook, state) {
    const count = worldbook.filter(entry => entryMatchesState(entry, state)).length;
    if (count <= 1)
        return;
    throw new Error(`原版内容「${state.displayName}」现在出现多个匹配条目，为避免误改已中止`);
}
async function applyOriginalEntryStates(projectId, desiredStates, previousStates) {
    const desiredKeys = new Set(desiredStates.map(stateClaimKey));
    const otherClaims = getOtherOriginalEntryClaims(projectId);
    const worldbookNames = _.uniq([
        ...desiredStates.map(state => state.worldbookName),
        ...previousStates.map(state => state.worldbookName),
    ]);
    for (const worldbookName of worldbookNames) {
        const desiredForBook = desiredStates.filter(state => state.worldbookName === worldbookName);
        const restoreForBook = previousStates
            .filter(state => state.worldbookName === worldbookName)
            .filter(state => !desiredKeys.has(stateClaimKey(state)))
            .filter(state => !otherClaims.has(stateClaimKey(state)));
        if (desiredForBook.length === 0 && restoreForBook.length === 0)
            continue;
        await updateWorldbookWith(worldbookName, worldbook => {
            for (const state of [...desiredForBook, ...restoreForBook]) {
                assertStateIsUnambiguous(worldbook, state);
            }
            return worldbook.map(entry => {
                const desired = desiredForBook.find(state => entryMatchesState(entry, state));
                if (desired)
                    return { ...entry, enabled: false };
                const restore = restoreForBook.find(state => entryMatchesState(entry, state));
                if (restore)
                    return { ...entry, enabled: restore.wasEnabled };
                return entry;
            });
        });
    }
}
async function syncCreativeWorkshopOriginalConflicts(projectId, detail) {
    const project = detail.project || {};
    const previousStates = getCreativeWorkshopInstallRecord(projectId)?.originalEntryStates || [];
    const requestedIds = project.conflictsWithOriginal && Array.isArray(project.originalConflictReferenceItemIds)
        ? project.originalConflictReferenceItemIds.map(String).filter(Boolean)
        : [];
    if (requestedIds.length === 0) {
        await applyOriginalEntryStates(projectId, [], previousStates);
        return [];
    }
    const referenceVersionId = String(project.builtForReferenceVersionId || '');
    if (!referenceVersionId)
        throw new Error('这个 DLC 没有记录对应的角色卡版本，无法自动切换原版内容');
    const items = await fetchCreativeWorkshopReferenceVersionItems(referenceVersionId);
    const requested = new Set(requestedIds);
    const selectedItems = items.filter(item => item.kind === 'worldbook' && requested.has(item.id));
    if (selectedItems.length !== requested.size) {
        throw new Error('这个 DLC 记录的原版内容已经有变化，请让作者重新确认');
    }
    const worldbooks = await loadCharacterWorldbooks();
    const otherClaims = getOtherOriginalEntryClaims(projectId);
    const desiredStates = [];
    for (const item of selectedItems) {
        const located = findReferenceItemInWorldbooks(item, worldbooks);
        if (!located) {
            throw new Error(`找不到原版内容「${item.displayName}」，请确认角色卡版本是否正确`);
        }
        const localStateIdentity = {
            referenceItemId: item.id,
            worldbookName: located.worldbookName,
            displayName: getOriginalEntryName(located.entry),
            entryUid: getEntryUid(located.entry),
            wasEnabled: getEntryEnabled(located.entry),
        };
        const key = stateClaimKey(localStateIdentity);
        const previous = previousStates.find(state => stateClaimKey(state) === key);
        const inherited = otherClaims.get(key);
        desiredStates.push({
            ...localStateIdentity,
            wasEnabled: previous?.wasEnabled ?? inherited?.wasEnabled ?? localStateIdentity.wasEnabled,
        });
    }
    await applyOriginalEntryStates(projectId, desiredStates, previousStates);
    return desiredStates;
}
async function restoreCreativeWorkshopOriginalConflicts(projectId, statesOverride) {
    const previousStates = statesOverride || getCreativeWorkshopInstallRecord(projectId)?.originalEntryStates || [];
    if (previousStates.length === 0)
        return;
    await applyOriginalEntryStates(projectId, [], previousStates);
}

;// ./src/CreativeWorkshop/services/worldbook-reconcile.ts
function getEntryExtra(entry) {
    const extra = entry.extra;
    return extra && typeof extra === 'object' && !Array.isArray(extra) ? extra : {};
}
function isSameCreativeWorkshopProject(entry, projectId, projectName, legacyProjectName) {
    const extra = getEntryExtra(entry);
    const itemProjectId = extra.cw_project_id;
    const legacyName = extra.fate_project_name;
    return (itemProjectId === projectId ||
        legacyName === projectId ||
        Boolean(legacyProjectName && itemProjectId === legacyProjectName) ||
        Boolean(legacyProjectName && legacyName === legacyProjectName) ||
        (!itemProjectId && legacyName === projectName));
}
function findExistingEntryIndex(worldbook, desired, projectId, options, alreadyMatched) {
    return worldbook.findIndex((entry, index) => {
        if (alreadyMatched.has(index))
            return false;
        const extra = getEntryExtra(entry);
        const entryKey = extra.cw_entry_key;
        if (entryKey === desired.stableKey || entryKey === desired.legacyKey)
            return true;
        const isConfirmedLegacyAlias = Boolean(options.legacyProjectName &&
            (extra.cw_project_id === options.legacyProjectName || extra.fate_project_name === options.legacyProjectName));
        if (entryKey && !isConfirmedLegacyAlias)
            return false;
        if (!isSameCreativeWorkshopProject(entry, projectId, options.projectName, options.legacyProjectName))
            return false;
        return entry.name === desired.payload.name || entry.comment === desired.sourceName;
    });
}
function reconcileCreativeWorkshopWorldbookEntries(worldbook, desiredEntries, projectId, options) {
    const matchedExisting = new Set();
    for (const desired of desiredEntries) {
        const existingIndex = findExistingEntryIndex(worldbook, desired, projectId, options, matchedExisting);
        if (existingIndex >= 0) {
            const existing = worldbook[existingIndex];
            const mergedExtra = { ...getEntryExtra(existing), ...getEntryExtra(desired.payload) };
            worldbook[existingIndex] = { ...existing, ...desired.payload, extra: mergedExtra, uid: existing.uid };
            matchedExisting.add(existingIndex);
        }
        else {
            worldbook.push(desired.payload);
        }
    }
    if (!options.pruneMissing)
        return worldbook;
    const desiredKeys = new Set(desiredEntries.map(entry => entry.stableKey));
    const seenDesiredKeys = new Set();
    return worldbook.filter(entry => {
        if (!isSameCreativeWorkshopProject(entry, projectId, options.projectName, options.legacyProjectName))
            return true;
        const entryKey = getEntryExtra(entry).cw_entry_key;
        if (typeof entryKey !== 'string' || !desiredKeys.has(entryKey) || seenDesiredKeys.has(entryKey))
            return false;
        seenDesiredKeys.add(entryKey);
        return true;
    });
}

;// ./src/CreativeWorkshop/services/worldbook-normalize.ts
function getCreativeWorkshopWorldbookEntryKey(entry, index) {
    if (_.isString(entry.entryKey) && entry.entryKey)
        return entry.entryKey;
    if (_.isString(entry.__cwEntryKey) && entry.__cwEntryKey)
        return entry.__cwEntryKey;
    const uid = entry.uid ?? _.get(entry, 'extensions.cw_entry_id');
    return uid !== undefined && uid !== null ? `uid:${String(uid)}` : `index:${index}`;
}
function getCreativeWorkshopStrategyType(entry) {
    const type = _.get(entry, 'strategy.type') ?? entry.strategyType;
    if (type !== undefined && type !== null) {
        if (type === 'constant' || type === 'selective' || type === 'vectorized')
            return type;
        throw new Error(`不支持的触发策略: ${String(type)}`);
    }
    if (entry.constant === true)
        return 'constant';
    if (entry.vectorized === true)
        return 'vectorized';
    return 'selective';
}
function getCreativeWorkshopSecondaryLogic(entry) {
    const logic = _.get(entry, 'strategy.keys_secondary.logic') ?? entry.secondaryLogic;
    if (logic !== undefined && logic !== null) {
        if (logic === 'and_any' || logic === 'not_all' || logic === 'not_any' || logic === 'and_all')
            return logic;
        throw new Error(`不支持的次要关键词逻辑: ${String(logic)}`);
    }
    const raw = entry.selectiveLogic ?? entry.selective_logic ?? 0;
    if (!Number.isInteger(raw))
        throw new Error(`selectiveLogic 必须是整数: ${String(raw)}`);
    switch (raw) {
        case 0:
            return 'and_any';
        case 1:
            return 'not_all';
        case 2:
            return 'not_any';
        case 3:
            return 'and_all';
        default:
            throw new Error(`不支持的 selectiveLogic: ${String(raw)}`);
    }
}
function getCreativeWorkshopPositionType(entry) {
    const type = _.get(entry, 'position.type') ?? entry.positionType;
    if (type !== undefined && type !== null) {
        switch (type) {
            case 'before_character_definition':
            case 'after_character_definition':
            case 'before_example_messages':
            case 'after_example_messages':
            case 'before_author_note':
            case 'after_author_note':
            case 'at_depth':
            case 'outlet':
                return type;
            case 'before_char':
                return 'before_character_definition';
            case 'after_char':
                return 'after_character_definition';
            default:
                throw new Error(`不支持的插入位置: ${String(type)}`);
        }
    }
    const raw = entry.position ?? 0;
    if (!Number.isInteger(raw))
        throw new Error(`插入位置必须是整数: ${String(raw)}`);
    switch (raw) {
        case 0:
            return 'before_character_definition';
        case 1:
            return 'after_character_definition';
        case 2:
            return 'before_author_note';
        case 3:
            return 'after_author_note';
        case 4:
            return 'at_depth';
        case 5:
            return 'before_example_messages';
        case 6:
            return 'after_example_messages';
        case 7:
            return 'outlet';
        default:
            throw new Error(`不支持的 SillyTavern 插入位置: ${String(raw)}`);
    }
}
function getCreativeWorkshopPositionRole(entry, positionType) {
    const role = _.get(entry, 'position.role') ?? entry.role;
    switch (role) {
        case 0:
        case 'system':
            return 'system';
        case 1:
        case 'user':
            return 'user';
        case 2:
        case 'assistant':
            return 'assistant';
        case undefined:
        case null:
            return 'system';
        default:
            if (positionType !== 'at_depth')
                return 'system';
            throw new Error(`不支持的 @D role: ${String(role)}`);
    }
}
function getCreativeWorkshopFiniteNumber(entry, rawPath, previewPath, defaultValue) {
    const value = _.get(entry, rawPath) ?? _.get(entry, previewPath);
    if (value === undefined || value === null)
        return defaultValue;
    if (!_.isNumber(value) || !Number.isFinite(value)) {
        throw new Error(`${previewPath} 必须是有限数字: ${String(value)}`);
    }
    return value;
}

;// ./src/CreativeWorkshop/services/worldbook.ts






function getCurrentWorldbookName() {
    const charWorldbooks = getCharWorldbookNames('current');
    if (!charWorldbooks.primary)
        throw new Error('当前角色卡未绑定世界书');
    return charWorldbooks.primary;
}
async function ensureCreativeWorkshopTargetWorldbook(worldbookName) {
    const target = worldbookName.trim();
    if (!target)
        throw new Error('请选择安装目标世界书');
    const existingNames = getWorldbookNames();
    if (!existingNames.includes(target)) {
        await createWorldbook(target, []);
    }
    const charWorldbooks = getCharWorldbookNames('current');
    if (target !== charWorldbooks.primary && !(charWorldbooks.additional || []).includes(target)) {
        await rebindCharWorldbooks('current', {
            primary: charWorldbooks.primary,
            additional: [...(charWorldbooks.additional || []), target],
        });
    }
    return target;
}
function arrayField(entry, rawPath, previewPath) {
    const rawValue = _.get(entry, rawPath);
    if (Array.isArray(rawValue))
        return rawValue;
    const previewValue = _.get(entry, previewPath);
    return Array.isArray(previewValue) ? previewValue : [];
}
function fieldWithDefault(entry, rawPath, previewPath, defaultValue) {
    return (_.get(entry, rawPath) ?? _.get(entry, previewPath) ?? defaultValue);
}
function getScanDepth(entry) {
    const value = _.get(entry, 'strategy.scan_depth') ?? entry.scanDepth;
    if (value === undefined || value === null)
        return 'same_as_global';
    if (value === 'same_as_global')
        return value;
    if (_.isNumber(value) && Number.isFinite(value))
        return value;
    throw new Error(`scanDepth 无效: ${String(value)}`);
}
function getProbability(entry) {
    if (entry.useProbability === false)
        return 100;
    return getCreativeWorkshopFiniteNumber(entry, 'probability', 'probability', 100);
}
function getRecursionDelayUntil(entry) {
    if (_.get(entry, 'recursion.delay_until') !== undefined)
        return _.get(entry, 'recursion.delay_until');
    if (entry.delayUntilRecursion !== undefined)
        return entry.delayUntilRecursion ? 1 : null;
    return null;
}
async function prepareCreativeWorkshopProject(projectId, selectedEntryKeys, expectedVersion) {
    const detail = await fetchCreativeWorkshopProjectDetail(projectId, expectedVersion);
    const sourceEntries = await fetchCreativeWorkshopProjectWorldbookSource(detail);
    const entries = sourceEntries.length > 0 ? sourceEntries : detail.worldbookEntriesPreview || [];
    const selected = selectedEntryKeys ? new Set(selectedEntryKeys) : null;
    const prepared = entries
        .map((entry, index) => ({ entry, index, entryKey: getCreativeWorkshopWorldbookEntryKey(entry, index) }))
        .filter(item => !selected || selected.has(item.entryKey))
        .map(({ entry, index, entryKey }) => {
        try {
            const positionType = getCreativeWorkshopPositionType(entry);
            return {
                entry,
                index,
                entryKey,
                positionType,
                positionRole: getCreativeWorkshopPositionRole(entry, positionType),
                strategyType: getCreativeWorkshopStrategyType(entry),
                secondaryLogic: getCreativeWorkshopSecondaryLogic(entry),
                depth: getCreativeWorkshopFiniteNumber(entry, 'position.depth', 'depth', 4),
                order: getCreativeWorkshopFiniteNumber(entry, 'position.order', 'order', index),
                probability: getProbability(entry),
                scanDepth: getScanDepth(entry),
            };
        }
        catch (error) {
            const title = entry.comment || entry.name || `条目${index + 1}`;
            throw new Error(`世界书条目「${title}」配置无效：${error instanceof Error ? error.message : String(error)}`);
        }
    });
    return { detail, prepared };
}
async function applyPreparedCreativeWorkshopProject(projectId, detail, prepared, worldbookName, options = {}) {
    if (prepared.length === 0 && !options.pruneMissing)
        return;
    const projectName = detail.project.name || '未命名项目';
    await updateWorldbookWith(worldbookName, worldbook => {
        const desiredEntries = prepared.map(({ entry, index, entryKey, positionType, positionRole, strategyType, secondaryLogic, depth, order, probability, scanDepth }) => {
            const sourceName = entry.comment || entry.name || `条目${index + 1}`;
            const name = formatCreativeWorkshopEntryName(sourceName, detail.project, projectName);
            const stableKey = `${projectId}:${entryKey}`;
            const legacyKey = `${projectId}:${index}`;
            const payload = {
                name,
                enabled: _.isBoolean(entry.enabled) ? entry.enabled : !entry.disable,
                strategy: {
                    type: strategyType,
                    keys: arrayField(entry, 'strategy.keys', 'key'),
                    keys_secondary: {
                        logic: secondaryLogic,
                        keys: arrayField(entry, 'strategy.keys_secondary.keys', 'keysecondary'),
                    },
                    scan_depth: scanDepth,
                },
                position: {
                    type: positionType,
                    depth,
                    order,
                    role: positionRole,
                },
                recursion: {
                    prevent_incoming: fieldWithDefault(entry, 'recursion.prevent_incoming', 'excludeRecursion', false),
                    prevent_outgoing: fieldWithDefault(entry, 'recursion.prevent_outgoing', 'preventRecursion', false),
                    delay_until: getRecursionDelayUntil(entry),
                },
                effect: {
                    sticky: fieldWithDefault(entry, 'effect.sticky', 'sticky', null),
                    cooldown: fieldWithDefault(entry, 'effect.cooldown', 'cooldown', null),
                    delay: fieldWithDefault(entry, 'effect.delay', 'delay', null),
                },
                probability,
                content: entry.content || '',
                comment: entry.comment || entry.name || name,
                outletName: _.isString(entry.outletName) ? entry.outletName : '',
                extra: {
                    cw_project_id: projectId,
                    cw_project_name_display: projectName,
                    cw_project_version: detail.project.version || null,
                    cw_remote_version: detail.project.version || null,
                    cw_entry_key: stableKey,
                    cw_name_format_version: CREATIVE_WORKSHOP_NAME_FORMAT_VERSION,
                },
            };
            return { payload, stableKey, legacyKey, sourceName };
        });
        return reconcileCreativeWorkshopWorldbookEntries(worldbook, desiredEntries, projectId, {
            projectName,
            legacyProjectName: options.legacyProjectName,
            pruneMissing: options.pruneMissing,
        });
    });
}
function isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName) {
    return (_.get(entry, 'extra.cw_project_id') === projectId ||
        _.get(entry, 'extra.fate_project_name') === projectId ||
        Boolean(legacyProjectName && _.get(entry, 'extra.cw_project_id') === legacyProjectName) ||
        Boolean(legacyProjectName && _.get(entry, 'extra.fate_project_name') === legacyProjectName));
}
async function deleteProjectEntriesFromWorldbook(projectId, worldbookName, legacyProjectName) {
    if (!getWorldbookNames().includes(worldbookName))
        return [];
    const before = await getWorldbook(worldbookName);
    if (!before.some(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName))) {
        return [];
    }
    const result = await deleteWorldbookEntries(worldbookName, entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName), { render: 'immediate' });
    if (result.deleted_entries.length === 0 ||
        result.worldbook.some(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName))) {
        throw new Error(`世界书「${worldbookName}」中的工坊条目未成功删除`);
    }
    return result.deleted_entries;
}
async function assertNoProjectEntriesInRelevantWorldbooks(projectId, legacyProjectName) {
    const existingNames = new Set(getWorldbookNames());
    for (const worldbookName of getCreativeWorkshopRelevantWorldbookNames(projectId, legacyProjectName)) {
        if (!existingNames.has(worldbookName))
            continue;
        const entries = await getWorldbook(worldbookName);
        if (entries.some(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName))) {
            throw new Error(`卸载未完全完成：世界书「${worldbookName}」仍有工坊条目`);
        }
    }
}
async function deleteProjectEntriesFromInstalledWorldbooks(projectId, preferredWorldbookName, legacyProjectName, preserveWorldbookName) {
    const candidates = _.uniq([
        preferredWorldbookName,
        ...getCreativeWorkshopRelevantWorldbookNames(projectId, legacyProjectName),
    ]).filter((name) => _.isString(name) && Boolean(name) && (!preserveWorldbookName || name !== preserveWorldbookName));
    const deletedEntries = [];
    for (const worldbookName of candidates) {
        deletedEntries.push(...await deleteProjectEntriesFromWorldbook(projectId, worldbookName, legacyProjectName));
    }
    return deletedEntries;
}
async function installCreativeWorkshopProject(projectId, selectedEntryKeys, requestedWorldbookName, expectedVersion, manageOriginalConflicts = false) {
    invalidateCreativeWorkshopProjectCache(projectId);
    const { detail, prepared } = await prepareCreativeWorkshopProject(projectId, selectedEntryKeys, expectedVersion);
    if (prepared.length === 0) {
        const originalEntryStates = manageOriginalConflicts
            ? await syncCreativeWorkshopOriginalConflicts(projectId, detail)
            : [];
        setCreativeWorkshopInstallRecord(projectId, {
            worldbookName: null,
            installedVersion: detail.project.version || expectedVersion || null,
            originalEntryStates,
        });
        return detail;
    }
    const worldbookName = requestedWorldbookName
        ? await ensureCreativeWorkshopTargetWorldbook(requestedWorldbookName)
        : getCurrentWorldbookName();
    await applyPreparedCreativeWorkshopProject(projectId, detail, prepared, worldbookName);
    let originalEntryStates = [];
    if (manageOriginalConflicts) {
        try {
            originalEntryStates = await syncCreativeWorkshopOriginalConflicts(projectId, detail);
        }
        catch (error) {
            await deleteProjectEntriesFromWorldbook(projectId, worldbookName);
            throw error;
        }
    }
    setCreativeWorkshopInstallRecord(projectId, {
        worldbookName,
        installedVersion: detail.project.version || expectedVersion || null,
        originalEntryStates,
    });
    return detail;
}
async function uninstallCreativeWorkshopProject(projectId, legacyProjectName) {
    const worldbookName = await resolveCreativeWorkshopInstallWorldbook(projectId, legacyProjectName);
    const deletedEntries = worldbookName
        ? await deleteProjectEntriesFromInstalledWorldbooks(projectId, worldbookName, legacyProjectName)
        : [];
    if (worldbookName)
        await assertNoProjectEntriesInRelevantWorldbooks(projectId, legacyProjectName);
    await restoreCreativeWorkshopOriginalConflicts(legacyProjectName || projectId);
    return deletedEntries;
}
async function updateCreativeWorkshopProject(projectId, expectedVersion, legacyProjectName, manageOriginalConflicts = false) {
    invalidateCreativeWorkshopProjectCache(projectId);
    const { detail, prepared } = await prepareCreativeWorkshopProject(projectId, undefined, expectedVersion);
    const installedWorldbookName = await resolveCreativeWorkshopInstallWorldbook(projectId, legacyProjectName);
    let worldbookName = installedWorldbookName;
    if (installedWorldbookName) {
        worldbookName = await ensureCreativeWorkshopTargetWorldbook(installedWorldbookName);
        await deleteProjectEntriesFromInstalledWorldbooks(projectId, worldbookName, legacyProjectName, worldbookName);
        await applyPreparedCreativeWorkshopProject(projectId, detail, prepared, worldbookName, {
            pruneMissing: true,
            legacyProjectName,
        });
        const persisted = await getWorldbook(worldbookName);
        const persistedProjectEntries = persisted.filter(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName));
        if (persistedProjectEntries.length !== prepared.length) {
            throw new Error(`世界书「${worldbookName}」更新后条目数量异常，请重试`);
        }
    }
    else if (prepared.length > 0) {
        worldbookName = getCurrentWorldbookName();
        await applyPreparedCreativeWorkshopProject(projectId, detail, prepared, worldbookName);
    }
    if (legacyProjectName && legacyProjectName !== projectId) {
        await restoreCreativeWorkshopOriginalConflicts(legacyProjectName);
    }
    let originalEntryStates = [];
    if (manageOriginalConflicts) {
        originalEntryStates = await syncCreativeWorkshopOriginalConflicts(projectId, detail);
    }
    else {
        await restoreCreativeWorkshopOriginalConflicts(projectId);
    }
    if (legacyProjectName && legacyProjectName !== projectId) {
        deleteCreativeWorkshopInstallRecord(legacyProjectName);
    }
    setCreativeWorkshopInstallRecord(projectId, {
        worldbookName: prepared.length > 0 ? worldbookName : null,
        installedVersion: detail.project.version || expectedVersion || null,
        originalEntryStates,
    });
    return detail;
}

;// ./src/CreativeWorkshop/services/repair.ts






const CREATIVE_WORKSHOP_REPAIR_QUEUE_KEY = 'creative_workshop_repair_queue';
const WORKSHOP_METADATA_FIELDS = [
    'cw_project_id',
    'cw_project_name_display',
    'cw_project_version',
    'cw_entry_key',
    'cw_name_format_version',
];
const OFFICIAL_WORLDBOOK_BASELINE_VERSION = String(worldbook_fingerprints_namespaceObject?.character_version || '');
const OFFICIAL_WORLDBOOK_BASELINE_ENTRIES = Array.isArray(worldbook_fingerprints_namespaceObject?.entries)
    ? worldbook_fingerprints_namespaceObject.entries
    : [];
const OFFICIAL_WORLDBOOK_BASELINE_BY_NAME = new Map(OFFICIAL_WORLDBOOK_BASELINE_ENTRIES.map(entry => [String(entry.name || '').trim(), entry]));
function normalizeBaselineText(value) {
    return String(value ?? '').replace(/\r\n/g, '\n').trim();
}
async function sha256Hex(value) {
    try {
        if (!globalThis.crypto?.subtle)
            return null;
        const bytes = new TextEncoder().encode(value);
        const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
        return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
    catch (error) {
        console.warn('[CreativeWorkshop] official baseline fingerprint 计算失败', error);
        return null;
    }
}
async function fingerprintWorldbookEntry(entry) {
    const raw = entry;
    const canonical = {
        name: normalizeBaselineText(raw.name ?? raw.comment),
        content: normalizeBaselineText(raw.content),
    };
    return sha256Hex(JSON.stringify(canonical));
}
function getRepairScopeKey() {
    return getCurrentCharacterName() || '__no_character__';
}
function readRepairRegistry() {
    const variables = getVariables({ type: 'script', script_id: getScriptId() });
    const raw = _.get(variables, CREATIVE_WORKSHOP_REPAIR_QUEUE_KEY);
    return _.isObject(raw) ? raw : {};
}
function writeRepairRegistry(registry) {
    updateVariablesWith(variables => {
        _.set(variables, CREATIVE_WORKSHOP_REPAIR_QUEUE_KEY, registry);
        return variables;
    }, { type: 'script', script_id: getScriptId() });
}
function writeRepairRecord(record) {
    const registry = readRepairRegistry();
    const scopeKey = getRepairScopeKey();
    registry[scopeKey] = registry[scopeKey] || {};
    for (const [repairId, existing] of Object.entries(registry[scopeKey])) {
        if (repairId !== record.repairId && existing.target.candidateId === record.target.candidateId) {
            delete registry[scopeKey][repairId];
        }
    }
    registry[scopeKey][record.repairId] = record;
    writeRepairRegistry(registry);
}
function updateRepairRecord(repairId, patch) {
    const registry = readRepairRegistry();
    const scopeKey = getRepairScopeKey();
    const current = registry[scopeKey]?.[repairId];
    if (!current)
        return;
    registry[scopeKey][repairId] = {
        ...current,
        ...patch,
        updatedAt: Date.now(),
    };
    writeRepairRegistry(registry);
}
function deleteRepairRecord(repairId) {
    const registry = readRepairRegistry();
    const scopeKey = getRepairScopeKey();
    if (!registry[scopeKey]?.[repairId])
        return;
    delete registry[scopeKey][repairId];
    if (Object.keys(registry[scopeKey]).length === 0)
        delete registry[scopeKey];
    writeRepairRegistry(registry);
}
function getCreativeWorkshopPendingRepairs() {
    return Object.values(readRepairRegistry()[getRepairScopeKey()] || {}).sort((a, b) => a.startedAt - b.startedAt);
}
function parseDlcEntryName(name) {
    if (!_.isString(name))
        return null;
    const value = String(name);
    const v3 = value.match(/^\[DLC\]\[([^\]]+)\]\[WS\]/);
    if (v3) {
        return {
            category: v3[1],
            projectName: null,
            workshopSourceMarker: true,
        };
    }
    const v2 = value.match(/^\[DLC\]\[([^\]]+)\]\[([^\]]+)\]\[WS\]/);
    if (v2) {
        return {
            category: v2[1],
            projectName: v2[2],
            workshopSourceMarker: true,
        };
    }
    const legacy = value.match(/^\[DLC\]\[([^\]]+)\](?:\[([^\]]+)\])?/);
    if (!legacy)
        return null;
    return {
        category: legacy[1],
        projectName: legacy[2] || null,
        workshopSourceMarker: false,
    };
}
function readStringMetadata(entry, field) {
    const value = _.get(entry, `extra.${field}`);
    if (_.isString(value) && value)
        return String(value);
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    return null;
}
function readUid(entry) {
    const value = entry.uid;
    if (_.isString(value) && value)
        return String(value);
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    return null;
}
function makeMetadataReport(entries) {
    return WORKSHOP_METADATA_FIELDS.map(field => {
        const values = entries.map(entry => readStringMetadata(entry, field)).filter((value) => Boolean(value));
        const uniqueValues = _.uniq(values);
        let status;
        if (values.length === 0)
            status = 'missing';
        else if (uniqueValues.length > 1 && field !== 'cw_entry_key')
            status = 'conflict';
        else if (values.length < entries.length)
            status = 'partial';
        else
            status = 'complete';
        return {
            field,
            status,
            presentCount: values.length,
            totalCount: entries.length,
            values: uniqueValues.slice(0, field === 'cw_entry_key' ? 4 : 8),
        };
    });
}
function candidateIdFor(worldbookName, projectName) {
    return `${worldbookName}::${projectName}`;
}
function describeCandidateProblems(candidate) {
    const problems = [];
    const projectIdReport = candidate.metadata.find(item => item.field === 'cw_project_id');
    const versionReport = candidate.metadata.find(item => item.field === 'cw_project_version');
    const entryKeyReport = candidate.metadata.find(item => item.field === 'cw_entry_key');
    if (projectIdReport?.status === 'missing')
        problems.push('缺少 cw_project_id，无法仅靠工坊 metadata 识别项目');
    else if (projectIdReport?.status === 'partial')
        problems.push('只有部分条目具有 cw_project_id');
    else if (projectIdReport?.status === 'conflict')
        problems.push('cw_project_id 存在冲突，同一 DLC 组出现多个项目 ID');
    if (versionReport?.status === 'missing')
        problems.push('缺少 cw_project_version，无法确认本地版本');
    else if (versionReport?.status === 'conflict')
        problems.push('本地条目的 cw_project_version 不一致');
    if (entryKeyReport?.status === 'missing')
        problems.push('缺少 cw_entry_key，不能依赖工坊条目键进行更新');
    else if (entryKeyReport?.status === 'partial')
        problems.push('只有部分条目具有 cw_entry_key');
    if (candidate.unaddressableEntryCount > 0)
        problems.push(`${candidate.unaddressableEntryCount} 个条目没有本地 UID，自动删除不安全`);
    if (candidate.dlcHeaderCount === 0)
        problems.push('没有发现 [DLC] 命名头，仅依赖旧 metadata 识别');
    if (candidate.workshopSourceMarkerCount === 0)
        problems.push('没有发现 [WS] 工坊来源标记');
    return problems;
}
async function scanCreativeWorkshopRepairCandidates(options = {}) {
    const availableWorldbookNames = _.uniq(getWorldbookNames().filter(name => _.isString(name) && Boolean(name)));
    const availableWorldbookNameSet = new Set(availableWorldbookNames);
    const enabledWorldbookNames = _.uniq(getCreativeWorkshopBoundWorldbookNames().filter(name => _.isString(name) && Boolean(name)));
    const requestedWorldbookNames = Array.isArray(options.worldbookNames) && options.worldbookNames.length > 0
        ? _.uniq(options.worldbookNames.filter(name => _.isString(name) && Boolean(name)))
            .filter(name => availableWorldbookNameSet.has(name))
        : enabledWorldbookNames;
    const rows = await Promise.all(requestedWorldbookNames.map(async (worldbookName) => {
        try {
            return { worldbookName, entries: await getWorldbook(worldbookName), readable: true };
        }
        catch (error) {
            console.warn('[CreativeWorkshop] repair scan 无法读取世界书', { worldbookName, error });
            return { worldbookName, entries: [], readable: false };
        }
    }));
    let officialBaselineSkippedCount = 0;
    const modifiedOfficialBaselineEntries = [];
    const entryRows = [];
    for (const row of rows.filter(row => row.readable)) {
        for (const entry of row.entries) {
            const header = parseDlcEntryName(entry.name);
            const currentProjectId = readStringMetadata(entry, 'cw_project_id');
            const legacyProjectName = readStringMetadata(entry, 'fate_project_name');
            if (header && !currentProjectId && !legacyProjectName) {
                const baselineEntry = OFFICIAL_WORLDBOOK_BASELINE_BY_NAME.get(normalizeBaselineText(entry.name ?? entry.comment));
                if (baselineEntry) {
                    const fingerprint = await fingerprintWorldbookEntry(entry);
                    if (fingerprint && fingerprint === baselineEntry.fingerprint) {
                        officialBaselineSkippedCount += 1;
                    }
                    else {
                        modifiedOfficialBaselineEntries.push({
                            worldbookName: row.worldbookName,
                            name: normalizeBaselineText(entry.name ?? entry.comment),
                        });
                    }
                    continue;
                }
            }
            if (header || currentProjectId || legacyProjectName) {
                entryRows.push({ worldbookName: row.worldbookName, entry, header });
            }
        }
    }
    const grouped = _.groupBy(entryRows, row => {
        const name = readStringMetadata(row.entry, 'cw_project_name_display') ||
            readStringMetadata(row.entry, 'fate_project_name') ||
            readStringMetadata(row.entry, 'cw_project_id') ||
            row.header?.projectName ||
            String(row.entry.name || '未命名 DLC');
        return candidateIdFor(row.worldbookName, name);
    });
    const regexes = getTavernRegexes({ scope: 'character', enable_state: 'all' });
    const candidates = Object.entries(grouped).map(([candidateId, candidateRows]) => {
        const entries = candidateRows.map(row => row.entry);
        const name = entries.map(entry => readStringMetadata(entry, 'cw_project_name_display')).find(Boolean) ||
            entries.map(entry => readStringMetadata(entry, 'fate_project_name')).find(Boolean) ||
            entries.map(entry => readStringMetadata(entry, 'cw_project_id')).find(Boolean) ||
            candidateRows[0]?.header?.projectName ||
            String(entries[0]?.name || '未命名 DLC');
        const category = candidateRows.map(row => row.header?.category || null).find(Boolean) || null;
        const worldbookName = candidateRows[0].worldbookName;
        const entryUids = entries.map(readUid).filter((value) => value !== null);
        const metadata = makeMetadataReport(entries);
        const detectedProjectIds = _.uniq([
            ...entries.map(entry => readStringMetadata(entry, 'cw_project_id')).filter((value) => Boolean(value)),
            ...entries.map(entry => readStringMetadata(entry, 'fate_project_name')).filter((value) => Boolean(value)),
        ]);
        const regexIds = regexes
            .filter(regex => {
            const regexId = getCreativeWorkshopRegexId(regex);
            const scriptName = _.isString(regex.script_name) ? String(regex.script_name) : '';
            return detectedProjectIds.some(projectId => regexId.startsWith(`creative_workshop:${projectId}:`)) ||
                scriptName.startsWith(`[工坊] ${name} -`);
        })
            .map(regex => getCreativeWorkshopRegexId(regex))
            .filter(Boolean);
        const versions = _.uniq(entries.map(entry => readStringMetadata(entry, 'cw_project_version')).filter((value) => Boolean(value)));
        const legacyNames = _.uniq(entries.map(entry => readStringMetadata(entry, 'fate_project_name')).filter((value) => Boolean(value)));
        const base = {
            candidateId,
            name,
            category,
            worldbookName,
            entryUids,
            regexIds: _.uniq(regexIds),
            entryCount: entries.length,
            regexCount: _.uniq(regexIds).length,
            unaddressableEntryCount: entries.length - entryUids.length,
            dlcHeaderCount: candidateRows.filter(row => Boolean(row.header)).length,
            workshopSourceMarkerCount: candidateRows.filter(row => row.header?.workshopSourceMarker).length,
            detectedProjectId: detectedProjectIds.length === 1 ? detectedProjectIds[0] : null,
            detectedProjectIds,
            legacyProjectName: legacyNames.length === 1 ? legacyNames[0] : null,
            localVersion: versions.length === 1 ? versions[0] : null,
            metadata,
        };
        return {
            ...base,
            problems: describeCandidateProblems(base),
        };
    });
    return {
        candidates: candidates.sort((a, b) => a.worldbookName.localeCompare(b.worldbookName) || a.name.localeCompare(b.name)),
        unreadableWorldbookNames: rows.filter(row => !row.readable).map(row => row.worldbookName),
        pending: getCreativeWorkshopPendingRepairs(),
        availableWorldbookNames,
        enabledWorldbookNames,
        scannedWorldbookNames: requestedWorldbookNames,
        officialBaselineVersion: OFFICIAL_WORLDBOOK_BASELINE_VERSION,
        officialBaselineSkippedCount,
        modifiedOfficialBaselineEntries,
    };
}
function normalizeRepairTarget(target) {
    const candidateId = String(target?.candidateId || '').trim();
    const projectId = String(target?.projectId || '').trim();
    const worldbookName = String(target?.worldbookName || '').trim();
    if (!candidateId)
        throw new Error('修复任务缺少 candidateId');
    if (!projectId)
        throw new Error('修复任务缺少 Workshop projectId');
    if (!worldbookName)
        throw new Error('修复任务缺少世界书');
    const entryUids = Array.from(new Set((Array.isArray(target.entryUids) ? target.entryUids : [])
        .map(value => (_.isString(value) && value) || (typeof value === 'number' && Number.isFinite(value) ? value : null))
        .filter((value) => value !== null)));
    const regexIds = Array.from(new Set((Array.isArray(target.regexIds) ? target.regexIds : [])
        .filter(_.isString)
        .map(String)
        .filter(Boolean)));
    const expectedEntryCount = Number.isInteger(target.expectedEntryCount) && Number(target.expectedEntryCount) >= 0
        ? Number(target.expectedEntryCount)
        : undefined;
    const expectedRegexCount = Number.isInteger(target.expectedRegexCount) && Number(target.expectedRegexCount) >= 0
        ? Number(target.expectedRegexCount)
        : undefined;
    if (entryUids.length === 0 && regexIds.length === 0) {
        throw new Error('没有可安全定位的旧 DLC 内容；已禁止自动删除');
    }
    if (expectedEntryCount !== undefined && entryUids.length !== expectedEntryCount) {
        throw new Error(`旧 DLC 条目快照不完整：扫描到 ${expectedEntryCount} 个条目，但只有 ${entryUids.length} 个可定位 UID；已禁止自动删除`);
    }
    if (expectedRegexCount !== undefined && regexIds.length !== expectedRegexCount) {
        throw new Error(`旧 DLC 正则快照不完整：扫描到 ${expectedRegexCount} 个正则，但只有 ${regexIds.length} 个可定位 ID；已禁止自动删除`);
    }
    return {
        candidateId,
        projectId,
        projectVersion: _.isString(target.projectVersion) && target.projectVersion ? String(target.projectVersion) : null,
        worldbookName,
        entryUids,
        regexIds,
        expectedEntryCount,
        expectedRegexCount,
        sourceProjectIds: Array.from(new Set((Array.isArray(target.sourceProjectIds) ? target.sourceProjectIds : [])
            .filter(_.isString)
            .map(String)
            .filter(Boolean))),
    };
}
async function deleteSelectedRepairArtifacts(target) {
    const uidKeys = new Set(target.entryUids.map(uid => String(uid)));
    if (uidKeys.size > 0) {
        if (!getWorldbookNames().includes(target.worldbookName)) {
            throw new Error(`世界书「${target.worldbookName}」不存在，无法安全删除旧 DLC`);
        }
        await deleteWorldbookEntries(target.worldbookName, entry => {
            const uid = readUid(entry);
            return uid !== null && uidKeys.has(String(uid));
        }, { render: 'immediate' });
        const remaining = await getWorldbook(target.worldbookName);
        if (remaining.some(entry => {
            const uid = readUid(entry);
            return uid !== null && uidKeys.has(String(uid));
        })) {
            throw new Error(`世界书「${target.worldbookName}」仍存在选中的旧 DLC 条目`);
        }
    }
    const regexIds = new Set(target.regexIds);
    if (regexIds.size > 0) {
        await updateTavernRegexesWith(regexes => regexes.filter(regex => !regexIds.has(getCreativeWorkshopRegexId(regex))), { scope: 'character' });
        const remainingRegexIds = new Set(getTavernRegexes({ scope: 'character', enable_state: 'all' }).map(regex => getCreativeWorkshopRegexId(regex)));
        if (target.regexIds.some(regexId => remainingRegexIds.has(regexId))) {
            throw new Error('仍存在选中的旧 DLC 正则');
        }
    }
}
async function verifyCreativeWorkshopRepair(target, expectedEntryCount, expectedRegexCount) {
    const entries = await getWorldbook(target.worldbookName);
    const installedEntries = entries.filter(entry => _.get(entry, 'extra.cw_project_id') === target.projectId);
    if (installedEntries.length !== expectedEntryCount) {
        throw new Error(`修复验证失败：世界书应有 ${expectedEntryCount} 个新版条目，实际 ${installedEntries.length} 个`);
    }
    const regexes = getTavernRegexes({ scope: 'character', enable_state: 'all' });
    const installedRegexCount = regexes.filter(regex => getCreativeWorkshopRegexId(regex).startsWith(`creative_workshop:${target.projectId}:`)).length;
    if (installedRegexCount !== expectedRegexCount) {
        throw new Error(`修复验证失败：应有 ${expectedRegexCount} 个新版正则，实际 ${installedRegexCount} 个`);
    }
}
async function repairCreativeWorkshopProject(rawTarget) {
    const target = normalizeRepairTarget(rawTarget);
    const repairId = `${target.candidateId}::${target.projectId}`;
    const startedAt = Date.now();
    writeRepairRecord({ repairId, target, status: 'preparing', error: null, startedAt, updatedAt: startedAt });
    try {
        // Repair always targets the current Workshop version. Do not pin retries to an older matched version.
        invalidateCreativeWorkshopProjectCache(target.projectId);
        const { detail, prepared } = await prepareCreativeWorkshopProject(target.projectId);
        const preparedRegexes = prepareCreativeWorkshopRegexEntries(detail);
        await ensureCreativeWorkshopTargetWorldbook(target.worldbookName);
        updateRepairRecord(repairId, { status: 'replacing', error: null });
        await deleteSelectedRepairArtifacts(target);
        await applyPreparedCreativeWorkshopProject(target.projectId, detail, prepared, target.worldbookName, { pruneMissing: true });
        await applyPreparedCreativeWorkshopRegex(target.projectId, detail, preparedRegexes);
        setCreativeWorkshopInstallRecord(target.projectId, {
            worldbookName: target.worldbookName,
            installedVersion: detail.project.version || target.projectVersion || null,
        });
        for (const sourceProjectId of target.sourceProjectIds || []) {
            if (sourceProjectId !== target.projectId)
                deleteCreativeWorkshopInstallRecord(sourceProjectId);
        }
        updateRepairRecord(repairId, { status: 'verifying', error: null });
        await verifyCreativeWorkshopRepair(target, prepared.length, preparedRegexes.length);
        deleteRepairRecord(repairId);
        return {
            success: true,
            candidateId: target.candidateId,
            projectId: target.projectId,
            installedVersion: detail.project.version || target.projectVersion || null,
            worldbookName: target.worldbookName,
            entryCount: prepared.length,
            regexCount: preparedRegexes.length,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        updateRepairRecord(repairId, { status: 'failed', error: message });
        throw error;
    }
}

;// ./src/CreativeWorkshop/services/script-dependency.ts
const SCRIPT_SCOPES = ['character', 'preset', 'global'];
const FLOATING_REFS = new Set(['main', 'master', 'latest', 'dev', 'develop', 'development', 'staging', 'next', 'canary']);
const SEMVER_RE = /^v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;
const COMMIT_RE = /^[0-9a-f]{7,40}$/i;
function getScriptTreeGetter() {
    const candidate = globalThis.getScriptTrees;
    return typeof candidate === 'function' ? candidate : null;
}
function normalizeText(value) {
    return typeof value === 'string' ? value : '';
}
function normalizeBoolean(value) {
    return value !== false;
}
function normalizeScript(tree, scope) {
    if (tree.type !== 'script')
        return null;
    const scriptId = normalizeText(tree.id).trim();
    const scriptName = normalizeText(tree.name).trim();
    const content = normalizeText(tree.content);
    const scriptEnabled = normalizeBoolean(tree.enabled);
    if (!scriptId && !scriptName)
        return null;
    const dependencies = extractScriptDependencies({ scope, scriptId, scriptName, scriptEnabled, content });
    if (dependencies.length === 0)
        return null;
    return {
        scope,
        scriptId,
        scriptName,
        scriptEnabled,
        dependencies,
    };
}
function flattenScriptTrees(value, scope) {
    if (!Array.isArray(value))
        return [];
    const scripts = [];
    for (const item of value) {
        if (!item || typeof item !== 'object')
            continue;
        const tree = item;
        const script = normalizeScript(tree, scope);
        if (script) {
            scripts.push(script);
            continue;
        }
        if (tree.type === 'folder' && Array.isArray(tree.scripts)) {
            for (const child of tree.scripts) {
                const nestedScript = child && typeof child === 'object'
                    ? normalizeScript(child, scope)
                    : null;
                if (nestedScript)
                    scripts.push(nestedScript);
            }
        }
    }
    return scripts;
}
function extractStaticImportUrls(content) {
    const urls = new Set();
    const patterns = [
        /\bimport\s+(?:[^'";]*?\s+from\s+)?['"](https?:\/\/[^'"\s]+)['"]/g,
        /\bimport\s*\(\s*['"](https?:\/\/[^'"\s]+)['"]\s*\)/g,
    ];
    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(content))) {
            if (match[1])
                urls.add(match[1]);
        }
    }
    return [...urls];
}
function safelyDecodeRef(ref) {
    try {
        return decodeURIComponent(ref).trim();
    }
    catch {
        return ref.trim();
    }
}
function normalizeRef(ref) {
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
function inspectScriptImportUrl(importUrl) {
    let url;
    try {
        url = new URL(importUrl);
    }
    catch {
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
function extractScriptDependencies(input) {
    return extractStaticImportUrls(input.content).map(importUrl => ({
        scope: input.scope,
        scriptId: input.scriptId,
        scriptName: input.scriptName,
        scriptEnabled: input.scriptEnabled,
        importUrl,
        ...inspectScriptImportUrl(importUrl),
    }));
}
function listCreativeWorkshopScriptDependencies() {
    const getTrees = getScriptTreeGetter();
    if (!getTrees) {
        return { supported: false, scripts: [] };
    }
    const scripts = [];
    for (const scope of SCRIPT_SCOPES) {
        try {
            scripts.push(...flattenScriptTrees(getTrees({ type: scope }), scope));
        }
        catch (error) {
            console.warn('[CreativeWorkshop] failed to inspect TavernHelper script tree', { scope, error });
        }
    }
    return { supported: true, scripts };
}

;// ./src/CreativeWorkshop/bridge/protocol.ts
const CREATIVE_WORKSHOP_BRIDGE_NAMESPACE = 'creative-workshop-bridge';
function isCreativeWorkshopBridgeMessage(value) {
    return (_.isObject(value) &&
        _.get(value, 'namespace') === CREATIVE_WORKSHOP_BRIDGE_NAMESPACE &&
        _.isString(_.get(value, 'type')));
}
function createBridgeMessage(type, payload, requestId) {
    return {
        namespace: CREATIVE_WORKSHOP_BRIDGE_NAMESPACE,
        type,
        requestId,
        payload,
    };
}

;// ./src/CreativeWorkshop/bridge/host.ts











const OAUTH_CALLBACK_SOURCE = 'creative-workshop-auth-callback';
const OAUTH_POPUP_NAME = 'creative-workshop-oauth';
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;
const OAUTH_POPUP_CLOSE_GUARD_MS = 8000;
function isOAuthCallbackMessage(value) {
    return (_.isObject(value) &&
        (_.get(value, 'type') === 'oauth-success' ||
            _.get(value, 'type') === 'oauth-error' ||
            _.get(value, 'type') === 'oauth-ready') &&
        _.get(value, 'source') === OAUTH_CALLBACK_SOURCE);
}
function redactOAuthLogPayload(value) {
    return {
        type: _.isString(_.get(value, 'type')) ? String(_.get(value, 'type')) : undefined,
        state: _.isString(_.get(value, 'state')) ? String(_.get(value, 'state')) : undefined,
        success: _.isBoolean(_.get(value, 'success')) ? Boolean(_.get(value, 'success')) : undefined,
        callbackReady: _.isBoolean(_.get(value, 'callbackReady')) ? Boolean(_.get(value, 'callbackReady')) : undefined,
        hasToken: _.isString(_.get(value, 'token')),
    };
}
function createCreativeWorkshopBridgeHost(option) {
    const { iframe, targetOrigin, hostWindow = window.parent !== window ? window.parent : window, onClose } = option;
    const oauthOrigin = getCreativeWorkshopOrigin();
    let oauthPopup = null;
    let pendingOauthRequestId;
    let pendingOauthState;
    let oauthTimeoutId = null;
    let oauthClosePollId = null;
    let oauthPopupOpenedAt = 0;
    let initialInstalledProjectScanInFlight = null;
    const projectMutationInFlight = new Set();
    async function getInitialInstalledProjectScan() {
        if (initialInstalledProjectScanInFlight)
            return initialInstalledProjectScanInFlight;
        const scan = scanInstalledCreativeWorkshopProjects();
        initialInstalledProjectScanInFlight = scan;
        try {
            return await scan;
        }
        finally {
            if (initialInstalledProjectScanInFlight === scan)
                initialInstalledProjectScanInFlight = null;
        }
    }
    async function getCompleteInitialInstalledProjects() {
        const scan = await getInitialInstalledProjectScan();
        if (!scan.complete) {
            throw new Error(`世界书尚未准备完成，未能读取：${scan.unreadableWorldbookNames.join('、')}`);
        }
        return scan.projects;
    }
    console.info('[CreativeWorkshopBridgeHost] created', {
        targetOrigin,
        oauthOrigin,
        iframeSrc: iframe.getAttribute('src'),
    });
    function cleanupOAuthPopupReference() {
        console.info('[CreativeWorkshopBridgeHost] cleanupOAuthPopupReference', {
            hasPopup: Boolean(oauthPopup),
            popupClosed: oauthPopup?.closed ?? null,
        });
        if (oauthPopup && !oauthPopup.closed) {
            oauthPopup.close();
        }
        oauthPopup = null;
    }
    function clearOAuthTimers() {
        console.info('[CreativeWorkshopBridgeHost] clearOAuthTimers', {
            hasTimeout: oauthTimeoutId !== null,
            hasClosePoll: oauthClosePollId !== null,
        });
        if (oauthTimeoutId !== null) {
            hostWindow.clearTimeout(oauthTimeoutId);
            oauthTimeoutId = null;
        }
        if (oauthClosePollId !== null) {
            hostWindow.clearInterval(oauthClosePollId);
            oauthClosePollId = null;
        }
    }
    async function resolveOAuthResult(payload, requestId = pendingOauthRequestId) {
        console.info('[CreativeWorkshopBridgeHost] resolveOAuthResult', {
            requestId,
            payload: redactOAuthLogPayload(payload),
        });
        await post('bridge:oauth:result', payload, requestId);
        clearOAuthTimers();
        cleanupOAuthPopupReference();
        pendingOauthRequestId = undefined;
        pendingOauthState = undefined;
    }
    async function failPendingOAuth(message) {
        console.warn('[CreativeWorkshopBridgeHost] failPendingOAuth', {
            message,
            pendingOauthRequestId,
            pendingOauthState,
        });
        if (!pendingOauthRequestId)
            return;
        await resolveOAuthResult({
            success: false,
            message,
            state: pendingOauthState,
        }, pendingOauthRequestId);
    }
    function startOAuthMonitors() {
        clearOAuthTimers();
        oauthPopupOpenedAt = Date.now();
        console.info('[CreativeWorkshopBridgeHost] startOAuthMonitors', {
            pendingOauthRequestId,
            pendingOauthState,
            popupClosed: oauthPopup?.closed ?? null,
        });
        oauthTimeoutId = hostWindow.setTimeout(() => {
            void failPendingOAuth('授权超时');
        }, OAUTH_TIMEOUT_MS);
        // TauriTavern mobile intentionally opens external URLs in the system browser
        // and returns null from window.open(). In that mode there is no popup Window
        // object to monitor; the Workshop iframe recovers the result through backend polling.
        if (oauthPopup) {
            oauthClosePollId = hostWindow.setInterval(() => {
                if (Date.now() - oauthPopupOpenedAt < OAUTH_POPUP_CLOSE_GUARD_MS) {
                    console.info('[CreativeWorkshopBridgeHost] oauthClosePoll:within-guard-window', {
                        elapsedMs: Date.now() - oauthPopupOpenedAt,
                        guardMs: OAUTH_POPUP_CLOSE_GUARD_MS,
                    });
                    return;
                }
                if (oauthPopup?.closed) {
                    console.info('[CreativeWorkshopBridgeHost] popup reported closed before oauth resolved', {
                        state: pendingOauthState,
                        guardMs: OAUTH_POPUP_CLOSE_GUARD_MS,
                    });
                }
            }, 500);
        }
    }
    async function handleOAuthCallback(event) {
        console.info('[CreativeWorkshopBridgeHost] handleOAuthCallback:received', {
            pendingOauthRequestId,
            pendingOauthState,
            eventOrigin: event.origin,
            sourceMatchesPopup: oauthPopup ? event.source === oauthPopup : null,
            data: redactOAuthLogPayload(event.data),
        });
        if (!pendingOauthRequestId)
            return;
        if (event.origin !== oauthOrigin)
            return;
        if (!isOAuthCallbackMessage(event.data))
            return;
        if (oauthPopup && event.source !== oauthPopup)
            return;
        if (pendingOauthState && event.data.state !== pendingOauthState) {
            await failPendingOAuth('授权状态校验失败');
            return;
        }
        if (event.data.type === 'oauth-ready') {
            await post('bridge:oauth:result', {
                callbackReady: true,
                state: event.data.state,
            }, pendingOauthRequestId);
            clearOAuthTimers();
            cleanupOAuthPopupReference();
            pendingOauthRequestId = undefined;
            pendingOauthState = undefined;
            return;
        }
        if (event.data.type === 'oauth-success') {
            if (!_.isString(event.data.token) || !_.isObject(event.data.user)) {
                await failPendingOAuth('授权回调缺少有效登录信息');
                return;
            }
            await resolveOAuthResult({
                success: true,
                token: event.data.token,
                user: event.data.user,
                state: event.data.state,
            });
            return;
        }
        await resolveOAuthResult({
            success: false,
            message: _.isString(event.data.message) ? event.data.message : '登录失败',
            state: event.data.state,
        });
    }
    async function post(type, payload, requestId) {
        console.info('[CreativeWorkshopBridgeHost] post', {
            type,
            requestId,
            payload: type === 'bridge:oauth:result' ? redactOAuthLogPayload(payload) : payload,
            targetOrigin,
        });
        iframe.contentWindow?.postMessage(createBridgeMessage(type, payload, requestId), targetOrigin);
    }
    async function handleMessage(event) {
        console.info('[CreativeWorkshopBridgeHost] handleMessage:received', {
            eventOrigin: event.origin,
            sourceMatchesIframe: event.source === iframe.contentWindow,
            data: {
                type: _.get(event.data, 'type'),
                requestId: _.get(event.data, 'requestId'),
            },
        });
        if (event.source !== iframe.contentWindow)
            return;
        if (targetOrigin !== '*' && event.origin !== targetOrigin)
            return;
        if (!isCreativeWorkshopBridgeMessage(event.data))
            return;
        const actionType = event.data.type;
        const actionLegacyProjectName = _.isString(_.get(event.data, 'payload.legacyProjectName'))
            ? String(event.data.payload?.legacyProjectName)
            : undefined;
        const actionProjectId = _.isString(_.get(event.data, 'payload.projectId'))
            ? String(event.data.payload?.projectId)
            : undefined;
        const isProjectMutation = actionType === 'bridge:install-project' ||
            actionType === 'bridge:uninstall-project' ||
            actionType === 'bridge:confirm-project-update' ||
            actionType === 'bridge:repair:project';
        if (isProjectMutation && actionProjectId) {
            if (projectMutationInFlight.has(actionProjectId)) {
                await post('bridge:error', {
                    message: '此项目已有安装、更新或卸载操作正在进行，请等待完成',
                    projectId: actionProjectId,
                    action: actionType,
                }, event.data.requestId);
                return;
            }
            projectMutationInFlight.add(actionProjectId);
        }
        try {
            switch (event.data.type) {
                case 'bridge:handshake':
                    await post('bridge:handshake:ok', { connected: true, clientVersion: CREATIVE_WORKSHOP_CLIENT_VERSION }, event.data.requestId);
                    await post('bridge:context', getCurrentCreativeWorkshopContext(), event.data.requestId);
                    await post('bridge:installed-projects', { projects: await getCompleteInitialInstalledProjects() }, event.data.requestId);
                    break;
                case 'bridge:get-context':
                    await post('bridge:context', getCurrentCreativeWorkshopContext(), event.data.requestId);
                    break;
                case 'bridge:list-installed-projects':
                    await post('bridge:installed-projects', { projects: await getCompleteInitialInstalledProjects() }, event.data.requestId);
                    break;
                case 'bridge:list-script-dependencies':
                    await post('bridge:script-dependencies', listCreativeWorkshopScriptDependencies(), event.data.requestId);
                    break;
                case 'bridge:install-project':
                    if (!_.isString(_.get(event.data, 'payload.projectId'))) {
                        throw new Error('缺少 projectId');
                    }
                    await installCreativeWorkshopProject(String(event.data.payload?.projectId), Array.isArray(event.data.payload?.worldbookEntryKeys) ? event.data.payload?.worldbookEntryKeys.map(String) : undefined, _.isString(event.data.payload?.worldbookName) ? String(event.data.payload?.worldbookName) : undefined, _.isString(event.data.payload?.projectVersion) ? String(event.data.payload?.projectVersion) : undefined, event.data.payload?.manageOriginalConflicts === true);
                    await installCreativeWorkshopRegex(String(event.data.payload?.projectId), Array.isArray(event.data.payload?.regexEntryKeys) ? event.data.payload?.regexEntryKeys.map(String) : undefined, _.isString(event.data.payload?.projectVersion) ? String(event.data.payload?.projectVersion) : undefined);
                    await post('bridge:install-result', {
                        success: true,
                        projectId: String(event.data.payload?.projectId),
                        projects: await listInstalledCreativeWorkshopProjects(),
                    }, event.data.requestId);
                    await post('bridge:context', getCurrentCreativeWorkshopContext(), event.data.requestId);
                    break;
                case 'bridge:uninstall-project':
                    if (!_.isString(_.get(event.data, 'payload.projectId'))) {
                        throw new Error('缺少 projectId');
                    }
                    await uninstallCreativeWorkshopProject(String(event.data.payload?.projectId), actionLegacyProjectName);
                    await uninstallCreativeWorkshopRegex(String(event.data.payload?.projectId), actionLegacyProjectName);
                    const remainingProjects = await listInstalledCreativeWorkshopProjects();
                    const stillInstalled = remainingProjects.some(project => project.projectId === String(event.data.payload?.projectId) ||
                        Boolean(actionLegacyProjectName &&
                            (project.projectId === actionLegacyProjectName || project.legacyProjectName === actionLegacyProjectName)));
                    if (stillInstalled) {
                        throw new Error('卸载未完全完成：仍检测到旧工坊安装条目，请重试或手动检查世界书/正则');
                    }
                    deleteCreativeWorkshopInstallRecord(String(event.data.payload?.projectId));
                    if (actionLegacyProjectName && actionLegacyProjectName !== String(event.data.payload?.projectId)) {
                        deleteCreativeWorkshopInstallRecord(actionLegacyProjectName);
                    }
                    await post('bridge:uninstall-result', {
                        success: true,
                        projectId: String(event.data.payload?.projectId),
                        projects: remainingProjects,
                    }, event.data.requestId);
                    break;
                case 'bridge:get-project-diff': {
                    if (!_.isString(_.get(event.data, 'payload.projectId'))) {
                        throw new Error('缺少 projectId');
                    }
                    const diffResult = await getCreativeWorkshopProjectDiff(String(event.data.payload?.projectId), _.isString(event.data.payload?.projectVersion) ? String(event.data.payload?.projectVersion) : undefined, actionLegacyProjectName);
                    await post('bridge:project-diff', diffResult, event.data.requestId);
                    break;
                }
                case 'bridge:confirm-project-update':
                    if (!_.isString(_.get(event.data, 'payload.projectId'))) {
                        throw new Error('缺少 projectId');
                    }
                    const expectedVersion = _.isString(event.data.payload?.projectVersion)
                        ? String(event.data.payload?.projectVersion)
                        : undefined;
                    await updateCreativeWorkshopProject(String(event.data.payload?.projectId), expectedVersion, actionLegacyProjectName, event.data.payload?.manageOriginalConflicts === true);
                    await updateCreativeWorkshopRegex(String(event.data.payload?.projectId), expectedVersion, actionLegacyProjectName);
                    await post('bridge:update-result', {
                        success: true,
                        projectId: String(event.data.payload?.projectId),
                        projects: await listInstalledCreativeWorkshopProjects(),
                    }, event.data.requestId);
                    break;
                case 'bridge:repair:scan': {
                    const requestedWorldbookNames = Array.isArray(event.data.payload?.worldbookNames)
                        ? event.data.payload?.worldbookNames.filter(_.isString).map(String)
                        : undefined;
                    const report = await scanCreativeWorkshopRepairCandidates({ worldbookNames: requestedWorldbookNames });
                    await post('bridge:repair:scan-result', report, event.data.requestId);
                    break;
                }
                case 'bridge:repair:project': {
                    const result = await repairCreativeWorkshopProject({
                        candidateId: _.isString(_.get(event.data, 'payload.candidateId')) ? String(event.data.payload?.candidateId) : '',
                        projectId: _.isString(_.get(event.data, 'payload.projectId')) ? String(event.data.payload?.projectId) : '',
                        projectVersion: _.isString(_.get(event.data, 'payload.projectVersion')) ? String(event.data.payload?.projectVersion) : null,
                        worldbookName: _.isString(_.get(event.data, 'payload.worldbookName')) ? String(event.data.payload?.worldbookName) : '',
                        entryUids: Array.isArray(event.data.payload?.entryUids)
                            ? event.data.payload?.entryUids
                            : [],
                        regexIds: Array.isArray(event.data.payload?.regexIds)
                            ? event.data.payload?.regexIds.filter(_.isString).map(String)
                            : [],
                        expectedEntryCount: _.isNumber(_.get(event.data, 'payload.expectedEntryCount'))
                            ? Number(event.data.payload?.expectedEntryCount)
                            : undefined,
                        expectedRegexCount: _.isNumber(_.get(event.data, 'payload.expectedRegexCount'))
                            ? Number(event.data.payload?.expectedRegexCount)
                            : undefined,
                        sourceProjectIds: Array.isArray(event.data.payload?.sourceProjectIds)
                            ? event.data.payload?.sourceProjectIds.filter(_.isString).map(String)
                            : [],
                    });
                    await post('bridge:repair:project-result', { ...result, projects: await listInstalledCreativeWorkshopProjects() }, event.data.requestId);
                    await post('bridge:context', getCurrentCreativeWorkshopContext(), event.data.requestId);
                    break;
                }
                case 'bridge:close-workshop':
                    onClose?.();
                    break;
                case 'bridge:oauth:start': {
                    const authUrl = _.get(event.data, 'payload.authUrl');
                    const state = _.get(event.data, 'payload.state');
                    if (!_.isString(authUrl) || !authUrl.trim()) {
                        throw new Error('缺少 authUrl');
                    }
                    if (state != null && !_.isString(state)) {
                        throw new Error('state 类型无效');
                    }
                    if (pendingOauthRequestId) {
                        await failPendingOAuth('新的登录请求已开始，旧的授权流程已取消');
                    }
                    console.info('[CreativeWorkshopBridgeHost] bridge:oauth:start', {
                        authUrl,
                        state,
                        requestId: event.data.requestId,
                    });
                    const width = 600;
                    const height = 700;
                    const left = Math.max(0, Math.round((hostWindow.screen.width - width) / 2));
                    const top = Math.max(0, Math.round((hostWindow.screen.height - height) / 2));
                    const tauriTavernMobileExternalOpen = _.get(hostWindow, '__TAURITAVERN_MOBILE_WINDOW_OPEN_COMPAT__') === true;
                    const popup = hostWindow.open(authUrl, OAUTH_POPUP_NAME, `width=${width},height=${height},left=${left},top=${top}`);
                    if (!popup && !tauriTavernMobileExternalOpen) {
                        console.error('[CreativeWorkshopBridgeHost] bridge:oauth:start popup blocked');
                        await post('bridge:oauth:result', {
                            success: false,
                            message: '请允许浏览器弹窗后重试登录',
                            state: _.isString(state) ? state : undefined,
                        }, event.data.requestId);
                        break;
                    }
                    oauthPopup = popup;
                    oauthPopupOpenedAt = Date.now();
                    pendingOauthRequestId = event.data.requestId;
                    pendingOauthState = _.isString(state) ? state : undefined;
                    console.info('[CreativeWorkshopBridgeHost] bridge:oauth:start popup opened', {
                        popupClosed: popup?.closed ?? null,
                        externalBrowserOnly: tauriTavernMobileExternalOpen && !popup,
                        pendingOauthRequestId,
                        pendingOauthState,
                    });
                    startOAuthMonitors();
                    break;
                }
            }
        }
        catch (error) {
            await post('bridge:error', {
                message: error instanceof Error ? error.message : String(error),
                projectId: actionProjectId,
                action: actionType,
            }, event.data.requestId);
        }
        finally {
            if (isProjectMutation && actionProjectId) {
                projectMutationInFlight.delete(actionProjectId);
            }
        }
    }
    hostWindow.addEventListener('message', handleOAuthCallback);
    hostWindow.addEventListener('message', handleMessage);
    return {
        destroy() {
            if (pendingOauthRequestId || pendingOauthState) {
                console.warn('[CreativeWorkshopBridgeHost] OAuth 监听在授权完成前被销毁', {
                    requestId: pendingOauthRequestId,
                    state: pendingOauthState,
                    popupClosed: oauthPopup?.closed ?? null,
                    iframeStillConnected: document.contains(iframe),
                    iframeSrc: iframe.getAttribute('src'),
                    iframeHref: (() => {
                        try {
                            return iframe.contentWindow?.location.href ?? null;
                        }
                        catch {
                            return '[cross-origin]';
                        }
                    })(),
                });
            }
            console.info('[CreativeWorkshopBridgeHost] destroy');
            clearOAuthTimers();
            cleanupOAuthPopupReference();
            pendingOauthRequestId = undefined;
            pendingOauthState = undefined;
            hostWindow.removeEventListener('message', handleOAuthCallback);
            hostWindow.removeEventListener('message', handleMessage);
        },
    };
}

;// ./src/CreativeWorkshop/index.ts



const AGREEMENT_STORAGE_KEY = 'creative_workshop_agreement_accepted';
function hasAcceptedAgreement() {
    return localStorage.getItem(AGREEMENT_STORAGE_KEY) === 'true';
}
function showAgreementPopup() {
    const existing = $('#creative-workshop-agreement-overlay');
    if (existing.length)
        existing.remove();
    const { destroy } = teleportStyle();
    const $overlay = $('<div id="creative-workshop-agreement-overlay">').css({
        position: 'fixed',
        inset: '0',
        zIndex: 2147483647,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '24px',
        backdropFilter: 'blur(6px)',
    });
    const $card = $('<div>').css({
        background: '#18191c',
        borderRadius: '20px',
        padding: '36px 32px 28px',
        width: 'min(520px, 92vw)',
        maxHeight: '85vh',
        overflowY: 'auto',
        boxShadow: '0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)',
        color: '#ececea',
        fontFamily: 'system-ui, -apple-system, sans-serif',
    });
    const $title = $('<h2>')
        .css({
        margin: '0 0 24px 0',
        fontSize: '1.4rem',
        fontWeight: '700',
        textAlign: 'center',
        color: '#F8FAFC',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px',
    })
        .html('<i class="fas fa-shield-alt" style="color:#b89d76"></i> 免责声明');
    const disclaimerItems = [
        {
            icon: 'fa-user-edit',
            title: '用户内容责任',
            text: '创意工坊中用户分享的所有内容均由分享者本人负责，虽然开发者拥有审核机制，但开发者不对用户生成内容（UGC）的合法性、准确性和适当性承担任何责任。',
        },
        {
            icon: 'fa-exclamation-triangle',
            title: '使用风险',
            text: '用户使用创意工坊的一切行为和后果由用户自行承担。开发者在法律允许的最大范围内，不对因使用或无法使用创意工坊而导致的任何直接或间接损失承担责任。',
        },
        {
            icon: 'fa-file-contract',
            title: '条款变更',
            text: '开发者保留随时修改本声明的权利，修改后的内容在更新后立即生效。',
        },
    ];
    const $list = $('<div>').css({
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
        marginBottom: '28px',
    });
    disclaimerItems.forEach((item, index) => {
        const $item = $('<div>').css({
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '12px',
            padding: '16px',
        });
        const $itemTitle = $('<div>')
            .css({
            fontWeight: '600',
            fontSize: '0.95rem',
            color: '#CBD5E1',
            marginBottom: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
        })
            .html(`<i class="fas ${item.icon}" style="color:#b89d76;font-size:0.85rem"></i> ${index + 1}. ${item.title}`);
        const $itemText = $('<div>')
            .css({
            fontSize: '0.88rem',
            lineHeight: '1.6',
            color: '#94A3B8',
        })
            .text(item.text);
        $item.append($itemTitle, $itemText);
        $list.append($item);
    });
    const $buttons = $('<div>').css({
        display: 'flex',
        gap: '12px',
        justifyContent: 'center',
    });
    const $acceptBtn = $('<button>')
        .css({
        padding: '12px 32px',
        background: 'linear-gradient(135deg, #3B82F6, #2563EB)',
        border: 'none',
        borderRadius: '12px',
        color: 'white',
        fontSize: '0.95rem',
        fontWeight: '600',
        cursor: 'pointer',
        boxShadow: '0 4px 15px rgba(59,130,246,0.4)',
        transition: 'all 0.2s',
    })
        .text('同意并继续')
        .on('mouseenter', function () {
        $(this).css('transform', 'translateY(-1px)');
    })
        .on('mouseleave', function () {
        $(this).css('transform', 'translateY(0)');
    })
        .on('click', () => {
        localStorage.setItem(AGREEMENT_STORAGE_KEY, 'true');
        close();
        openCreativeWorkshop();
    });
    const $cancelBtn = $('<button>')
        .css({
        padding: '12px 32px',
        background: 'rgba(255,255,255,0.08)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: '12px',
        color: '#94A3B8',
        fontSize: '0.95rem',
        fontWeight: '500',
        cursor: 'pointer',
        transition: 'all 0.2s',
    })
        .text('取消')
        .on('mouseenter', function () {
        $(this).css('background', 'rgba(255,255,255,0.12)');
    })
        .on('mouseleave', function () {
        $(this).css('background', 'rgba(255,255,255,0.08)');
    })
        .on('click', () => {
        close();
    });
    $buttons.append($cancelBtn, $acceptBtn);
    $card.append($title, $list, $buttons);
    $overlay.append($card).appendTo('body');
    $overlay.on('click', event => {
        if (event.target === $overlay[0]) {
            close();
        }
    });
    function close() {
        $overlay.remove();
        destroy();
    }
}
function openCreativeWorkshop() {
    const creativeWorkshopUrl = getCreativeWorkshopUrl();
    const hostWindow = window.parent !== window ? window.parent : window;
    const hostDocument = hostWindow.document;
    const host$ = hostWindow.$;
    console.info('[CreativeWorkshop] openCreativeWorkshop:start', {
        creativeWorkshopUrl,
        hostOrigin: hostWindow.location.origin,
        currentOrigin: window.location.origin,
        parentEqualsWindow: window.parent === window,
    });
    const existing = host$('#creative-workshop-overlay');
    if (existing.length) {
        console.warn('[CreativeWorkshop] openCreativeWorkshop:remove-existing-overlay', {
            count: existing.length,
        });
        existing.remove();
    }
    const { destroy } = teleportStyle(hostDocument.head);
    const $overlay = host$('<div id="creative-workshop-overlay">').css({
        position: 'absolute',
        top: '0',
        right: '0',
        left: '0',
        zIndex: 2147483647,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: '20px',
        paddingRight: '24px',
        paddingBottom: '20px',
        paddingLeft: '24px',
        boxSizing: 'border-box',
        overflow: 'auto',
        overscrollBehavior: 'contain',
    });
    const $frameShell = host$('<div>').css({
        position: 'relative',
        width: '100%',
        height: '100%',
        flex: '0 0 auto',
    });
    const $frame = createScriptIdIframe().css({
        width: '100%',
        height: '100%',
        borderRadius: '20px',
        background: '#0f1012',
        boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
    });
    const $closeButton = host$('<button type="button">退出</button>').css({
        position: 'absolute',
        top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        right: 'calc(env(safe-area-inset-right, 0px) + 12px)',
        zIndex: 3,
        minHeight: '44px',
        padding: '0 14px',
        border: '1px solid rgba(248,113,113,0.45)',
        borderRadius: '999px',
        background: 'rgba(185,28,28,0.92)',
        color: '#FEF2F2',
        fontSize: '14px',
        fontWeight: '600',
        cursor: 'pointer',
        boxShadow: '0 8px 24px rgba(127,29,29,0.35)',
        backdropFilter: 'blur(8px)',
    });
    const updateOverlayLayout = () => {
        const useFullscreenLayout = hostWindow.innerWidth < 1000;
        const viewportHeight = hostWindow.visualViewport?.height ?? hostWindow.innerHeight;
        const viewportTop = (hostWindow.visualViewport?.offsetTop ?? 0) + hostWindow.scrollY;
        $overlay.css({
            top: `${viewportTop}px`,
            height: `${viewportHeight}px`,
            alignItems: useFullscreenLayout ? 'stretch' : 'center',
            paddingTop: useFullscreenLayout ? 'calc(env(safe-area-inset-top, 0px) + 10px)' : '24px',
            paddingRight: useFullscreenLayout ? 'env(safe-area-inset-right, 0px)' : '24px',
            paddingBottom: useFullscreenLayout ? 'calc(env(safe-area-inset-bottom, 0px) + 10px)' : '24px',
            paddingLeft: useFullscreenLayout ? 'env(safe-area-inset-left, 0px)' : '24px',
        });
        $frameShell.css({
            width: useFullscreenLayout ? '100%' : '90vw',
            height: useFullscreenLayout ? '100%' : '90vh',
        });
        $frame.css({
            // Mobile keeps a small visual safe zone; desktop keeps simple 90% sizing.
            width: useFullscreenLayout ? '100%' : '90vw',
            height: useFullscreenLayout ? '100%' : '90vh',
            borderRadius: useFullscreenLayout ? '12px' : '20px',
            boxShadow: useFullscreenLayout ? '0 8px 30px rgba(0,0,0,0.28)' : '0 24px 80px rgba(0,0,0,0.45)',
        });
        $closeButton.css({
            display: useFullscreenLayout ? 'none' : 'block',
            top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
            right: 'calc(env(safe-area-inset-right, 0px) + 12px)',
            left: 'auto',
            transform: 'none',
            padding: '0 14px',
        });
    };
    updateOverlayLayout();
    host$(hostWindow).on('resize.creative-workshop-overlay', updateOverlayLayout);
    host$(hostWindow).on('scroll.creative-workshop-overlay', updateOverlayLayout);
    hostWindow.visualViewport?.addEventListener('resize', updateOverlayLayout);
    hostWindow.visualViewport?.addEventListener('scroll', updateOverlayLayout);
    $frameShell.append($frame, $closeButton);
    $overlay.append($frameShell).appendTo(hostDocument.body);
    console.info('[CreativeWorkshop] openCreativeWorkshop:overlay-mounted', {
        iframeCount: $overlay.find('iframe').length,
        bodyChildCount: hostDocument.body.children.length,
    });
    const close = () => {
        console.warn('[CreativeWorkshop] openCreativeWorkshop:close', {
            hasBridge: Boolean(bridge),
            hasNavigated,
            overlayExists: hostDocument.body.contains($overlay[0]),
            activeElementTag: hostDocument.activeElement?.tagName,
        });
        bridge?.destroy();
        host$(hostWindow).off('resize.creative-workshop-overlay', updateOverlayLayout);
        host$(hostWindow).off('scroll.creative-workshop-overlay', updateOverlayLayout);
        hostWindow.visualViewport?.removeEventListener('resize', updateOverlayLayout);
        hostWindow.visualViewport?.removeEventListener('scroll', updateOverlayLayout);
        $overlay.remove();
        destroy();
    };
    $closeButton.on('click', event => {
        event.stopPropagation();
        close();
    });
    $overlay.on('click', event => {
        console.info('[CreativeWorkshop] openCreativeWorkshop:overlay-click', {
            targetIsOverlay: event.target === $overlay[0],
            targetTag: event.target?.tagName,
        });
        if (event.target === $overlay[0]) {
            close();
        }
    });
    let bridge = null;
    let hasNavigated = false;
    $frame.on('load', () => {
        const iframe = $frame[0];
        console.info('[CreativeWorkshop] openCreativeWorkshop:iframe-load', {
            hasBridge: Boolean(bridge),
            hasNavigated,
            iframeSrc: iframe.getAttribute('src'),
            iframeHref: (() => {
                try {
                    return iframe.contentWindow?.location.href ?? null;
                }
                catch {
                    return '[cross-origin]';
                }
            })(),
        });
        if (!bridge) {
            bridge = createCreativeWorkshopBridgeHost({
                iframe,
                targetOrigin: getCreativeWorkshopOrigin(),
                onClose: close,
            });
            console.info('[CreativeWorkshop] openCreativeWorkshop:bridge-created', {
                targetOrigin: getCreativeWorkshopOrigin(),
            });
        }
        if (!hasNavigated) {
            hasNavigated = true;
            console.info('[CreativeWorkshop] openCreativeWorkshop:navigate-iframe', {
                creativeWorkshopUrl,
            });
            iframe.contentWindow?.location.replace(creativeWorkshopUrl);
        }
    });
}
$(() => {
    console.info('[CreativeWorkshop] script-mounted');
    replaceScriptButtons([{ name: '命定创意工坊', visible: true }]);
    eventOn(getButtonEvent('命定创意工坊'), () => {
        console.info('[CreativeWorkshop] workshop-button-clicked', {
            acceptedAgreement: hasAcceptedAgreement(),
        });
        if (hasAcceptedAgreement()) {
            openCreativeWorkshop();
        }
        else {
            showAgreementPopup();
        }
    });
    $(window).on('pagehide', () => {
        console.warn('[CreativeWorkshop] script-pagehide');
    });
});

;// ./src/CreativeWorkshop/staging.ts


/******/ })()
;
//# sourceMappingURL=index.js.map