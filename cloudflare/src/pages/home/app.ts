import { homeApiScript } from './api';
import { homeModalsScript } from './modals';
import { homeCardsRenderScript } from './render/cards';
import { homeDetailModalRenderScript } from './render/detail-modal';
import { homeReviewDiffRenderScript } from './render/review-diff';
import { homeLayoutRenderScript } from './render/layout';
import { homeStateScript } from './state';
import { homeTavernBridgeScript } from './tavern-bridge';
import { homeUploadPreviewScript } from './upload-preview';
import { homeUtilsScript } from './utils';
import { PROJECT_CONTENT_POLICY } from '../../config/project-content-policy';
import { PROJECT_TAXONOMY } from '../../config/project-taxonomy';

const projectContentPolicyJson = JSON.stringify(PROJECT_CONTENT_POLICY);
const projectTaxonomyJson = JSON.stringify(PROJECT_TAXONOMY);

export const homeScript = String.raw`
(function() {
  const app = document.getElementById('app');
  const PROJECT_CONTENT_POLICY = ${projectContentPolicyJson};
  const PROJECT_TAXONOMY = ${projectTaxonomyJson};

  ${homeStateScript}
  ${homeUtilsScript}
  ${homeTavernBridgeScript}
  ${homeApiScript}
  ${homeCardsRenderScript}
  ${homeDetailModalRenderScript}
  ${homeUploadPreviewScript}
  ${homeReviewDiffRenderScript}
  ${homeLayoutRenderScript}
  ${homeModalsScript}

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

  function bindStaticActions(filteredProjects) {
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const workshopCloseBtn = document.getElementById('workshopCloseBtn');
    const uploadBtn = document.getElementById('uploadBtn');
    const myProjectsMenuBtn = document.getElementById('myProjectsMenuBtn');
    const adminPanelBtn = document.getElementById('adminPanelBtn');
    const addAdminBtn = document.getElementById('addAdminBtn');
    const adminLogsBtn = document.getElementById('adminLogsBtn');
    const installedToggle = document.getElementById('installedProjectsToggle');
    const sortMenuTrigger = document.getElementById('sortMenuTrigger');
    const sortMenu = document.getElementById('sortMenu');
    const fontMenuTrigger = document.getElementById('fontMenuTrigger');
    const fontMenu = document.getElementById('fontMenu');
    const searchInput = document.getElementById('projectSearchInput');
    const baseTagFilter = document.getElementById('baseTagFilter');
    const mobileBaseTagFilter = document.getElementById('mobileBaseTagFilter');

    const userMenuTrigger = document.getElementById('userMenuTrigger');
    const userMenu = document.getElementById('userMenu');
    const projectLoadMoreBtn = document.getElementById('projectLoadMoreBtn');
    const releaseNoticeBtn = document.getElementById('releaseNoticeBtn');
    const mobileSearchInput = document.getElementById('projectSearchInputMobile');
    const mobileToolSheet = document.getElementById('mobileToolSheet');
    const mobileToolBackdrop = document.getElementById('mobileToolBackdrop');
    const mobileToolClose = document.getElementById('mobileToolClose');

    if (loginBtn) loginBtn.onclick = openLoginPopup;
    if (releaseNoticeBtn) releaseNoticeBtn.onclick = openReleaseNoticeModal;

    const closeMobileTool = () => {
      if (!mobileToolSheet || !mobileToolBackdrop) return;
      state.mobileToolMode = '';
      mobileToolSheet.classList.remove('show');
      mobileToolBackdrop.classList.remove('show');
      mobileToolSheet.setAttribute('aria-hidden', 'true');
      document.querySelectorAll('[data-mobile-tool]').forEach(button => button.classList.remove('active'));
    };
    const openMobileTool = mode => {
      if (!mobileToolSheet || !mobileToolBackdrop) return;
      state.mobileToolMode = mode;
      const titleMap = { page: '页面', search: '搜索', sort: '排序', font: '内容字体' };
      const title = document.getElementById('mobileToolTitle');
      if (title) title.textContent = titleMap[mode] || '浏览工具';
      mobileToolSheet.querySelectorAll('[data-mobile-panel]').forEach(panel => {
        panel.hidden = panel.dataset.mobilePanel !== mode;
      });
      mobileToolSheet.classList.add('show');
      mobileToolBackdrop.classList.add('show');
      mobileToolSheet.setAttribute('aria-hidden', 'false');
      document.querySelectorAll('[data-mobile-tool]').forEach(button => button.classList.toggle('active', button.dataset.mobileTool === mode));
      if (mode === 'search') setTimeout(() => mobileSearchInput?.focus(), 120);
    };
    if (mobileToolClose) mobileToolClose.onclick = closeMobileTool;
    if (mobileToolBackdrop) mobileToolBackdrop.onclick = closeMobileTool;
    document.querySelectorAll('[data-mobile-tool]').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        openMobileTool(button.dataset.mobileTool || 'search');
      });
    });
    if (workshopCloseBtn) workshopCloseBtn.onclick = requestCloseWorkshop;
    if (logoutBtn) logoutBtn.onclick = logout;
    if (uploadBtn) uploadBtn.onclick = event => {
      event.stopPropagation();
      state.userMenuOpen = false;
      try {
        openUploadModal();
      } catch (error) {
        console.error('[CreativeWorkshop] failed to open upload modal', error);
        showToast('无法打开上传窗口: ' + (error?.message || String(error)), 'error');
      }
    };
    if (myProjectsMenuBtn) myProjectsMenuBtn.onclick = async () => {
      state.showOnlyMyProjects = !state.showOnlyMyProjects;
      if (state.showOnlyMyProjects) {
        state.showSubscribedAndInstalledProjects = false;
      }
      state.userMenuOpen = false;
      renderApp();

      if (state.showOnlyMyProjects && state.currentUser) {
        try {
          const myData = await apiFetch('/api/my/projects');
          setMyProjects(myData.projects || []);
        } catch (error) {
          showToast('加载我的项目失败: ' + error.message, 'warning');
        }
        renderApp();
      }
    };
    if (adminPanelBtn) adminPanelBtn.onclick = openAdminPanel;
    if (addAdminBtn) addAdminBtn.onclick = openAddAdminModal;
    if (adminLogsBtn) adminLogsBtn.onclick = openAdminLogsModal;

    if (installedToggle) {
      const checkbox = installedToggle.querySelector('input');
      checkbox.addEventListener('change', async event => {
        state.showSubscribedAndInstalledProjects = event.target.checked;
        if (state.showSubscribedAndInstalledProjects && state.tavern.connected && state.tavern.installedProjectsLoaded) {
          try {
            await fetchInstalledProjectDetails();
          } catch (error) {
            console.warn('[CreativeWorkshop] 加载已安装项目远端详情失败', error);
          }
        }
        if (state.showSubscribedAndInstalledProjects) {
          state.showOnlyMyProjects = false;
        }
        renderApp();

        if (state.showSubscribedAndInstalledProjects && state.currentUser) {
          try {
            await fetchSubscriptions();
          } catch (error) {
            showToast('加载订阅项目失败: ' + error.message, 'warning');
          }
          renderApp();
        }
      });
    }

    if (sortMenuTrigger && sortMenu) {
      sortMenuTrigger.onclick = event => {
        event.stopPropagation();
        if (state.sortRequestPending) {
          return;
        }
        state.sortMenuOpen = !state.sortMenuOpen;
        state.userMenuOpen = false;
        state.fontMenuOpen = false;
        renderApp();
      };

      sortMenu.querySelectorAll('[data-sort-value]').forEach(button => {
        button.addEventListener('click', event => {
          event.stopPropagation();
          if (state.sortRequestPending) {
            return;
          }
          const nextSortMode = button.dataset.sortValue || DEFAULT_SORT_MODE;
          if (state.sortMode === nextSortMode) {
            state.sortMenuOpen = false;
            renderApp();
            return;
          }
          state.sortRequestPending = true;
          const sortLabelMap = {
            discover: '发现',
            published: '最新',
            rating: '玩家好评',
            downloads: '下载最多',
          };
          showToast('正在按' + (sortLabelMap[nextSortMode] || '当前方式') + '排序...', 'info');
          state.sortMode = nextSortMode;
          state.sortMenuOpen = false;
          resetProjectPagination();
          renderApp();
          fetchProjects(true, {
            page: 0,
            pageSize: state.projectPagination.pageSize,
          }).finally(() => {
            state.sortRequestPending = false;
            renderApp();
          });
        });
      });
    }

    if (fontMenuTrigger && fontMenu) {
      fontMenuTrigger.onclick = event => {
        event.stopPropagation();
        state.fontMenuOpen = !state.fontMenuOpen;
        state.sortMenuOpen = false;
        state.userMenuOpen = false;
        renderApp();
        document.addEventListener('click', () => {
          if (!state.fontMenuOpen) return;
          state.fontMenuOpen = false;
          renderApp();
        }, { once: true });
      };
    }

    document.querySelectorAll('[data-font-value]').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        const nextFont = button.dataset.fontValue || DEFAULT_CONTENT_FONT;
        const option = applyContentFont(nextFont, true);
        state.fontMenuOpen = false;
        renderApp();
        showToast('内容字体：' + option.label, 'info');
      });
    });

    document.querySelectorAll('.mobile-sort-option[data-sort-value]').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        if (state.sortRequestPending) return;
        const nextSortMode = button.dataset.sortValue || DEFAULT_SORT_MODE;
        if (state.sortMode === nextSortMode) {
          closeMobileTool();
          return;
        }
        state.sortRequestPending = true;
        const sortLabelMap = { discover: '发现', published: '最新', rating: '玩家好评', downloads: '下载最多' };
        showToast('正在按' + (sortLabelMap[nextSortMode] || '当前方式') + '排序...', 'info');
        state.sortMode = nextSortMode;
        state.sortMenuOpen = false;
        resetProjectPagination();
        renderApp();
        fetchProjects(true, {
          page: 0,
          pageSize: state.projectPagination.pageSize,
        }).finally(() => {
          state.sortRequestPending = false;
          renderApp();
        });
      });
    });

    const filterLocalSearchTagSuggestions = (input, value) => {
      const root = input?.closest('[data-unified-search]');
      if (!root) return;
      const query = String(value || '').trim().toLowerCase();
      let visibleTotal = 0;
      root.querySelectorAll('[data-search-tag-group]').forEach(group => {
        const groupLabel = String(group.querySelector('.search-tag-group-title')?.textContent || '').toLowerCase();
        let visibleCount = 0;
        group.querySelectorAll('[data-search-tag]').forEach(button => {
          const tag = String(button.dataset.searchTag || '').toLowerCase();
          const visible = !query || tag.includes(query) || groupLabel.includes(query);
          button.hidden = !visible;
          if (visible) {
            visibleCount += 1;
            visibleTotal += 1;
          }
        });
        group.hidden = visibleCount === 0;
      });
      const emptyState = root.querySelector('.search-tag-empty');
      if (emptyState) emptyState.hidden = !query || visibleTotal > 0;
    };

    if (searchInput) {
      const runSearch = value => {
        const nextKeyword = String(value || '').trim();
        state.searchKeyword = nextKeyword;
        state.searchDraft = '';
        if (nextKeyword === lastCommittedSearchKeyword) {
          renderApp();
          return;
        }
        lastCommittedSearchKeyword = nextKeyword;
        resetProjectPagination();
        void fetchProjects(true, { page: 0, pageSize: state.projectPagination.pageSize });
      };
      searchInput.oninput = event => {
        state.searchDraft = event.target.value;
        filterLocalSearchTagSuggestions(event.currentTarget, event.target.value);
      };

      searchInput.onkeydown = event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          runSearch(event.target.value);
        }
      };
    }

    if (mobileSearchInput) {
      const runMobileSearch = value => {
        const nextKeyword = String(value || '').trim();
        state.searchKeyword = nextKeyword;
        state.searchDraft = '';
        state.mobileToolMode = '';
        if (searchInput && searchInput.value !== nextKeyword) searchInput.value = nextKeyword;
        if (nextKeyword === lastCommittedSearchKeyword) {
          renderApp();
          return;
        }
        lastCommittedSearchKeyword = nextKeyword;
        resetProjectPagination();
        void fetchProjects(true, { page: 0, pageSize: state.projectPagination.pageSize });
      };
      mobileSearchInput.oninput = event => {
        state.searchDraft = event.target.value;
        filterLocalSearchTagSuggestions(event.currentTarget, event.target.value);
      };

      mobileSearchInput.onkeydown = event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          runMobileSearch(event.target.value);
          closeMobileTool();
        }
      };
    }

    if (baseTagFilter) {
      baseTagFilter.addEventListener('click', event => {
        if (state.filterRequestPending) {
          return;
        }
        const nextTagButton = event.target instanceof Element ? event.target.closest('[data-base-tag]') : null;
        if (!nextTagButton) return;
        const nextTag = nextTagButton.dataset.baseTag || 'all';
        if (state.activeBaseTag === nextTag) return;
        state.activeBaseTag = nextTag;
        state.activeTags = [];
        state.searchDraft = '';

        if (state.showOnlyMyProjects || state.showSubscribedAndInstalledProjects) {
          renderApp();
          return;
        }

        resetProjectPagination();
        state.filterRequestPending = true;
        renderApp();
        fetchProjects(true, {
          page: 0,
          pageSize: state.projectPagination.pageSize,
        }).finally(() => {
          state.filterRequestPending = false;
          renderApp();
        });
      });
    }

    const mobileTagFilter = mobileBaseTagFilter;
    if (mobileTagFilter) {
      mobileTagFilter.addEventListener('click', event => {
        if (state.filterRequestPending) return;
        const nextTagButton = event.target instanceof Element ? event.target.closest('[data-base-tag]') : null;
        if (!nextTagButton) return;
        const nextTag = nextTagButton.dataset.baseTag || 'all';
        if (state.activeBaseTag === nextTag) {
          closeMobileTool();
          return;
        }
        state.activeBaseTag = nextTag;
        state.activeTags = [];
        state.searchDraft = '';
        state.mobileToolMode = '';
        if (state.showOnlyMyProjects || state.showSubscribedAndInstalledProjects) {
          renderApp();
          return;
        }
        resetProjectPagination();
        state.filterRequestPending = true;
        renderApp();
        fetchProjects(true, {
          page: 0,
          pageSize: state.projectPagination.pageSize,
        }).finally(() => {
          state.filterRequestPending = false;
          renderApp();
        });
      });
    }

    const applyOfficialTagFilters = nextTags => {
      const normalized = Array.from(new Set((Array.isArray(nextTags) ? nextTags : [])
        .map(value => String(value || '').trim())
        .filter(Boolean))).slice(0, 12);
      const current = getActivePublicTags();
      if (normalized.length === current.length && normalized.every((tag, index) => tag === current[index])) return;
      state.activeTags = normalized;
      state.searchDraft = '';
      if (state.showOnlyMyProjects || state.showSubscribedAndInstalledProjects) {
        renderApp();
        return;
      }
      resetProjectPagination();
      state.filterRequestPending = true;
      renderApp();
      fetchProjects(true, {
        page: 0,
        pageSize: state.projectPagination.pageSize,
      }).finally(() => {
        state.filterRequestPending = false;
        renderApp();
      });
    };

    const toggleSearchTag = tagValue => {
      if (state.filterRequestPending) return;
      const tag = String(tagValue || '').trim();
      if (!tag) return;
      const current = getActivePublicTags();
      if (!current.includes(tag) && current.length >= 12) {
        showToast('最多同时选择 12 个官方标签', 'warning');
        return;
      }
      applyOfficialTagFilters(current.includes(tag) ? current.filter(value => value !== tag) : [...current, tag]);
    };

    document.querySelectorAll('[data-search-tag]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        toggleSearchTag(button.dataset.searchTag);
      });
    });

    document.querySelectorAll('[data-remove-search-tag]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const tag = String(button.dataset.removeSearchTag || '').trim();
        if (!tag || state.filterRequestPending) return;
        applyOfficialTagFilters(getActivePublicTags().filter(value => value !== tag));
      });
    });

    document.querySelectorAll('[data-clear-all-search-tags]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (state.filterRequestPending) return;
        applyOfficialTagFilters([]);
      });
    });

    document.querySelectorAll('[data-clear-text-search]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (!state.searchKeyword && !state.searchDraft) return;
        state.searchKeyword = '';
        state.searchDraft = '';
        lastCommittedSearchKeyword = '';
        resetProjectPagination();
        renderApp();
        void fetchProjects(true, { page: 0, pageSize: state.projectPagination.pageSize });
      });
    });

    if (searchInput) filterLocalSearchTagSuggestions(searchInput, searchInput.value);
    if (mobileSearchInput) filterLocalSearchTagSuggestions(mobileSearchInput, mobileSearchInput.value);

    if (userMenuTrigger && userMenu) {
      userMenuTrigger.onclick = event => {
        event.stopPropagation();
        state.userMenuOpen = !state.userMenuOpen;
        state.sortMenuOpen = false;
        state.fontMenuOpen = false;
        renderApp();
      };
      document.addEventListener('click', () => {
        if (state.userMenuOpen || state.sortMenuOpen || state.fontMenuOpen) {
          state.userMenuOpen = false;
          state.sortMenuOpen = false;
          state.fontMenuOpen = false;
          renderApp();
        }
      }, { once: true });
    }

    if (projectLoadMoreBtn) projectLoadMoreBtn.onclick = () => loadMoreProjects();

    document.querySelectorAll('.project-card').forEach(card => {
      const openDetail = () => {
        const project = filteredProjects.find(item => item.id === card.dataset.id);
        if (project) showProjectDetail(project);
      };
      card.addEventListener('click', openDetail);
      card.addEventListener('keydown', event => {
        if (event.target !== card || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        openDetail();
      });
    });

    document.querySelectorAll('.card-more-btn').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        const card = button.closest('.project-card');
        if (!card) return;
        const shouldOpen = !card.classList.contains('admin-menu-open');
        document.querySelectorAll('.project-card.admin-menu-open').forEach(openCard => openCard.classList.remove('admin-menu-open'));
        if (!shouldOpen) return;
        card.classList.add('admin-menu-open');
        document.addEventListener('click', () => card.classList.remove('admin-menu-open'), { once: true });
      });
    });

    document.querySelectorAll('.card-admin-menu').forEach(menu => {
      menu.addEventListener('click', event => event.stopPropagation());
    });

    document.querySelectorAll('.like-btn').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        if (button.dataset.id) toggleLike(button.dataset.id);
      });
    });

    document.querySelectorAll('.install-btn').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        const projectId = button.dataset.id;
        const project = filteredProjects.find(item => item.id === projectId);
        if (!projectId || !project) return;
        const localMeta = getLocalProjectMeta(projectId);
        if (localMeta) {
          requestUninstallProject(projectId);
          return;
        }
        const restore = setButtonLoading(button, '加载安装');
        void beginProjectInstall(project)
          .catch(error => showToast('安装失败: ' + error.message, 'error'))
          .finally(restore);
      });
    });

    document.querySelectorAll('.update-btn').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        const project = filteredProjects.find(item => item.id === button.dataset.id);
        if (project) {
          const restore = setButtonLoading(button, '加载差异');
          requestProjectDiff(project.id, project.version)
            .then(diff => openProjectUpdateModal(project, diff))
            .catch(error => showToast('加载更新差异失败: ' + error.message, 'error'))
            .finally(restore);
        }
      });
    });

    document.querySelectorAll('.edit-btn').forEach(button => {
      button.addEventListener('click', async event => {
        event.stopPropagation();
        if (button.disabled) return;
        const project = filteredProjects.find(item => item.id === button.dataset.id);
        if (!project) return;

        const restore = setButtonLoading(button, '加载内容');
        try {
          const editableProjectId = project.draftProjectId || project.id;
          const editableDetail = await fetchProjectEntries(editableProjectId, { forceRefresh: true });
          const editableProject = {
            ...(editableDetail?.project || project),
            publishedVersion:
              editableDetail?.project?.publishedVersion ||
              project.publishedVersion ||
              (project.draftProjectId ? project.version : undefined),
          };
          openEditProjectModal(editableProject);
        } catch (error) {
          showToast('加载可编辑版本失败: ' + error.message, 'error');
        } finally {
          restore();
        }
      });
    });

    document.querySelectorAll('.delete-btn').forEach(button => {
      button.addEventListener('click', async event => {
        event.stopPropagation();
        if (button.disabled) return;
        const projectId = button.dataset.id;
        const project = filteredProjects.find(item => item.id === projectId);
        if (!projectId || !project) return;
        const isReviewDraft = Boolean(project.reviewTarget === 'draft' && project.publishedProjectId);
        const isPublishedWithDraft = Boolean(project.isPublished && (project.hasPendingDraft || project.draftProjectId));
        const confirmText = isReviewDraft
          ? '确定撤回这次更新吗？已发布版本会继续保留。'
          : isPublishedWithDraft
            ? '确定删除这个正式项目吗？正在审核/被退回的更新草稿也会一并删除。'
            : '确定要删除该项目吗？';
        if (!confirm(confirmText)) return;
        const restore = setButtonLoading(button, isReviewDraft ? '撤回中' : '删除中');
        try {
          await deleteProject(projectId);
          await fetchProjects();
          showToast(isReviewDraft ? '更新草稿已撤回，已发布版本保持不变' : '项目已删除');
        } catch (error) {
          showToast((isReviewDraft ? '撤回失败: ' : '删除失败: ') + error.message, 'error');
        } finally {
          restore();
        }
      });
    });

    document.querySelectorAll('.delete-project-btn').forEach(button => {
      button.addEventListener('click', async event => {
        event.stopPropagation();
        const publishedProjectId = button.dataset.id;
        if (!publishedProjectId) return;
        if (!confirm('确定删除整个项目吗？已发布版本和当前审核/退回草稿都会一起删除。')) return;
        const restore = setButtonLoading(button, '删除中');
        try {
          await deleteProject(publishedProjectId);
          await fetchProjects();
          showToast('整个项目已删除');
        } catch (error) {
          showToast('删除项目失败: ' + error.message, 'error');
        } finally {
          restore();
        }
      });
    });

    document.querySelectorAll('.visibility-btn').forEach(button => {
      button.addEventListener('click', async event => {
        event.stopPropagation();
        const projectId = button.dataset.id;
        const visible = button.dataset.visible === '1';
        if (!projectId) return;
        const restore = setButtonLoading(button, visible ? '隐藏中' : '公开中');
        try {
          await updateProjectVisibility(projectId, !visible);
          await fetchProjects();
          showToast(!visible ? '项目已公开' : '项目已隐藏');
        } catch (error) {
          showToast('操作失败: ' + error.message, 'error');
        } finally {
          restore();
        }
      });
    });
  }

  function renderApp() {
    applyContentFont(state.contentFont);
    const filteredProjects = getFilteredProjects();
    app.innerHTML = renderLayout(filteredProjects);
    bindStaticActions(filteredProjects);
    bindCoverImageFallbacks();
  }

  async function init() {
    if (window.__CW_TAVERN_MOCK__) {
      setTavernConnectionStatus('connected');
      setInstalledProjects(window.__CW_TAVERN_MOCK__.installedProjects || []);
      (window.__CW_TAVERN_MOCK__.projectDiffs || []).forEach(item => {
        setProjectUpdateDiff(item.projectId, item.diff);
      });
    } else {
      initializeTavernBridge();
    }
    resetProjectPagination();
    const authState = await fetchCurrentUser();
    if (authState?.user) {
      clearPendingOAuth();
    } else {
      resumeEmbeddedOAuthPolling();
    }
    showRejectedProjectReminder(authState?.rejectedProjects);
    await fetchProjects(false, { page: 0, pageSize: state.projectPagination.pageSize });
  }

  init();
})();
`;
