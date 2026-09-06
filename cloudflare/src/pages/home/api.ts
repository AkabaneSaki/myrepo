export const homeApiScript = String.raw`
const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;
const UPLOAD_SIZE_ERROR = '文件过大，最大 10MB';

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
    throw new Error(resolveApiErrorMessage(response.status, rawText, data, '请求失败(' + response.status + ')'));
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
    params.set('tag', baseTag);
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

async function fetchInstalledProjectDetails() {
  const installedProjectIds = Array.from(new Set(
    state.tavern.installedProjects
      .map(project => project.projectId || project.id)
      .filter(Boolean),
  ));
  if (!installedProjectIds.length) {
    mergeInstalledRemoteProjects([]);
    return [];
  }

  const loadedProjectIds = new Set(state.projects.map(project => project.id));
  const missingProjectIds = installedProjectIds.filter(projectId => !loadedProjectIds.has(projectId));
  if (!missingProjectIds.length) return [];

  const results = await Promise.allSettled(
    missingProjectIds.map(async projectId => {
      const detail = await fetchProjectEntries(projectId);
      return detail?.project?.id ? detail.project : null;
    }),
  );
  const remoteProjects = results
    .filter(result => result.status === 'fulfilled' && result.value)
    .map(result => result.value);
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

async function fetchPendingProjects() {
  return apiFetch('/api/admin/pending?page=0&pageSize=50');
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



