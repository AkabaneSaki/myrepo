export const homeApiScript = String.raw`
async function apiFetch(endpoint, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) {
    headers.Authorization = 'Bearer ' + token;
  }

  const response = await fetch(API_BASE + endpoint, { ...options, headers });
  if (response.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setCurrentUser(null);
    renderApp();
    throw new Error('登录已过期');
  }

  const rawText = await response.text();
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const fallbackMessage = rawText && rawText.trim() ? rawText.slice(0, 300) : ('请求失败(' + response.status + ')');
    throw new Error((data && (data.error || data.message)) || fallbackMessage);
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

async function fetchProjects(forceRefresh = false) {
  try {
    const cacheBust = forceRefresh ? ('&_=' + Date.now()) : '';
    const data = await apiFetch('/api/projects?page=0&pageSize=50' + cacheBust);
    const projectList = data.projects || [];
    setProjects(projectList);
    syncProjectStats(projectList);
    if (state.currentUser) {
      const myData = await apiFetch('/api/my/projects');
      setMyProjects(myData.projects || []);
    } else {
      setMyProjects([]);
    }
  } catch (error) {
    setProjects([]);
    setMyProjects([]);
    syncProjectStats([]);
    showToast('加载项目失败: ' + error.message, 'error');
  }
  renderApp();
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
    return { project: typeof projectOrId === 'string' ? null : projectOrId, entries: [], regexEntries: [] };
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
  const response = await fetch('/api/projects/' + projectId + '/upload', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY),
      'Content-Type': file.type,
    },
    body: file,
  });
  const rawText = await response.text();
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }
  if (!response.ok) throw new Error((data && (data.error || data.message)) || rawText || '上传失败');
  return data || {};
}

async function uploadRegexFile(projectId, file) {
  const response = await fetch('/api/projects/' + projectId + '/upload-regex', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY),
      'Content-Type': file.type,
    },
    body: file,
  });
  const rawText = await response.text();
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }
  if (!response.ok) throw new Error((data && (data.error || data.message)) || rawText || '上传失败');
  return data || {};
}

async function uploadCoverFile(projectId, file) {
  const formData = new FormData();
  formData.append('cover', file);
  const response = await fetch('/api/projects/' + projectId + '/upload-cover', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY),
    },
    body: formData,
  });
  const rawText = await response.text();
  let data = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = null;
  }
  if (!response.ok) throw new Error((data && (data.error || data.message)) || rawText || '上传失败');
  return data || {};
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
