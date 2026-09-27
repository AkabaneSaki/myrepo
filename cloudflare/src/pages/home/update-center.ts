export const homeUpdateCenterScript = String.raw`
const DLC_UPDATE_STATUS_CACHE_KEY = 'creative_workshop_dlc_update_status_v1';
const DLC_UPDATE_FALSE_TTL_MS = 6 * 60 * 60 * 1000;
let dlcUpdateCheckInFlight = null;

function getInstalledProjectVersionPayload() {
  return (Array.isArray(state.tavern.installedProjects) ? state.tavern.installedProjects : [])
    .map(project => ({
      id: String(project?.projectId || project?.id || '').trim(),
      installedVersion: String(project?.localVersion || '').trim(),
    }))
    .filter(item => item.id && item.installedVersion)
    .slice(0, 500);
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
    const hasUpdate = result?.hasUpdate === true;
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

function renderDlcUpdateCenterRows(updates) {
  return updates.map(item => {
    const installed = escapeHtml(item.installedVersion || '未知');
    const latest = escapeHtml(item.latestVersion || '未知');
    const name = escapeHtml(item.name || item.id || '未命名 DLC');
    return '<article class="dlc-update-center-item">'
      + '<div class="dlc-update-center-copy"><strong>' + name + '</strong><span>'
      + installed + ' <i class="fas fa-arrow-right"></i> ' + latest
      + '</span></div>'
      + '<button class="btn btn-primary" type="button" data-dlc-update-project="' + escapeHtml(item.id) + '"><i class="fas fa-arrows-rotate"></i> 更新</button>'
      + '</article>';
  }).join('');
}

async function openDlcUpdateCenter() {
  const loadingOverlay = openModal(
    '<div class="detail-loading"><div class="loading-spinner"></div><div class="detail-loading-text">正在读取最新 DLC 版本...</div></div>',
    '<i class="fas fa-circle-up"></i> DLC 更新',
  );
  try {
    const result = await requestDlcVersionCheck({ fresh: true });
    const updates = Array.isArray(result?.updates) ? result.updates : [];
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
          const diff = await requestProjectDiff(project.id, project.version);
          if (overlay.isConnected) overlay.remove();
          openProjectUpdateModal(project, diff);
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
