import { homeApiScript } from './api';
import { homeModalsScript } from './modals';
import { homeCardsRenderScript } from './render/cards';
import { homeDetailModalRenderScript } from './render/detail-modal';
import { homeLayoutRenderScript } from './render/layout';
import { homeStateScript } from './state';
import { homeTavernBridgeScript } from './tavern-bridge';
import { homeUtilsScript } from './utils';

export const homeScript = String.raw`
(function() {
  const app = document.getElementById('app');

  ${homeStateScript}
  ${homeUtilsScript}
  ${homeTavernBridgeScript}
  ${homeApiScript}
  ${homeCardsRenderScript}
  ${homeDetailModalRenderScript}
  ${homeLayoutRenderScript}
  ${homeModalsScript}

  const isEmbedded = window.parent !== window;
  function finishLogin(payload) {
    localStorage.setItem(TOKEN_KEY, payload.token);
    localStorage.setItem(USER_KEY, JSON.stringify(payload.user));
    setCurrentUser(payload.user);
    renderApp();
    showToast('登录成功');
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
            showToast('登录状态检查失败，请重试登录', 'error');
            cleanupBrowserLogin();
            if (!popup.closed) popup.close();
          }
        }, 1000);

        pollTimeout = setTimeout(() => {
          showToast('登录结果轮询超时', 'error');
          cleanupBrowserLogin();
          if (!popup.closed) popup.close();
        }, 60000);
      }
    }).catch(error => showToast('获取登录链接失败: ' + error.message, 'error'));
  }

  function openLoginPopupForEmbedded() {
    apiFetch('/api/auth/login').then(data => {
      if (!data?.url) {
        showToast('登录链接无效', 'error');
        return;
      }

      const state = data.state;

      let pollInterval = null;
      let pollTimeout = null;
      let finished = false;

      const cleanupPoll = () => {
        if (pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
        if (pollTimeout) {
          clearTimeout(pollTimeout);
          pollTimeout = null;
        }
      };

      const finalizePoll = payload => {
        if (finished) return;
        finished = true;
        cleanupPoll();

        if (payload.success && typeof payload.token === 'string' && payload.user) {
          finishLogin(payload);
          return;
        }

        showToast('登录失败: ' + (payload.message || '未收到有效授权结果'), 'error');
      };

      if (state) {
        pollInterval = setInterval(async () => {
          try {
            const payload = await apiFetch('/api/auth/poll?key=' + encodeURIComponent(state), {
              method: 'GET',
            });
            if (payload.ready) {
              finalizePoll(payload);
            }
          } catch (error) {
            finalizePoll({ success: false, message: '登录状态检查失败，请重试登录' });
          }
        }, 3000);

        pollTimeout = setTimeout(() => {
          finalizePoll({ success: false, message: '登录结果轮询超时' });
        }, 60000);
      }

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
    if (payload.success && typeof payload.token === 'string' && payload.user) {
      finishLogin(payload);
      return;
    }

    showToast('登录失败: ' + (payload.message || '未收到有效授权结果'), 'error');
  });

  function logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setCurrentUser(null);
    state.showOnlyMyProjects = false;
    renderApp();
    showToast('已登出');
  }

  function bindStaticActions(filteredProjects) {
    const loginBtn = document.getElementById('loginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const uploadBtn = document.getElementById('uploadBtn');
    const myProjectsMenuBtn = document.getElementById('myProjectsMenuBtn');
    const adminPanelBtn = document.getElementById('adminPanelBtn');
    const addAdminBtn = document.getElementById('addAdminBtn');
    const adminLogsBtn = document.getElementById('adminLogsBtn');
    const installedToggle = document.getElementById('installedProjectsToggle');
    const sortMenuTrigger = document.getElementById('sortMenuTrigger');
    const sortMenu = document.getElementById('sortMenu');
    const searchInput = document.getElementById('projectSearchInput');
    const baseTagFilter = document.getElementById('baseTagFilter');
    const userMenuTrigger = document.getElementById('userMenuTrigger');
    const userMenu = document.getElementById('userMenu');
    const projectLoadMoreBtn = document.getElementById('projectLoadMoreBtn');

    if (loginBtn) loginBtn.onclick = openLoginPopup;
    if (logoutBtn) logoutBtn.onclick = logout;
    if (uploadBtn) uploadBtn.onclick = openUploadModal;
    if (myProjectsMenuBtn) myProjectsMenuBtn.onclick = () => {
      state.showOnlyMyProjects = !state.showOnlyMyProjects;
      if (state.showOnlyMyProjects) {
        state.showSubscribedAndInstalledProjects = false;
      }
      state.userMenuOpen = false;
      renderApp();
    };
    if (adminPanelBtn) adminPanelBtn.onclick = openAdminPanel;
    if (addAdminBtn) addAdminBtn.onclick = openAddAdminModal;
    if (adminLogsBtn) adminLogsBtn.onclick = openAdminLogsModal;

    if (installedToggle) {
      const checkbox = installedToggle.querySelector('input');
      checkbox.addEventListener('change', event => {
        state.showSubscribedAndInstalledProjects = event.target.checked;
        if (state.showSubscribedAndInstalledProjects) {
          state.showOnlyMyProjects = false;
        }
        renderApp();
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
            published: '发布时间',
            updated: '更新日期',
            likes: '点赞数',
            subscribes: '订阅数',
            downloads: '下载量',
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

    if (searchInput) {
      const commitSearch = event => {
        state.searchKeyword = event.target.value;
        renderApp();
      };
      searchInput.onchange = commitSearch;
      searchInput.onblur = commitSearch;
      searchInput.onkeydown = event => {
        if (event.key === 'Enter') {
          commitSearch(event);
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

    if (userMenuTrigger && userMenu) {
      userMenuTrigger.onclick = event => {
        event.stopPropagation();
        state.userMenuOpen = !state.userMenuOpen;
        state.sortMenuOpen = false;
        renderApp();
      };
      document.addEventListener('click', () => {
        if (state.userMenuOpen || state.sortMenuOpen) {
          state.userMenuOpen = false;
          state.sortMenuOpen = false;
          renderApp();
        }
      }, { once: true });
    }

    if (projectLoadMoreBtn) projectLoadMoreBtn.onclick = () => loadMoreProjects();

    document.querySelectorAll('.detail-btn').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        const project = filteredProjects.find(item => item.id === button.dataset.id);
        if (project) {
          const originalHtml = button.innerHTML;
          button.disabled = true;
          button.classList.add('is-loading');
          button.innerHTML = '<span class="inline-loading-spinner"></span><span>加载中</span>';
          Promise.resolve(showProjectDetail(project)).finally(() => {
            button.disabled = false;
            button.classList.remove('is-loading');
            button.innerHTML = originalHtml;
          });
        }
      });
    });

    document.querySelectorAll('.like-btn').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        if (button.dataset.id) toggleLike(button.dataset.id);
      });
    });

    document.querySelectorAll('.subscribe-btn').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        if (button.dataset.id) toggleSubscribe(button.dataset.id);
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
        requestInstallProject(projectId);
      });
    });

    document.querySelectorAll('.update-btn').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        const project = filteredProjects.find(item => item.id === button.dataset.id);
        if (project) {
          requestProjectDiff(project.id);
          openProjectUpdateModal(project);
        }
      });
    });

    document.querySelectorAll('.edit-btn').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        if (button.disabled) return;
        const project = filteredProjects.find(item => item.id === button.dataset.id);
        if (project) openEditProjectModal(project);
      });
    });

    document.querySelectorAll('.delete-btn').forEach(button => {
      button.addEventListener('click', async event => {
        event.stopPropagation();
        if (button.disabled) return;
        const projectId = button.dataset.id;
        if (!projectId || !confirm('确定要删除该项目吗？')) return;
        const restore = setButtonLoading(button, '删除中');
        try {
          await deleteProject(projectId);
          await fetchProjects();
          showToast('项目已删除');
        } catch (error) {
          showToast('删除失败: ' + error.message, 'error');
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
    const filteredProjects = getFilteredProjects();
    app.innerHTML = renderLayout(filteredProjects);
    bindStaticActions(filteredProjects);
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
    await fetchCurrentUser();
    await fetchProjects(true, { page: 0, pageSize: state.projectPagination.pageSize });
  }

  init();
})();
`;
