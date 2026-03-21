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

  function openLoginPopup() {
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
      const finishLogin = payload => {
        localStorage.setItem(TOKEN_KEY, payload.token);
        localStorage.setItem(USER_KEY, JSON.stringify(payload.user));
        setCurrentUser(payload.user);
        renderApp();
        showToast('登录成功');
        window.removeEventListener('message', messageHandler);
        if (pollInterval) {
          clearInterval(pollInterval);
        }
        if (!popup.closed) popup.close();
      };

      const messageHandler = async event => {
        if (event.origin !== window.location.origin || event.source !== popup || !event.data || typeof event.data !== 'object') {
          return;
        }

        if (event.data.type === 'oauth-success' && typeof event.data.token === 'string' && event.data.user) {
          finishLogin(event.data);
        } else if (event.data.type === 'oauth-error') {
          showToast('登录失败: ' + event.data.message, 'error');
          window.removeEventListener('message', messageHandler);
          if (pollInterval) {
            clearInterval(pollInterval);
          }
        }
      };
      window.addEventListener('message', messageHandler);

      if (state) {
        pollInterval = setInterval(async () => {
          try {
            const result = await fetch('/api/auth/poll?key=' + encodeURIComponent(state));
            const payload = await result.json();
            if (payload.ready && payload.token && payload.user) {
              finishLogin(payload);
            }
          } catch (error) {}
        }, 1000);
      }
    }).catch(error => showToast('获取登录链接失败: ' + error.message, 'error'));
  }

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
    const userMenuTrigger = document.getElementById('userMenuTrigger');
    const userMenu = document.getElementById('userMenu');

    if (loginBtn) loginBtn.onclick = openLoginPopup;
    if (logoutBtn) logoutBtn.onclick = logout;
    if (uploadBtn) uploadBtn.onclick = openUploadModal;
    if (myProjectsMenuBtn) myProjectsMenuBtn.onclick = () => {
      state.showOnlyMyProjects = !state.showOnlyMyProjects;
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
        renderApp();
      });
    }

    if (sortMenuTrigger && sortMenu) {
      sortMenuTrigger.onclick = event => {
        event.stopPropagation();
        state.sortMenuOpen = !state.sortMenuOpen;
        state.userMenuOpen = false;
        renderApp();
      };

      sortMenu.querySelectorAll('[data-sort-value]').forEach(button => {
        button.addEventListener('click', event => {
          event.stopPropagation();
          state.sortMode = button.dataset.sortValue || DEFAULT_SORT_MODE;
          state.sortMenuOpen = false;
          renderApp();
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
        try {
          await deleteProject(projectId);
          showToast('项目已删除');
          fetchProjects();
        } catch (error) {
          showToast('删除失败: ' + error.message, 'error');
        }
      });
    });

    document.querySelectorAll('.visibility-btn').forEach(button => {
      button.addEventListener('click', async event => {
        event.stopPropagation();
        const projectId = button.dataset.id;
        const visible = button.dataset.visible === '1';
        if (!projectId) return;
        try {
          await updateProjectVisibility(projectId, !visible);
          showToast(!visible ? '项目已公开' : '项目已隐藏');
          await fetchProjects();
        } catch (error) {
          showToast('操作失败: ' + error.message, 'error');
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
    await fetchCurrentUser();
    await fetchProjects();
  }

  init();
})();
`;
