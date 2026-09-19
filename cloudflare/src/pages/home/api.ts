export const homeApiScript = String.raw`
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const UPLOAD_SIZE_ERROR = '文件过大，最大 10MB';
const REPAIR_RESOLVE_CACHE_TTL_MS = 5 * 60 * 1000;
const REPAIR_RESOLVE_LOCK_STORAGE_PREFIX = 'creative_workshop_repair_locked_until_v1:';
const REPAIR_DAILY_LOCK_MESSAGE = '好啦別再点了喵！截图然后去DC找我吧喵！';
const DISCOVER_ROTATION_WINDOW_MS = 6 * 60 * 60 * 1000;
const DISCOVER_CANDIDATE_POOL_SIZE = 30;
const DISCOVER_DISPLAY_COUNT = 10;
const DISCOVER_ANCHOR_COUNT = 2;
const DISCOVER_MAX_PER_AUTHOR = 2;
const repairResolveCache = new Map();
let repairLockNoticeShownFor = '';

function assertUploadSize(file) {
  if (file && Number(file.size) > MAX_UPLOAD_SIZE) {
    throw new Error(UPLOAD_SIZE_ERROR);
  }
}

function resolveApiErrorMessage(status, rawText, data, fallbackMessage) {
  const text = String(rawText || '').trim();
  if (/\b1027\b/.test(text)) return '服务额度用尽，请稍后再试';
  if (/\b1102\b/.test(text) || /Worker exceeded resource limits/i.test(text)) return '服务资源超限，请稍后再试';
  if (status === 429 || /rate limit|too many requests|quota|limit exceeded/i.test(text)) return '请求过于频繁，请稍后再试';
  if (data && (data.error || data.message)) return data.error || data.message;
  const lowerText = text.toLowerCase();
  if (lowerText.startsWith('<!doctype html') || lowerText.startsWith('<html') || lowerText.includes('<body') || lowerText.includes('</html>')) {
    return '服务暂时不可用，请稍后再试';
  }
  if (text) return text.slice(0, 300);
  return fallbackMessage || ('请求失败(' + status + ')');
}

function normalizeThrownError(error, fallbackMessage) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/Failed to fetch|NetworkError|Load failed/i.test(message)) {
    return new Error('网络连接失败，请检查网络后重试');
  }
  return new Error(message || fallbackMessage);
}

async function parseResponseBody(response) {
  const rawText = await response.text();
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }
  return { rawText, data };
}

async function apiFetch(endpoint, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) {
    headers.Authorization = 'Bearer ' + token;
  }

  let response;
  try {
    response = await fetch(API_BASE + endpoint, { ...options, headers });
  } catch (error) {
    throw normalizeThrownError(error, '请求失败');
  }
  if (response.status === 401) {
    clearAuthenticatedCoverObjectUrls();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    invalidateAllProjectDetailCaches();
    setCurrentUser(null);
    renderApp();
    throw new Error('登录已过期');
  }
  if (options.rawResponse && response.ok) {
    return response;
  }

  const { rawText, data } = await parseResponseBody(response);

  if (!response.ok) {
    const requestError = new Error(resolveApiErrorMessage(response.status, rawText, data, '请求失败(' + response.status + ')'));
    requestError.status = response.status;
    requestError.code = data?.code || '';
    requestError.lockedUntil = data?.lockedUntil || null;
    throw requestError;
  }

  return data || {};
}

async function fetchCurrentUser() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  try {
    const data = await apiFetch('/api/auth/me', { method: 'GET' });
    if (data.user) {
      setCurrentUser(data.user);
      localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      return data;
    }
  } catch (error) {}

  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  invalidateAllProjectDetailCaches();
  setCurrentUser(null);
  return null;
}

const PROJECT_DETAIL_CACHE_TTL_MS = 60 * 1000;
const INSTALLED_PROJECT_BATCH_SIZE = 50;
const projectDetailCache = new Map();
const projectDetailInFlight = new Map();
const projectDetailGeneration = new Map();
let projectDetailCacheEpoch = 0;

function getProjectDetailGeneration(projectId) {
  return projectDetailGeneration.get(projectId) || 0;
}

function invalidateProjectDetailCache(projectId) {
  if (!projectId) return;
  projectDetailCache.delete(projectId);
  projectDetailGeneration.set(projectId, getProjectDetailGeneration(projectId) + 1);
}

function invalidateAllProjectDetailCaches() {
  projectDetailCache.clear();
  projectDetailCacheEpoch += 1;
}

async function fetchSubscriptions(forceRefresh = false) {
  if (!state.currentUser) {
    state.subsMap = new Map();
    state.subscriptionsLoaded = false;
    return [];
  }
  if (state.subscriptionsLoaded && !forceRefresh) {
    return Array.from(state.subsMap.entries())
      .filter(([, value]) => Boolean(value?.subscribed))
      .map(([projectId]) => projectId);
  }

  const data = await apiFetch('/api/my/subscriptions');
  const projectIds = Array.isArray(data.projectIds) ? data.projectIds : [];
  setSubscribedProjectIds(projectIds);
  return projectIds;
}

function hashDiscoverRotation(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getDiscoverRotationBucket(nowMs = Date.now()) {
  const numericNow = Number(nowMs);
  return Math.floor((Number.isFinite(numericNow) ? numericNow : Date.now()) / DISCOVER_ROTATION_WINDOW_MS);
}

function selectDiscoverProjects(projects, nowMs = Date.now()) {
  const candidates = (Array.isArray(projects) ? projects : [])
    .filter(Boolean)
    .slice(0, DISCOVER_CANDIDATE_POOL_SIZE);
  if (candidates.length <= DISCOVER_DISPLAY_COUNT) return candidates.slice(0, DISCOVER_DISPLAY_COUNT);

  const selected = [];
  const selectedIds = new Set();
  const authorCounts = new Map();
  const authorKey = project => project?.authorId ? 'author:' + project.authorId : 'project:' + String(project?.id || '');
  const addProject = (project, enforceAuthorCap = true) => {
    const projectId = String(project?.id || '');
    if (!projectId || selectedIds.has(projectId)) return false;
    const key = authorKey(project);
    const count = authorCounts.get(key) || 0;
    if (enforceAuthorCap && count >= DISCOVER_MAX_PER_AUTHOR) return false;
    selected.push(project);
    selectedIds.add(projectId);
    authorCounts.set(key, count + 1);
    return true;
  };

  for (const project of candidates.slice(0, DISCOVER_ANCHOR_COUNT)) addProject(project);

  const bucket = getDiscoverRotationBucket(nowMs);
  const rotated = candidates
    .slice(DISCOVER_ANCHOR_COUNT)
    .map((project, index) => ({
      project,
      originalIndex: index,
      rotationScore: hashDiscoverRotation(bucket + ':' + String(project?.id || index)),
    }))
    .sort((a, b) => a.rotationScore - b.rotationScore || a.originalIndex - b.originalIndex);

  for (const entry of rotated) {
    if (selected.length >= DISCOVER_DISPLAY_COUNT) break;
    addProject(entry.project, true);
  }
  // A tiny/creator-heavy pool should still render a full shelf instead of leaving holes.
  for (const entry of rotated) {
    if (selected.length >= DISCOVER_DISPLAY_COUNT) break;
    addProject(entry.project, false);
  }

  return selected;
}

async function fetchDiscoverShelves(forceRefresh = false) {
  const shelfSpecs = [
    { key: 'discover', sort: 'discover', pageSize: DISCOVER_CANDIDATE_POOL_SIZE },
    { key: 'published', sort: 'published', pageSize: 5 },
    { key: 'rating', sort: 'rating', pageSize: 5 },
    { key: 'downloads', sort: 'downloads', pageSize: 5 },
  ];
  setDiscoverShelves({ ...state.discoverShelves, loading: true });
  renderApp();
  try {
    const results = await Promise.all(shelfSpecs.map(async spec => {
      const params = new URLSearchParams({ page: '0', pageSize: String(spec.pageSize), sort: spec.sort });
      if (forceRefresh) params.set('_', String(Date.now()));
      const data = await apiFetch('/api/projects?' + params.toString());
      const projects = Array.isArray(data.projects) ? data.projects : [];
      return [spec.key, spec.key === 'discover' ? selectDiscoverProjects(projects) : projects];
    }));
    const shelves = { discover: [], published: [], rating: [], downloads: [], loading: false };
    results.forEach(([key, projects]) => { shelves[key] = projects; });
    setDiscoverShelves(shelves);
    syncProjectStats(state.projects);
    renderApp();
    return shelves;
  } catch (error) {
    setDiscoverShelves({ ...state.discoverShelves, loading: false });
    renderApp();
    throw error;
  }
}

async function fetchProjects(forceRefresh = false, options = {}) {
  const append = Boolean(options.append);
  const pageSize = Number(options.pageSize || state.projectPagination.pageSize || 50);
  const nextPage = append ? Number(state.projectPagination.page || 0) + 1 : Number(options.page || 0);
  const requestToken = createProjectRequestToken();
  const params = new URLSearchParams({
    page: String(nextPage),
    pageSize: String(pageSize),
    sort: String(state.sortMode || DEFAULT_SORT_MODE),
  });
  const baseTag = getActivePublicBaseTag();
  if (baseTag && baseTag !== 'all') {
    params.set('projectType', baseTag);
  }
  const activeTags = getActivePublicTags();
  if (activeTags.length) {
    params.set('tags', activeTags.join(','));
  }
  const searchKeyword = String(state.searchKeyword || '').trim();
  if (searchKeyword) {
    params.set('search', searchKeyword);
  }

  try {
    if (forceRefresh) {
      params.set('_', String(Date.now()));
    }
    const data = await apiFetch('/api/projects?' + params.toString());
    if (!isLatestProjectRequestToken(requestToken)) {
      return null;
    }
    const projectList = data.projects || [];

    setProjectsPage({
      projects: projectList,
      page: data.page,
      pageSize: data.pageSize || pageSize,
      hasMore: data.hasMore,
      append,
    });

    if (state.showSubscribedAndInstalledProjects && state.tavern.connected && state.tavern.installedProjectsLoaded) {
      await fetchInstalledProjectDetails();
    }

    syncProjectStats(state.projects);

    if (state.currentUser && state.showOnlyMyProjects) {
      try {
        const myData = await apiFetch('/api/my/projects');
        if (!isLatestProjectRequestToken(requestToken)) {
          return null;
        }
        setMyProjects(myData.projects || []);
      } catch (myProjectsError) {
        if (!isLatestProjectRequestToken(requestToken)) {
          return null;
        }
        showToast('加载我的项目失败: ' + myProjectsError.message, 'warning');
      }
    } else {
      setMyProjects([]);
    }

    if (!isLatestProjectRequestToken(requestToken)) {
      return null;
    }
    renderApp();
    return data;
  } catch (error) {
    if (!isLatestProjectRequestToken(requestToken)) {
      return null;
    }
    if (append) {
      setProjectPaginationLoadingMore(false);
    } else {
      resetProjectPagination();
      setProjects([]);
      syncProjectStats([]);
    }

    showToast('加载项目失败: ' + error.message, 'error');
    renderApp();
    return null;
  }
}

function normalizeRepairProjectName(value) {
  return String(value || '').trim().toLowerCase();
}

function getRepairResolveLockStorageKey() {
  const identity = String(state.currentUser?.id || 'anonymous').trim() || 'anonymous';
  return REPAIR_RESOLVE_LOCK_STORAGE_PREFIX + identity;
}

function getRepairResolveLockedUntil() {
  try {
    const storageKey = getRepairResolveLockStorageKey();
    const value = String(localStorage.getItem(storageKey) || '').trim();
    const lockedUntil = Date.parse(value);
    if (!value || !Number.isFinite(lockedUntil) || lockedUntil <= Date.now()) {
      localStorage.removeItem(storageKey);
      return null;
    }
    return new Date(lockedUntil).toISOString();
  } catch {
    return null;
  }
}

function setRepairResolveLockedUntil(value) {
  const lockedUntil = Date.parse(String(value || ''));
  if (!Number.isFinite(lockedUntil) || lockedUntil <= Date.now()) return null;
  const normalized = new Date(lockedUntil).toISOString();
  try {
    localStorage.setItem(getRepairResolveLockStorageKey(), normalized);
  } catch {}
  return normalized;
}

function showRepairResolveLockNotice(lockedUntil) {
  const normalized = setRepairResolveLockedUntil(lockedUntil) || getRepairResolveLockedUntil();
  const noticeKey = normalized || 'locked';
  if (repairLockNoticeShownFor !== noticeKey) {
    repairLockNoticeShownFor = noticeKey;
    alert(REPAIR_DAILY_LOCK_MESSAGE);
  }
  return normalized;
}

function createRepairResolveLockedError(lockedUntil) {
  const error = new Error(REPAIR_DAILY_LOCK_MESSAGE);
  error.code = 'REPAIR_DAILY_LOCKED';
  error.lockedUntil = lockedUntil || null;
  return error;
}

function getRepairResolveCacheKey(candidate) {
  const projectId = String(candidate?.projectId || '').trim();
  const name = normalizeRepairProjectName(candidate?.name);
  return projectId + '|' + name;
}

async function resolveWorkshopRepairCandidates(candidates) {
  const input = (Array.isArray(candidates) ? candidates : []).slice(0, 50).map((candidate, index) => ({
    candidateId: String(candidate?.candidateId || ('candidate-' + index)).trim(),
    projectId: String(candidate?.projectId || '').trim(),
    name: String(candidate?.name || '').trim(),
  })).filter(candidate => candidate.candidateId);

  if (!input.length) return [];

  const existingLock = getRepairResolveLockedUntil();
  if (existingLock) {
    showRepairResolveLockNotice(existingLock);
    throw createRepairResolveLockedError(existingLock);
  }

  const now = Date.now();
  const resolvedByCandidateId = new Map();
  const pending = [];
  input.forEach(candidate => {
    const cacheKey = getRepairResolveCacheKey(candidate);
    const cached = repairResolveCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      resolvedByCandidateId.set(candidate.candidateId, cached.result);
      return;
    }
    if (cached) repairResolveCache.delete(cacheKey);
    pending.push(candidate);
  });

  if (pending.length) {
    let data;
    try {
      data = await apiFetch('/api/projects/repair-resolve', {
        method: 'POST',
        body: JSON.stringify({ candidates: pending }),
      });
    } catch (error) {
      if (error?.code === 'REPAIR_DAILY_LOCKED') {
        showRepairResolveLockNotice(error.lockedUntil);
      }
      throw error;
    }

    const serverResults = new Map((Array.isArray(data.results) ? data.results : []).map(result => [
      String(result?.candidateId || ''),
      result,
    ]));
    pending.forEach(candidate => {
      const result = serverResults.get(candidate.candidateId)
        || { candidateId: candidate.candidateId, status: 'none', method: 'exact_name', projects: [] };
      repairResolveCache.set(getRepairResolveCacheKey(candidate), {
        expiresAt: now + REPAIR_RESOLVE_CACHE_TTL_MS,
        result,
      });
      resolvedByCandidateId.set(candidate.candidateId, result);
    });
  }

  return input.map(candidate => resolvedByCandidateId.get(candidate.candidateId)
    || { candidateId: candidate.candidateId, status: 'none', method: 'exact_name', projects: [] });
}

function buildRepairSearchTerm(value) {
  const cleaned = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[%_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, 20).join('');
}

function isWorkshopUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

async function searchWorkshopProjectsByName(query) {
  const normalizedQuery = normalizeRepairProjectName(query);
  const searchTerm = buildRepairSearchTerm(query);
  if (!normalizedQuery || !searchTerm) return { projects: [], exactNameMatches: [] };
  const params = new URLSearchParams({ page: '0', pageSize: '20', sort: 'published', search: searchTerm });
  const data = await apiFetch('/api/projects?' + params.toString());
  const projects = Array.isArray(data.projects) ? data.projects : [];
  const exactNameMatches = projects.filter(project => normalizeRepairProjectName(project?.name) === normalizedQuery);
  return { projects, exactNameMatches };
}

async function findWorkshopProjectsForRepair(candidate, manualQuery = '') {
  if (manualQuery) {
    const { projects, exactNameMatches } = await searchWorkshopProjectsByName(manualQuery);
    if (exactNameMatches.length === 1) {
      return { status: 'candidates', method: 'manual_exact_name', projects: exactNameMatches };
    }
    if (exactNameMatches.length > 1) {
      return { status: 'ambiguous', method: 'manual_exact_name', projects: exactNameMatches };
    }
    if (projects.length > 0) {
      return { status: 'candidates', method: 'manual_search', projects };
    }
    return { status: 'none', method: 'manual_search', projects: [] };
  }

  const detectedProjectId = String(candidate?.detectedProjectId || '').trim();
  const projectId = detectedProjectId && isWorkshopUuid(detectedProjectId) ? detectedProjectId : '';
  const name = String(candidate?.name || candidate?.legacyProjectName || '').trim();
  if (!projectId && !name) return { status: 'none', method: 'none', projects: [] };

  const [result] = await resolveWorkshopRepairCandidates([{
    candidateId: String(candidate?.candidateId || projectId || name),
    projectId,
    name,
  }]);
  return result || { status: 'none', method: 'exact_name', projects: [] };
}

async function fetchInstalledProjectDetails() {
  const installedProjects = state.tavern.installedProjects.slice();
  const installedProjectIds = Array.from(new Set(
    installedProjects.map(project => project.projectId || project.id).filter(Boolean),
  ));
  if (!installedProjectIds.length) {
    mergeInstalledRemoteProjects([]);
    return [];
  }

  const loadedProjectIds = new Set(state.projects.map(project => project.id));
  const missingProjectIds = installedProjectIds.filter(projectId => !loadedProjectIds.has(projectId));
  if (!missingProjectIds.length) return [];

  const remoteProjects = [];
  for (let offset = 0; offset < missingProjectIds.length; offset += INSTALLED_PROJECT_BATCH_SIZE) {
    const projectIds = missingProjectIds.slice(offset, offset + INSTALLED_PROJECT_BATCH_SIZE);
    const data = await apiFetch('/api/projects/batch', {
      method: 'POST',
      body: JSON.stringify({ projectIds }),
    });
    if (Array.isArray(data.projects)) {
      remoteProjects.push(...data.projects);
    }
  }

  const foundRemoteIds = new Set(remoteProjects.map(project => project?.id).filter(Boolean));
  const missingIdSet = new Set(missingProjectIds);
  const rebindRequests = [];
  for (const localProject of installedProjects) {
    const currentProjectId = localProject.projectId || localProject.id;
    if (!missingIdSet.has(currentProjectId) || foundRemoteIds.has(currentProjectId)) continue;
    const installedProjectId = String(localProject.installedProjectId || currentProjectId || '').trim();
    const projectNameHint = String(localProject.projectNameHint || localProject.legacyProjectName || localProject.name || '').trim();
    if (!installedProjectId || !projectNameHint) {
      setInstalledProjectRebindCandidates(installedProjectId, []);
      continue;
    }
    rebindRequests.push({
      candidateId: installedProjectId,
      projectId: isWorkshopUuid(installedProjectId) ? installedProjectId : '',
      name: projectNameHint,
    });
  }

  if (rebindRequests.length) {
    try {
      const resolved = await resolveWorkshopRepairCandidates(rebindRequests);
      const byCandidateId = new Map(resolved.map(result => [String(result?.candidateId || ''), result]));
      rebindRequests.forEach(request => {
        const result = byCandidateId.get(request.candidateId);
        setInstalledProjectRebindCandidates(request.candidateId, Array.isArray(result?.projects) ? result.projects : []);
      });
    } catch (error) {
      console.warn('[CreativeWorkshop] stale installed project batch candidate lookup failed', { error });
      rebindRequests.forEach(request => setInstalledProjectRebindCandidates(request.candidateId, []));
    }
  }

  mergeInstalledRemoteProjects(remoteProjects);
  return remoteProjects;
}

async function loadMoreProjects() {
  if (state.projectPagination.loadingMore || !shouldShowProjectLoadMore()) {
    return;
  }
  setProjectPaginationLoadingMore(true);
  renderApp();
  await fetchProjects(false, { append: true, pageSize: state.projectPagination.pageSize });
}

async function toggleLike(projectId) {
  if (!state.currentUser) {
    showToast('请先登录', 'warning');
    return;
  }
  try {
    const data = await apiFetch('/api/projects/' + projectId + '/like', { method: 'POST' });
    updateLikeState(projectId, { liked: data.liked, count: data.count });
    invalidateProjectDetailCache(projectId);
    renderApp();
  } catch (error) {
    showToast('操作失败: ' + error.message, 'error');
  }
}

async function setProjectSubscription(projectId, subscribed) {
  if (!state.currentUser) {
    return null;
  }
  const data = await apiFetch('/api/projects/' + projectId + '/subscribe', {
    method: 'PUT',
    body: JSON.stringify({ subscribed: Boolean(subscribed) }),
  });
  updateSubscribeState(projectId, { subscribed: data.subscribed, count: 0 });
  invalidateProjectDetailCache(projectId);
  renderApp();
  return data;
}

async function fetchProjectEntries(projectOrId, options = {}) {
  try {
    const projectId = typeof projectOrId === 'string' ? projectOrId : projectOrId?.id;
    if (!projectId) {
      throw new Error('缺少项目 ID');
    }

    if (typeof projectOrId === 'object' && projectOrId?.source === 'local-only') {
      return {
        project: projectOrId,
        entries: [],
        regexEntries: [],
      };
    }

    const forceRefresh = Boolean(options.forceRefresh);
    const expectedVersion =
      typeof projectOrId === 'object' && projectOrId?.version ? String(projectOrId.version) : null;
    if (forceRefresh) {
      invalidateProjectDetailCache(projectId);
    }
    const generation = getProjectDetailGeneration(projectId);
    const cacheEpoch = projectDetailCacheEpoch;
    const cached = projectDetailCache.get(projectId);
    if (
      !forceRefresh &&
      cached &&
      Date.now() - cached.cachedAt <= PROJECT_DETAIL_CACHE_TTL_MS &&
      (!expectedVersion || cached.data?.project?.version === expectedVersion)
    ) {
      return cached.data;
    }

    const inFlight = projectDetailInFlight.get(projectId);
    if (
      !forceRefresh &&
      inFlight?.generation === generation &&
      inFlight.cacheEpoch === cacheEpoch &&
      inFlight.expectedVersion === expectedVersion
    ) {
      return await inFlight.request;
    }
    const versionQuery = expectedVersion ? '?v=' + encodeURIComponent(expectedVersion) : '';
    const request = apiFetch('/api/projects/' + projectId + versionQuery, {
      method: 'GET',
      ...(forceRefresh ? { cache: 'no-store' } : {}),
    }).then(detail => {
      const entries = Array.isArray(detail.worldbookEntriesPreview) ? detail.worldbookEntriesPreview : [];
      const regexEntries = Array.isArray(detail.regexEntriesPreview) ? detail.regexEntriesPreview : [];
      const data = {
        project: {
          ...(detail.project || (typeof projectOrId === 'object' ? projectOrId : { id: projectId })),
          worldbookEntriesPreview: entries,
          regexEntriesPreview: regexEntries,
        },
        entries,
        regexEntries,
      };
      if (getProjectDetailGeneration(projectId) === generation && projectDetailCacheEpoch === cacheEpoch) {
        projectDetailCache.set(projectId, { cachedAt: Date.now(), data });
      }
      return data;
    });
    projectDetailInFlight.set(projectId, { generation, cacheEpoch, expectedVersion, request });
    try {
      return await request;
    } finally {
      if (projectDetailInFlight.get(projectId)?.request === request) {
        projectDetailInFlight.delete(projectId);
      }
    }
  } catch (error) {
    throw normalizeThrownError(error, '加载项目详情失败');
  }
}

async function createProject(payload) {
  return apiFetch('/api/projects', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function updateProject(projectId, payload) {
  const result = await apiFetch('/api/projects/' + projectId, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  invalidateProjectDetailCache(projectId);
  return result;
}

async function updateProjectVisibility(projectId, visibility) {
  const result = await apiFetch('/api/projects/' + projectId + '/visibility', {
    method: 'PUT',
    body: JSON.stringify({ visibility }),
  });
  invalidateProjectDetailCache(projectId);
  return result;
}

async function deleteProject(projectId) {
  const result = await apiFetch('/api/projects/' + projectId, { method: 'DELETE' });
  invalidateProjectDetailCache(projectId);
  return result;
}

async function uploadProjectFile(projectId, file) {
  assertUploadSize(file);
  try {
    const response = await fetch('/api/projects/' + projectId + '/upload', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY),
        'Content-Type': file.type,
      },
      body: file,
    });
    const { rawText, data } = await parseResponseBody(response);
    if (!response.ok) {
      throw new Error(resolveApiErrorMessage(response.status, rawText, data, '上传失败'));
    }
    invalidateProjectDetailCache(projectId);
    return data || {};
  } catch (error) {
    throw normalizeThrownError(error, '上传失败');
  }
}

async function uploadRegexFile(projectId, file) {
  assertUploadSize(file);
  try {
    const response = await fetch('/api/projects/' + projectId + '/upload-regex', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY),
        'Content-Type': file.type,
      },
      body: file,
    });
    const { rawText, data } = await parseResponseBody(response);
    if (!response.ok) {
      throw new Error(resolveApiErrorMessage(response.status, rawText, data, '上传失败'));
    }
    invalidateProjectDetailCache(projectId);
    return data || {};
  } catch (error) {
    throw normalizeThrownError(error, '上传失败');
  }
}

async function uploadCoverFile(projectId, file) {
  assertUploadSize(file);
  const formData = new FormData();
  formData.append('cover', file);
  try {
    const response = await fetch('/api/projects/' + projectId + '/upload-cover', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY),
      },
      body: formData,
    });
    const { rawText, data } = await parseResponseBody(response);
    if (!response.ok) {
      throw new Error(resolveApiErrorMessage(response.status, rawText, data, '上传失败'));
    }
    invalidateProjectDetailCache(projectId);
    return data || {};
  } catch (error) {
    throw normalizeThrownError(error, '上传失败');
  }
}

async function fetchDiscoverBanner() {
  const result = await apiFetch('/api/site/discover-banner', { cache: 'no-store' });
  setDiscoverBanner(result?.banner || {});
  return result?.banner || {};
}

async function updateCoverPresentation(projectId, presentation) {
  const result = await apiFetch('/api/projects/' + projectId + '/cover-presentation', {
    method: 'PUT',
    body: JSON.stringify(presentation),
  });
  invalidateProjectDetailCache(projectId);
  return result;
}

async function updateDiscoverBannerPresentation(presentation) {
  const result = await apiFetch('/api/admin/discover-banner', {
    method: 'PUT',
    body: JSON.stringify(presentation),
  });
  if (result?.banner) setDiscoverBanner(result.banner);
  return result;
}

async function uploadDiscoverBanner(file) {
  const formData = new FormData();
  formData.append('banner', file);
  const response = await fetch('/api/admin/discover-banner/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY) },
    body: formData,
  });
  const { rawText, data } = await parseResponseBody(response);
  if (!response.ok) throw new Error(resolveApiErrorMessage(response.status, rawText, data, 'Banner 上传失败'));
  if (data?.banner) setDiscoverBanner(data.banner);
  return data || {};
}

async function fetchPendingProjects({ sort = 'oldest', projectType = '' } = {}) {
  const params = new URLSearchParams({ page: '0', pageSize: '50', sort });
  if (projectType) params.set('projectType', projectType);
  return apiFetch('/api/admin/pending?' + params.toString());
}

async function fetchAdminReviewDetail(projectId) {
  return apiFetch('/api/admin/review/' + projectId, {
    method: 'GET',
    cache: 'no-store',
  });
}

async function reviewProject(projectId, payload) {
  const result = await apiFetch('/api/admin/review/' + projectId, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  invalidateAllProjectDetailCaches();
  return result;
}

async function fetchAdminList() {
  return apiFetch('/api/admin/list');
}

async function fetchAdminLogs() {
  return apiFetch('/api/admin/logs');
}

async function fetchCharacterReferences() {
  return apiFetch('/api/character-references', { method: 'GET', cache: 'no-store' });
}

async function fetchCharacterReferenceVersionItems(versionId) {
  return apiFetch('/api/character-references/versions/' + encodeURIComponent(versionId) + '/items', { method: 'GET', cache: 'no-store' });
}


async function updateProjectCompatibility(projectId, payload) {
  const result = await apiFetch('/api/projects/' + projectId + '/compatibility', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  invalidateProjectDetailCache(projectId);
  return result;
}

async function setAdmin(userId, isAdmin) {
  return apiFetch('/api/admin/set-admin', {
    method: 'POST',
    body: JSON.stringify({ userId, isAdmin }),
  });
}
async function removeProjectEntry(projectId, kind, entryKey) {
  const result = await apiFetch('/api/projects/' + projectId + '/entries/remove', {
    method: 'POST',
    body: JSON.stringify({ kind, entryKey }),
  });
  return result;
}
`;



