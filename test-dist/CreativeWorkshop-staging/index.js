/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ 947:
/***/ (() => {


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
const DEFAULT_CREATIVE_WORKSHOP_URL = 'https://poemofdestinycreativeworkshop.1528779666.workers.dev';
const CREATIVE_WORKSHOP_URL_VARIABLE_KEY = 'creative_workshop_worker_url';
const FORCED_CREATIVE_WORKSHOP_URL_KEY = '__CREATIVE_WORKSHOP_FORCED_URL__';
function normalizeCreativeWorkshopUrl(url) {
    return url.trim().replace(/\/+$/, '');
}
function getCreativeWorkshopUrl() {
    const forcedUrl = globalThis[FORCED_CREATIVE_WORKSHOP_URL_KEY];
    if (_.isString(forcedUrl) && forcedUrl.trim()) {
        return normalizeCreativeWorkshopUrl(forcedUrl);
    }
    const scriptId = getScriptId();
    const variables = getVariables({ type: 'script', script_id: scriptId });
    const customUrl = _.get(variables, CREATIVE_WORKSHOP_URL_VARIABLE_KEY);
    if (_.isString(customUrl) && customUrl.trim()) {
        return normalizeCreativeWorkshopUrl(customUrl);
    }
    return DEFAULT_CREATIVE_WORKSHOP_URL;
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
const CREATIVE_WORKSHOP_CLIENT_VERSION = '2.0.15';
const CREATIVE_WORKSHOP_DIAGNOSTIC_REVISION = '2.0.15-install-diag-3';

;// ./src/CreativeWorkshop/services/diagnostic-log.ts

const INSTALL_DIAGNOSTIC_EVENTS = new Set([
    'script-mounted',
    'install-state:scan:start',
    'install-state:worldbook',
    'install-state:project',
    'install-state:scan:complete',
    'install-state:worldbook-read-error',
    'install-request',
    'install-request-blocked',
    'install-entry-match',
    'install:prepared',
    'install:complete',
    'install-request-finished',
    'install-request-error',
]);
function stringifyDiagnosticPayload(payload) {
    try {
        return JSON.stringify(payload, (_key, value) => {
            if (value instanceof Error) {
                return { name: value.name, message: value.message };
            }
            if (typeof value === 'bigint')
                return String(value);
            return value;
        });
    }
    catch (error) {
        return JSON.stringify({
            clientVersion: CREATIVE_WORKSHOP_CLIENT_VERSION,
            diagnosticRevision: CREATIVE_WORKSHOP_DIAGNOSTIC_REVISION,
            serializationError: error instanceof Error ? error.message : String(error),
        });
    }
}
function formatDiagnosticLine(event, payload) {
    const body = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? {
            ...payload,
            clientVersion: CREATIVE_WORKSHOP_CLIENT_VERSION,
            diagnosticRevision: CREATIVE_WORKSHOP_DIAGNOSTIC_REVISION,
        }
        : {
            clientVersion: CREATIVE_WORKSHOP_CLIENT_VERSION,
            diagnosticRevision: CREATIVE_WORKSHOP_DIAGNOSTIC_REVISION,
            data: payload ?? null,
        };
    return `[CreativeWorkshop][diag] ${event} ${stringifyDiagnosticPayload(body)}`;
}
function creativeWorkshopDiag(event, payload) {
    if (!INSTALL_DIAGNOSTIC_EVENTS.has(event))
        return;
    console.info(formatDiagnosticLine(event, payload));
}
function creativeWorkshopDiagError(event, payload) {
    if (!INSTALL_DIAGNOSTIC_EVENTS.has(event))
        return;
    console.error(formatDiagnosticLine(event, payload));
}

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
    const candidates = getCreativeWorkshopRelevantWorldbookNames(projectId, legacyProjectName);
    const existingNames = new Set(getWorldbookNames());
    for (const worldbookName of candidates) {
        if (!existingNames.has(worldbookName))
            continue;
        const entries = await getWorldbook(worldbookName);
        if (entries.some(entry => _.get(entry, 'extra.cw_project_id') === projectId ||
            _.get(entry, 'extra.fate_project_name') === projectId ||
            Boolean(legacyProjectName && _.get(entry, 'extra.fate_project_name') === legacyProjectName))) {
            return worldbookName;
        }
    }
    return null;
}
function setCreativeWorkshopInstallRecord(projectId, worldbookName) {
    const registry = readInstallRegistry();
    const scopeKey = getRegistryScopeKey();
    registry[scopeKey] = registry[scopeKey] || {};
    registry[scopeKey][projectId] = {
        projectId,
        worldbookName,
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
function safeRequestUrlForLog(value) {
    if (!_.isString(value) || !value)
        return null;
    try {
        const url = new URL(value);
        return `${url.origin}${url.pathname}`;
    }
    catch {
        return value.split('?')[0];
    }
}
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
            creativeWorkshopDiag('http:worldbook-source:cache-hit', {
                projectId,
                projectVersion,
                url: safeRequestUrlForLog(downloadUrl),
                entryCount: cached.length,
            });
            return cached;
        }
    }
    const sourceRequestStartedAt = Date.now();
    creativeWorkshopDiag('http:worldbook-source:request', {
        projectId,
        projectVersion,
        url: safeRequestUrlForLog(downloadUrl),
        cache: 'no-store',
    });
    try {
        const response = await fetch(downloadUrl, {
            cache: 'no-store',
        });
        creativeWorkshopDiag('http:worldbook-source:response', {
            projectId,
            projectVersion,
            url: safeRequestUrlForLog(downloadUrl),
            status: response.status,
            ok: response.ok,
            durationMs: Date.now() - sourceRequestStartedAt,
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
        creativeWorkshopDiagError('http:worldbook-source:error', {
            projectId,
            projectVersion,
            url: safeRequestUrlForLog(downloadUrl),
            durationMs: Date.now() - sourceRequestStartedAt,
            error: error instanceof Error ? error.message : String(error),
        });
        if (_.isString(projectId) && projectId) {
            const fallback = getAnyCachedWorldbookSource(projectId, downloadUrl, projectVersion || undefined);
            if (fallback) {
                return fallback;
            }
        }
        throw error;
    }
}
async function fetchCreativeWorkshopProjectDetail(projectId, expectedVersion) {
    const cached = getCachedProjectDetail(projectId, expectedVersion);
    if (cached) {
        creativeWorkshopDiag('http:project-detail:cache-hit', {
            projectId,
            expectedVersion,
            cachedVersion: _.get(cached, 'project.version', null),
        });
        return cached;
    }
    let receivedVersionMismatch = false;
    let requestUrl = null;
    const detailRequestStartedAt = Date.now();
    try {
        const versionQuery = expectedVersion ? `?v=${encodeURIComponent(expectedVersion)}` : '';
        requestUrl = `${getCreativeWorkshopUrl()}/api/projects/${projectId}${versionQuery}`;
        creativeWorkshopDiag('http:project-detail:request', {
            projectId,
            expectedVersion,
            url: safeRequestUrlForLog(requestUrl),
            cache: expectedVersion ? 'no-store' : 'no-cache',
        });
        const response = await fetch(requestUrl, {
            cache: expectedVersion ? 'no-store' : 'no-cache',
        });
        creativeWorkshopDiag('http:project-detail:response', {
            projectId,
            expectedVersion,
            url: safeRequestUrlForLog(requestUrl),
            status: response.status,
            ok: response.ok,
            durationMs: Date.now() - detailRequestStartedAt,
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
        creativeWorkshopDiagError('http:project-detail:error', {
            projectId,
            expectedVersion,
            url: requestUrl ? safeRequestUrlForLog(requestUrl) : null,
            durationMs: Date.now() - detailRequestStartedAt,
            error: error instanceof Error ? error.message : String(error),
        });
        if (receivedVersionMismatch)
            throw error;
        const fallback = getCreativeWorkshopCacheStore().projectDetails?.[projectId]?.data;
        if (fallback && (!expectedVersion || _.get(fallback, 'project.version') === expectedVersion)) {
            return fallback;
        }
        throw error;
    }
}

;// ./src/CreativeWorkshop/services/regex-name.ts
function getReadableRegexName(projectName, entry, index) {
    const name = entry.scriptName || entry.script_name || entry.id || `正则${index + 1}`;
    return String(name).startsWith('[工坊]') ? String(name) : `[工坊] ${projectName} - ${name}`;
}
function getCreativeWorkshopRegexId(regex) {
    return String(regex.id || regex.script_name || '');
}

;// ./src/CreativeWorkshop/services/diff.ts



const CREATIVE_WORKSHOP_DIFF_CACHE_KEY = 'creative_workshop_diff_cache';
const PROJECT_DIFF_CACHE_TTL_MS = 5 * 60 * 1000;
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
function normalizeRemoteEntry(entry, projectId, index) {
    const comment = entry.comment || '无标题';
    return {
        entryKey: `${projectId}:${index}`,
        name: comment,
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
        Boolean(legacyProjectName && _.get(entry, 'extra.fate_project_name') === legacyProjectName))
        .map(normalizeWorldbookEntry);
    const remoteEntries = (detail.worldbookEntriesPreview || []).map((entry, index) => normalizeRemoteEntry(entry, projectId, index));
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
        id: `creative_workshop:${projectId}:${entry.id || index}`,
        scriptName: getReadableRegexName(detail.project.name || '未命名项目', entry, index),
        findRegex: entry.findRegex || '',
        replaceString: entry.replaceString || '',
    }));
    const localSignature = JSON.stringify({
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
function summarizeInstalledEntry(entry) {
    return {
        uid: _.get(entry, 'uid', null),
        name: _.get(entry, 'name', ''),
        cwProjectId: _.get(entry, 'extra.cw_project_id', null),
        legacyProjectName: _.get(entry, 'extra.fate_project_name', null),
        cwEntryKey: _.get(entry, 'extra.cw_entry_key', null),
        localVersion: _.get(entry, 'extra.cw_project_version', null),
        enabled: _.get(entry, 'enabled', null),
    };
}
async function readWorldbookEntries(worldbookName) {
    try {
        return await getWorldbook(worldbookName);
    }
    catch (error) {
        creativeWorkshopDiagError('install-state:worldbook-read-error', {
            worldbookName,
            error: error instanceof Error ? error.message : String(error),
        });
        return [];
    }
}
async function listInstalledCreativeWorkshopProjects() {
    const registry = getCreativeWorkshopInstallRecords();
    const worldbookNames = getCreativeWorkshopRelevantWorldbookNames();
    creativeWorkshopDiag('install-state:scan:start', {
        registryProjectIds: Object.keys(registry),
        worldbookNames,
    });
    const worldbooks = await Promise.all(worldbookNames.map(async (worldbookName) => ({
        worldbookName,
        entries: await readWorldbookEntries(worldbookName),
    })));
    worldbooks.forEach(({ worldbookName, entries }) => {
        const workshopEntries = entries
            .filter(entry => _.isString(_.get(entry, 'extra.cw_project_id')) || _.isString(_.get(entry, 'extra.fate_project_name')))
            .map(summarizeInstalledEntry);
        const suspiciousLegacyEntries = entries
            .filter(entry => {
            const name = String(_.get(entry, 'name', ''));
            const hasWorkshopIdentity = _.isString(_.get(entry, 'extra.cw_project_id')) || _.isString(_.get(entry, 'extra.fate_project_name'));
            return !hasWorkshopIdentity && (name.startsWith('[DLC]') || name.startsWith('命定系统-'));
        })
            .map(summarizeInstalledEntry);
        if (workshopEntries.length === 0 && suspiciousLegacyEntries.length === 0)
            return;
        creativeWorkshopDiag('install-state:worldbook', {
            worldbookName,
            totalEntries: entries.length,
            workshopEntryCount: workshopEntries.length,
            suspiciousLegacyEntries,
        });
    });
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
        const localVersion = firstEntry ? _.get(firstEntry, 'extra.cw_project_version', null) : null;
        const legacyProjectName = projectEntries
            .map(entry => _.get(entry, 'extra.fate_project_name'))
            .find(value => _.isString(value) && Boolean(value)) ||
            (!UUID_PATTERN.test(projectId) ? projectId : null);
        return {
            projectId,
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
    projects.forEach(project => creativeWorkshopDiag('install-state:project', ({
        projectId: project.projectId,
        name: project.name,
        legacyProjectName: project.legacyProjectName,
        localVersion: project.localVersion,
        entryCount: project.entryCount,
        regexCount: project.regexCount,
        worldbookName: project.worldbookName,
    })));
    creativeWorkshopDiag('install-state:scan:complete', {
        detectedProjectCount: projects.length,
        detectedProjectIds: projects.map(project => project.projectId),
    });
    return projects;
}

;// ./src/CreativeWorkshop/services/regex.ts


async function installCreativeWorkshopRegex(projectId, selectedEntryKeys, expectedVersion, legacyProjectName) {
    const detail = await fetchCreativeWorkshopProjectDetail(projectId, expectedVersion);
    const selected = selectedEntryKeys ? new Set(selectedEntryKeys) : null;
    const regexEntries = (detail.regexEntriesPreview || [])
        .map((entry, originalIndex) => ({
        entry,
        originalIndex,
        entryKey: entry.entryKey || (entry.id !== undefined ? `id:${entry.id}` : `index:${originalIndex}`),
    }))
        .filter(({ entryKey }) => !selected || selected.has(entryKey));
    if (regexEntries.length === 0) {
        return [];
    }
    return updateTavernRegexesWith(regexes => {
        const filtered = regexes.filter(regex => {
            const regexId = getCreativeWorkshopRegexId(regex);
            return !regexId.startsWith(`creative_workshop:${projectId}:`) &&
                !Boolean(legacyProjectName && regexId.startsWith(`creative_workshop:${legacyProjectName}:`));
        });
        const appended = regexEntries.map(({ entry, originalIndex, entryKey }) => ({
            id: `creative_workshop:${projectId}:${entryKey}`,
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
async function getInstalledWorldbookName(projectId, legacyProjectName) {
    const worldbookName = await resolveCreativeWorkshopInstallWorldbook(projectId, legacyProjectName);
    if (!worldbookName) {
        throw new Error('无法确认此项目的已安装世界书，已中止操作以避免重复安装');
    }
    return worldbookName;
}
async function ensureTargetWorldbook(worldbookName) {
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
function renameEntry(entryName, tags, projectName) {
    if (tags.includes('系统')) {
        return entryName.startsWith('命定系统-') ? entryName : `命定系统-${entryName}`;
    }
    const type = tags.includes('角色') ? '角色' : tags.includes('事件') ? '事件' : '扩展';
    return entryName.startsWith('[DLC]') ? entryName : `[DLC][${type}][${projectName}]${entryName}`;
}
function summarizeInstallCandidate(entry) {
    return {
        uid: _.get(entry, 'uid', null),
        name: _.get(entry, 'name', ''),
        cwProjectId: _.get(entry, 'extra.cw_project_id', null),
        legacyProjectName: _.get(entry, 'extra.fate_project_name', null),
        cwEntryKey: _.get(entry, 'extra.cw_entry_key', null),
        localVersion: _.get(entry, 'extra.cw_project_version', null),
    };
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
async function applyPreparedProject(projectId, detail, prepared, worldbookName, option = {}) {
    if (prepared.length === 0 && !option.replaceExistingProject)
        return;
    await updateWorldbookWith(worldbookName, worldbook => {
        const desiredProjectEntryKeys = new Set();
        prepared.forEach(({ entry, index, entryKey, positionType, positionRole, strategyType, secondaryLogic, depth, order, probability, scanDepth }) => {
            const name = renameEntry(entry.comment || entry.name || `条目${index + 1}`, detail.project.tags || [], detail.project.name || '未命名项目');
            const stableKey = `${projectId}:${entryKey}`;
            const legacyKey = `${projectId}:${index}`;
            desiredProjectEntryKeys.add(stableKey);
            const sameNameCandidates = worldbook
                .filter(item => item.name === name)
                .map(summarizeInstallCandidate);
            let matchingIndexes = worldbook.reduce((indexes, item, itemIndex) => {
                const existingKey = _.get(item, 'extra.cw_entry_key');
                if (existingKey === stableKey || existingKey === legacyKey)
                    indexes.push(itemIndex);
                return indexes;
            }, []);
            let matchMethod = matchingIndexes.length > 0 ? 'entry-key' : 'none';
            if (matchingIndexes.length === 0) {
                matchingIndexes = worldbook.reduce((indexes, item, itemIndex) => {
                    const itemProjectId = _.get(item, 'extra.cw_project_id') ?? _.get(item, 'extra.fate_project_name');
                    if (!_.get(item, 'extra.cw_entry_key') && itemProjectId === projectId && item.name === name) {
                        indexes.push(itemIndex);
                    }
                    return indexes;
                }, []);
                if (matchingIndexes.length > 0)
                    matchMethod = 'project-id+name';
            }
            creativeWorkshopDiag('install-entry-match', {
                projectId,
                worldbookName,
                name,
                stableKey,
                legacyKey,
                matchMethod,
                matchCount: matchingIndexes.length,
                action: matchingIndexes.length === 0 ? 'CREATE_NEW' : matchingIndexes.length === 1 ? 'REUSE' : 'DEDUP_REUSE',
                sameNameCandidates,
            });
            const existingIndex = matchingIndexes[0] ?? -1;
            for (let duplicateIndex = matchingIndexes.length - 1; duplicateIndex >= 1; duplicateIndex -= 1) {
                worldbook.splice(matchingIndexes[duplicateIndex], 1);
            }
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
                    ..._.get(worldbook[existingIndex], 'extra', {}),
                    cw_project_id: projectId,
                    cw_project_name_display: detail.project.name || '未命名项目',
                    cw_project_version: detail.project.version || null,
                    cw_remote_version: detail.project.version || null,
                    cw_entry_key: stableKey,
                },
            };
            if (existingIndex >= 0) {
                worldbook[existingIndex] = { ...worldbook[existingIndex], ...payload, uid: worldbook[existingIndex].uid };
            }
            else {
                worldbook.push(payload);
            }
        });
        if (option.replaceExistingProject) {
            _.remove(worldbook, entry => {
                if (!isCreativeWorkshopProjectEntry(entry, projectId, option.legacyProjectName))
                    return false;
                const entryKey = _.get(entry, 'extra.cw_entry_key');
                return !_.isString(entryKey) || !desiredProjectEntryKeys.has(entryKey);
            });
        }
        return worldbook;
    });
}
function isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName) {
    return (_.get(entry, 'extra.cw_project_id') === projectId ||
        _.get(entry, 'extra.fate_project_name') === projectId ||
        Boolean(legacyProjectName && _.get(entry, 'extra.fate_project_name') === legacyProjectName));
}
async function deleteProjectEntriesFromWorldbook(projectId, worldbookName, legacyProjectName) {
    if (!getWorldbookNames().includes(worldbookName))
        return [];
    const before = await getWorldbook(worldbookName);
    const matchingBefore = before.filter(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName));
    creativeWorkshopDiag('worldbook:delete:scan', {
        projectId,
        legacyProjectName,
        worldbookName,
        totalEntriesBefore: before.length,
        matchingEntriesBefore: matchingBefore.length,
        matchingEntryKeys: matchingBefore.map(entry => _.get(entry, 'extra.cw_entry_key', null)),
    });
    if (matchingBefore.length === 0) {
        return [];
    }
    const result = await deleteWorldbookEntries(worldbookName, entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName), { render: 'immediate' });
    if (result.deleted_entries.length === 0 ||
        result.worldbook.some(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName))) {
        throw new Error(`世界书「${worldbookName}」中的工坊条目未成功删除`);
    }
    creativeWorkshopDiag('worldbook:delete:complete', {
        projectId,
        legacyProjectName,
        worldbookName,
        deletedCount: result.deleted_entries.length,
        totalEntriesAfter: result.worldbook.length,
        matchingEntriesAfter: result.worldbook.filter(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName)).length,
    });
    return result.deleted_entries;
}
async function assertNoProjectEntriesInRelevantWorldbooks(projectId, legacyProjectName, ignoreWorldbookName) {
    const existingNames = new Set(getWorldbookNames());
    for (const worldbookName of getCreativeWorkshopRelevantWorldbookNames(projectId, legacyProjectName)) {
        if (worldbookName === ignoreWorldbookName)
            continue;
        if (!existingNames.has(worldbookName))
            continue;
        const entries = await getWorldbook(worldbookName);
        if (entries.some(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName))) {
            throw new Error(`卸载未完全完成：世界书「${worldbookName}」仍有工坊条目`);
        }
    }
}
async function deleteProjectEntriesFromInstalledWorldbooks(projectId, preferredWorldbookName, legacyProjectName) {
    const candidates = _.uniq([
        preferredWorldbookName,
        ...getCreativeWorkshopRelevantWorldbookNames(projectId, legacyProjectName),
    ]).filter((name) => _.isString(name) && Boolean(name));
    const deletedEntries = [];
    for (const worldbookName of candidates) {
        deletedEntries.push(...await deleteProjectEntriesFromWorldbook(projectId, worldbookName, legacyProjectName));
    }
    return deletedEntries;
}
async function installCreativeWorkshopProject(projectId, selectedEntryKeys, requestedWorldbookName, expectedVersion) {
    invalidateCreativeWorkshopProjectCache(projectId);
    const { detail, prepared } = await prepareCreativeWorkshopProject(projectId, selectedEntryKeys, expectedVersion);
    const worldbookName = requestedWorldbookName
        ? await ensureTargetWorldbook(requestedWorldbookName)
        : getCurrentWorldbookName();
    creativeWorkshopDiag('install:prepared', {
        projectId,
        projectVersion: _.get(detail, 'project.version', null),
        requestedWorldbookName: requestedWorldbookName || null,
        resolvedWorldbookName: worldbookName,
        selectedEntryKeyCount: selectedEntryKeys?.length ?? null,
        preparedEntryCount: prepared.length,
    });
    await applyPreparedProject(projectId, detail, prepared, worldbookName);
    setCreativeWorkshopInstallRecord(projectId, worldbookName);
    creativeWorkshopDiag('install:complete', {
        projectId,
        worldbookName,
        preparedEntryCount: prepared.length,
    });
    return detail;
}
async function uninstallCreativeWorkshopProject(projectId, legacyProjectName) {
    const worldbookName = await getInstalledWorldbookName(projectId, legacyProjectName);
    creativeWorkshopDiag('uninstall:start', {
        projectId,
        legacyProjectName,
        resolvedWorldbookName: worldbookName,
    });
    const deletedEntries = await deleteProjectEntriesFromInstalledWorldbooks(projectId, worldbookName, legacyProjectName);
    await assertNoProjectEntriesInRelevantWorldbooks(projectId, legacyProjectName);
    creativeWorkshopDiag('uninstall:complete', {
        projectId,
        legacyProjectName,
        resolvedWorldbookName: worldbookName,
        deletedEntryCount: deletedEntries.length,
    });
    return deletedEntries;
}
async function updateCreativeWorkshopProject(projectId, expectedVersion, legacyProjectName) {
    invalidateCreativeWorkshopProjectCache(projectId);
    const { detail, prepared } = await prepareCreativeWorkshopProject(projectId, undefined, expectedVersion);
    const worldbookName = await ensureTargetWorldbook(await getInstalledWorldbookName(projectId, legacyProjectName));
    const otherWorldbooks = _.uniq(getCreativeWorkshopRelevantWorldbookNames(projectId, legacyProjectName))
        .filter(name => name !== worldbookName);
    creativeWorkshopDiag('update:prepared', {
        projectId,
        legacyProjectName,
        expectedVersion: expectedVersion || null,
        actualVersion: _.get(detail, 'project.version', null),
        resolvedWorldbookName: worldbookName,
        preparedEntryCount: prepared.length,
        cleanupWorldbooks: otherWorldbooks,
    });
    for (const otherWorldbookName of otherWorldbooks) {
        await deleteProjectEntriesFromWorldbook(projectId, otherWorldbookName, legacyProjectName);
    }
    await applyPreparedProject(projectId, detail, prepared, worldbookName, {
        replaceExistingProject: true,
        legacyProjectName,
    });
    const persisted = await getWorldbook(worldbookName);
    const persistedProjectEntries = persisted.filter(entry => isCreativeWorkshopProjectEntry(entry, projectId, legacyProjectName));
    if (persistedProjectEntries.length !== prepared.length) {
        throw new Error(`世界书「${worldbookName}」更新后条目数量异常，请重试`);
    }
    await assertNoProjectEntriesInRelevantWorldbooks(projectId, legacyProjectName, worldbookName);
    if (legacyProjectName && legacyProjectName !== projectId) {
        deleteCreativeWorkshopInstallRecord(legacyProjectName);
    }
    setCreativeWorkshopInstallRecord(projectId, worldbookName);
    creativeWorkshopDiag('update:complete', {
        projectId,
        legacyProjectName,
        worldbookName,
        persistedEntryCount: persistedProjectEntries.length,
    });
    return detail;
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
const OAUTH_TIMEOUT_MS = 180000;
const OAUTH_POPUP_CLOSE_GUARD_MS = 8000;
function isOAuthCallbackMessage(value) {
    return (_.isObject(value) &&
        (_.get(value, 'type') === 'oauth-success' ||
            _.get(value, 'type') === 'oauth-error' ||
            _.get(value, 'type') === 'oauth-ready') &&
        _.get(value, 'source') === OAUTH_CALLBACK_SOURCE);
}
function safeUrlForLog(value) {
    if (!_.isString(value) || !value)
        return null;
    try {
        const url = new URL(value);
        return `${url.origin}${url.pathname}`;
    }
    catch {
        return '[invalid-url]';
    }
}
function summarizeBridgePayload(type, payload) {
    if (!_.isObject(payload))
        return {};
    return {
        projectId: _.isString(_.get(payload, 'projectId')) ? String(_.get(payload, 'projectId')) : undefined,
        legacyProjectName: _.isString(_.get(payload, 'legacyProjectName')) ? String(_.get(payload, 'legacyProjectName')) : undefined,
        projectVersion: _.isString(_.get(payload, 'projectVersion')) ? String(_.get(payload, 'projectVersion')) : undefined,
        worldbookName: _.isString(_.get(payload, 'worldbookName')) ? String(_.get(payload, 'worldbookName')) : undefined,
        worldbookEntryKeyCount: Array.isArray(_.get(payload, 'worldbookEntryKeys')) ? _.get(payload, 'worldbookEntryKeys').length : undefined,
        regexEntryKeyCount: Array.isArray(_.get(payload, 'regexEntryKeys')) ? _.get(payload, 'regexEntryKeys').length : undefined,
        projectsCount: Array.isArray(_.get(payload, 'projects')) ? _.get(payload, 'projects').length : undefined,
        connected: _.isBoolean(_.get(payload, 'connected')) ? _.get(payload, 'connected') : undefined,
        clientVersion: _.isString(_.get(payload, 'clientVersion')) ? String(_.get(payload, 'clientVersion')) : undefined,
        success: _.isBoolean(_.get(payload, 'success')) ? _.get(payload, 'success') : undefined,
        message: _.isString(_.get(payload, 'message')) ? String(_.get(payload, 'message')) : undefined,
        state: _.isString(_.get(payload, 'state')) ? String(_.get(payload, 'state')) : undefined,
        authUrl: type === 'bridge:oauth:start' ? safeUrlForLog(_.get(payload, 'authUrl')) : undefined,
        hasToken: _.isString(_.get(payload, 'token')) && Boolean(_.get(payload, 'token')),
        hasUser: _.isObject(_.get(payload, 'user')),
    };
}
const legacyDebugLog = (..._args) => { };
function createCreativeWorkshopBridgeHost(option) {
    const { iframe, targetOrigin, hostWindow = window.parent !== window ? window.parent : window, onClose } = option;
    const oauthOrigin = getCreativeWorkshopOrigin();
    let oauthPopup = null;
    let pendingOauthRequestId;
    let pendingOauthState;
    let oauthTimeoutId = null;
    let oauthClosePollId = null;
    let oauthPopupOpenedAt = 0;
    const projectMutationInFlight = new Set();
    legacyDebugLog('[CreativeWorkshopBridgeHost] created', {
        clientVersion: CREATIVE_WORKSHOP_CLIENT_VERSION,
        diagnosticRevision: CREATIVE_WORKSHOP_DIAGNOSTIC_REVISION,
        targetOrigin,
        oauthOrigin,
        iframeSrc: iframe.getAttribute('src'),
    });
    function cleanupOAuthPopupReference() {
        legacyDebugLog('[CreativeWorkshopBridgeHost] cleanupOAuthPopupReference', {
            hasPopup: Boolean(oauthPopup),
            popupClosed: oauthPopup?.closed ?? null,
        });
        if (oauthPopup && !oauthPopup.closed) {
            oauthPopup.close();
        }
        oauthPopup = null;
    }
    function clearOAuthTimers() {
        legacyDebugLog('[CreativeWorkshopBridgeHost] clearOAuthTimers', {
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
        legacyDebugLog('[CreativeWorkshopBridgeHost] resolveOAuthResult', {
            requestId,
            payload: summarizeBridgePayload('bridge:oauth:result', payload),
        });
        await post('bridge:oauth:result', payload, requestId);
        clearOAuthTimers();
        cleanupOAuthPopupReference();
        pendingOauthRequestId = undefined;
        pendingOauthState = undefined;
    }
    async function failPendingOAuth(message) {
        legacyDebugLog('[CreativeWorkshopBridgeHost] failPendingOAuth', {
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
        legacyDebugLog('[CreativeWorkshopBridgeHost] startOAuthMonitors', {
            pendingOauthRequestId,
            pendingOauthState,
            popupClosed: oauthPopup?.closed ?? null,
        });
        oauthTimeoutId = hostWindow.setTimeout(() => {
            void failPendingOAuth('授权超时');
        }, OAUTH_TIMEOUT_MS);
        oauthClosePollId = hostWindow.setInterval(() => {
            if (!oauthPopup) {
                legacyDebugLog('[CreativeWorkshopBridgeHost] oauthClosePoll:no-popup-reference');
                return;
            }
            if (Date.now() - oauthPopupOpenedAt < OAUTH_POPUP_CLOSE_GUARD_MS) {
                legacyDebugLog('[CreativeWorkshopBridgeHost] oauthClosePoll:within-guard-window', {
                    elapsedMs: Date.now() - oauthPopupOpenedAt,
                    guardMs: OAUTH_POPUP_CLOSE_GUARD_MS,
                });
                return;
            }
            if (oauthPopup.closed) {
                legacyDebugLog('[CreativeWorkshopBridgeHost] popup reported closed before oauth resolved', {
                    state: pendingOauthState,
                    guardMs: OAUTH_POPUP_CLOSE_GUARD_MS,
                });
                return;
            }
        }, 500);
    }
    async function handleOAuthCallback(event) {
        legacyDebugLog('[CreativeWorkshopBridgeHost] handleOAuthCallback:received', {
            pendingOauthRequestId,
            pendingOauthState,
            eventOrigin: event.origin,
            sourceMatchesPopup: oauthPopup ? event.source === oauthPopup : null,
            callbackType: _.get(event.data, 'type'),
            payload: summarizeBridgePayload('bridge:oauth:callback', event.data),
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
        legacyDebugLog('[CreativeWorkshopBridgeHost] post', {
            type,
            requestId,
            payload: summarizeBridgePayload(type, payload),
            targetOrigin,
        });
        iframe.contentWindow?.postMessage(createBridgeMessage(type, payload, requestId), targetOrigin);
    }
    async function handleMessage(event) {
        legacyDebugLog('[CreativeWorkshopBridgeHost] handleMessage:received', {
            eventOrigin: event.origin,
            sourceMatchesIframe: event.source === iframe.contentWindow,
            type: _.get(event.data, 'type'),
            requestId: _.get(event.data, 'requestId'),
            payload: summarizeBridgePayload(String(_.get(event.data, 'type') || ''), _.get(event.data, 'payload')),
        });
        if (event.source !== iframe.contentWindow)
            return;
        if (targetOrigin !== '*' && event.origin !== targetOrigin)
            return;
        if (!isCreativeWorkshopBridgeMessage(event.data))
            return;
        const actionType = event.data.type;
        const actionStartedAt = Date.now();
        const actionLegacyProjectName = _.isString(_.get(event.data, 'payload.legacyProjectName'))
            ? String(event.data.payload?.legacyProjectName)
            : undefined;
        const actionProjectId = _.isString(_.get(event.data, 'payload.projectId'))
            ? String(event.data.payload?.projectId)
            : undefined;
        const isProjectMutation = actionType === 'bridge:install-project' ||
            actionType === 'bridge:uninstall-project' ||
            actionType === 'bridge:confirm-project-update';
        if (actionType === 'bridge:install-project') {
            creativeWorkshopDiag('install-request', {
                requestId: event.data.requestId,
                projectId: actionProjectId,
                legacyProjectName: actionLegacyProjectName,
                projectVersion: _.get(event.data, 'payload.projectVersion', null),
                worldbookName: _.get(event.data, 'payload.worldbookName', null),
                worldbookEntryKeyCount: Array.isArray(_.get(event.data, 'payload.worldbookEntryKeys'))
                    ? _.get(event.data, 'payload.worldbookEntryKeys').length
                    : null,
            });
        }
        if (isProjectMutation && actionProjectId) {
            if (projectMutationInFlight.has(actionProjectId)) {
                if (actionType === 'bridge:install-project') {
                    creativeWorkshopDiag('install-request-blocked', {
                        requestId: event.data.requestId,
                        projectId: actionProjectId,
                        reason: 'mutation-in-flight',
                    });
                }
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
                    await post('bridge:installed-projects', { projects: await listInstalledCreativeWorkshopProjects() }, event.data.requestId);
                    break;
                case 'bridge:get-context':
                    await post('bridge:context', getCurrentCreativeWorkshopContext(), event.data.requestId);
                    break;
                case 'bridge:list-installed-projects':
                    await post('bridge:installed-projects', { projects: await listInstalledCreativeWorkshopProjects() }, event.data.requestId);
                    break;
                case 'bridge:install-project':
                    if (!_.isString(_.get(event.data, 'payload.projectId'))) {
                        throw new Error('缺少 projectId');
                    }
                    await installCreativeWorkshopProject(String(event.data.payload?.projectId), Array.isArray(event.data.payload?.worldbookEntryKeys) ? event.data.payload?.worldbookEntryKeys.map(String) : undefined, _.isString(event.data.payload?.worldbookName) ? String(event.data.payload?.worldbookName) : undefined, _.isString(event.data.payload?.projectVersion) ? String(event.data.payload?.projectVersion) : undefined);
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
                        Boolean(actionLegacyProjectName && (project.projectId === actionLegacyProjectName || project.legacyProjectName === actionLegacyProjectName)));
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
                    await updateCreativeWorkshopProject(String(event.data.payload?.projectId), expectedVersion, actionLegacyProjectName);
                    await updateCreativeWorkshopRegex(String(event.data.payload?.projectId), expectedVersion, actionLegacyProjectName);
                    await post('bridge:update-result', {
                        success: true,
                        projectId: String(event.data.payload?.projectId),
                        projects: await listInstalledCreativeWorkshopProjects(),
                    }, event.data.requestId);
                    break;
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
                    legacyDebugLog('[CreativeWorkshopBridgeHost] bridge:oauth:start', {
                        authUrl: safeUrlForLog(authUrl),
                        state,
                        requestId: event.data.requestId,
                    });
                    const width = 600;
                    const height = 700;
                    const left = Math.max(0, Math.round((hostWindow.screen.width - width) / 2));
                    const top = Math.max(0, Math.round((hostWindow.screen.height - height) / 2));
                    const popup = hostWindow.open(authUrl, OAUTH_POPUP_NAME, `width=${width},height=${height},left=${left},top=${top}`);
                    if (!popup) {
                        legacyDebugLog('[CreativeWorkshopBridgeHost] bridge:oauth:start popup blocked');
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
                    legacyDebugLog('[CreativeWorkshopBridgeHost] bridge:oauth:start popup opened', {
                        popupClosed: popup.closed,
                        pendingOauthRequestId,
                        pendingOauthState,
                    });
                    startOAuthMonitors();
                    break;
                }
            }
            if (actionType === 'bridge:install-project') {
                creativeWorkshopDiag('install-request-finished', {
                    requestId: event.data.requestId,
                    projectId: actionProjectId,
                    durationMs: Date.now() - actionStartedAt,
                });
            }
        }
        catch (error) {
            if (actionType === 'bridge:install-project') {
                creativeWorkshopDiagError('install-request-error', {
                    requestId: event.data.requestId,
                    projectId: actionProjectId,
                    legacyProjectName: actionLegacyProjectName,
                    durationMs: Date.now() - actionStartedAt,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
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
                legacyDebugLog('[CreativeWorkshopBridgeHost] OAuth 监听在授权完成前被销毁', {
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
            legacyDebugLog('[CreativeWorkshopBridgeHost] destroy');
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
        background: 'linear-gradient(145deg, #1E293B, #0F172A)',
        borderRadius: '20px',
        padding: '36px 32px 28px',
        width: 'min(520px, 92vw)',
        maxHeight: '85vh',
        overflowY: 'auto',
        boxShadow: '0 24px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)',
        color: '#E2E8F0',
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
        .html('<i class="fas fa-shield-alt" style="color:#60A5FA"></i> 免责声明');
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
            .html(`<i class="fas ${item.icon}" style="color:#60A5FA;font-size:0.85rem"></i> ${index + 1}. ${item.title}`);
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
    const existing = host$('#creative-workshop-overlay');
    if (existing.length) {
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
        background: '#0F172A',
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
            paddingTop: useFullscreenLayout ? '0' : '24px',
            paddingRight: useFullscreenLayout ? '0' : '24px',
            paddingBottom: useFullscreenLayout ? '0' : '24px',
            paddingLeft: useFullscreenLayout ? '0' : '24px',
        });
        $frameShell.css({
            width: useFullscreenLayout ? '100vw' : '90vw',
            height: useFullscreenLayout ? `${viewportHeight}px` : '90vh',
        });
        $frame.css({
            // ponytail: mobile fills viewport; desktop keeps simple 90% sizing with no extra ratio math.
            width: useFullscreenLayout ? '100vw' : '90vw',
            height: useFullscreenLayout ? `${viewportHeight}px` : '90vh',
            borderRadius: useFullscreenLayout ? '0' : '20px',
            boxShadow: useFullscreenLayout ? 'none' : '0 24px 80px rgba(0,0,0,0.45)',
        });
        $closeButton.css({
            top: useFullscreenLayout
                ? '50%'
                : 'calc(env(safe-area-inset-top, 0px) + 12px)',
            right: useFullscreenLayout ? 'auto' : 'calc(env(safe-area-inset-right, 0px) + 12px)',
            left: useFullscreenLayout ? 'calc(env(safe-area-inset-left, 0px) + 6px)' : 'auto',
            transform: useFullscreenLayout ? 'translateY(-50%)' : 'none',
            padding: useFullscreenLayout ? '0 10px' : '0 14px',
        });
    };
    updateOverlayLayout();
    host$(hostWindow).on('resize.creative-workshop-overlay', updateOverlayLayout);
    host$(hostWindow).on('scroll.creative-workshop-overlay', updateOverlayLayout);
    hostWindow.visualViewport?.addEventListener('resize', updateOverlayLayout);
    hostWindow.visualViewport?.addEventListener('scroll', updateOverlayLayout);
    $frameShell.append($frame, $closeButton);
    $overlay.append($frameShell).appendTo(hostDocument.body);
    const close = () => {
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
        if (event.target === $overlay[0]) {
            close();
        }
    });
    let bridge = null;
    let hasNavigated = false;
    $frame.on('load', () => {
        const iframe = $frame[0];
        if (!bridge) {
            bridge = createCreativeWorkshopBridgeHost({
                iframe,
                targetOrigin: getCreativeWorkshopOrigin(),
                onClose: close,
            });
        }
        if (!hasNavigated) {
            hasNavigated = true;
            iframe.contentWindow?.location.replace(creativeWorkshopUrl);
        }
    });
}
$(() => {
    creativeWorkshopDiag('script-mounted');
    replaceScriptButtons([{ name: '命定创意工坊', visible: true }]);
    eventOn(getButtonEvent('命定创意工坊'), () => {
        if (hasAcceptedAgreement()) {
            openCreativeWorkshop();
        }
        else {
            showAgreementPopup();
        }
    });
});


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/* harmony import */ var _index__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(947);
globalThis.__CREATIVE_WORKSHOP_FORCED_URL__ =
    'https://workshop-test.uika.cc.cd';


/******/ })()
;
//# sourceMappingURL=index.js.map