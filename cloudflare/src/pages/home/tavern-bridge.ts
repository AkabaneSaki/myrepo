export const homeTavernBridgeScript = String.raw`
const TAVERN_BRIDGE_NAMESPACE = 'creative-workshop-bridge';
const TAVERN_OAUTH_RESULT_EVENT = 'creative-workshop:oauth-result';
const PROJECT_DIFF_TIMEOUT_MS = 10000;
const REPAIR_REQUEST_TIMEOUT_MS = 60000;
const pendingProjectDiffRequests = new Map();
const pendingRepairRequests = new Map();
const SCRIPT_DEPENDENCY_REGISTRY = new Map(
  (WORKSHOP_CONFIG.scriptDependencies || []).map(item => [
    String(item.key || ''),
    { name: String(item.displayName || item.key || '脚本'), latestVersion: String(item.latestVersion || '') },
  ]),
);

state.tavern.scriptDependenciesSupported = false;
state.tavern.scriptDependenciesLoaded = false;
state.tavern.scriptDependencies = [];

function createBridgeRequest(type, payload) {
  return {
    namespace: TAVERN_BRIDGE_NAMESPACE,
    type,
    requestId: crypto.randomUUID(),
    payload: payload || {},
  };
}

function postBridgeMessage(type, payload) {
  const message = createBridgeRequest(type, payload);
  window.parent.postMessage(message, '*');
  return message.requestId;
}

function settleProjectDiffRequest(requestId, error, diff) {
  if (!requestId) return false;
  const pending = pendingProjectDiffRequests.get(requestId);
  if (!pending) return false;
  clearTimeout(pending.timeoutId);
  pendingProjectDiffRequests.delete(requestId);
  if (error) {
    pending.reject(error);
    return true;
  }
  pending.resolve(diff);
  return true;
}

function settleRepairRequest(requestId, error, payload) {
  if (!requestId) return false;
  const pending = pendingRepairRequests.get(requestId);
  if (!pending) return false;
  clearTimeout(pending.timeoutId);
  pendingRepairRequests.delete(requestId);
  if (error) pending.reject(error);
  else pending.resolve(payload || {});
  return true;
}

function dispatchOAuthResult(payload) {
  window.dispatchEvent(new CustomEvent(TAVERN_OAUTH_RESULT_EVENT, {
    detail: payload || {},
  }));
}

function syncInstalledProjectsFromBridge(payload, options) {
  const installedProjects = Array.isArray(payload?.projects) ? payload.projects : [];
  const syncMode = payload?.complete === false ? 'merge' : ((options && options.mode) || 'replace');
  setInstalledProjects(installedProjects, {
    mode: syncMode,
    removeProjectId: options && options.removeProjectId ? options.removeProjectId : null,
    complete: payload?.complete !== false,
    unreadableWorldbookNames: Array.isArray(payload?.unreadableWorldbookNames) ? payload.unreadableWorldbookNames : [],
  });
  if (payload?.complete === false) {
    showToast(
      '有些世界书暂时读不到，未确认项目的安装按钮已暂停。请稍后重开工坊再试。',
      'error',
    );
  }
  renderApp();
  scheduleDlcUpdateStatusCheck();
}

function normalizeScriptDependencyVersion(version) {
  const match = String(version || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) return null;
  return match.slice(1, 4).map(Number);
}

function compareScriptDependencyVersions(left, right) {
  const leftParts = normalizeScriptDependencyVersion(left);
  const rightParts = normalizeScriptDependencyVersion(right);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] < rightParts[index]) return -1;
    if (leftParts[index] > rightParts[index]) return 1;
  }
  return 0;
}

function syncScriptDependenciesFromBridge(payload) {
  state.tavern.scriptDependenciesSupported = Boolean(payload?.supported);
  state.tavern.scriptDependenciesLoaded = true;
  state.tavern.scriptDependencies = Array.isArray(payload?.scripts) ? payload.scripts : [];
  renderApp();
}

function getScriptDependencyHealthItems() {
  const items = [];
  const scripts = Array.isArray(state.tavern.scriptDependencies) ? state.tavern.scriptDependencies : [];
  scripts.forEach(script => {
    const dependencies = Array.isArray(script?.dependencies) ? script.dependencies : [];
    dependencies.forEach(dependency => {
      const registryEntry = SCRIPT_DEPENDENCY_REGISTRY.get(String(dependency?.repository || ''));
      if (!registryEntry) return;

      let status = 'unknown';
      if (dependency?.refKind === 'semver' && dependency?.installedVersion) {
        const comparison = compareScriptDependencyVersions(dependency.installedVersion, registryEntry.latestVersion);
        if (comparison === -1) status = 'outdated';
        else if (comparison === 0) status = 'current';
        else if (comparison === 1) status = 'ahead';
      } else if (dependency?.refKind === 'floating') {
        status = 'floating';
      } else if (dependency?.refKind === 'commit' || dependency?.refKind === 'other-ref') {
        status = 'pinned-unknown';
      }

      items.push({
        ...dependency,
        scriptName: script?.scriptName || dependency?.scriptName || registryEntry.name,
        dependencyName: registryEntry.name,
        latestVersion: registryEntry.latestVersion,
        status,
      });
    });
  });
  return items;
}

function getScriptDependencyHealthSummary() {
  const items = getScriptDependencyHealthItems();
  return {
    items,
    outdated: items.filter(item => item.status === 'outdated'),
    uncertain: items.filter(item => item.status === 'floating' || item.status === 'pinned-unknown' || item.status === 'unknown'),
  };
}

function handleInstallResult(payload) {
  syncInstalledProjectsFromBridge(payload, { mode: 'merge' });
  showToast('项目安装完成');
}

function handleUninstallResult(payload) {
  const projectId = payload?.projectId || null;
  if (Array.isArray(payload?.projects) && payload.projects.length > 0) {
    syncInstalledProjectsFromBridge(payload, { mode: 'merge', removeProjectId: projectId });
  } else {
    clearInstalledProject(projectId);
    renderApp();
  }
  showToast('项目已卸载');
}

function handleUpdateResult(payload) {
  syncInstalledProjectsFromBridge(payload, { mode: 'merge' });
  showToast('项目更新完成');
}

function syncContextFromBridge(payload) {
  setTavernConnectionStatus(payload?.connected ? 'connected' : 'error');
  state.tavern.worldbooks = {
    primary: payload?.worldbooks?.primary || null,
    additional: Array.isArray(payload?.worldbooks?.additional) ? payload.worldbooks.additional : [],
    available: Array.isArray(payload?.worldbooks?.available) ? payload.worldbooks.available : [],
  };
  renderApp();
}

function syncDiffFromBridge(payload) {
  if (payload?.projectId) {
    const diff = payload.diff || payload;
    setProjectUpdateDiff(payload.projectId, diff);
    return diff;
  }
}

function handleBridgeMessage(event) {
  const data = event.data;
  if (!data || data.namespace !== TAVERN_BRIDGE_NAMESPACE || !data.type) {
    return;
  }

  const projectId = data.payload?.projectId || null;

  switch (data.type) {
    case 'bridge:handshake:ok':
      setTavernConnectionStatus('connected');
      setTavernClientVersion(data.payload?.clientVersion);
      renderApp();
      if (shouldShowWorkshopReleaseNotice(WORKSHOP_MINIMUM_CLIENT_VERSION)) {
        openReleaseNoticeModal();
      }
      break;
    case 'bridge:context':
      syncContextFromBridge(data.payload || {});
      break;
    case 'bridge:script-dependencies':
      syncScriptDependenciesFromBridge(data.payload || {});
      break;
    case 'bridge:installed-projects':
    case 'bridge:install-result':
    case 'bridge:uninstall-result':
    case 'bridge:update-result':
      if (projectId) {
        setProjectPendingAction(projectId, null);
      }
      if (data.type === 'bridge:install-result') {
        handleInstallResult(data.payload || {});
      } else if (data.type === 'bridge:uninstall-result') {
        handleUninstallResult(data.payload || {});
      } else if (data.type === 'bridge:update-result') {
        handleUpdateResult(data.payload || {});
      } else {
        syncInstalledProjectsFromBridge(data.payload || {}, { mode: 'replace' });
      }
      break;
    case 'bridge:project-diff':
      settleProjectDiffRequest(data.requestId, null, syncDiffFromBridge(data.payload || {}));
      renderApp();
      break;
    case 'bridge:repair:scan-result':
      settleRepairRequest(data.requestId, null, data.payload || {});
      break;
    case 'bridge:repair:project-result':
      if (Array.isArray(data.payload?.projects)) {
        syncInstalledProjectsFromBridge(data.payload || {}, { mode: 'merge' });
      }
      settleRepairRequest(data.requestId, null, data.payload || {});
      break;
    case 'bridge:oauth:result':
      dispatchOAuthResult(data.payload || {});
      break;
    case 'bridge:error':
      const handledProjectDiffError = settleProjectDiffRequest(
        data.requestId,
        new Error(data.payload?.message || '更新差异加载失败'),
        null,
      );
      const handledRepairError = settleRepairRequest(
        data.requestId,
        new Error(data.payload?.message || 'DLC 修复请求失败'),
        null,
      );
      const isProjectDiffError = data.payload?.action === 'bridge:get-project-diff';
      if (projectId) {
        setProjectPendingAction(projectId, null);
        renderApp();
      }
      if (!handledProjectDiffError && !handledRepairError && !isProjectDiffError) {
        showToast(data.payload?.message || '酒馆桥接错误', 'error');
      }
      break;
  }
}

function initializeTavernBridge() {
  if (window.parent === window) {
    setTavernConnectionStatus('disconnected');
    return;
  }

  setTavernConnectionStatus('connecting');
  window.addEventListener('message', handleBridgeMessage);
  postBridgeMessage('bridge:handshake');
  postBridgeMessage('bridge:get-context');
  postBridgeMessage('bridge:list-installed-projects');
  postBridgeMessage('bridge:list-script-dependencies');
}

function getLegacyProjectNameForBridge(projectId) {
  const localMeta = getLocalProjectMeta(projectId);
  const installedProjectId = String(localMeta?.installedProjectId || '').trim();
  if (installedProjectId && installedProjectId !== projectId) return installedProjectId;
  return localMeta?.legacyProjectName || null;
}

async function requestInstallProject(projectId, selection = {}) {
  if (!requireDiscordLoginForDownload('安装 DLC')) {
    const error = new Error('请先 Discord 登录后安装 DLC');
    error.code = 'LOGIN_REQUIRED';
    throw error;
  }

  const installInfo = await fetchProjectInstallInfo(projectId, selection?.projectVersion || null);
  setProjectPendingAction(projectId, 'install');
  renderApp();
  postBridgeMessage('bridge:install-project', {
    projectId,
    ...selection,
    ...(installInfo?.version ? { projectVersion: installInfo.version } : {}),
    ...(installInfo?.downloadUrl ? { downloadUrl: installInfo.downloadUrl } : {}),
  });
  return true;
}

function requestUninstallProject(projectId) {
  const legacyProjectName = getLegacyProjectNameForBridge(projectId);
  setProjectPendingAction(projectId, 'uninstall');
  renderApp();
  postBridgeMessage('bridge:uninstall-project', {
    projectId,
    ...(legacyProjectName ? { legacyProjectName } : {}),
  });
}

function requestProjectDiff(projectId, projectVersion = null) {
  if (!requireDiscordLoginForDownload('更新 DLC')) {
    const error = new Error('请先 Discord 登录后更新 DLC');
    error.code = 'LOGIN_REQUIRED';
    return Promise.reject(error);
  }
  const legacyProjectName = getLegacyProjectNameForBridge(projectId);
  const cachedDiff = getProjectUpdateDiff(projectId);
  if (window.__CW_TAVERN_MOCK__ && cachedDiff) {
    return Promise.resolve(cachedDiff);
  }
  const requestId = postBridgeMessage('bridge:get-project-diff', {
    projectId,
    ...(projectVersion ? { projectVersion } : {}),
    ...(legacyProjectName ? { legacyProjectName } : {}),
  });
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (!pendingProjectDiffRequests.has(requestId)) return;
      pendingProjectDiffRequests.delete(requestId);
      reject(new Error('更新差异加载超时，请重试'));
    }, PROJECT_DIFF_TIMEOUT_MS);
    pendingProjectDiffRequests.set(requestId, { projectId, resolve, reject, timeoutId });
  });
}

async function confirmProjectUpdate(projectId, projectVersion = null, manageOriginalConflicts = false) {
  if (!requireDiscordLoginForDownload('更新 DLC')) {
    const error = new Error('请先 Discord 登录后更新 DLC');
    error.code = 'LOGIN_REQUIRED';
    throw error;
  }

  const installInfo = await fetchProjectInstallInfo(projectId, projectVersion);
  const legacyProjectName = getLegacyProjectNameForBridge(projectId);
  setProjectPendingAction(projectId, 'update');
  renderApp();
  postBridgeMessage('bridge:confirm-project-update', {
    projectId,
    ...(installInfo?.version ? { projectVersion: installInfo.version } : projectVersion ? { projectVersion } : {}),
    ...(installInfo?.downloadUrl ? { downloadUrl: installInfo.downloadUrl } : {}),
    manageOriginalConflicts: manageOriginalConflicts === true,
    ...(legacyProjectName ? { legacyProjectName } : {}),
  });
  return true;
}

function requestRepairBridge(type, payload = {}) {
  const requestId = postBridgeMessage(type, payload);
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (!pendingRepairRequests.has(requestId)) return;
      pendingRepairRequests.delete(requestId);
      reject(new Error('DLC 诊断 / 修复请求超时，请重试'));
    }, REPAIR_REQUEST_TIMEOUT_MS);
    pendingRepairRequests.set(requestId, { resolve, reject, timeoutId, type });
  });
}

function requestDlcRepairScan(worldbookNames = null) {
  const payload = Array.isArray(worldbookNames) && worldbookNames.length
    ? { worldbookNames }
    : {};
  return requestRepairBridge('bridge:repair:scan', payload);
}

async function requestDlcRepairProject(target) {
  if (!requireDiscordLoginForDownload('修复 DLC')) {
    const error = new Error('请先 Discord 登录后修复 DLC');
    error.code = 'LOGIN_REQUIRED';
    throw error;
  }
  const projectId = String(target?.projectId || '').trim();
  if (!projectId) throw new Error('缺少修复项目 ID');
  const installInfo = await fetchProjectInstallInfo(projectId);
  return requestRepairBridge('bridge:repair:project', {
    ...(target || {}),
    ...(installInfo?.version ? { projectVersion: installInfo.version } : {}),
    ...(installInfo?.downloadUrl ? { downloadUrl: installInfo.downloadUrl } : {}),
  });
}

function requestOAuthLogin(authUrl, state) {
  return postBridgeMessage('bridge:oauth:start', { authUrl, state });
}

function requestCloseWorkshop() {
  if (window.parent === window) return;
  postBridgeMessage('bridge:close-workshop');
}
`;
