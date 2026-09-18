export const homeStateScript = String.raw`
const API_BASE = '';
const TOKEN_KEY = 'creative_workshop_token';
const USER_KEY = 'creative_workshop_user';
const DEFAULT_SORT_MODE = 'discover';
const CONTENT_FONT_KEY = 'creative_workshop_content_font_v1';
const DEFAULT_CONTENT_FONT = 'noto-sans';
const CONTENT_FONT_OPTIONS = [
  { value: 'wenkai', label: '霞鹜文楷', family: '\"LXGW WenKai Lite\", \"Microsoft YaHei\", sans-serif', stylesheets: [] },
  { value: 'system', label: '系统字体', family: '-apple-system, BlinkMacSystemFont, \"Segoe UI\", \"Microsoft YaHei\", sans-serif', stylesheets: [] },
  { value: 'noto-sans', label: 'Noto 黑体', family: '\"Noto Sans SC\", \"Microsoft YaHei\", sans-serif', stylesheets: ['https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.0/400.css', 'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.0/500.css', 'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-sc@5.3.0/700.css'] },
  { value: 'noto-serif', label: 'Noto 宋体', family: '\"Noto Serif SC\", \"Songti SC\", SimSun, serif', stylesheets: ['https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.3.0/400.css', 'https://cdn.jsdelivr.net/npm/@fontsource/noto-serif-sc@5.3.0/700.css'] },
  { value: 'zcool-xiaowei', label: '站酷小薇', family: '\"ZCOOL XiaoWei\", \"Songti SC\", SimSun, serif', stylesheets: ['https://cdn.jsdelivr.net/npm/@fontsource/zcool-xiaowei@5.3.0/400.css'] },
  { value: 'ma-shan-zheng', label: '马善政毛笔', family: '\"Ma Shan Zheng\", \"KaiTi\", cursive', stylesheets: ['https://cdn.jsdelivr.net/npm/@fontsource/ma-shan-zheng@5.3.0/400.css'] },
];

function readSavedContentFont() {
  try {
    const saved = DEFAULT_CONTENT_FONT;
    return CONTENT_FONT_OPTIONS.some(option => option.value === saved) ? saved : DEFAULT_CONTENT_FONT;
  } catch {
    return DEFAULT_CONTENT_FONT;
  }
}

function getContentFontOption(value) {
  return CONTENT_FONT_OPTIONS.find(option => option.value === value)
    || CONTENT_FONT_OPTIONS.find(option => option.value === DEFAULT_CONTENT_FONT)
    || CONTENT_FONT_OPTIONS[0];
}

function ensureContentFontAssets(option) {
  (option?.stylesheets || []).forEach(href => {
    if (document.querySelector('link[data-workshop-font-href="' + href + '"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.workshopFontHref = href;
    document.head.appendChild(link);
  });
}

function applyContentFont(value, persist = false) {
  const option = getContentFontOption(value || state.contentFont);
  state.contentFont = option.value;
  ensureContentFontAssets(option);
  document.documentElement.style.setProperty('--workshop-content-font', option.family);
  if (persist) {
    try {
      localStorage.setItem(CONTENT_FONT_KEY, option.value);
    } catch {}
  }
  return option;
}

function createDefaultTavernState() {
  return {
    connected: false,
    status: 'disconnected',
    clientVersion: null,
    clientVersionResolved: false,
    installedProjects: [],
    installedProjectsLoaded: false,
    localProjectMap: new Map(),
    installedRemoteProjectMap: new Map(),
    installedProjectRebindCandidates: new Map(),
    installedProjectRebindMap: new Map(),
    updateDiffMap: new Map(),
    pendingProjectActions: new Map(),
    worldbooks: { primary: null, additional: [], available: [] },
  };
}

function createDefaultProjectPagination() {
  return {
    page: 0,
    pageSize: 50,
    hasMore: false,
    loadingMore: false,
  };
}

const state = {
  currentUser: null,
  projects: [],
  myProjects: [],
  discoverShelves: {
    discover: [],
    published: [],
    rating: [],
    downloads: [],
    loading: false,
  },
  discoverBanner: {
    imageUrl: '/discover-preview-banner.png',
    positionX: 50,
    positionY: 50,
    zoom: 1,
    mobilePositionX: 50,
    mobilePositionY: 50,
    mobileZoom: 1,
  },
  viewMode: 'discover',
  showOnlyMyProjects: false,
  showSubscribedAndInstalledProjects: false,
  sortMode: DEFAULT_SORT_MODE,
  activeBaseTag: 'all',
  activeTags: [],
  searchDraft: '',
  mobileToolMode: '',
  searchKeyword: '',
  userMenuOpen: false,
  sortMenuOpen: false,
  fontMenuOpen: false,
  contentFont: readSavedContentFont(),
  sortRequestPending: false,
  filterRequestPending: false,
  projectRequestToken: 0,
  likesMap: new Map(),
  subsMap: new Map(),
  subscriptionsLoaded: false,
  projectPagination: createDefaultProjectPagination(),
  tavern: createDefaultTavernState(),
  updateModal: {
    open: false,
    projectId: null,
    loading: false,
  },
};

function isDiscoverHomeView() {
  return state.viewMode === 'discover'
    && !state.showOnlyMyProjects
    && !state.showSubscribedAndInstalledProjects
    && state.activeBaseTag === 'all'
    && !String(state.searchKeyword || '').trim()
    && getActivePublicTags().length === 0;
}

function setCurrentUser(user) {
  const previousUserId = state.currentUser?.id || null;
  const nextUser = user || null;
  const nextUserId = nextUser?.id || null;
  state.currentUser = nextUser;
  if (previousUserId !== nextUserId) {
    
    state.subsMap = new Map();
    state.subscriptionsLoaded = false;
  }
}

function setDiscoverBanner(banner) {
  state.discoverBanner = {
    ...state.discoverBanner,
    ...(banner && typeof banner === 'object' ? banner : {}),
  };
}

function setProjects(projects) {
  state.projects = Array.isArray(projects) ? projects : [];
  if (state.tavern.installedProjectsLoaded) {
    rebuildInstalledProjectState(new Map(state.tavern.installedProjects.map(project => [project.projectId || project.id, project])));
  }
}

function setDiscoverShelves(payload = {}) {
  state.discoverShelves = {
    discover: Array.isArray(payload.discover) ? payload.discover : [],
    published: Array.isArray(payload.published) ? payload.published : [],
    rating: Array.isArray(payload.rating) ? payload.rating : [],
    downloads: Array.isArray(payload.downloads) ? payload.downloads : [],
    loading: Boolean(payload.loading),
  };
  const combined = [
    ...state.discoverShelves.discover,
    ...state.discoverShelves.published,
    ...state.discoverShelves.rating,
    ...state.discoverShelves.downloads,
  ];
  const uniqueProjects = [];
  const seen = new Set();
  combined.forEach(project => {
    if (!project?.id || seen.has(project.id)) return;
    seen.add(project.id);
    uniqueProjects.push(project);
  });
  setProjects(uniqueProjects);
}

function setProjectsPage(payload) {
  const projects = Array.isArray(payload?.projects) ? payload.projects : [];
  const append = Boolean(payload?.append);
  state.projects = append ? [...state.projects, ...projects] : projects;
  state.projectPagination.page = Number(payload?.page || 0);
  state.projectPagination.pageSize = Number(payload?.pageSize || state.projectPagination.pageSize || 50);
  state.projectPagination.hasMore = Boolean(payload?.hasMore);
  state.projectPagination.loadingMore = false;
  if (state.tavern.installedProjectsLoaded) {
    rebuildInstalledProjectState(new Map(state.tavern.installedProjects.map(project => [project.projectId || project.id, project])));
  }
}

function setMyProjects(projects) {
  state.myProjects = Array.isArray(projects) ? projects : [];
  syncProjectStats(state.myProjects, { replace: false });
}

function resetProjectPagination() {
  state.projectPagination = createDefaultProjectPagination();
}

function getActivePublicBaseTag() {
  if (state.showOnlyMyProjects || state.showSubscribedAndInstalledProjects) {
    return 'all';
  }
  return state.activeBaseTag || 'all';
}

function getActivePublicTags() {
  if (state.showOnlyMyProjects || state.showSubscribedAndInstalledProjects) {
    return [];
  }
  return Array.from(new Set((Array.isArray(state.activeTags) ? state.activeTags : [])
    .map(value => String(value || '').trim())
    .filter(Boolean))).slice(0, 12);
}

function createProjectRequestToken() {
  state.projectRequestToken += 1;
  return state.projectRequestToken;
}

function isLatestProjectRequestToken(token) {
  return token === state.projectRequestToken;
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

function syncProjectStats(projects, options = {}) {
  if (options.replace !== false) state.likesMap = new Map();
  
  (projects || []).forEach(project => {
    state.likesMap.set(project.id, {
      count: project.likesCount || 0,
      liked: Boolean(project.userLiked),
    });
    if (project.userSubscribed) state.subsMap.set(project.id, {
      count: project.subscribesCount || 0,
      subscribed: Boolean(project.userSubscribed),
    });
  });
}

function setSubscribedProjectIds(projectIds) {
  const nextMap = new Map();
  (projectIds || []).forEach(projectId => {
    if (!projectId) return;
    nextMap.set(String(projectId), { count: 0, subscribed: true });
  });
  state.subsMap = nextMap;
  state.subscriptionsLoaded = true;
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
  if (!state.tavern.connected) state.tavern.installedProjectsLoaded = false;
}

function setTavernClientVersion(version) {
  state.tavern.clientVersionResolved = true;
  state.tavern.clientVersion = typeof version === 'string' && version.trim() ? version.trim() : null;
}

function normalizeInstalledProject(project) {
  if (!project || typeof project !== 'object') return null;
  const projectId = project.projectId || project.id;
  if (!projectId) return null;
  const installedProjectId = project.installedProjectId || project.projectId || project.id || projectId;
  return {
    ...project,
    installed: true,
    projectId,
    installedProjectId,
    projectNameHint: typeof project.projectNameHint === 'string' && project.projectNameHint.trim()
      ? project.projectNameHint.trim()
      : null,
    remoteVersion: project.remoteVersion || null,
    localVersion: project.localVersion || null,
    entryCount: Number(project.entryCount || 0),
    regexCount: Number(project.regexCount || 0),
    name: project.name || '',
    legacyProjectName: typeof project.legacyProjectName === 'string' && project.legacyProjectName.trim()
      ? project.legacyProjectName.trim()
      : null,
    canUpdate: Boolean(project.canUpdate),
    hasUpdate: Boolean(project.hasUpdate),
    worldbookName: project.worldbookName || null,
  };
}

function resolveInstalledProjectIdentity(project) {
  if (!project) return project;
  const installedProjectId = String(project.installedProjectId || project.projectId || '').trim();
  if (!installedProjectId) return project;
  const reboundProjectId = state.tavern.installedProjectRebindMap.get(installedProjectId);
  if (!reboundProjectId || reboundProjectId === project.projectId) return project;
  const remoteProject = state.tavern.installedRemoteProjectMap.get(reboundProjectId)
    || state.projects.find(item => item?.id === reboundProjectId);
  return {
    ...project,
    projectId: reboundProjectId,
    name: remoteProject?.name || project.name,
  };
}

function getLegacyInstalledProjectMatches(project) {
  const projectName = String(project?.name || '').trim();
  if (!projectName) return [];
  return state.tavern.installedProjects.filter(localProject => {
    const hint = String(localProject?.projectNameHint || localProject?.legacyProjectName || '').trim();
    return hint === projectName && localProject.projectId !== project?.id;
  });
}

function setInstalledProjectRebindCandidates(installedProjectId, projects) {
  const key = String(installedProjectId || '').trim();
  if (!key) return;
  const list = Array.isArray(projects) ? projects.filter(project => project?.id) : [];
  if (list.length) state.tavern.installedProjectRebindCandidates.set(key, list);
  else state.tavern.installedProjectRebindCandidates.delete(key);
}

function getInstalledProjectRebindCandidate(projectId) {
  const localProject = getLocalProjectMeta(projectId)
    || state.tavern.installedProjects.find(project => project?.installedProjectId === projectId || project?.projectId === projectId);
  const installedProjectId = String(localProject?.installedProjectId || projectId || '').trim();
  if (!installedProjectId) return null;
  const projects = state.tavern.installedProjectRebindCandidates.get(installedProjectId) || [];
  return projects.length ? { installedProjectId, projects } : null;
}

function confirmInstalledProjectRebind(installedProjectId, remoteProject) {
  const sourceId = String(installedProjectId || '').trim();
  const targetId = String(remoteProject?.id || '').trim();
  if (!sourceId || !targetId || sourceId === targetId) return false;
  const localProject = state.tavern.installedProjects.find(project =>
    String(project?.installedProjectId || project?.projectId || '') === sourceId,
  );
  if (!localProject) return false;
  const candidates = state.tavern.installedProjectRebindCandidates.get(sourceId) || [];
  if (!candidates.some(project => project?.id === targetId)) return false;
  state.tavern.installedProjectRebindMap.set(sourceId, targetId);
  state.tavern.installedRemoteProjectMap.set(targetId, remoteProject);
  state.tavern.installedProjectRebindCandidates.delete(sourceId);
  rebuildInstalledProjectState(new Map(
    state.tavern.installedProjects.map(project => [project.installedProjectId || project.projectId || project.id, project]),
  ));
  return true;
}

function rebuildInstalledProjectState(installedProjectMap) {
  const resolvedProjectMap = new Map();
  Array.from(installedProjectMap.values()).forEach(rawProject => {
    const project = resolveInstalledProjectIdentity(normalizeInstalledProject(rawProject));
    if (!project?.projectId) return;
    const existing = resolvedProjectMap.get(project.projectId);
    if (!existing) {
      resolvedProjectMap.set(project.projectId, project);
      return;
    }
    resolvedProjectMap.set(project.projectId, {
      ...existing,
      ...project,
      legacyProjectName: existing.legacyProjectName || project.legacyProjectName || null,
      localVersion: project.localVersion || existing.localVersion || null,
      worldbookName: project.worldbookName || existing.worldbookName || null,
      entryCount: Math.max(Number(existing.entryCount || 0), Number(project.entryCount || 0)),
      regexCount: Math.max(Number(existing.regexCount || 0), Number(project.regexCount || 0)),
    });
  });
  const list = Array.from(resolvedProjectMap.values());
  state.tavern.installedProjects = list;
  state.tavern.localProjectMap = new Map(list.map(project => [project.projectId, project]));
  const installedIds = new Set(list.map(project => project.projectId).filter(Boolean));
  const installedSourceIds = new Set(list.map(project => project.installedProjectId || project.projectId).filter(Boolean));
  state.tavern.installedRemoteProjectMap = new Map(
    Array.from(state.tavern.installedRemoteProjectMap || new Map()).filter(([projectId]) => installedIds.has(projectId)),
  );
  state.tavern.installedProjectRebindCandidates = new Map(
    Array.from(state.tavern.installedProjectRebindCandidates || new Map()).filter(([projectId]) => installedSourceIds.has(projectId)),
  );
  state.tavern.installedProjectRebindMap = new Map(
    Array.from(state.tavern.installedProjectRebindMap || new Map()).filter(([projectId]) => installedSourceIds.has(projectId)),
  );
}

function mergeInstalledRemoteProjects(projects) {
  const installedIds = new Set(state.tavern.installedProjects.map(project => project.projectId || project.id).filter(Boolean));
  const remoteProjectMap = new Map(state.tavern.installedRemoteProjectMap || new Map());
  (Array.isArray(projects) ? projects : []).forEach(project => {
    if (!project?.id || !installedIds.has(project.id)) return;
    remoteProjectMap.set(project.id, project);
  });
  state.tavern.installedRemoteProjectMap = new Map(
    Array.from(remoteProjectMap.entries()).filter(([projectId]) => installedIds.has(projectId)),
  );
}

function setInstalledProjects(projects, options) {
  const list = Array.isArray(projects) ? projects : [];
  state.tavern.installedProjectsLoaded = true;
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
  state.tavern.installedRemoteProjectMap.forEach((remoteProject, projectId) => {
    if (!projectMap.has(projectId)) {
      projectMap.set(projectId, remoteProject);
    }
  });
  state.tavern.installedProjects.forEach(localProject => {
    const projectId = localProject.projectId || localProject.id;
    if (!projectMap.has(projectId)) {
      projectMap.set(projectId, {
        id: projectId,
        name: localProject.name || '本地已安装项目',
        description: localProject.description || '该项目当前仅存在于本地安装记录中',
        version: localProject.localVersion || '未知版本',
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

  const baseTag = getActivePublicBaseTag();
  const baseTagFilteredSource = scopedSource.filter(project => matchProjectBaseTag(project, baseTag));
  const activeTags = getActivePublicTags();
  const tagFilteredSource = activeTags.length
    ? baseTagFilteredSource.filter(project => activeTags.every(tag => getProjectDetailTags(project).includes(tag) || getProjectExtensionType(project) === tag))
    : baseTagFilteredSource;

  const keyword = String(state.searchKeyword || '').trim().toLowerCase();
  const filteredSource = !keyword
    ? tagFilteredSource
    : tagFilteredSource.filter(project => {
        const haystacks = [
          project.name,
          project.description,
          project.authorGlobalName,
          project.authorName,
          getProjectTypeDisplayLabel(project),
          ...getProjectDetailTags(project),
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

  return Boolean(state.projectPagination.hasMore);
}
`;
