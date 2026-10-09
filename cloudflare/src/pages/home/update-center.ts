export const homeUpdateCenterScript = String.raw`
const DLC_UPDATE_STATUS_CACHE_KEY = 'creative_workshop_dlc_update_status_v2';
const DLC_UPDATE_FALSE_TTL_MS = 6 * 60 * 60 * 1000;
let dlcUpdateCheckInFlight = null;

function getInstalledProjectVersionPayload() {
  const byProject = new Map();
  (Array.isArray(state.tavern.installedProjects) ? state.tavern.installedProjects : [])
    .forEach(project => {
      const id = String(project?.projectId || project?.id || '').trim();
      const version = String(project?.localVersion || '').trim();
      if (!id) return;
      // Different or unfinished instances require a check, still once per project.
      const previous = byProject.get(id);
      if (!byProject.has(id)) byProject.set(id, version || null);
      else if (previous !== version) byProject.set(id, null);
      if (project.mixedVersions || project.regexVersionMismatch) byProject.set(id, null);
    });
  return Array.from(byProject, ([id, installedVersion]) => ({ id, installedVersion })).slice(0, 500);
}

function getInstalledProjectVersionSignature(projects) {
  return JSON.stringify(
    (Array.isArray(projects) ? projects : [])
      .map(item => [String(item.id || ''), String(item.installedVersion || '')])
      .sort((left, right) => left[0].localeCompare(right[0])),
  );
}

function readDlcUpdateStatusCache() {
  try {
    const raw = localStorage.getItem(DLC_UPDATE_STATUS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      signature: String(parsed.signature || ''),
      checkedAt: Number(parsed.checkedAt || 0),
      hasUpdate: parsed.hasUpdate === true,
    };
  } catch {
    return null;
  }
}

function writeDlcUpdateStatusCache(value) {
  try {
    localStorage.setItem(DLC_UPDATE_STATUS_CACHE_KEY, JSON.stringify({
      signature: String(value?.signature || ''),
      checkedAt: Number(value?.checkedAt || Date.now()),
      hasUpdate: value?.hasUpdate === true,
    }));
  } catch {}
}

function applyDlcUpdateStatus(hasUpdate, checkedAt, signature) {
  const nextAvailable = Boolean(hasUpdate);
  const nextSignature = String(signature || '');
  const changed = !state.tavern.dlcUpdateKnown
    || state.tavern.dlcUpdateAvailable !== nextAvailable
    || state.tavern.dlcUpdateSignature !== nextSignature;
  state.tavern.dlcUpdateKnown = true;
  state.tavern.dlcUpdateAvailable = nextAvailable;
  state.tavern.dlcUpdateCheckedAt = Number(checkedAt || Date.now());
  state.tavern.dlcUpdateSignature = nextSignature;
  if (changed) renderApp();
}

async function requestDlcVersionCheck(options = {}) {
  const fresh = Boolean(options.fresh);

  const projects = getInstalledProjectVersionPayload();
  const signature = getInstalledProjectVersionSignature(projects);
  if (!projects.length) {
    applyDlcUpdateStatus(false, Date.now(), signature);
    writeDlcUpdateStatusCache({ signature, checkedAt: Date.now(), hasUpdate: false });
    return { success: true, hasUpdate: false, updates: [] };
  }

  const cached = readDlcUpdateStatusCache();
  if (!fresh && cached?.signature === signature) {
    if (cached.hasUpdate) {
      applyDlcUpdateStatus(true, cached.checkedAt, signature);
      return { success: true, hasUpdate: true, updates: null, cached: true };
    }
    if (Date.now() - cached.checkedAt < DLC_UPDATE_FALSE_TTL_MS) {
      applyDlcUpdateStatus(false, cached.checkedAt, signature);
      return { success: true, hasUpdate: false, updates: null, cached: true };
    }
  }

  if (dlcUpdateCheckInFlight) return await dlcUpdateCheckInFlight;

  state.tavern.dlcUpdateCheckPending = true;
  dlcUpdateCheckInFlight = (async () => {
    const result = await apiFetch('/api/projects/version-check', {
      method: 'POST',
      cache: 'no-store',
      body: JSON.stringify({ projects }),
    });
    const checkedAt = Date.now();
    const hasUpdate = result?.hasUpdate === true && expandDlcUpdateInstances(Array.isArray(result?.updates) ? result.updates : []).length > 0;
    writeDlcUpdateStatusCache({ signature, checkedAt, hasUpdate });
    applyDlcUpdateStatus(hasUpdate, checkedAt, signature);
    return {
      success: true,
      hasUpdate,
      updates: Array.isArray(result?.updates) ? result.updates : [],
    };
  })();
  try {
    return await dlcUpdateCheckInFlight;
  } finally {
    dlcUpdateCheckInFlight = null;
    state.tavern.dlcUpdateCheckPending = false;
  }
}

function scheduleDlcUpdateStatusCheck() {
  if (!state.tavern.installedProjectsLoaded) return;
  void requestDlcVersionCheck().catch(error => {
    console.warn('[CreativeWorkshop] DLC 更新状态检查失败', error);
  });
}

function expandDlcUpdateInstances(updates) {
  return updates.flatMap(item => {
    return getLocalProjectInstallations(item.id)
      .filter(instance => {
        const order = compareProjectVersions(item.latestVersion, instance.localVersion);
        return order === 1 || (order === 0 && instance.regexVersionMismatch) || (instance.mixedVersions && !instance.localVersion);
      }).map(instance => ({ ...item, installedVersion: instance.localVersion, worldbookName: instance.worldbookName }));
  });
}

function renderDlcUpdateCenterRows(updates) {
  return updates.map(item => {
    const installed = escapeHtml(item.installedVersion || '未知');
    const latest = escapeHtml(item.latestVersion || '未知');
    const name = escapeHtml(item.name || item.id || '未命名 DLC');
    const location = item.worldbookName ? '<span>世界书：' + escapeHtml(item.worldbookName) + '</span>' : '';
    return '<article class="dlc-update-center-item">'
      + '<div class="dlc-update-center-copy"><strong>' + name + '</strong>' + location + '<span>'
      + installed + ' <i class="fas fa-arrow-right"></i> ' + latest
      + '</span></div>'
      + '<button class="btn btn-primary" type="button" data-dlc-update-project="' + escapeHtml(item.id)
      + '" data-worldbook-name="' + escapeHtml(item.worldbookName || '') + '"><i class="fas fa-arrows-rotate"></i> 更新</button>'
      + '</article>';
  }).join('');
}

function openWorkshopUpdateHub() {
  const scriptHealth = state.tavern.scriptDependenciesLoaded && state.tavern.scriptDependenciesSupported
    ? getScriptDependencyHealthSummary()
    : { outdated: [] };
  const scriptCount = Array.isArray(scriptHealth.outdated) ? scriptHealth.outdated.length : 0;
  const dlcAvailable = Boolean(state.tavern.dlcUpdateKnown && state.tavern.dlcUpdateAvailable);
  const dlcHtml = '<section class="workshop-update-hub-section"><div><i class="fas fa-box-open"></i><span><strong>DLC 更新</strong><small>'
    + (dlcAvailable ? '有已安装 DLC 可以更新' : '当前没有检测到 DLC 更新')
    + '</small></span></div>'
    + (dlcAvailable ? '<button class="btn btn-primary" type="button" data-update-hub-dlc>查看</button>' : '<span class="workshop-update-hub-ok"><i class="fas fa-circle-check"></i> 最新</span>')
    + '</section>';
  const scriptHtml = '<section class="workshop-update-hub-section"><div><i class="fas fa-code-branch"></i><span><strong>其他脚本</strong><small>'
    + (scriptCount ? scriptCount + ' 个脚本可以更新' : '当前没有其他脚本更新')
    + '</small></span></div>'
    + (scriptCount ? '<button class="btn btn-outline" type="button" data-update-hub-scripts>查看</button>' : '<span class="workshop-update-hub-ok"><i class="fas fa-circle-check"></i> 最新</span>')
    + '</section>';
  const overlay = openModal('<div class="workshop-update-hub">' + dlcHtml + scriptHtml + '</div>', '<i class="fas fa-bell"></i> 更新');
  overlay.querySelector('[data-update-hub-dlc]')?.addEventListener('click', () => {
    overlay.remove();
    void openDlcUpdateCenter();
  });
  overlay.querySelector('[data-update-hub-scripts]')?.addEventListener('click', () => {
    overlay.remove();
    openScriptDependencyHealthModal();
  });
  return overlay;
}

async function openDlcUpdateCenter() {
  const loadingOverlay = openModal(
    '<div class="detail-loading"><div class="loading-spinner"></div><div class="detail-loading-text">正在读取最新 DLC 版本...</div></div>',
    '<i class="fas fa-circle-up"></i> DLC 更新',
  );
  try {
    const result = await requestDlcVersionCheck({ fresh: true });
    const updates = expandDlcUpdateInstances(Array.isArray(result?.updates) ? result.updates : []);
    if (loadingOverlay.isConnected) loadingOverlay.remove();

    if (!updates.length) {
      const overlay = openModal(
        '<div class="dlc-update-center-empty"><i class="fas fa-circle-check"></i><strong>已经是最新版</strong><span>目前没有检测到可更新的 DLC。</span></div>',
        '<i class="fas fa-circle-up"></i> DLC 更新',
      );
      return overlay;
    }

    const html = '<div class="dlc-update-center">'
      + '<div class="dlc-update-center-head"><strong>' + updates.length + ' 个 DLC 有更新</strong><span>这是刚刚重新检查后的最新结果。</span></div>'
      + '<div class="dlc-update-center-list">' + renderDlcUpdateCenterRows(updates) + '</div>'
      + '</div>';
    const overlay = openModal(html, '<i class="fas fa-circle-up"></i> DLC 更新');

    overlay.querySelectorAll('[data-dlc-update-project]').forEach(button => {
      button.addEventListener('click', async () => {
        const projectId = String(button.dataset.dlcUpdateProject || '');
        if (!projectId) return;
        if (!requireDiscordLoginForDownload('更新 DLC')) return;
        const restore = setButtonLoading(button, '读取中');
        try {
          const detail = await fetchProjectEntries(projectId, { forceRefresh: true });
          const project = detail?.project;
          if (!project?.id || !project?.version) throw new Error('无法读取这个 DLC 的最新版本');
          const diff = await requestProjectDiff(project.id, project.version, button.dataset.worldbookName || null);
          if (overlay.isConnected) overlay.remove();
          openProjectUpdateModal(project, diff, button.dataset.worldbookName || null);
        } catch (error) {
          showToast('更新检查失败: ' + (error?.message || String(error)), 'error');
        } finally {
          restore();
        }
      });
    });
    return overlay;
  } catch (error) {
    if (loadingOverlay.isConnected) loadingOverlay.remove();
    showToast('DLC 更新检查失败: ' + (error?.message || String(error)), 'error');
    return null;
  }
}
`;
