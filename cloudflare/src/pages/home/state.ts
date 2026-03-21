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

function setMyProjects(projects) {
  state.myProjects = Array.isArray(projects) ? projects : [];
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

function setInstalledProjects(projects) {
  const list = Array.isArray(projects) ? projects : [];
  state.tavern.installedProjects = list;
  state.tavern.localProjectMap = new Map(
    list.map(project => [project.projectId || project.id, {
      installed: true,
      projectId: project.projectId || project.id,
      remoteVersion: project.remoteVersion || null,
      localVersion: project.localVersion || null,
      entryCount: Number(project.entryCount || 0),
      regexCount: Number(project.regexCount || 0),
      name: project.name || '',
      canUpdate: Boolean(project.canUpdate),
      hasUpdate: Boolean(project.hasUpdate),
    }]),
  );
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

function sortProjects(projects) {
  const list = Array.isArray(projects) ? [...projects] : [];
  const compareNumberDesc = (left, right) => right - left;
  const compareDateDesc = (left, right) => {
    const leftTime = left ? new Date(left).getTime() : 0;
    const rightTime = right ? new Date(right).getTime() : 0;
    return compareNumberDesc(Number.isNaN(leftTime) ? 0 : leftTime, Number.isNaN(rightTime) ? 0 : rightTime);
  };

  list.sort((a, b) => {
    if (state.sortMode === 'likes') {
      return compareNumberDesc(Number(a.likesCount || 0), Number(b.likesCount || 0)) || compareDateDesc(a.createdAt, b.createdAt);
    }
    if (state.sortMode === 'subscribes') {
      return compareNumberDesc(Number(a.subscribesCount || 0), Number(b.subscribesCount || 0)) || compareDateDesc(a.createdAt, b.createdAt);
    }
    if (state.sortMode === 'downloads') {
      return compareNumberDesc(Number(a.downloadsCount || 0), Number(b.downloadsCount || 0)) || compareDateDesc(a.createdAt, b.createdAt);
    }
    if (state.sortMode === 'updated') {
      return compareDateDesc(a.updatedAt, b.updatedAt) || compareDateDesc(a.createdAt, b.createdAt);
    }
    return compareDateDesc(a.createdAt, b.createdAt) || compareDateDesc(a.updatedAt, b.updatedAt);
  });

  return list;
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

  return sortProjects(filteredSource);
}
`;
