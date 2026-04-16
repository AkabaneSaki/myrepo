export const homeApiScript = String.raw`
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
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setCurrentUser(null);
    renderApp();
    throw new Error('登录已过期');
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
      return data.user;
    }
  } catch (error) {}

  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  setCurrentUser(null);
  return null;
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
      total: data.total,
      append,
    });

    syncProjectStats(state.projects);

    if (state.currentUser) {
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
    renderApp();
  } catch (error) {
    showToast('操作失败: ' + error.message, 'error');
  }
}

async function toggleSubscribe(projectId) {
  if (!state.currentUser) {
    showToast('请先登录', 'warning');
    return;
  }
  try {
    const data = await apiFetch('/api/projects/' + projectId + '/subscribe', { method: 'POST' });
    updateSubscribeState(projectId, { subscribed: data.subscribed, count: data.count });
    renderApp();
  } catch (error) {
    showToast('操作失败: ' + error.message, 'error');
  }
}

async function fetchProjectEntries(projectOrId) {
  try {
    const projectId = typeof projectOrId === 'string' ? projectOrId : projectOrId?.id;
    const detail = await apiFetch('/api/projects/' + projectId);
    const project = detail.project || projectOrId;
    const entries = Array.isArray(detail.worldbookEntriesPreview) ? detail.worldbookEntriesPreview : [];
    const regexEntries = Array.isArray(detail.regexEntriesPreview) ? detail.regexEntriesPreview : [];
    return { project, entries, regexEntries };
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
  return apiFetch('/api/projects/' + projectId, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

async function updateProjectVisibility(projectId, visibility) {
  return apiFetch('/api/projects/' + projectId + '/visibility', {
    method: 'PUT',
    body: JSON.stringify({ visibility }),
  });
}

async function deleteProject(projectId) {
  return apiFetch('/api/projects/' + projectId, { method: 'DELETE' });
}

async function uploadProjectFile(projectId, file) {
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
    return data || {};
  } catch (error) {
    throw normalizeThrownError(error, '上传失败');
  }
}

async function uploadRegexFile(projectId, file) {
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
    return data || {};
  } catch (error) {
    throw normalizeThrownError(error, '上传失败');
  }
}

async function uploadCoverFile(projectId, file) {
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
    return data || {};
  } catch (error) {
    throw normalizeThrownError(error, '上传失败');
  }
}

async function fetchPendingProjects() {
  return apiFetch('/api/admin/pending?page=0&pageSize=50');
}

async function reviewProject(projectId, payload) {
  return apiFetch('/api/admin/review/' + projectId, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
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
`;
