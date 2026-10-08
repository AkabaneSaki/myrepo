export const homeAppAuthFlowScript = String.raw`
  const isEmbedded = window.parent !== window;
  const REJECTED_REMINDER_STORAGE_PREFIX = 'creative_workshop_rejected_reminders_v1:';
  const PENDING_OAUTH_STORAGE_KEY = 'creative_workshop_pending_oauth_v1';
  const OAUTH_POLL_INTERVAL_MS = 3000;
  const OAUTH_MAX_WAIT_MS = 5 * 60 * 1000;
  let lastCommittedSearchKeyword = String(state.searchKeyword || '').trim();
  let embeddedOAuthSession = null;

  function showRejectedProjectReminder(projects) {
    if (!state.currentUser || !Array.isArray(projects)) return false;
    const rejectedProjects = projects.filter(project => project && project.id);
    if (!rejectedProjects.length) return false;

    const storageKey = REJECTED_REMINDER_STORAGE_PREFIX + state.currentUser.id;
    let seen = {};
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || '{}');
      if (stored && typeof stored === 'object' && !Array.isArray(stored)) seen = stored;
    } catch {}

    const unseen = rejectedProjects.filter(project => {
      const projectId = String(project.id);
      const rejectionToken = String(project.reviewedAt || project.updatedAt || 'rejected');
      return seen[projectId] !== rejectionToken;
    });
    if (!unseen.length) return false;

    unseen.forEach(project => {
      seen[String(project.id)] = String(project.reviewedAt || project.updatedAt || 'rejected');
    });
    const seenEntries = Object.entries(seen);
    if (seenEntries.length > 100) seen = Object.fromEntries(seenEntries.slice(-100));
    try {
      localStorage.setItem(storageKey, JSON.stringify(seen));
    } catch {}

    if (unseen.length === 1) {
      showToast('项目「' + (unseen[0].name || '未命名项目') + '」审核被退回，请到「我的项目」查看原因并修改', 'warning');
    } else {
      showToast('有 ' + unseen.length + ' 个项目审核被退回，请到「我的项目」查看并修改', 'warning');
    }
    return true;
  }

  function readPendingOAuth() {
    try {
      const raw = localStorage.getItem(PENDING_OAUTH_STORAGE_KEY);
      if (!raw) return null;
      const pending = JSON.parse(raw);
      const oauthState = typeof pending?.state === 'string' ? pending.state.trim() : '';
      const startedAt = Number(pending?.startedAt);
      if (!oauthState || !Number.isFinite(startedAt) || startedAt <= 0) {
        localStorage.removeItem(PENDING_OAUTH_STORAGE_KEY);
        return null;
      }
      return { state: oauthState, startedAt };
    } catch {
      localStorage.removeItem(PENDING_OAUTH_STORAGE_KEY);
      return null;
    }
  }

  function persistPendingOAuth(oauthState, startedAt = Date.now()) {
    const pending = { state: oauthState, startedAt };
    try {
      localStorage.setItem(PENDING_OAUTH_STORAGE_KEY, JSON.stringify(pending));
    } catch (error) {
      console.warn('[CreativeWorkshop] OAuth pending state persistence failed', error);
    }
    return pending;
  }

  function clearPendingOAuth(expectedState = null) {
    if (!expectedState) {
      localStorage.removeItem(PENDING_OAUTH_STORAGE_KEY);
      return;
    }

    const pending = readPendingOAuth();
    if (!pending || pending.state === expectedState) {
      localStorage.removeItem(PENDING_OAUTH_STORAGE_KEY);
    }
  }

  function stopEmbeddedOAuthPolling({ clearPending = false } = {}) {
    const session = embeddedOAuthSession;
    if (!session) {
      if (clearPending) clearPendingOAuth();
      return;
    }

    session.finished = true;
    if (session.pollInterval) clearInterval(session.pollInterval);
    if (session.pollTimeout) clearTimeout(session.pollTimeout);
    embeddedOAuthSession = null;
    if (clearPending) clearPendingOAuth(session.state);
  }

  function finalizeEmbeddedOAuth(payload) {
    const session = embeddedOAuthSession;
    if (!session || session.finished) return;

    if (payload?.success && typeof payload.token === 'string' && payload.user) {
      finishLogin(payload);
      return;
    }

    stopEmbeddedOAuthPolling({ clearPending: true });
    showToast('登录失败: ' + (payload?.message || '未收到有效授权结果'), 'error');
  }

  async function pollEmbeddedOAuthOnce({ force = false } = {}) {
    const session = embeddedOAuthSession;
    if (!session || session.finished || session.pollInFlight) return;

    if (Date.now() - session.startedAt >= OAUTH_MAX_WAIT_MS) {
      finalizeEmbeddedOAuth({ success: false, message: '登录结果轮询超时' });
      return;
    }

    if (!force && (document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus()))) {
      return;
    }

    session.pollInFlight = true;
    try {
      const payload = await apiFetch('/api/auth/poll?key=' + encodeURIComponent(session.state), {
        method: 'GET',
      });
      if (session !== embeddedOAuthSession || session.finished) return;
      if (payload.ready) finalizeEmbeddedOAuth(payload);
    } catch (error) {
      if (session === embeddedOAuthSession && !session.finished) {
        console.warn('[CreativeWorkshop] OAuth poll temporary failure; retrying', error);
      }
    } finally {
      if (session === embeddedOAuthSession) session.pollInFlight = false;
    }
  }

  function startEmbeddedOAuthPolling(oauthState, startedAt = Date.now()) {
    const normalizedState = typeof oauthState === 'string' ? oauthState.trim() : '';
    if (!normalizedState) return false;

    const normalizedStartedAt = Number.isFinite(Number(startedAt)) ? Number(startedAt) : Date.now();
    const elapsed = Date.now() - normalizedStartedAt;
    if (elapsed >= OAUTH_MAX_WAIT_MS || elapsed < -60000) {
      clearPendingOAuth(normalizedState);
      return false;
    }

    if (embeddedOAuthSession?.state === normalizedState && !embeddedOAuthSession.finished) {
      return true;
    }

    if (embeddedOAuthSession) stopEmbeddedOAuthPolling();
    persistPendingOAuth(normalizedState, normalizedStartedAt);

    const remaining = Math.max(1, OAUTH_MAX_WAIT_MS - Math.max(0, elapsed));
    const session = {
      state: normalizedState,
      startedAt: normalizedStartedAt,
      pollInterval: null,
      pollTimeout: null,
      pollInFlight: false,
      finished: false,
    };
    embeddedOAuthSession = session;
    session.pollInterval = setInterval(() => void pollEmbeddedOAuthOnce(), OAUTH_POLL_INTERVAL_MS);
    session.pollTimeout = setTimeout(() => {
      if (embeddedOAuthSession === session) {
        finalizeEmbeddedOAuth({ success: false, message: '登录结果轮询超时' });
      }
    }, remaining);
    return true;
  }

  function resumeEmbeddedOAuthPolling() {
    if (!isEmbedded || state.currentUser) return;
    const pending = readPendingOAuth();
    if (!pending) return;

    if (Date.now() - pending.startedAt >= OAUTH_MAX_WAIT_MS) {
      clearPendingOAuth(pending.state);
      return;
    }

    startEmbeddedOAuthPolling(pending.state, pending.startedAt);
    void pollEmbeddedOAuthOnce({ force: true });
  }

  function finishLogin(payload) {
    stopEmbeddedOAuthPolling({ clearPending: true });
    clearAuthenticatedCoverObjectUrls();
    localStorage.setItem(TOKEN_KEY, payload.token);
    localStorage.setItem(USER_KEY, JSON.stringify(payload.user));
    invalidateAllProjectDetailCaches();
    setCurrentUser(payload.user);
    renderApp();
    void fetchDevTeamRecommendations(true).then(() => renderApp())
      .catch(error => console.warn('[CreativeWorkshop] 编辑精选刷新失败', error));
    apiFetch('/api/auth/me', { method: 'GET' })
      .then(data => {
        if (!showRejectedProjectReminder(data.rejectedProjects)) showToast('登录成功');
      })
      .catch(() => {
        if (state.currentUser) showToast('登录成功');
      });
  }

  function openLoginPopupForBrowser() {
    const width = 600;
    const height = 700;
    const left = (screen.width - width) / 2;
    const top = (screen.height - height) / 2;

    apiFetch('/api/auth/login').then(data => {
      const url = data.url;
      const state = data.state;
      const popup = window.open(url, 'discord-login', 'width=' + width + ',height=' + height + ',left=' + left + ',top=' + top);
      if (!popup) {
        showToast('请允许浏览器弹窗', 'warning');
        return;
      }

      let pollInterval = null;
      let pollTimeout = null;
      const cleanupBrowserLogin = () => {
        window.removeEventListener('message', messageHandler);
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        if (pollTimeout) {
          clearTimeout(pollTimeout);
          pollTimeout = null;
        }
      };
      const finalizeBrowserLogin = payload => {
        finishLogin(payload);
        cleanupBrowserLogin();
        if (!popup.closed) popup.close();
      };

      const messageHandler = async event => {
        if (event.origin !== window.location.origin || event.source !== popup || !event.data || typeof event.data !== 'object') {
          return;
        }

        if (event.data.type === 'oauth-success' && event.data.source === 'creative-workshop-auth-callback' && event.data.state === state && typeof event.data.token === 'string' && event.data.user) {
          finalizeBrowserLogin(event.data);
        } else if (event.data.type === 'oauth-error') {
          showToast('登录失败: ' + event.data.message, 'error');
          cleanupBrowserLogin();
        }
      };
      window.addEventListener('message', messageHandler);

      if (state) {
        pollInterval = setInterval(async () => {
          try {
            const result = await fetch('/api/auth/poll?key=' + encodeURIComponent(state));
            if (!result.ok) {
              throw new Error('登录状态检查失败(' + result.status + ')');
            }
            const payload = await result.json();
            if (payload.ready && payload.token && payload.user) {
              finalizeBrowserLogin(payload);
              return;
            }
            if (payload.ready && payload.success === false) {
              showToast('登录失败: ' + (payload.message || '未收到有效授权结果'), 'error');
              cleanupBrowserLogin();
              if (!popup.closed) popup.close();
            }
          } catch (error) {
            console.warn('[CreativeWorkshop] OAuth popup poll temporary failure; retrying', error);
          }
        }, 1000);

        pollTimeout = setTimeout(() => {
          showToast('登录结果轮询超时', 'error');
          cleanupBrowserLogin();
          if (!popup.closed) popup.close();
        }, OAUTH_MAX_WAIT_MS);
      }
    }).catch(error => showToast('获取登录链接失败: ' + error.message, 'error'));
  }

  function openLoginPopupForEmbedded() {
    apiFetch('/api/auth/login').then(data => {
      if (!data?.url || !data?.state) {
        showToast('登录链接无效', 'error');
        return;
      }

      startEmbeddedOAuthPolling(data.state);
      requestOAuthLogin(data.url, data.state);
    }).catch(error => showToast('获取登录链接失败: ' + error.message, 'error'));
  }

  function openLoginPopup() {
    if (isEmbedded) {
      openLoginPopupForEmbedded();
      return;
    }

    openLoginPopupForBrowser();
  }

  function requireDiscordLoginForDownload(actionLabel = '继续') {
    if (state.currentUser && localStorage.getItem(TOKEN_KEY)) return true;
    showToast('请先 Discord 登录后' + actionLabel, 'info');
    openLoginPopup();
    return false;
  }

  window.addEventListener(TAVERN_OAUTH_RESULT_EVENT, event => {
    const payload = event.detail || {};

    if (isEmbedded) {
      if (!embeddedOAuthSession) {
        const pending = readPendingOAuth();
        if (pending && (!payload.state || payload.state === pending.state)) {
          startEmbeddedOAuthPolling(pending.state, pending.startedAt);
        }
      }

      if (embeddedOAuthSession) {
        if (payload.state && payload.state !== embeddedOAuthSession.state) return;
        if (payload.callbackReady) {
          void pollEmbeddedOAuthOnce({ force: true });
          return;
        }
        finalizeEmbeddedOAuth(payload);
        return;
      }

      if (payload.callbackReady) return;
    }

    if (payload.success && typeof payload.token === 'string' && payload.user) {
      finishLogin(payload);
      return;
    }

    showToast('登录失败: ' + (payload.message || '未收到有效授权结果'), 'error');
  });

  if (isEmbedded) {
    window.addEventListener('focus', resumeEmbeddedOAuthPolling);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) resumeEmbeddedOAuthPolling();
    });
  }

  function logout() {
    stopEmbeddedOAuthPolling({ clearPending: true });
    clearAuthenticatedCoverObjectUrls();
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    invalidateAllProjectDetailCaches();
    setCurrentUser(null);
    state.showOnlyMyProjects = false;
    renderApp();
    showToast('已登出');
  }
`;
