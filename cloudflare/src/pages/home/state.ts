export const homeStateScript = String.raw`
const API_BASE = '';
const TOKEN_KEY = 'creative_workshop_token';
const USER_KEY = 'creative_workshop_user';
const DEFAULT_SORT_MODE = 'discover';
const CONTENT_FONT_KEY = 'creative_workshop_content_font_v1';
const CATALOG_LAYOUT_KEY = 'creative_workshop_catalog_layout_v1';
function readSavedCatalogLayout() {
  try { return localStorage.getItem(CATALOG_LAYOUT_KEY) === 'list' ? 'list' : 'grid'; }
  catch { return 'grid'; }
}
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
    installedProjectsComplete: false,
    unreadableWorldbookNames: [],
    localProjectMap: new Map(),
    installedRemoteProjectMap: new Map(),
    installedProjectRebindCandidates: new Map(),
    installedProjectRebindMap: new Map(),
    updateDiffMap: new Map(),
    pendingProjectActions: new Map(),
    dlcUpdateKnown: false,
    dlcUpdateAvailable: false,
    dlcUpdateCheckedAt: 0,
    dlcUpdateSignature: '',
    dlcUpdateCheckPending: false,
    worldbooks: { primary: null, additional: [], available: [] },
  };
}

function createDefaultProjectPagination() {
  return {
    page: 0,
    pageSize: 48,
    pageSizeLocked: false,
    hasMore: false,
    loadingPage: false,
    publicCounts: null,
  };
}

function createDefaultDailyRandomDrawState() {
  return {
    loaded: false,
    loading: false,
    busy: false,
    count: 0,
    limit: 10,
    remaining: 10,
    drawDay: '',
    resetAt: '',
  };
}

function chooseProjectPageSize() {
  const grid = document.querySelector('.projects-grid');
  const columns = grid
    ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length
    : 4;
  return [50, 49, 48].find(size => size % columns === 0) || 48;
}

const state = {
  currentUser: null,
  projects: [],
  myProjects: [],
  discoverShelves: {
    discover: [],
    published: [],
    updated: [],
    downloads: [],
    likes: [],
    loading: false,
  },
  discoverBanner: {
    imageUrl: null,
    positionX: 50,
    positionY: 50,
    zoom: 1,
    mobilePositionX: 50,
    mobilePositionY: 50,
    mobileZoom: 1,
  },
  editorRecommendations: [],
  editorRecommendationsRequestToken: 0,
  myRecommendedProjectIds: [],
  viewMode: 'discover',
  catalogLayout: readSavedCatalogLayout(),
  showOnlyMyProjects: false,
  showSubscribedAndInstalledProjects: false,
  sortMode: DEFAULT_SORT_MODE,
  periodPopularityReady: { days7: false, days30: false },
  activeBaseTag: 'all',
  activeTags: [],
  searchDraft: '',
  mobileToolMode: '',
  searchKeyword: '',
  minLikes: 0,
  minDownloads: 0,
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
  dailyRandomDraw: createDefaultDailyRandomDrawState(),
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
    state.editorRecommendationsRequestToken += 1;
    state.myRecommendedProjectIds = [];
    state.editorRecommendations.forEach(project => {
      const stats = state.likesMap.get(project.id);
      if (stats) stats.liked = false;
    });
    state.subsMap = new Map();
    state.subscriptionsLoaded = false;
    state.dailyRandomDraw = createDefaultDailyRandomDrawState();
  }
}

function setDiscoverBanner(banner) {
  state.discoverBanner = {
    ...state.discoverBanner,
    ...(banner && typeof banner === 'object' ? banner : {}),
  };
}

function setEditorRecommendations(projects, mine) {
  state.editorRecommendations = Array.isArray(projects) ? projects : [];
  state.myRecommendedProjectIds = Array.isArray(mine) ? mine : [];
}

function getMyDevTeamRecommendation(projectId) {
  return state.currentUser?.isAdmin && state.myRecommendedProjectIds.includes(projectId);
}

function setProjects(projects) {
  state.projects = Array.isArray(projects) ? projects : [];
  if (state.tavern.installedProjectsLoaded) {
    rebuildInstalledProjectState(new Map(state.tavern.installedProjects.map(project => [getInstalledInstanceKey(project), project])));
  }
}

function setDiscoverShelves(payload = {}) {
  state.discoverShelves = {
    discover: Array.isArray(payload.discover) ? payload.discover : [],
    published: Array.isArray(payload.published) ? payload.published : [],
    updated: Array.isArray(payload.updated) ? payload.updated : [],
    downloads: Array.isArray(payload.downloads) ? payload.downloads : [],
    likes: Array.isArray(payload.likes) ? payload.likes : [],
    loading: Boolean(payload.loading),
  };
  const combined = [
    ...state.discoverShelves.discover,
    ...state.discoverShelves.published,
    ...state.discoverShelves.updated,
    ...state.discoverShelves.downloads,
    ...state.discoverShelves.likes,
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
  state.projects = projects;
  state.projectPagination.page = Number(payload?.page || 0);
  state.projectPagination.pageSize = Number(payload?.pageSize || state.projectPagination.pageSize || 48);
  state.projectPagination.pageSizeLocked = true;
  state.projectPagination.hasMore = Boolean(payload?.hasMore);
  state.projectPagination.publicCounts = payload?.publicCounts || state.projectPagination.publicCounts;
  state.periodPopularityReady = {
    days7: payload?.periodPopularityReady?.days7 === true,
    days30: payload?.periodPopularityReady?.days30 === true,
  };
  state.projectPagination.loadingPage = false;
  if (state.tavern.installedProjectsLoaded) {
    rebuildInstalledProjectState(new Map(state.tavern.installedProjects.map(project => [getInstalledInstanceKey(project), project])));
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

function setProjectPageLoading(loading) {
  state.projectPagination.loadingPage = Boolean(loading);
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
  if (options.replace !== false) {
    const editorProjectIds = new Set(state.editorRecommendations.map(project => project.id));
    state.likesMap = new Map([...state.likesMap].filter(([projectId]) => editorProjectIds.has(projectId)));
  }
  
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
  if (!state.tavern.connected) {
    state.tavern.installedProjectsLoaded = false;
    state.tavern.installedProjectsComplete = false;
    state.tavern.unreadableWorldbookNames = [];
  }
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
    installKey: project.installKey || JSON.stringify([installedProjectId, project.worldbookName || null]),
    mixedVersions: Boolean(project.mixedVersions),
    regexVersionMismatch: Boolean(project.regexVersionMismatch),
    worldbookBound: project.worldbookBound !== false,
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
    state.tavern.installedProjects.map(project => [getInstalledInstanceKey(project), project]),
  ));
  return true;
}

function getInstalledInstanceKey(project) {
  if (!project) return '';
  return String(project.installKey || JSON.stringify([
    project.installedProjectId || project.projectId || project.id,
    project.worldbookName || null,
  ]));
}

function getLocalProjectInstallations(projectId) {
  return state.tavern.installedProjects.filter(project => project.projectId === projectId);
}

function rebuildInstalledProjectState(installedProjectMap) {
  const byInstance = new Map();
  Array.from(installedProjectMap.values()).forEach(rawProject => {
    const project = resolveInstalledProjectIdentity(normalizeInstalledProject(rawProject));
    if (project?.projectId) byInstance.set(getInstalledInstanceKey(project), project);
  });
  const list = Array.from(byInstance.values());
  state.tavern.installedProjects = list;
  const byProject = new Map();
  list.forEach(project => {
    const previous = byProject.get(project.projectId);
    if (!previous) {
      byProject.set(project.projectId, project);
    } else {
      byProject.set(project.projectId, {
        ...previous,
        localVersion: previous.localVersion === project.localVersion ? previous.localVersion : null,
        worldbookName: null,
        mixedVersions: previous.mixedVersions || project.mixedVersions ||
          previous.localVersion !== project.localVersion,
        entryCount: previous.entryCount + project.entryCount,
        regexCount: Math.max(previous.regexCount, project.regexCount),
      });
    }
  });
  state.tavern.localProjectMap = byProject;
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
  state.tavern.installedProjectsComplete = options?.complete !== false;
  state.tavern.unreadableWorldbookNames = Array.isArray(options?.unreadableWorldbookNames)
    ? options.unreadableWorldbookNames.map(String).filter(Boolean)
    : [];
  const mode = options && options.mode === 'merge' ? 'merge' : 'replace';
  const removeProjectId = options && options.removeProjectId ? options.removeProjectId : null;
  const installedProjectMap = mode === 'merge'
    ? new Map(state.tavern.installedProjects.map(project => [getInstalledInstanceKey(project), normalizeInstalledProject(project)]).filter(entry => entry[0] && entry[1]))
    : new Map();

  list.forEach(project => {
    const normalized = normalizeInstalledProject(project);
    if (!normalized) return;
    installedProjectMap.set(getInstalledInstanceKey(normalized), normalized);
  });

  if (removeProjectId) {
    for (const [key, project] of installedProjectMap) {
      if (project.projectId === removeProjectId) installedProjectMap.delete(key);
    }
  }

  rebuildInstalledProjectState(new Map(Array.from(installedProjectMap.entries()).filter(entry => Boolean(entry[1]))));
}

function clearInstalledProject(projectId) {
  if (!projectId) return;
  const installedProjectMap = new Map(state.tavern.installedProjects.map(project => [getInstalledInstanceKey(project), normalizeInstalledProject(project)]).filter(entry => entry[0] && entry[1]));
  for (const [key, project] of installedProjectMap) {
    if (project.projectId === projectId) installedProjectMap.delete(key);
  }
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
      }).flatMap(project => {
        const installations = getLocalProjectInstallations(project.id);
        return installations.length
          ? installations.map(instance => ({ ...project, __installedInstance: instance }))
          : [project];
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

function shouldShowProjectPagination() {
  if (state.showOnlyMyProjects || state.showSubscribedAndInstalledProjects) {
    return false;
  }
  return state.viewMode === 'catalog';
}

function renderProjectPagination() {
  if (!shouldShowProjectPagination()) return '';
  const pagination = state.projectPagination;
  const counts = pagination.publicCounts;
  const filtered = Boolean(String(state.searchKeyword || '').trim()
    || getActivePublicTags().length || state.minLikes || state.minDownloads);
  const type = state.activeBaseTag;
  const scopedTotal = counts ? (type === 'all' ? counts.total : Number(counts.byType?.[type] || 0)) : 0;
  const pageCount = !filtered && counts ? Math.ceil(scopedTotal / pagination.pageSize) : null;
  const lastVisiblePage = pageCount === null
    ? pagination.page + (pagination.hasMore ? 1 : 0)
    : Math.max(0, Math.min(19, pageCount - 1));
  const firstNumber = Math.max(0, pagination.page - 2);
  const lastNumber = Math.min(lastVisiblePage, pagination.page + 4);
  const numbered = [];
  for (let page = firstNumber; page <= lastNumber; page++) {
    numbered.push('<button type="button" class="project-page-number' + (page === pagination.page ? ' active' : '')
      + '" data-project-page="' + page + '"' + (page === pagination.page || pagination.loadingPage ? ' disabled' : '')
      + ' aria-label="第 ' + (page + 1) + ' 页">' + (page + 1) + '</button>');
  }
  const byType = counts?.byType || {};
  const countText = counts
    ? '公开项目 ' + counts.total + ' · 角色 ' + Number(byType['角色'] || 0)
      + ' · 系统核心 ' + Number(byType['系统核心'] || 0)
      + ' · 扩展 ' + Number(byType['扩展'] || 0)
      + ' · 事件 ' + Number(byType['事件'] || 0)
    : '正在加载项目数量';
  const morePages = pageCount !== null && pageCount > 20
    ? '<small>更多作品可以用搜索查找</small>' : '';
  return '<div class="project-pagination"><div class="project-pagination-summary">' + countText + morePages + '</div>'
    + '<nav class="project-pagination-controls" aria-label="项目页码">'
    + '<button type="button" data-project-page="' + (pagination.page - 1) + '"'
    + (pagination.page === 0 || pagination.loadingPage ? ' disabled' : '') + '>上一页</button>'
    + (firstNumber > 0 ? '<span aria-hidden="true">…</span>' : '') + numbered.join('')
    + (lastNumber < lastVisiblePage ? '<span aria-hidden="true">…</span>' : '')
    + '<button type="button" data-project-page="' + (pagination.page + 1) + '"'
    + (!pagination.hasMore || pagination.loadingPage ? ' disabled' : '') + '>下一页</button>'
    + '</nav></div>';
}
`;
