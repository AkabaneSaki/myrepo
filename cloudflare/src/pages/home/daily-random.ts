export const homeDailyRandomDrawScript = String.raw`
let dailyRandomDrawResetTimer = null;

function canUseDailyRandomDraw() {
  return Boolean(
    isEmbedded
    && state.currentUser
    && state.tavern.connected
    && state.tavern.installedProjectsLoaded
    && (state.discoverShelves?.discover || []).length > 0
  );
}

function getInstalledProjectIdsForDailyDraw() {
  return Array.from(new Set(
    (state.tavern.installedProjects || [])
      .map(project => String(project?.projectId || project?.id || '').trim())
      .filter(Boolean),
  )).slice(0, 500);
}

function getCurrentDiscoverProjectIdsForDailyDraw() {
  return Array.from(new Set(
    (state.discoverShelves?.discover || [])
      .map(project => String(project?.id || '').trim())
      .filter(Boolean),
  )).slice(0, 20);
}

function syncDailyRandomDrawDetailActions() {
  const drawState = state.dailyRandomDraw || createDefaultDailyRandomDrawState();
  document.querySelectorAll('[data-daily-random-next]').forEach(button => {
    const remaining = Math.max(0, Number(drawState.remaining || 0));
    button.disabled = Boolean(drawState.busy) || remaining <= 0;
    button.innerHTML = remaining > 0
      ? '<i class="fas fa-dice"></i> 再抽一个（今日剩余 ' + remaining + ' 次）'
      : '<i class="fas fa-hourglass-end"></i> 今天已经抽完啦';
  });
}

function scheduleDailyRandomDrawReset(resetAt) {
  if (dailyRandomDrawResetTimer) {
    clearTimeout(dailyRandomDrawResetTimer);
    dailyRandomDrawResetTimer = null;
  }
  const resetMs = Date.parse(String(resetAt || ''));
  if (!Number.isFinite(resetMs)) return;
  const delay = Math.max(1000, resetMs - Date.now() + 1000);
  dailyRandomDrawResetTimer = setTimeout(() => {
    state.dailyRandomDraw.loaded = false;
    state.dailyRandomDraw.count = 0;
    state.dailyRandomDraw.remaining = Number(state.dailyRandomDraw.limit || 10);
    syncDailyRandomDrawDetailActions();
    if (canUseDailyRandomDraw()) void ensureDailyRandomDrawState(true);
  }, Math.min(delay, 2_147_000_000));
}

function applyDailyRandomDrawPayload(payload) {
  const limit = Math.max(1, Number(payload?.limit || state.dailyRandomDraw.limit || 10));
  const count = Math.max(0, Math.min(limit, Number(payload?.count || 0)));
  state.dailyRandomDraw.loaded = true;
  state.dailyRandomDraw.loading = false;
  state.dailyRandomDraw.count = count;
  state.dailyRandomDraw.limit = limit;
  state.dailyRandomDraw.remaining = Math.max(0, Number(payload?.remaining ?? (limit - count)));
  state.dailyRandomDraw.drawDay = String(payload?.drawDay || '');
  state.dailyRandomDraw.resetAt = String(payload?.resetAt || '');
  scheduleDailyRandomDrawReset(state.dailyRandomDraw.resetAt);
  syncDailyRandomDrawDetailActions();
}

async function ensureDailyRandomDrawState(forceRefresh = false) {
  if (!canUseDailyRandomDraw()) return false;
  if (state.dailyRandomDraw.loading) return false;
  if (state.dailyRandomDraw.loaded && !forceRefresh) return true;

  state.dailyRandomDraw.loading = true;
  try {
    const payload = await apiFetch('/api/projects/random-draw/state', {
      method: 'GET',
      cache: 'no-store',
    });
    applyDailyRandomDrawPayload(payload);
    renderApp();
    return true;
  } catch (error) {
    state.dailyRandomDraw.loading = false;
    console.warn('[CreativeWorkshop] 每日抽卡状态加载失败', error);
    return false;
  }
}

function renderDailyRandomDrawEntry() {
  if (!canUseDailyRandomDraw() || !state.dailyRandomDraw.loaded) return '';
  const drawState = state.dailyRandomDraw;
  const count = Math.max(0, Number(drawState.count || 0));
  const limit = Math.max(1, Number(drawState.limit || 10));
  const disabled = Boolean(drawState.busy) || count >= limit;
  const label = count >= limit ? '今天已经抽完啦' : '每日抽卡（' + count + '/' + limit + '）';
  return '<section class="daily-random-draw"><div class="daily-random-draw-copy"><small>DAILY DRAW</small><strong>' + escapeHtml(label) + '</strong><span>不会抽到当前随机发现、本机已安装和最近抽过的项目</span></div><button type="button" class="btn btn-primary daily-random-draw-btn" id="dailyRandomDrawBtn" ' + (disabled ? 'disabled' : '') + '><i class="fas fa-dice"></i><span>' + (count >= limit ? '明天再来' : '抽一个') + '</span></button></section>';
}

async function performDailyRandomDraw() {
  if (!canUseDailyRandomDraw()) throw new Error('请从 SillyTavern 内打开创意工坊再抽卡');
  if (!state.dailyRandomDraw.loaded) {
    const loaded = await ensureDailyRandomDrawState(true);
    if (!loaded) throw new Error('抽卡状态加载失败，请稍后再试');
  }
  if (state.dailyRandomDraw.busy) {
    const error = new Error('正在抽卡，请稍等');
    error.code = 'DAILY_DRAW_BUSY';
    throw error;
  }
  if (Number(state.dailyRandomDraw.remaining || 0) <= 0) {
    const error = new Error('今天的 10 次抽卡已经用完啦');
    error.code = 'DAILY_DRAW_LIMIT';
    throw error;
  }

  state.dailyRandomDraw.busy = true;
  syncDailyRandomDrawDetailActions();
  try {
    const payload = await apiFetch('/api/projects/random-draw', {
      method: 'POST',
      cache: 'no-store',
      body: JSON.stringify({
        installedProjectIds: getInstalledProjectIdsForDailyDraw(),
        discoverProjectIds: getCurrentDiscoverProjectIdsForDailyDraw(),
      }),
    });
    applyDailyRandomDrawPayload(payload);
    return payload;
  } finally {
    state.dailyRandomDraw.busy = false;
    syncDailyRandomDrawDetailActions();
  }
}

function returnFromDailyRandomDrawToHome(overlay) {
  if (overlay?.isConnected) overlay.remove();
  state.viewMode = 'discover';
  state.showOnlyMyProjects = false;
  state.showSubscribedAndInstalledProjects = false;
  state.sortMode = DEFAULT_SORT_MODE;
  state.activeBaseTag = 'all';
  state.activeTags = [];
  state.searchDraft = '';
  state.searchKeyword = '';
  state.minLikes = 0;
  state.minDownloads = 0;
  state.mobileToolMode = '';
  resetProjectPagination();
  renderApp();
  window.scrollTo({ top: 0, behavior: 'auto' });
  if (!(state.discoverShelves?.discover || []).length && !state.discoverShelves?.loading) {
    void fetchDiscoverShelves(false);
  }
}

async function openNextDailyRandomDraw(currentOverlay = null, triggerButton = null) {
  if (state.dailyRandomDraw.busy) return false;
  const restore = triggerButton ? setButtonLoading(triggerButton, '抽取中') : () => {};
  try {
    const payload = await performDailyRandomDraw();
    const projectId = String(payload?.projectId || '').trim();
    if (!projectId) throw new Error('没有取得项目');
    if (currentOverlay?.isConnected) currentOverlay.remove();
    renderApp();
    await showProjectDetail({ id: projectId }, { dailyRandomDraw: true });
    return true;
  } catch (error) {
    if (error?.code !== 'DAILY_DRAW_BUSY') {
      const message = error?.code === 'DAILY_DRAW_LIMIT'
        ? '今天的 10 次抽卡已经用完啦'
        : error?.message || '抽卡失败，请稍后再试';
      showToast(message, error?.code === 'DAILY_DRAW_LIMIT' ? 'warning' : 'error');
    }
    return false;
  } finally {
    restore();
    renderApp();
  }
}

function attachDailyRandomDrawControls(overlay) {
  if (!overlay?.isConnected) return;
  const modalContent = overlay.querySelector('.modal-content');
  if (!modalContent || modalContent.querySelector('[data-daily-random-actions]')) return;
  overlay.classList.add('daily-random-detail-modal');

  const actions = document.createElement('div');
  actions.className = 'daily-random-detail-actions';
  actions.dataset.dailyRandomActions = 'true';
  actions.innerHTML = '<button type="button" class="btn btn-outline" data-daily-random-back><i class="fas fa-arrow-left"></i> 回到首页</button><button type="button" class="btn btn-primary" data-daily-random-next></button>';
  modalContent.appendChild(actions);

  actions.querySelector('[data-daily-random-back]')?.addEventListener('click', () => {
    returnFromDailyRandomDrawToHome(overlay);
  });
  const nextButton = actions.querySelector('[data-daily-random-next]');
  nextButton?.addEventListener('click', () => {
    void openNextDailyRandomDraw(overlay, nextButton);
  });
  syncDailyRandomDrawDetailActions();
}

function bindDailyRandomDrawEntry() {
  const button = document.getElementById('dailyRandomDrawBtn');
  if (!button) return;
  button.onclick = () => {
    if (button.disabled) return;
    void openNextDailyRandomDraw(null, button);
  };
}
`;
