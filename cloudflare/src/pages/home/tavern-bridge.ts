export const homeTavernBridgeScript = String.raw`
const TAVERN_BRIDGE_NAMESPACE = 'creative-workshop-bridge';
const TAVERN_OAUTH_RESULT_EVENT = 'creative-workshop:oauth-result';

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
  renderApp();
}

function syncDiffFromBridge(payload) {
  if (payload?.projectId) {
    setProjectUpdateDiff(payload.projectId, payload.diff || payload);
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
      syncDiffFromBridge(data.payload || {});
      renderApp();
      break;
    case 'bridge:oauth:result':
      dispatchOAuthResult(data.payload || {});
      break;
    case 'bridge:error':
      if (projectId) {
        setProjectPendingAction(projectId, null);
        renderApp();
      }
      showToast(data.payload?.message || '酒馆桥接错误', 'error');
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

function requestInstallProject(projectId) {
  setProjectPendingAction(projectId, 'install');
  renderApp();
  postBridgeMessage('bridge:install-project', { projectId });
}

function requestUninstallProject(projectId) {
  setProjectPendingAction(projectId, 'uninstall');
  renderApp();
  postBridgeMessage('bridge:uninstall-project', { projectId });
}

function requestProjectDiff(projectId) {
  postBridgeMessage('bridge:get-project-diff', { projectId });
}

function confirmProjectUpdate(projectId) {
  setProjectPendingAction(projectId, 'update');
  renderApp();
  postBridgeMessage('bridge:confirm-project-update', { projectId });
}

function requestOAuthLogin(authUrl, state) {
  return postBridgeMessage('bridge:oauth:start', { authUrl, state });
}
`;
