export const homeApiScript = String.raw`
const MAX_UPLOAD_SIZE = WORKSHOP_LIMITS.projectUploadBytes;
const UPLOAD_SIZE_ERROR = '文件过大，最大 ' + WORKSHOP_LIMITS.projectUploadLabel;
const REPAIR_RESOLVE_CACHE_TTL_MS = 5 * 60 * 1000;
const REPAIR_RESOLVE_LOCK_STORAGE_PREFIX = 'creative_workshop_repair_locked_until_v1:';
const REPAIR_DAILY_LOCK_MESSAGE = '好啦別再点了喵！截图然后去DC找我吧喵！';
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
  if (/\b1102\b/.test(text) || /Worker exceeded resource limits/i.test(text)) return '服务器未能完成这次处理。重复操作可能仍会失败，请联系管理员，并附上当前页面截图。';
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

async function fetchProjectInstallInfo(projectId, expectedVersion = null) {
  if (!state.currentUser || !localStorage.getItem(TOKEN_KEY)) {
    const error = new Error('请先 Discord 登录后再下载 / 安装 DLC');
    error.code = 'LOGIN_REQUIRED';
    throw error;
  }
  const versionQuery = expectedVersion ? '?v=' + encodeURIComponent(expectedVersion) : '';
  return apiFetch('/api/projects/' + encodeURIComponent(projectId) + '/install-info' + versionQuery, {
    method: 'GET',
    cache: 'no-store',
  });
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

async function fetchDiscoverShelves(forceRefresh = false) {
  const shelfSpecs = [
    { key: 'discover', sort: 'discover', pageSize: 10 },
    { key: 'published', sort: 'published', pageSize: 5 },
    { key: 'updated', sort: 'updated', pageSize: 5 },
  ];
  setDiscoverShelves({ ...state.discoverShelves, loading: true });
  renderApp();
  try {
    const results = await Promise.all(shelfSpecs.map(async spec => {
      const params = new URLSearchParams({ page: '0', pageSize: String(spec.pageSize), sort: spec.sort });
      if (forceRefresh) params.set('_', String(Date.now()));
      const data = await apiFetch('/api/projects?' + params.toString());
      const projects = Array.isArray(data.projects) ? data.projects : [];
      return [spec.key, projects];
    }));
    const shelves = { discover: [], published: [], updated: [], downloads: [], likes: [], loading: false };
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

async function fetchDevTeamRecommendations(forceRefresh = false) {
  const suffix = forceRefresh ? ('?_=' + Date.now()) : '';
  const data = await apiFetch('/api/devteam-recommendations' + suffix);
  const curators = Array.isArray(data.curators) ? data.curators : [];
  setDevTeamCurators(curators);
  const projects = curators.flatMap(curator => (curator.recommendations || []).map(item => item.project)).filter(Boolean);
  syncProjectStats(projects, { replace: false });
  return curators;
}

async function fetchDlcKitchenProfile(forceRefresh = false) {
  if (!state.currentUser?.isAdmin) return null;
  if (!forceRefresh && state.dlcKitchenProfile) return state.dlcKitchenProfile;
  const suffix = forceRefresh ? ('?_=' + Date.now()) : '';
  const data = await apiFetch('/api/admin/devteam-curator-profile' + suffix);
  const profile = data?.profile || {};
  state.dlcKitchenProfile = {
    title: String(profile.title || ''),
    bio: String(profile.bio || ''),
    reactionPresets: Array.isArray(profile.reactionPresets)
      ? profile.reactionPresets.map(item => String(item || '').trim()).filter(Boolean).slice(0, 12)
      : [],
  };
  return state.dlcKitchenProfile;
}

async function saveDlcKitchenProfile(profile) {
  const data = await apiFetch('/api/admin/devteam-curator-profile', {
    method: 'PUT',
    body: JSON.stringify(profile || {}),
  });
  const saved = data?.profile || {};
  state.dlcKitchenProfile = {
    title: String(saved.title || ''),
    bio: String(saved.bio || ''),
    reactionPresets: Array.isArray(saved.reactionPresets)
      ? saved.reactionPresets.map(item => String(item || '').trim()).filter(Boolean).slice(0, 12)
      : [],
  };
  await fetchDevTeamRecommendations(true);
  return state.dlcKitchenProfile;
}

async function saveDevTeamRecommendation(projectId, fields) {
  await apiFetch('/api/admin/devteam-recommendations/' + encodeURIComponent(projectId), {
    method: 'PUT',
    body: JSON.stringify(fields || {}),
  });
  return fetchDevTeamRecommendations(true);
}

async function deleteDevTeamRecommendation(projectId) {
  await apiFetch('/api/admin/devteam-recommendations/' + encodeURIComponent(projectId), { method: 'DELETE' });
  return fetchDevTeamRecommendations(true);
}

const PROJECT_LIST_CLIENT_CACHE_FRESH_MS = 15 * 1000;
const PROJECT_LIST_CLIENT_CACHE_MAX_STALE_MS = 60 * 1000;
const PROJECT_LIST_CLIENT_CACHE_MAX_ENTRIES = 24;
const projectListClientCache = new Map();

function clearProjectListClientCache() {
  projectListClientCache.clear();
}

function writeProjectListClientCache(key, data) {
  if (!key || !data) return;
  projectListClientCache.delete(key);
  projectListClientCache.set(key, { cachedAt: Date.now(), data });
  while (projectListClientCache.size > PROJECT_LIST_CLIENT_CACHE_MAX_ENTRIES) {
    const oldestKey = projectListClientCache.keys().next().value;
    if (!oldestKey) break;
    projectListClientCache.delete(oldestKey);
  }
}

function applyProjectListClientCacheData(data, pageSize) {
  const projectList = Array.isArray(data?.projects) ? data.projects : [];
  setProjectsPage({
    projects: projectList,
    page: data?.page,
    pageSize: data?.pageSize || pageSize,
    hasMore: data?.hasMore,
    publicCounts: data?.publicCounts,
  });
  syncProjectStats(state.projects);
  renderApp();
}

async function fetchProjects(forceRefresh = false, options = {}) {
  const pageSize = state.projectPagination.pageSizeLocked
    ? state.projectPagination.pageSize
    : chooseProjectPageSize();
  state.projectPagination.pageSize = pageSize;
  state.projectPagination.pageSizeLocked = true;
  const nextPage = Number(options.page ?? state.projectPagination.page ?? 0);
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

  const canUseProjectListClientCache = !state.showOnlyMyProjects && !state.showSubscribedAndInstalledProjects;
  forceRefresh = Boolean(forceRefresh && options.bypassClientCache);
  // Writes clear this cache directly; bypassClientCache is only for an explicit uncached reread.
  const projectListClientCacheKey = (state.currentUser?.id || 'anonymous') + '|' + params.toString();
  let cachedFallbackData = null;

  if (forceRefresh) {
    clearProjectListClientCache();
  } else if (canUseProjectListClientCache) {
    const cached = projectListClientCache.get(projectListClientCacheKey);
    if (cached) {
      const ageMs = Date.now() - Number(cached.cachedAt || 0);
      if (ageMs <= PROJECT_LIST_CLIENT_CACHE_MAX_STALE_MS) {
        cachedFallbackData = cached.data;
        if (isLatestProjectRequestToken(requestToken)) {
          applyProjectListClientCacheData(cached.data, pageSize);
        }
        if (ageMs <= PROJECT_LIST_CLIENT_CACHE_FRESH_MS) {
          return cached.data;
        }
      } else {
        projectListClientCache.delete(projectListClientCacheKey);
      }
    }
  }

  try {
    if (forceRefresh) {
      params.set('_', String(Date.now()));
    }
    const data = await apiFetch('/api/projects?' + params.toString());
    if (!isLatestProjectRequestToken(requestToken)) {
      return null;
    }
    if (canUseProjectListClientCache) {
      writeProjectListClientCache(projectListClientCacheKey, data);
    }
    const projectList = data.projects || [];

    setProjectsPage({
      projects: projectList,
      page: data.page,
      pageSize: data.pageSize || pageSize,
      hasMore: data.hasMore,
      publicCounts: data.publicCounts,
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
    if (cachedFallbackData) {
      console.warn('[CreativeWorkshop] 项目列表后台刷新失败，继续显示刚才的内容', error);
      return cachedFallbackData;
    }
    if (nextPage > 0) {
      setProjectPageLoading(false);
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

async function searchWorkshopProjectsForRepair(query, methodPrefix = 'auto_search') {
  const { projects, exactNameMatches } = await searchWorkshopProjectsByName(query);
  if (exactNameMatches.length === 1) {
    return { status: 'unique', method: methodPrefix + '_exact_name', projects: exactNameMatches };
  }
  if (exactNameMatches.length > 1) {
    return { status: 'ambiguous', method: methodPrefix + '_exact_name', projects: exactNameMatches };
  }
  if (projects.length === 1) {
    return { status: 'unique', method: methodPrefix + '_single_result', projects };
  }
  if (projects.length > 1) {
    return { status: 'candidates', method: methodPrefix, projects };
  }
  return { status: 'none', method: methodPrefix, projects: [] };
}

async function findWorkshopProjectsForRepair(candidate, manualQuery = '') {
  if (manualQuery) return searchWorkshopProjectsForRepair(manualQuery, 'manual_search');

  const detectedProjectId = String(candidate?.detectedProjectId || '').trim();
  const projectId = detectedProjectId && isWorkshopUuid(detectedProjectId) ? detectedProjectId : '';
  const name = String(candidate?.name || candidate?.legacyProjectName || '').trim();
  if (!projectId && !name) return { status: 'none', method: 'none', projects: [] };

  const [result] = await resolveWorkshopRepairCandidates([{
    candidateId: String(candidate?.candidateId || projectId || name),
    projectId,
    name,
  }]);
  if (result?.status !== 'none' || !name) {
    return result || { status: 'none', method: 'exact_name', projects: [] };
  }
  return searchWorkshopProjectsForRepair(name, 'auto_search');
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
  const nameSearchCache = new Map();
  for (const localProject of installedProjects) {
    const currentProjectId = localProject.projectId || localProject.id;
    if (!missingIdSet.has(currentProjectId) || foundRemoteIds.has(currentProjectId)) continue;
    const installedProjectId = String(localProject.installedProjectId || currentProjectId || '').trim();
    const projectNameHint = String(localProject.projectNameHint || localProject.legacyProjectName || localProject.name || '').trim();
    if (!installedProjectId || !projectNameHint) {
      setInstalledProjectRebindCandidates(installedProjectId, []);
      continue;
    }
    try {
      if (!nameSearchCache.has(projectNameHint)) {
        nameSearchCache.set(projectNameHint, searchWorkshopProjectsByName(projectNameHint));
      }
      const result = await nameSearchCache.get(projectNameHint);
      setInstalledProjectRebindCandidates(installedProjectId, result?.exactNameMatches || []);
    } catch (error) {
      console.warn('[CreativeWorkshop] stale installed project candidate lookup failed', { installedProjectId, error });
      setInstalledProjectRebindCandidates(installedProjectId, []);
    }
  }

  mergeInstalledRemoteProjects(remoteProjects);
  return remoteProjects;
}

async function goToProjectPage(page) {
  if (state.projectPagination.loadingPage || !shouldShowProjectPagination()) {
    return;
  }
  if (!Number.isInteger(page) || page < 0 || page > 19) return;
  if (page === state.projectPagination.page) return;
  if (page > state.projectPagination.page && !state.projectPagination.hasMore) return;
  setProjectPageLoading(true);
  renderApp();
  await fetchProjects(false, { page });
  document.querySelector('.projects-grid')?.scrollIntoView({ block: 'start' });
}

const pendingLikeProjectIds = new Set();

async function toggleLike(projectId) {
  if (!state.currentUser) {
    showToast('请先登录', 'warning');
    return;
  }
  if (pendingLikeProjectIds.has(projectId)) return;
  pendingLikeProjectIds.add(projectId);
  try {
    const data = await apiFetch('/api/projects/' + projectId + '/like', { method: 'POST' });
    updateLikeState(projectId, { liked: data.liked, count: data.count });
    clearProjectListClientCache();
    invalidateProjectDetailCache(projectId);
    renderApp();
  } catch (error) {
    showToast('操作失败: ' + error.message, 'error');
  } finally {
    pendingLikeProjectIds.delete(projectId);
  }
}

async function setPrivateProjectRating(projectId, rating, comment = '') {
  if (!state.currentUser) throw new Error('请先登录');
  const numericRating = Math.max(1, Math.min(5, Math.floor(Number(rating || 0))));
  const normalizedComment = String(comment || '').trim().slice(0, 500);
  const result = await apiFetch('/api/projects/' + projectId + '/rating', {
    method: 'PUT',
    body: JSON.stringify({ rating: numericRating, comment: normalizedComment }),
  });
  invalidateProjectDetailCache(projectId);
  return result;
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
  clearProjectListClientCache();
  return apiFetch('/api/projects', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

async function updateProject(projectId, payload) {
  clearProjectListClientCache();
  const result = await apiFetch('/api/projects/' + projectId, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  invalidateProjectDetailCache(projectId);
  return result;
}

async function updateProjectVisibility(projectId, visibility) {
  clearProjectListClientCache();
  const result = await apiFetch('/api/projects/' + projectId + '/visibility', {
    method: 'PUT',
    body: JSON.stringify({ visibility }),
  });
  invalidateProjectDetailCache(projectId);
  return result;
}

async function deleteProject(projectId) {
  clearProjectListClientCache();
  const result = await apiFetch('/api/projects/' + projectId, { method: 'DELETE' });
  invalidateProjectDetailCache(projectId);
  return result;
}

const activeUploadChecks = new Map();

function cancelUploadPreflight(kind) {
  activeUploadChecks.get(kind)?.();
}

async function preflightProjectUpload(file, kind) {
  assertUploadSize(file);
  const normalizedKind = kind === 'regex' ? 'regex' : 'worldbook';
  cancelUploadPreflight(normalizedKind);
  return new Promise((resolve, reject) => {
    const worker = new Worker(UPLOAD_CHECKER_URL);
    const finish = (error, result) => {
      clearTimeout(timeout);
      worker.terminate();
      if (activeUploadChecks.get(normalizedKind) === cancel) activeUploadChecks.delete(normalizedKind);
      if (error) reject(error); else resolve(result);
    };
    const cancel = () => finish(new DOMException('已取消旧文件的检查', 'AbortError'));
    const timeout = setTimeout(() => finish(new Error('浏览器检查用时过长，尚未完成。请减少本次提交的脚本数量，或拆分过大的条目后再检查。')), UPLOAD_CHECKER_TIMEOUT_MS);
    activeUploadChecks.set(normalizedKind, cancel);
    worker.onmessage = event => {
      const result = event.data;
      if (!result?.success || !result.codeCheck || result.codeCheck.gate !== 'accept') {
        const error = new Error(result?.error || '本地检查未完成，暂时不能提交。');
        error.codeCheck = result?.codeCheck || null;
        finish(error);
      } else finish(null, result);
    };
    worker.onerror = () => finish(new Error('浏览器未能启动文件检查。请刷新页面；若仍然失败，请联系管理员并附上页面截图。'));
    worker.postMessage({ file, kind: normalizedKind });
  });
}

/**
 * Server-stamped receipt for exactly these bytes. The Worker recomputes the hash of
 * the uploaded file and rejects anything that does not match, so this receipt cannot
 * be reused for different content. It carries no checker verdict.
 */
async function attestProjectContent(file, kind) {
  const normalizedKind = kind === 'regex' ? 'regex' : 'worldbook';
  const response = await fetch('/api/projects/preflight/' + normalizedKind, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY),
      'Content-Type': file.type || 'application/json',
    },
    body: file,
  });
  const { rawText, data } = await parseResponseBody(response);
  if (!response.ok) {
    const error = new Error(resolveApiErrorMessage(response.status, rawText, data, '文件完整性检查失败'));
    error.codeCheck = data?.codeCheck || null;
    throw error;
  }
  if (!data?.success || !data.attestation) {
    throw new Error('文件完整性检查未完成，暂时不能提交。请刷新页面后再试。');
  }
  return data;
}

async function preflightProjectSubmission(file, kind) {
  assertUploadSize(file);
  const normalizedKind = kind === 'regex' ? 'regex' : 'worldbook';
  try {
    const response = await fetch('/api/projects/preflight/' + normalizedKind, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY),
        'Content-Type': file.type || 'application/json',
      },
      body: file,
    });
    const { rawText, data } = await parseResponseBody(response);
    if (!response.ok) {
      const error = new Error(resolveApiErrorMessage(response.status, rawText, data, '自动检查失败'));
      error.codeCheck = data?.codeCheck || null;
      throw error;
    }
    if (!data?.success || !data.attestation) throw new Error('提交检查未完成，暂时不能提交。请联系管理员并附上页面截图。');
    return data;
  } catch (error) {
    const normalized = normalizeThrownError(error, '自动检查失败');
    normalized.codeCheck = error?.codeCheck || null;
    throw normalized;
  }
}
async function uploadProjectFile(projectId, file, attestation) {
  clearProjectListClientCache();
  assertUploadSize(file);
  try {
    const response = await fetch('/api/projects/' + projectId + '/upload', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY),
        'Content-Type': file.type,
        ...(attestation ? { 'X-Workshop-Content-Attestation': attestation } : {}),
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

async function uploadRegexFile(projectId, file, attestation) {
  clearProjectListClientCache();
  assertUploadSize(file);
  try {
    const response = await fetch('/api/projects/' + projectId + '/upload-regex', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY),
        'Content-Type': file.type,
        ...(attestation ? { 'X-Workshop-Content-Attestation': attestation } : {}),
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
  clearProjectListClientCache();
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
  const result = await apiFetch('/api/site/discover-banner');
  setDiscoverBanner(result?.banner || {});
  return result?.banner || {};
}

async function updateCoverPresentation(projectId, presentation) {
  clearProjectListClientCache();
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

// 审核队列必须是「可操作的待审核」全集：只显示一页、却把 total 当成队列长度，
// 会让管理员以为项目丢失。这里按页拉取直到覆盖 total，并对超大队列设上限。
const ADMIN_PENDING_PAGE_SIZE = 20;
const ADMIN_PENDING_MAX_CARDS = 200;

async function fetchPendingProjects({ sort = 'oldest', projectType = '' } = {}) {
  const startedAt = performance.now();
  const projects = [];
  const seenIds = new Set();
  let total = 0;
  let page = 0;

  while (true) {
    const params = new URLSearchParams({ page: String(page), pageSize: String(ADMIN_PENDING_PAGE_SIZE), sort });
    if (projectType) params.set('projectType', projectType);
    const result = await apiFetch('/api/admin/pending?' + params.toString());
    const batch = Array.isArray(result?.projects) ? result.projects : [];
    total = Number(result?.total ?? total);
    // 审核期间队列可能变动：approve/reject 会让行移出排序窗口，翻页按 OFFSET
    // 读取可能重复。同一项目只保留一次，卡片和数字才不会互相打架。
    for (const project of batch) {
      const key = String(project?.id ?? '');
      if (!key || seenIds.has(key)) continue;
      seenIds.add(key);
      projects.push(project);
    }
    const seenTotal = total <= projects.length;
    const pageExhausted = batch.length < ADMIN_PENDING_PAGE_SIZE;
    if (seenTotal || pageExhausted || projects.length >= ADMIN_PENDING_MAX_CARDS) break;
    page += 1;
  }

  console.info('[CreativeWorkshop] admin pending loaded', {
    ms: Math.round(performance.now() - startedAt),
    returned: projects.length,
    total,
    pages: page + 1,
  });
  return {
    success: true,
    projects,
    total,
    page: 0,
    pageSize: ADMIN_PENDING_PAGE_SIZE,
    hasMore: projects.length < total,
  };
}

async function cleanupOutdatedReviewDrafts() {
  return apiFetch('/api/admin/pending/cleanup', {
    method: 'POST',
  });
}

async function recountPublicProjects() {
  return apiFetch('/api/admin/projects/recount', { method: 'POST' });
}

async function fetchAdminReviewDetail(projectId) {
  return apiFetch('/api/admin/review/' + projectId, {
    method: 'GET',
    cache: 'no-store',
  });
}

/**
 * Runs the complete checker on the reviewer device over the exact content the server
 * just returned, and returns a result the server can bind to that content. The
 * server performs no rule analysis of its own; it only verifies the bindings.
 */
function runAdminReviewDeviceCheck(deviceCheck) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(REVIEW_CHECKER_URL);
    const finish = (error, result) => {
      clearTimeout(timeout);
      worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const timeout = setTimeout(
      () => finish(new Error('本机检查用时过长，尚未完成。请稍后重新检查，或联系管理员。')),
      UPLOAD_CHECKER_TIMEOUT_MS,
    );
    worker.onmessage = event => {
      const result = event.data;
      if (!result?.success) {
        finish(new Error(result?.error || '本机未能完成这条内容的检查。'));
        return;
      }
      resolve(result);
    };
    worker.onerror = () => finish(new Error('本机未能启动内容检查。请刷新页面后重试。'));
    worker.postMessage({
      files: deviceCheck?.files || [],
      baseline: deviceCheck?.baseline || null,
      projectId: deviceCheck?.projectId,
      draftRevision: deviceCheck?.draftRevision,
    });
  });
}

async function reviewProject(projectId, payload) {
  clearProjectListClientCache();
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
  clearProjectListClientCache();
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
  clearProjectListClientCache();
  const result = await apiFetch('/api/projects/' + projectId + '/entries/remove', {
    method: 'POST',
    body: JSON.stringify({ kind, entryKey }),
  });
  return result;
}
`;



