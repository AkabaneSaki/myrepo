export const homeTavernBridgeScript = String.raw`
const TAVERN_BRIDGE_NAMESPACE = 'creative-workshop-bridge';
const TAVERN_OAUTH_RESULT_EVENT = 'creative-workshop:oauth-result';
const PROJECT_DIFF_TIMEOUT_MS = 10000;
const pendingProjectDiffRequests = new Map();
const installSubscriptionSyncChains = new Map();

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
  });
  renderApp();
}

function syncInstallSubscription(projectId, subscribed) {
  if (!projectId || !state.currentUser) return Promise.resolve();

  const previous = installSubscriptionSyncChains.get(projectId) || Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    try {
      await setProjectSubscription(projectId, subscribed);
    } catch (error) {
      console.warn('[CreativeWorkshop] 同步更新订阅状态失败', { projectId, subscribed, error });
      showToast('项目操作完成，但更新订阅状态同步失败', 'warning');
    }
  });

  installSubscriptionSyncChains.set(projectId, next);
  void next.finally(() => {
    if (installSubscriptionSyncChains.get(projectId) === next) {
      installSubscriptionSyncChains.delete(projectId);
    }
  });
  return next;
}

function handleInstallResult(payload) {
  syncInstalledProjectsFromBridge(payload, { mode: 'merge' });
  void syncInstallSubscription(payload?.projectId || null, true);
  showToast(state.currentUser ? '项目安装完成，已自动订阅更新' : '项目安装完成');
}

function handleUninstallResult(payload) {
  const projectId = payload?.projectId || null;
  if (Array.isArray(payload?.projects) && payload.projects.length > 0) {
    syncInstalledProjectsFromBridge(payload, { mode: 'merge', removeProjectId: projectId });
  } else {
    clearInstalledProject(projectId);
    renderApp();
  }
  void syncInstallSubscription(projectId, false);
  showToast(state.currentUser ? '项目已卸载，已取消更新订阅' : '项目已卸载');
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
      break;
    case 'bridge:context':
      syncContextFromBridge(data.payload || {});
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
    case 'bridge:oauth:result':
      dispatchOAuthResult(data.payload || {});
      break;
    case 'bridge:error':
      const handledProjectDiffError = settleProjectDiffRequest(
        data.requestId,
        new Error(data.payload?.message || '更新差异加载失败'),
        null,
      );
      const isProjectDiffError = data.payload?.action === 'bridge:get-project-diff';
      if (projectId) {
        setProjectPendingAction(projectId, null);
        renderApp();
      }
      if (!handledProjectDiffError && !isProjectDiffError) {
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
}

function getLegacyProjectNameForBridge(projectId) {
  return getLocalProjectMeta(projectId)?.legacyProjectName || null;
}

function requestInstallProject(projectId, selection = {}) {
  setProjectPendingAction(projectId, 'install');
  renderApp();
  postBridgeMessage('bridge:install-project', { projectId, ...selection });
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

function confirmProjectUpdate(projectId, projectVersion = null) {
  const legacyProjectName = getLegacyProjectNameForBridge(projectId);
  setProjectPendingAction(projectId, 'update');
  renderApp();
  postBridgeMessage('bridge:confirm-project-update', {
    projectId,
    ...(projectVersion ? { projectVersion } : {}),
    ...(legacyProjectName ? { legacyProjectName } : {}),
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
