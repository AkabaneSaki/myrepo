export const homeStateScript = String.raw`
const API_BASE = '';
const TOKEN_KEY = 'creative_workshop_token';
const USER_KEY = 'creative_workshop_user';
const DEFAULT_SORT_MODE = 'published';

function createDefaultTavernState() {
  return {
    connected: false,
    status: 'disconnected',
    installedProjects: [],
    localProjectMap: new Map(),
    updateDiffMap: new Map(),
    pendingProjectActions: new Map(),
  };
}

function createDefaultProjectPagination() {
  return {
    page: 0,
    pageSize: 50,
    total: 0,
    loadingMore: false,
  };
}

const state = {
  currentUser: null,
  projects: [],
  myProjects: [],
  showOnlyMyProjects: false,
  showSubscribedAndInstalledProjects: false,
  sortMode: DEFAULT_SORT_MODE,
  searchKeyword: '',
  userMenuOpen: false,
  sortMenuOpen: false,
  likesMap: new Map(),
  subsMap: new Map(),
  projectPagination: createDefaultProjectPagination(),
  tavern: createDefaultTavernState(),
  updateModal: {
    open: false,
    projectId: null,
    loading: false,
  },
};

function setCurrentUser(user) {
  state.currentUser = user || null;
}

function setProjects(projects) {
  state.projects = Array.isArray(projects) ? projects : [];
}

function setProjectsPage(payload) {
  const projects = Array.isArray(payload?.projects) ? payload.projects : [];
  const append = Boolean(payload?.append);
  state.projects = append ? [...state.projects, ...projects] : projects;
  state.projectPagination.page = Number(payload?.page || 0);
  state.projectPagination.pageSize = Number(payload?.pageSize || state.projectPagination.pageSize || 50);
  state.projectPagination.total = Number(payload?.total || 0);
  state.projectPagination.loadingMore = false;
}

function setMyProjects(projects) {
  state.myProjects = Array.isArray(projects) ? projects : [];
}

function resetProjectPagination() {
  state.projectPagination = createDefaultProjectPagination();
}

function setProjectPaginationLoadingMore(loading) {
  state.projectPagination.loadingMore = Boolean(loading);
}

function setProjectPendingAction(projectId, action) {
  if (!projectId) return;
  if (action) {
    state.tavern.pendingProjectActions.set(projectId, action);
    return;
  }
  state.tavern.pendingProjectActions.delete(projectId);
}

function getProjectPendingAction(projectId) {
  return state.tavern.pendingProjectActions.get(projectId) || null;
}

function syncProjectStats(projects) {
  state.likesMap = new Map();
  state.subsMap = new Map();
  (projects || []).forEach(project => {
    state.likesMap.set(project.id, {
      count: project.likesCount || 0,
      liked: Boolean(project.userLiked),
    });
    state.subsMap.set(project.id, {
      count: project.subscribesCount || 0,
      subscribed: Boolean(project.userSubscribed),
    });
  });
}

function updateLikeState(projectId, payload) {
  state.likesMap.set(projectId, {
    count: payload?.count || 0,
    liked: Boolean(payload?.liked),
  });
}

function updateSubscribeState(projectId, payload) {
  state.subsMap.set(projectId, {
    count: payload?.count || 0,
    subscribed: Boolean(payload?.subscribed),
  });
}

function setTavernConnectionStatus(status) {
  state.tavern.status = status || 'disconnected';
  state.tavern.connected = status === 'connected';
}

function normalizeInstalledProject(project) {
  if (!project || typeof project !== 'object') return null;
  const projectId = project.projectId || project.id;
  if (!projectId) return null;
  return {
    ...project,
    installed: true,
    projectId,
    remoteVersion: project.remoteVersion || null,
    localVersion: project.localVersion || null,
    entryCount: Number(project.entryCount || 0),
    regexCount: Number(project.regexCount || 0),
    name: project.name || '',
    canUpdate: Boolean(project.canUpdate),
    hasUpdate: Boolean(project.hasUpdate),
  };
}

function rebuildInstalledProjectState(installedProjectMap) {
  const list = Array.from(installedProjectMap.values());
  state.tavern.installedProjects = list;
  state.tavern.localProjectMap = new Map(list.map(project => [project.projectId, project]));
}

function setInstalledProjects(projects, options) {
  const list = Array.isArray(projects) ? projects : [];
  const mode = options && options.mode === 'merge' ? 'merge' : 'replace';
  const removeProjectId = options && options.removeProjectId ? options.removeProjectId : null;
  const installedProjectMap = mode === 'merge'
    ? new Map(state.tavern.installedProjects.map(project => [project.projectId || project.id, normalizeInstalledProject(project)]).filter(entry => entry[0] && entry[1]))
    : new Map();

  list.forEach(project => {
    const normalized = normalizeInstalledProject(project);
    if (!normalized) return;
    installedProjectMap.set(normalized.projectId, normalized);
  });

  if (removeProjectId) {
    installedProjectMap.delete(removeProjectId);
  }

  rebuildInstalledProjectState(new Map(Array.from(installedProjectMap.entries()).filter(entry => Boolean(entry[1]))));
}

function clearInstalledProject(projectId) {
  if (!projectId) return;
  const installedProjectMap = new Map(state.tavern.installedProjects.map(project => [project.projectId || project.id, normalizeInstalledProject(project)]).filter(entry => entry[0] && entry[1]));
  installedProjectMap.delete(projectId);
  rebuildInstalledProjectState(installedProjectMap);
}

function setProjectUpdateDiff(projectId, diff) {
  if (!projectId) return;
  state.tavern.updateDiffMap.set(projectId, diff || null);
}

function getLocalProjectMeta(projectId) {
  return state.tavern.localProjectMap.get(projectId) || null;
}

function getProjectUpdateDiff(projectId) {
  return state.tavern.updateDiffMap.get(projectId) || null;
}

function isSubscribedProject(projectId) {
  const sub = state.subsMap.get(projectId);
  return Boolean(sub?.subscribed);
}

function mergeProjectsForInstalledView(source) {
  const projectMap = new Map((source || []).map(project => [project.id, project]));
  state.tavern.installedProjects.forEach(localProject => {
    const projectId = localProject.projectId || localProject.id;
    if (!projectMap.has(projectId)) {
      projectMap.set(projectId, {
        id: projectId,
        name: localProject.name || '本地已安装项目',
        description: localProject.description || '该项目当前仅存在于本地安装记录中',
        version: localProject.remoteVersion || localProject.localVersion || '未知版本',
        localVersion: localProject.localVersion || null,
        authorId: localProject.authorId || '',
        authorName: localProject.authorName || '本地项目',
        authorGlobalName: localProject.authorGlobalName || localProject.authorName || '本地项目',
        authorAvatar: localProject.authorAvatar || '',
        tags: Array.isArray(localProject.tags) ? localProject.tags : ['本地'],
        coverImage: localProject.coverImage || '',
        likesCount: 0,
        subscribesCount: 0,
        userLiked: false,
        userSubscribed: false,
        createdAt: localProject.createdAt || '',
        updatedAt: localProject.updatedAt || '',
        status: 'approved',
        visibility: true,
        isPublished: true,
        hasPendingDraft: false,
        source: 'local-only',
      });
    }
  });
  return Array.from(projectMap.values());
}

function getFilteredProjects() {
  const source = state.showOnlyMyProjects && state.currentUser
    ? (state.myProjects.length ? state.myProjects : state.projects.filter(project => project.authorId === state.currentUser.id))
    : state.projects;

  const scopedSource = state.showSubscribedAndInstalledProjects
    ? mergeProjectsForInstalledView(source).filter(project => {
        const localMeta = getLocalProjectMeta(project.id);
        if (state.tavern.connected) {
          return Boolean(localMeta) || isSubscribedProject(project.id);
        }
        return isSubscribedProject(project.id);
      })
    : source;

  const keyword = String(state.searchKeyword || '').trim().toLowerCase();
  const filteredSource = !keyword
    ? scopedSource
    : scopedSource.filter(project => {
        const haystacks = [
          project.name,
          project.description,
          project.authorGlobalName,
          project.authorName,
          ...(Array.isArray(project.tags) ? project.tags : []),
        ]
          .filter(Boolean)
          .map(value => String(value).toLowerCase());

        return haystacks.some(value => value.includes(keyword));
      });

  if (state.showOnlyMyProjects || state.showSubscribedAndInstalledProjects) {
    return filteredSource;
  }

  return filteredSource;
}

function shouldShowProjectLoadMore() {
  if (state.showOnlyMyProjects || state.showSubscribedAndInstalledProjects) {
    return false;
  }

  const loadedCount = Array.isArray(state.projects) ? state.projects.length : 0;
  const total = Number(state.projectPagination.total || 0);
  return loadedCount > 0 && total > loadedCount;
}

function getRemainingProjectCount() {
  const total = Number(state.projectPagination.total || 0);
  const loadedCount = Array.isArray(state.projects) ? state.projects.length : 0;
  return Math.max(0, total - loadedCount);
}
`;
