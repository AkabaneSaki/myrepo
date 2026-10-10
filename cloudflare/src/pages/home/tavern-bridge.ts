export const homeTavernBridgeScript = String.raw`
const TAVERN_BRIDGE_NAMESPACE = 'creative-workshop-bridge';
const TAVERN_OAUTH_RESULT_EVENT = 'creative-workshop:oauth-result';
const PROJECT_DIFF_TIMEOUT_MS = 10000;
const REPAIR_REQUEST_TIMEOUT_MS = 60000;
const pendingProjectDiffRequests = new Map();
const pendingOriginalConflictPreviews = new Map();
const pendingRepairRequests = new Map();

const pendingDlcTransfers = new Map();
const DLC_TRANSFER_PHASES = [
  ['queued','排队等待'], ['preflight','检查安装环境'], ['download','下载 DLC JSON'],
  ['validate','检查下载内容'], ['recover','恢复上次中断'], ['install','写入新版'],
  ['install_verify','验证暂存新版'], ['remove_old','删除旧版并启用新版'],
  ['worldbook_verify','验证世界书'], ['conflicts','处理原版冲突'],
  ['regex','安装 Regex'], ['regex_verify','验证 Regex'],
  ['cleanup','清理已授权的重复副本'], ['registry','保存安装记录'],
  ['final_verify','最终重新扫描']
];
const DLC_TRANSFER_LABELS = Object.fromEntries(DLC_TRANSFER_PHASES);
function drawDlcProgress(task) {
  if (!task.overlay?.isConnected) return;
  const root = task.overlay;
  root.querySelector('[data-dlc-phase]').textContent = task.failed ? '操作未完成' :
    task.done ? '安装完整性验收通过' : (DLC_TRANSFER_LABELS[task.phase] || '准备中');
  let message = task.failed ? '已停止。请保留错误码，重新扫描后再决定是否重试。' :
    task.done ? '已重新读取并检查最终状态。' : '正在处理当前步骤，请勿强制关闭酒馆。';
  if (task.phase === 'download' && !task.failed && !task.done) {
    const p = task.download || {};
    if (p.source === 'cache') message = '已复用完整的本地下载缓存';
    else if (p.source === 'none') message = '此项目无独立世界书下载包';
    else if (Number(p.loadedBytes) > 0) {
      message = '已接收 ' + Math.round(p.loadedBytes / 1024) + ' KB';
      if (Number(p.totalBytes) > 0 && p.loadedBytes <= p.totalBytes)
        message += ' / ' + Math.round(p.totalBytes / 1024) + ' KB（' +
          Math.floor(p.loadedBytes / p.totalBytes * 100) + '%）';
    } else message = '正在下载；总大小未知时不显示虚假的百分比';
  }
  root.querySelector('[data-dlc-detail]').textContent = message;
  const list = root.querySelector('[data-dlc-steps]');
  list.replaceChildren();
  for (const [phase, label] of DLC_TRANSFER_PHASES) {
    if (!task.visited.has(phase)) continue;
    const row = document.createElement('li');
    const current = phase === task.phase;
    row.className = 'cw-transfer-step ' + (task.failed && current ? 'is-error' : !task.done && current ? 'is-active' : 'is-done');
    row.textContent = (task.failed && current ? '✕ ' : !task.done && current ? '◌ ' : '✓ ') + label;
    list.appendChild(row);
  }
  const bar = root.querySelector('[data-dlc-bar]');
  const bytes = task.download || {};
  const percent = task.phase === 'download' && !task.failed && Number(bytes.totalBytes) > 0 &&
    Number(bytes.loadedBytes) <= Number(bytes.totalBytes)
      ? Math.max(0, Math.min(100, Math.floor(bytes.loadedBytes / bytes.totalBytes * 100))) : null;
  bar.style.width = percent === null ? '100%' : percent + '%';
  bar.classList.toggle('is-indeterminate', !task.failed && !task.done && percent === null);
  bar.classList.toggle('is-error', task.failed);
  const error = root.querySelector('[data-dlc-error]');
  error.hidden = !task.error;
  if (task.error) {
    root.querySelector('[data-dlc-code]').textContent = task.error.code;
    root.querySelector('[data-dlc-message]').textContent = task.error.message;
    root.querySelector('[data-dlc-request]').textContent = task.requestId || '本地请求';
  }
}
function startDlcProgress(projectId, mode) {
  const html = '<div class="cw-dlc-progress" role="status" aria-live="polite">' +
    '<strong data-dlc-phase>正在准备</strong><p data-dlc-detail>正在获取下载信息</p>' +
    '<div class="cw-transfer-track"><span data-dlc-bar class="is-indeterminate"></span></div>' +
    '<ol data-dlc-steps class="cw-transfer-list"></ol>' +
    '<section class="cw-transfer-error" data-dlc-error hidden><b>错误码：<code data-dlc-code></code></b>' +
    '<p data-dlc-message></p><small>请求：<span data-dlc-request></span></small>' +
    '<button type="button" class="btn btn-outline" data-dlc-copy>复制错误详情</button></section>' +
    '<p class="cw-transfer-hint">关闭此窗口不会取消安装；可稍后重新扫描实际安装状态。</p></div>';
  const overlay = openModal(html, mode === 'update' ? 'DLC 更新进度' : 'DLC 安装进度');
  overlay.classList.add('cw-transfer-modal');
  const task = { overlay, projectId, mode, phase:'queued', visited:new Set(['queued']),
    requestId:null, download:null, failed:false, done:false, error:null };
  overlay.querySelector('[data-dlc-copy]').onclick = () => {
    if (!task.error) return;
    const message = task.error.code + ' / ' + task.error.message + ' / ' + (task.requestId || '本地');
    if (!navigator.clipboard?.writeText) { showToast(message, 'info'); return; }
    navigator.clipboard.writeText(message).then(() => showToast('错误详情已复制'))
      .catch(() => showToast(message, 'info'));
  };
  drawDlcProgress(task);
  return task;
}

const SCRIPT_DEPENDENCY_REGISTRY = new Map(
  (WORKSHOP_CONFIG.scriptDependencies || []).map(item => [
    String(item.key || '').toLowerCase(),
    {
      name: String(item.displayName || item.key || '脚本'),
      latestVersion: String(item.latestVersion || ''),
      publicPath: String(item.publicPath || ''),
    },
  ]),
);

state.tavern.scriptDependenciesSupported = false;
state.tavern.scriptDependenciesLoaded = false;
state.tavern.scriptDependencies = [];
state.tavern.verifiedDlcInstall = false;
state.tavern.duplicateDlcConsolidation = false;
state.tavern.originalConflictDisambiguation = false;
let bridgeHandshakeRequestId = null;
let bridgeHostSource = null;
let bridgeHostOrigin = null;

function createBridgeRequest(type, payload) {
  return {
    namespace: TAVERN_BRIDGE_NAMESPACE,
    type,
    requestId: crypto.randomUUID(),
    payload: payload || {},
  };
}

function postBridgeMessage(type, payload) {
  if (!['bridge:handshake', 'bridge:get-context', 'bridge:close-workshop'].includes(type)) {
    requireLatestWorkshopClient();
  }
  if (['bridge:install-project', 'bridge:uninstall-project', 'bridge:confirm-project-update', 'bridge:get-project-diff', 'bridge:repair:project'].includes(type)
      && state.tavern.verifiedDlcInstall !== true) {
    throw new Error('当前工坊脚本不支持安全安装与按位置操作，请先更新工坊脚本后再试');
  }
  const message = createBridgeRequest(type, payload);
  if (type === 'bridge:handshake') bridgeHandshakeRequestId = message.requestId;
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

const DLC_DUPLICATE_NOTIFICATION_KEY = 'cw_install_duplicate_notice_v1';
function notifyDuplicateWorldbookInstallations() {
  const locations = new Map();
  (state.tavern.installedProjects || []).forEach(instance => {
    if (!instance.worldbookName || !instance.worldbookBound) return;
    if (!locations.has(instance.projectId)) locations.set(instance.projectId, new Set());
    locations.get(instance.projectId).add(instance.worldbookName);
  });
  const duplicates = Array.from(locations.entries())
    .filter(([, books]) => books.size > 1)
    .map(([id, books]) => [id, ...Array.from(books).sort()]);
  if (!duplicates.length) return;
  const signature = JSON.stringify(duplicates.sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  try {
    if (localStorage.getItem(DLC_DUPLICATE_NOTIFICATION_KEY) === signature) return;
    localStorage.setItem(DLC_DUPLICATE_NOTIFICATION_KEY, signature);
  } catch {}
  showToast('检测到 ' + duplicates.length + ' 个 DLC 安装在多本已启用世界书中。已保留所有副本，可分别更新；请留意重复执行效果。', 'warning');
}

function syncInstalledProjectsFromBridge(payload, options) {
  const installedProjects = Array.isArray(payload?.projects) ? payload.projects : [];
  const syncMode = payload?.complete === false ? 'merge' : ((options && options.mode) || 'replace');
  setInstalledProjects(installedProjects, {
    mode: syncMode,
    removeProjectId: options && options.removeProjectId ? options.removeProjectId : null,
    complete: payload?.complete !== false,
    unreadableWorldbookNames: Array.isArray(payload?.unreadableWorldbookNames) ? payload.unreadableWorldbookNames : [],
    scannedWorldbookNames: Array.isArray(payload?.scannedWorldbookNames) ? payload.scannedWorldbookNames : [],
  });
  if (payload?.complete === false) {
    showToast(
      '有些世界书暂时读不到，未确认项目的安装按钮已暂停。请稍后重开工坊再试。',
      'error',
    );
  }
  notifyDuplicateWorldbookInstallations();
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
      const registryEntry = SCRIPT_DEPENDENCY_REGISTRY.get(String(dependency?.repository || '').toLowerCase());
      if (!registryEntry) return;
      if (registryEntry.publicPath && !new URL(dependency.importUrl).pathname.endsWith('/' + registryEntry.publicPath)) return;

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
  if (Array.isArray(payload?.projects)) {
    syncInstalledProjectsFromBridge(payload, { mode: 'replace' });
  } else {
    clearInstalledProject(projectId);
    renderApp();
  }
  showToast('项目已卸载');
}

function handleUpdateResult(payload) {
  syncInstalledProjectsFromBridge(payload, { mode: 'replace' });
  showToast('项目更新完成');
}

function syncContextFromBridge(payload) {
  setTavernConnectionStatus(payload?.connected ? 'connected' : 'error');
  state.tavern.worldbooks = {
    primary: payload?.worldbooks?.primary || null,
    additional: Array.isArray(payload?.worldbooks?.additional) ? payload.worldbooks.additional : [],
    available: Array.isArray(payload?.worldbooks?.available) ? payload.worldbooks.available : [],
    global: Array.isArray(payload?.worldbooks?.global) ? payload.worldbooks.global : [],
    chat: typeof payload?.worldbooks?.chat === 'string' ? payload.worldbooks.chat : null,
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


function bindDlcProgress(task, requestId) {
  task.requestId = requestId;
  pendingDlcTransfers.set(requestId, task);
  drawDlcProgress(task);
}
function advanceDlcProgress(requestId, payload) {
  const task = pendingDlcTransfers.get(requestId);
  if (!task || task.done || task.failed || payload?.projectId !== task.projectId ||
      !DLC_TRANSFER_LABELS[payload?.phase]) return false;
  task.phase = payload.phase;
  task.visited.add(payload.phase);
  if (payload.phase === 'download') task.download = payload;
  drawDlcProgress(task);
  return true;
}
function completeDlcProgress(requestId, payload, failed = false) {
  const task = pendingDlcTransfers.get(requestId);
  if (!task || payload?.projectId !== task.projectId) return false;
  task.failed = failed;
  task.done = !failed;
  if (failed) task.error = {
    code: String(payload.errorCode || 'CW-' + (task.mode === 'update' ? 'U' : 'I') + '-999'),
    message: String(payload.message || '操作中断，请重新扫描')
  };
  pendingDlcTransfers.delete(requestId);
  drawDlcProgress(task);
  return true;
}
function failLocalDlcProgress(task, error) {
  task.failed = true;
  task.error = {
    code: 'CW-' + (task.mode === 'update' ? 'U' : 'I') + '-005',
    message: error?.message || String(error)
  };
  drawDlcProgress(task);
}

function handleBridgeMessage(event) {
  const data = event.data;
  if (!data || data.namespace !== TAVERN_BRIDGE_NAMESPACE || !data.type) {
    return;
  }
  if (data.type === 'bridge:handshake:ok') {
    if (!bridgeHandshakeRequestId || data.requestId !== bridgeHandshakeRequestId || !event.source) return;
    bridgeHostSource = event.source;
    bridgeHostOrigin = event.origin;
    bridgeHandshakeRequestId = null;
  } else if (event.source !== bridgeHostSource || !bridgeHostSource || event.origin !== bridgeHostOrigin) return;

  const projectId = data.payload?.projectId || null;

  switch (data.type) {
    case 'bridge:handshake:ok':
      setTavernConnectionStatus('connected');
      setTavernClientVersion(data.payload?.clientVersion);
      state.tavern.verifiedDlcInstall = data.payload?.capabilities?.verifiedDlcInstall === true;
      state.tavern.duplicateDlcConsolidation = data.payload?.capabilities?.duplicateDlcConsolidation === true;
      state.tavern.installedManagerTransferSupported = data.payload?.capabilities?.installedManagerTransfer === true;
      state.tavern.originalConflictDisambiguation = data.payload?.capabilities?.originalConflictDisambiguation === true;
      renderApp();
      if (shouldShowWorkshopReleaseNotice()) {
        openReleaseNoticeModal();
        break;
      }
      postBridgeMessage('bridge:list-installed-projects');
      postBridgeMessage('bridge:get-context');
      postBridgeMessage('bridge:list-script-dependencies');
      break;
    case 'bridge:context':
      syncContextFromBridge(data.payload || {});
      break;
    case 'bridge:script-dependencies':
      syncScriptDependenciesFromBridge(data.payload || {});
      break;
    case 'bridge:operation-progress':
      advanceDlcProgress(data.requestId, data.payload || {});
      break;
    case 'bridge:installed-projects':
    case 'bridge:install-result':
    case 'bridge:transfer-installed-result':
    case 'bridge:uninstall-result':
    case 'bridge:update-result':
      if (data.type === 'bridge:install-result' || data.type === 'bridge:update-result')
        completeDlcProgress(data.requestId, data.payload || {});
      if (projectId) {
        setProjectPendingAction(projectId, null);
      }
      if (data.type === 'bridge:install-result') {
        handleInstallResult(data.payload || {});
      } else if (data.type === 'bridge:transfer-installed-result') {
        syncInstalledProjectsFromBridge(data.payload || {}, { mode: 'replace' });
        showToast(data.payload?.movedOutsideScan
          ? '迁移完成；目标未绑定，DLC 已退出安装列表，角色 Regex 仍保留'
          : 'DLC 迁移完成，已重新扫描安装位置');
      } else if (data.type === 'bridge:uninstall-result') {
        handleUninstallResult(data.payload || {});
      } else if (data.type === 'bridge:update-result') {
        handleUpdateResult(data.payload || {});
      } else {
        syncInstalledProjectsFromBridge(data.payload || {}, { mode: 'replace' });
      }
      break;
    case 'bridge:create-additional-worldbook-result':
      showToast('已创建并绑定世界书：' + (data.payload?.worldbookName || ''), 'success');
      postBridgeMessage('bridge:list-installed-projects');
      break;
    case 'bridge:original-conflict-preview': {
      const pending = pendingOriginalConflictPreviews.get(data.requestId);
      if (pending) {
        pendingOriginalConflictPreviews.delete(data.requestId);
        clearTimeout(pending.timeoutId);
        if (data.payload?.projectId !== pending.projectId)
          pending.reject(new Error('原版冲突核对的项目身份不一致'));
        else pending.resolve(data.payload);
      }
      break;
    }
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
      const failedTransfer = data.payload?.action === 'bridge:transfer-installed-worldbook';
      if (failedTransfer) showToast('DLC 迁移未完成：请检查安装位置并重新扫描，不要直接重试', 'error');
      if (failedTransfer) postBridgeMessage('bridge:list-installed-projects');
      const conflictPreview = pendingOriginalConflictPreviews.get(data.requestId);
      if (conflictPreview) {
        pendingOriginalConflictPreviews.delete(data.requestId);
        clearTimeout(conflictPreview.timeoutId);
        conflictPreview.reject(new Error(data.payload?.message || '读取角色正则失败'));
      }
      const handledDlcError = completeDlcProgress(data.requestId, data.payload || {}, true);
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
      if (Array.isArray(data.payload?.projects)) syncInstalledProjectsFromBridge(data.payload, { mode: 'replace' });
      if (projectId) {
        setProjectPendingAction(projectId, null);
        renderApp();
      }
      if (!handledDlcError && !handledProjectDiffError && !handledRepairError && !conflictPreview && !isProjectDiffError) {
        showToast((data.payload?.errorCode ? '[' + data.payload.errorCode + '] ' : '') +
          (data.payload?.message || '酒馆桥接错误'), 'error');
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

  const task = startDlcProgress(projectId, 'install');
  try {
    const installInfo = await fetchProjectInstallInfo(projectId, selection?.projectVersion || null);
    const requestId = postBridgeMessage('bridge:install-project', {
      projectId,
      ...selection,
      ...(installInfo?.version ? { projectVersion: installInfo.version } : {}),
      ...(installInfo?.downloadUrl ? { downloadUrl: installInfo.downloadUrl } : {}),
      ...(installInfo?.regexDownloadUrl ? { regexDownloadUrl: installInfo.regexDownloadUrl } : {}),
      ...(selection.manageOriginalConflicts && typeof selection.manageOriginalConflicts === 'object'
        ? { manageOriginalConflicts: true,
            originalConflictSelections: selection.manageOriginalConflicts.originalConflictSelections }
        : {}),
    });
    bindDlcProgress(task, requestId);
    setProjectPendingAction(projectId, 'install');
    renderApp();
    return true;
  } catch (error) { failLocalDlcProgress(task, error); throw error; }
}

function requestInstalledWorldbookTransfer(projectId, sourceWorldbookName, targetWorldbookName) {
  if (!state.tavern.connected || !state.tavern.installedManagerTransferSupported ||
      !state.tavern.installedProjectsComplete)
    throw new Error('ST Client 未连接、不支持安全迁移，或扫描不完整');
  const rows = getLocalProjectInstallations(projectId);
  if (!rows.some(item => item.worldbookName === sourceWorldbookName && item.entryCount > 0))
    throw new Error('来源安装位置已变化，请重新扫描');
  const books = state.tavern.worldbooks || {};
  if (!(books.available || []).includes(targetWorldbookName) ||
      targetWorldbookName === sourceWorldbookName)
    throw new Error('目标必须是存在的其他世界书');
  postBridgeMessage('bridge:transfer-installed-worldbook', {
    projectId, sourceWorldbookName, targetWorldbookName
  });
  setProjectPendingAction(projectId, 'transfer');
  renderApp();
}

function requestUninstallProject(projectId, worldbookName = null) {
  const legacyProjectName = getLegacyProjectNameForBridge(projectId);
  if (!worldbookName && getLocalProjectInstallations(projectId).filter(item => item.worldbookName).length > 1) {
    showToast('此 DLC 安装在多本世界书，请到「我的工坊」选择具体位置卸载', 'warning');
    return;
  }
  try { postBridgeMessage('bridge:uninstall-project', {
    projectId,
    ...(worldbookName ? { worldbookName } : {}),
    ...(legacyProjectName ? { legacyProjectName } : {}),
  }); } catch (error) { showToast(error.message, 'error'); return; }
  setProjectPendingAction(projectId, 'uninstall');
  renderApp();
}

function requestProjectDiff(projectId, projectVersion = null, worldbookName = null) {
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
    ...(worldbookName ? { worldbookName } : {}),
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

async function inspectOriginalConflictChoices(projectId, projectVersion = null) {
  if (!state.tavern.originalConflictDisambiguation)
    return { ambiguities: [] }; // Older clients still fail closed on duplicates.
  const requestId = postBridgeMessage('bridge:inspect-original-conflicts', {
    projectId, ...(projectVersion ? { projectVersion } : {})
  });
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      pendingOriginalConflictPreviews.delete(requestId);
      reject(new Error('读取角色原版正则超时，请重试'));
    }, 15000);
    pendingOriginalConflictPreviews.set(requestId, { projectId, resolve, reject, timeoutId });
  });
}

async function confirmProjectUpdate(projectId, projectVersion = null, manageOriginalConflicts = false, worldbookName = null, approvedDuplicates = []) {
  if (!state.tavern.duplicateDlcConsolidation) throw new Error('请先更新工坊脚本，才能核验重复安装位置并安全更新');
  const local = worldbookName ? getLocalProjectInstallations(projectId).find(item => item.worldbookName === worldbookName) : getLocalProjectMeta(projectId);
  const order = compareProjectVersions(projectVersion, local?.localVersion);
  if (order === -1) throw new Error('远端版本比本地旧，已停止更新，避免降级');
  if (order === null && !local?.mixedVersions) throw new Error('无法确认版本，请重新扫描后再更新');
  if (!requireDiscordLoginForDownload('更新 DLC')) {
    const error = new Error('请先 Discord 登录后更新 DLC');
    error.code = 'LOGIN_REQUIRED';
    throw error;
  }

  const task = startDlcProgress(projectId, 'update');
  try {
    const installInfo = await fetchProjectInstallInfo(projectId, projectVersion);
    const legacyProjectName = getLegacyProjectNameForBridge(projectId);
    const requestId = postBridgeMessage('bridge:confirm-project-update', {
      projectId,
      ...(installInfo?.version ? { projectVersion: installInfo.version } : projectVersion ? { projectVersion } : {}),
      ...(installInfo?.downloadUrl ? { downloadUrl: installInfo.downloadUrl } : {}),
      ...(installInfo?.regexDownloadUrl ? { regexDownloadUrl: installInfo.regexDownloadUrl } : {}),
      manageOriginalConflicts: manageOriginalConflicts === true ||
        (manageOriginalConflicts && typeof manageOriginalConflicts === 'object'),
      ...(manageOriginalConflicts && typeof manageOriginalConflicts === 'object'
        ? { originalConflictSelections: manageOriginalConflicts.originalConflictSelections } : {}),
      approvedDuplicates,
      ...(worldbookName ? { worldbookName } : {}),
      ...(legacyProjectName ? { legacyProjectName } : {}),
    });
    bindDlcProgress(task, requestId);
    setProjectPendingAction(projectId, 'update');
    renderApp();
    return true;
  } catch (error) { failLocalDlcProgress(task, error); throw error; }
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
