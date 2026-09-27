export const homeAppActionsScript = String.raw`
  function bindStaticActions(filteredProjects) {
    const loginBtn = document.getElementById('loginBtn');
    const localAdminLoginBtn = document.getElementById('localAdminLoginBtn');
    const logoutBtn = document.getElementById('logoutBtn');
    const workshopCloseBtn = document.getElementById('workshopCloseBtn');
    const uploadBtn = document.getElementById('uploadBtn');
    const myProjectsUploadBtn = document.getElementById('myProjectsUploadBtn');
    const myProjectsMenuBtn = document.getElementById('myProjectsMenuBtn');
    const dlcKitchenSettingsBtn = document.getElementById('dlcKitchenSettingsBtn');
    const adminPanelBtn = document.getElementById('adminPanelBtn');
    const bannerSettingsBtn = document.getElementById('bannerSettingsBtn');
    const addAdminBtn = document.getElementById('addAdminBtn');
    const adminLogsBtn = document.getElementById('adminLogsBtn');
    const installedToggle = document.getElementById('installedProjectsToggle');
    const dlcRepairBtn = document.getElementById('dlcRepairBtn');
    const dlcUpdateStatusBtn = document.getElementById('dlcUpdateStatusBtn');
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
    const scriptDependencyHealthBtns = Array.from(document.querySelectorAll('.script-dependency-health-btn'));
    const mobileSearchInput = document.getElementById('projectSearchInputMobile');
    const mobileToolSheet = document.getElementById('mobileToolSheet');
    const mobileToolBackdrop = document.getElementById('mobileToolBackdrop');
    const mobileToolClose = document.getElementById('mobileToolClose');
    const mobileLoginBtn = document.getElementById('mobileLoginBtn');
    const mobileLocalAdminLoginBtn = document.getElementById('mobileLocalAdminLoginBtn');
    const mobileInstalledProjectsBtn = document.getElementById('mobileInstalledProjectsBtn');
    const mobileDlcRepairBtn = document.getElementById('mobileDlcRepairBtn');
    const mobileDlcUpdateStatusBtn = document.getElementById('mobileDlcUpdateStatusBtn');
    const mobileMyProjectsBtn = document.getElementById('mobileMyProjectsBtn');
    const mobileUploadBtn = document.getElementById('mobileUploadBtn');
    const mobileDlcKitchenSettingsBtn = document.getElementById('mobileDlcKitchenSettingsBtn');
    const mobileAdminPanelBtn = document.getElementById('mobileAdminPanelBtn');
    const mobileBannerSettingsBtn = document.getElementById('mobileBannerSettingsBtn');
    const mobileAddAdminBtn = document.getElementById('mobileAddAdminBtn');
    const mobileAdminLogsBtn = document.getElementById('mobileAdminLogsBtn');
    const mobileLogoutBtn = document.getElementById('mobileLogoutBtn');

    if (loginBtn) loginBtn.onclick = openLoginPopup;
    if (mobileLoginBtn) mobileLoginBtn.onclick = openLoginPopup;
    const runLocalAdminLogin = async button => {
      button.disabled = true;
      try {
        const response = await fetch('/api/auth/local-preview', { method: 'POST' });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.token || !payload?.user) throw new Error(payload?.error || '本地管理员登录不可用');
        state.mobileToolMode = '';
        finishLogin(payload);
      } catch (error) {
        showToast('本地 Admin 登录失败: ' + (error?.message || String(error)), 'error');
        button.disabled = false;
      }
    };
    if (localAdminLoginBtn) localAdminLoginBtn.onclick = () => runLocalAdminLogin(localAdminLoginBtn);
    if (mobileLocalAdminLoginBtn) mobileLocalAdminLoginBtn.onclick = () => runLocalAdminLogin(mobileLocalAdminLoginBtn);
    if (dlcUpdateStatusBtn) dlcUpdateStatusBtn.onclick = () => void openDlcUpdateCenter();
    if (mobileDlcUpdateStatusBtn) mobileDlcUpdateStatusBtn.onclick = () => void openDlcUpdateCenter();
    scriptDependencyHealthBtns.forEach(button => {
      button.onclick = event => {
        event.stopPropagation();
        openScriptDependencyHealthModal();
      };
    });

    const closeMobileTool = () => {
      if (!mobileToolSheet || !mobileToolBackdrop) return;
      const activeElement = document.activeElement;
      if (activeElement && mobileToolSheet.contains(activeElement) && typeof activeElement.blur === 'function') activeElement.blur();
      state.mobileToolMode = '';
      mobileToolSheet.classList.remove('show');
      mobileToolBackdrop.classList.remove('show');
      mobileToolSheet.inert = true;
      mobileToolSheet.setAttribute('aria-hidden', 'true');
      document.querySelectorAll('[data-mobile-tool]').forEach(button => button.classList.remove('active'));
    };
    const openMobileTool = mode => {
      if (!mobileToolSheet || !mobileToolBackdrop) return;
      state.mobileToolMode = mode;
      const titleMap = { page: '浏览', search: '搜寻', sort: '排序', account: '个人', font: '内容字体' };
      const title = document.getElementById('mobileToolTitle');
      if (title) title.textContent = titleMap[mode] || '浏览工具';
      mobileToolSheet.querySelectorAll('[data-mobile-panel]').forEach(panel => {
        panel.hidden = panel.dataset.mobilePanel !== mode;
      });
      mobileToolSheet.classList.add('show');
      mobileToolBackdrop.classList.add('show');
      mobileToolSheet.inert = false;
      mobileToolSheet.setAttribute('aria-hidden', 'false');
      document.querySelectorAll('[data-mobile-tool]').forEach(button => button.classList.toggle('active', button.dataset.mobileTool === mode));
      if (mode === 'search') setTimeout(() => mobileSearchInput?.focus(), 120);
    };
    const scrollWorkshopToTop = () => {
      requestAnimationFrame(() => {
        try { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); }
        catch { window.scrollTo(0, 0); }
      });
    };
    if (mobileToolClose) mobileToolClose.onclick = closeMobileTool;
    if (mobileToolBackdrop) mobileToolBackdrop.onclick = closeMobileTool;
    document.querySelectorAll('[data-mobile-tool]').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        openMobileTool(button.dataset.mobileTool || 'search');
      });
    });
    document.querySelectorAll('.discover-shelf').forEach(shelf => {
      const track = shelf.querySelector('[data-shelf-track]');
      if (!track) return;
      const buttons = shelf.querySelectorAll('[data-shelf-scroll]');
      const updateShelfButtons = () => {
        const maxScrollLeft = Math.max(0, track.scrollWidth - track.clientWidth);
        buttons.forEach(button => {
          const direction = Number(button.dataset.shelfScroll || 0);
          button.disabled = direction < 0 ? track.scrollLeft <= 2 : track.scrollLeft >= maxScrollLeft - 2;
        });
      };
      buttons.forEach(button => {
        button.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          const direction = Number(button.dataset.shelfScroll || 0);
          if (!direction) return;
          const distance = Math.max(240, Math.round(track.clientWidth * 0.82));
          track.scrollBy({ left: direction * distance, behavior: 'smooth' });
        });
      });
      track.addEventListener('scroll', updateShelfButtons, { passive: true });
      requestAnimationFrame(updateShelfButtons);
    });
    document.querySelectorAll('[data-return-all-projects]').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        state.showOnlyMyProjects = false;
        state.showSubscribedAndInstalledProjects = false;
        state.viewMode = 'catalog';
        state.activeBaseTag = 'all';
        state.activeTags = [];
        state.searchKeyword = '';
        state.searchDraft = '';
        if (state.sortMode === 'discover') state.sortMode = 'published';
        state.mobileToolMode = '';
        state.userMenuOpen = false;
        scrollWorkshopToTop();
        resetProjectPagination();
        renderApp();
        void fetchProjects(true, { page: 0, pageSize: state.projectPagination.pageSize });
      });
    });
    document.querySelectorAll('[data-workshop-view]').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        if (state.filterRequestPending) return;
        const nextView = button.dataset.workshopView === 'discover' ? 'discover' : 'catalog';
        state.viewMode = nextView;
        state.showOnlyMyProjects = false;
        state.showSubscribedAndInstalledProjects = false;
        state.activeBaseTag = 'all';
        state.activeTags = [];
        state.searchKeyword = '';
        state.searchDraft = '';
        lastCommittedSearchKeyword = '';
        state.sortMode = nextView === 'discover' ? 'discover' : 'published';
        state.mobileToolMode = '';
        scrollWorkshopToTop();
        resetProjectPagination();
        state.filterRequestPending = true;
        renderApp();
        const request = nextView === 'discover'
          ? fetchDiscoverShelves(true)
          : fetchProjects(true, { page: 0, pageSize: state.projectPagination.pageSize });
        request.finally(() => {
          state.filterRequestPending = false;
          renderApp();
        });
      });
    });
    document.querySelectorAll('[data-discover-more-sort]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (state.filterRequestPending) return;
        const nextSortMode = button.dataset.discoverMoreSort || 'published';
        state.viewMode = 'catalog';
        state.sortMode = nextSortMode;
        state.activeBaseTag = 'all';
        state.activeTags = [];
        state.searchKeyword = '';
        state.searchDraft = '';
        lastCommittedSearchKeyword = '';
        scrollWorkshopToTop();
        resetProjectPagination();
        state.filterRequestPending = true;
        renderApp();
        fetchProjects(true, { page: 0, pageSize: state.projectPagination.pageSize }).finally(() => {
          state.filterRequestPending = false;
          renderApp();
        });
      });
    });
    if (workshopCloseBtn) workshopCloseBtn.onclick = requestCloseWorkshop;
    if (dlcRepairBtn) dlcRepairBtn.onclick = event => {
      event.stopPropagation();
      state.userMenuOpen = false;
      openDlcRepairModal();
    };
    if (mobileDlcRepairBtn) mobileDlcRepairBtn.onclick = event => {
      event.stopPropagation();
      closeMobileTool();
      openDlcRepairModal();
    };
    if (logoutBtn) logoutBtn.onclick = logout;
    const openUploadProject = event => {
      event?.stopPropagation();
      state.userMenuOpen = false;
      try {
        openUploadModal();
      } catch (error) {
        console.error('[CreativeWorkshop] failed to open upload modal', error);
        showToast('无法打开上传窗口: ' + (error?.message || String(error)), 'error');
      }
    };
    if (uploadBtn) uploadBtn.onclick = openUploadProject;
    if (myProjectsUploadBtn) myProjectsUploadBtn.onclick = openUploadProject;
    const toggleMyProjectsView = async () => {
      state.showOnlyMyProjects = !state.showOnlyMyProjects;
      if (state.showOnlyMyProjects) state.showSubscribedAndInstalledProjects = false;
      state.userMenuOpen = false;
      state.mobileToolMode = '';
      scrollWorkshopToTop();
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
    if (myProjectsMenuBtn) myProjectsMenuBtn.onclick = toggleMyProjectsView;
    if (mobileMyProjectsBtn) mobileMyProjectsBtn.onclick = toggleMyProjectsView;
    if (dlcKitchenSettingsBtn) dlcKitchenSettingsBtn.onclick = event => {
      event.stopPropagation();
      state.userMenuOpen = false;
      void openDlcKitchenSettingsModal();
    };
    if (mobileDlcKitchenSettingsBtn) mobileDlcKitchenSettingsBtn.onclick = event => {
      event.stopPropagation();
      closeMobileTool();
      void openDlcKitchenSettingsModal();
    };
    if (adminPanelBtn) adminPanelBtn.onclick = openAdminPanel;
    if (mobileAdminPanelBtn) mobileAdminPanelBtn.onclick = () => { closeMobileTool(); openAdminPanel(); };
    if (bannerSettingsBtn) bannerSettingsBtn.onclick = event => {
      event.stopPropagation();
      state.userMenuOpen = false;
      openDiscoverBannerSettingsModal();
    };
    if (addAdminBtn) addAdminBtn.onclick = openAddAdminModal;
    if (mobileAddAdminBtn) mobileAddAdminBtn.onclick = () => { closeMobileTool(); openAddAdminModal(); };
    if (adminLogsBtn) adminLogsBtn.onclick = openAdminLogsModal;
    if (mobileAdminLogsBtn) mobileAdminLogsBtn.onclick = () => { closeMobileTool(); openAdminLogsModal(); };
    if (mobileBannerSettingsBtn) mobileBannerSettingsBtn.onclick = event => { event.stopPropagation(); closeMobileTool(); openDiscoverBannerSettingsModal(); };
    if (mobileLogoutBtn) mobileLogoutBtn.onclick = logout;
    if (mobileUploadBtn) mobileUploadBtn.onclick = event => {
      event.stopPropagation();
      closeMobileTool();
      try { openUploadModal(); }
      catch (error) { console.error('[CreativeWorkshop] failed to open upload modal', error); showToast('无法打开上传窗口: ' + (error?.message || String(error)), 'error'); }
    };
    document.querySelectorAll('.cover-presentation-btn').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const projectId = button.dataset.id;
        const project = filteredProjects.find(item => item.id === projectId)
          || state.projects.find(item => item.id === projectId)
          || state.myProjects.find(item => item.id === projectId);
        if (!project) { showToast('找不到项目资料', 'error'); return; }
        button.closest('.project-card')?.classList.remove('admin-menu-open');
        openCoverPresentationModal(project);
      });
    });
    document.querySelectorAll('.devteam-recommend-btn').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        const projectId = button.dataset.id;
        const project = filteredProjects.find(item => item.id === projectId)
          || state.projects.find(item => item.id === projectId)
          || state.myProjects.find(item => item.id === projectId);
        if (!project) { showToast('找不到项目资料', 'error'); return; }
        button.closest('.project-card')?.classList.remove('admin-menu-open');
        openDevTeamRecommendationModal(project);
      });
    });

    const shiftDevTeamCurator = delta => {
      const count = Array.isArray(state.devTeamCurators) ? state.devTeamCurators.length : 0;
      if (count < 2) return;
      const current = Number(state.activeDevTeamCuratorIndex || 0);
      state.activeDevTeamCuratorIndex = ((current + Number(delta || 0)) % count + count) % count;
      renderApp();
    };
    document.querySelectorAll('[data-devteam-curator-shift]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        shiftDevTeamCurator(Number(button.dataset.devteamCuratorShift || 0));
      });
    });
    document.querySelectorAll('[data-devteam-curator-index]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        state.activeDevTeamCuratorIndex = Number(button.dataset.devteamCuratorIndex || 0);
        renderApp();
      });
    });
    document.querySelectorAll('.devteam-curator-head[data-devteam-curator-id]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openDlcKitchenCuratorModal(button.dataset.devteamCuratorId);
      });
    });
    const devTeamCarousel = document.querySelector('.devteam-curator-carousel');
    if (devTeamCarousel && (state.devTeamCurators || []).length > 1) {
      let touchStartX = null;
      let touchStartY = null;
      devTeamCarousel.addEventListener('touchstart', event => {
        const touch = event.touches?.[0];
        touchStartX = touch ? touch.clientX : null;
        touchStartY = touch ? touch.clientY : null;
      }, { passive: true });
      devTeamCarousel.addEventListener('touchend', event => {
        if (touchStartX === null || touchStartY === null) return;
        const touch = event.changedTouches?.[0];
        if (!touch) return;
        const deltaX = touch.clientX - touchStartX;
        const deltaY = touch.clientY - touchStartY;
        touchStartX = null;
        touchStartY = null;
        if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
        shiftDevTeamCurator(deltaX < 0 ? 1 : -1);
      }, { passive: true });
    }

    const setInstalledProjectsView = async enabled => {
      state.showSubscribedAndInstalledProjects = Boolean(enabled);
      if (state.showSubscribedAndInstalledProjects) state.showOnlyMyProjects = false;
      state.mobileToolMode = '';
      scrollWorkshopToTop();
      renderApp();
      if (state.showSubscribedAndInstalledProjects && state.tavern.connected && state.tavern.installedProjectsLoaded) {
        try { await fetchInstalledProjectDetails(); }
        catch (error) { console.warn('[CreativeWorkshop] 加载已安装项目远端详情失败', error); }
      }
      if (state.showSubscribedAndInstalledProjects && state.currentUser) {
        try { await fetchSubscriptions(); }
        catch (error) { showToast('加载订阅项目失败: ' + error.message, 'warning'); }
      }
      renderApp();
    };
    if (installedToggle) {
      const checkbox = installedToggle.querySelector('input');
      checkbox.addEventListener('change', event => { void setInstalledProjectsView(event.target.checked); });
    }
    if (mobileInstalledProjectsBtn) {
      mobileInstalledProjectsBtn.onclick = () => { void setInstalledProjectsView(!state.showSubscribedAndInstalledProjects); };
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
            updated: '最近更新',
            downloads: '下载最多',
            likes: '点赞最多',
          };
          showToast('正在按' + (sortLabelMap[nextSortMode] || '当前方式') + '排序...', 'info');
          if (state.viewMode === 'discover') {
            state.viewMode = 'catalog';
            state.activeBaseTag = 'all';
            state.activeTags = [];
            state.searchKeyword = '';
            state.searchDraft = '';
            lastCommittedSearchKeyword = '';
          }
          state.sortMode = nextSortMode;
          state.sortMenuOpen = false;
          scrollWorkshopToTop();
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
        const sortLabelMap = { discover: '发现', published: '最新发布', updated: '最近更新', downloads: '下载最多', likes: '点赞最多' };
        showToast('正在按' + (sortLabelMap[nextSortMode] || '当前方式') + '排序...', 'info');
        if (state.viewMode === 'discover') {
          state.viewMode = 'catalog';
          state.activeBaseTag = 'all';
          state.activeTags = [];
          state.searchKeyword = '';
          state.searchDraft = '';
          lastCommittedSearchKeyword = '';
        }
        state.sortMode = nextSortMode;
        state.sortMenuOpen = false;
        state.mobileToolMode = '';
        scrollWorkshopToTop();
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

    const applyMetricFilter = (kind, rawValue) => {
      if (state.filterRequestPending) return;
      const value = Math.max(0, Math.floor(Number(rawValue || 0)));
      if (kind === 'likes') state.minLikes = value;
      else if (kind === 'downloads') state.minDownloads = value;
      else return;

      if (state.viewMode === 'discover') {
        state.viewMode = 'catalog';
        state.sortMode = 'published';
        state.activeBaseTag = 'all';
        state.activeTags = [];
        state.searchKeyword = '';
        state.searchDraft = '';
        lastCommittedSearchKeyword = '';
      }
      state.mobileToolMode = '';
      scrollWorkshopToTop();
      resetProjectPagination();
      state.filterRequestPending = true;
      renderApp();
      fetchProjects(true, { page: 0, pageSize: state.projectPagination.pageSize }).finally(() => {
        state.filterRequestPending = false;
        renderApp();
      });
    };

    document.querySelectorAll('[data-metric-filter]').forEach(select => {
      select.addEventListener('change', event => {
        event.stopPropagation();
        applyMetricFilter(select.dataset.metricFilter, select.value);
      });
      select.addEventListener('click', event => event.stopPropagation());
    });

    document.querySelectorAll('[data-clear-metric-filter]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        applyMetricFilter(button.dataset.clearMetricFilter, 0);
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
        state.viewMode = 'catalog';
        if (state.sortMode === 'discover') state.sortMode = 'published';
        state.searchKeyword = nextKeyword;
        state.searchDraft = '';
        scrollWorkshopToTop();
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
        state.viewMode = 'catalog';
        if (state.sortMode === 'discover') state.sortMode = 'published';
        state.searchKeyword = nextKeyword;
        state.searchDraft = '';
        state.mobileToolMode = '';
        scrollWorkshopToTop();
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
        if (state.viewMode === 'catalog' && state.activeBaseTag === nextTag) return;
        state.viewMode = 'catalog';
        if (state.sortMode === 'discover') state.sortMode = 'published';
        state.activeBaseTag = nextTag;
        state.activeTags = [];
        state.searchDraft = '';
        scrollWorkshopToTop();

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
        if (state.viewMode === 'catalog' && state.activeBaseTag === nextTag) {
          closeMobileTool();
          return;
        }
        state.viewMode = 'catalog';
        if (state.sortMode === 'discover') state.sortMode = 'published';
        state.activeBaseTag = nextTag;
        state.activeTags = [];
        state.searchDraft = '';
        state.mobileToolMode = '';
        scrollWorkshopToTop();
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
      state.viewMode = 'catalog';
      if (state.sortMode === 'discover') state.sortMode = 'published';
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

    document.querySelectorAll('.project-card, .discover-card').forEach(card => {
      const openDetail = () => {
        const projectId = card.dataset.id;
        const project = filteredProjects.find(item => item.id === projectId)
          || state.projects.find(item => item.id === projectId)
          || (state.devTeamCurators || []).flatMap(curator => curator.recommendations || []).map(item => item.project).find(item => item?.id === projectId);
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

    document.querySelectorAll('.rebind-project-btn').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        if (button.dataset.id) openInstalledProjectRebindModal(button.dataset.id);
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
        const isPendingReviewDraft = Boolean(isReviewDraft && project.status === 'pending');
        const isPublishedWithDraft = Boolean(project.isPublished && (project.hasPendingDraft || project.draftProjectId));
        const confirmText = isPendingReviewDraft
          ? '继续编辑会保留当前审核快照，并从它创建一份新的编辑草稿。继续吗？'
          : isReviewDraft
            ? '确定撤回这次更新吗？已发布版本会继续保留。'
            : isPublishedWithDraft
              ? '确定删除这个正式项目吗？当前编辑草稿也会一并删除。'
              : '确定要删除该项目吗？';
        if (!confirm(confirmText)) return;
        const restore = setButtonLoading(button, isPendingReviewDraft ? '准备草稿' : isReviewDraft ? '撤回中' : '删除中');
        try {
          const result = await deleteProject(projectId);
          await fetchProjects(true);
          if (result?.continuedDraftProjectId) {
            showToast('审核快照已保留，可以继续编辑新草稿');
            const nextDetail = await fetchProjectEntries(result.continuedDraftProjectId, { forceRefresh: true });
            if (nextDetail?.project) openEditProjectModal(nextDetail.project);
          } else {
            showToast(isReviewDraft ? '更新草稿已撤回，已发布版本保持不变' : '项目已删除');
          }
        } catch (error) {
          showToast((isPendingReviewDraft ? '继续编辑失败: ' : isReviewDraft ? '撤回失败: ' : '删除失败: ') + error.message, 'error');
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
`;
