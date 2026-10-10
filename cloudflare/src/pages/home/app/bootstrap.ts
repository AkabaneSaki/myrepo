export const homeAppBootstrapScript = String.raw`
  function renderApp() {
    applyContentFont(state.contentFont);
    const filteredProjects = getFilteredProjects();
    app.innerHTML = renderLayout(filteredProjects);
    document.body.classList.toggle('mobile-tool-open', Boolean(state.mobileToolMode));
    bindStaticActions(filteredProjects);
    bindCoverImageFallbacks();
    void ensureDailyRandomDrawState();
  }

  async function init() {
    const startedAt = performance.now();
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

    // Paint the shell immediately. Network/API work below is progressive and must not
    // turn one slow endpoint into a blank Workshop open.
    renderApp();

    const timedTask = async (name, task) => {
      const taskStartedAt = performance.now();
      try {
        return await task();
      } finally {
        console.info('[CreativeWorkshop] startup task', {
          name,
          ms: Math.round(performance.now() - taskStartedAt),
        });
      }
    };

    const authTask = timedTask('auth', async () => {
      const authState = await fetchCurrentUser();
      if (authState?.user) {
        await fetchDevTeamRecommendations(true).catch(error => console.warn('[CreativeWorkshop] 精选状态加载失败', error));
      }
      if (authState?.user) {
        clearPendingOAuth();
      } else {
        resumeEmbeddedOAuthPolling();
      }
      showRejectedProjectReminder(authState?.rejectedProjects);
      renderApp();
      return authState;
    });

    const bannerTask = timedTask('banner', async () => {
      await fetchDiscoverBanner();
      renderApp();
    }).catch(error => console.warn('[CreativeWorkshop] Banner 配置加载失败', error));

    const recommendationsTask = timedTask('editor-picks', async () => {
      await fetchDevTeamRecommendations();
      renderApp();
    }).catch(error => console.warn('[CreativeWorkshop] DevTeam 推荐加载失败', error));

    const shelvesTask = timedTask('discover-shelves', () => fetchDiscoverShelves(false))
      .catch(error => console.warn('[CreativeWorkshop] Discover shelves 加载失败', error));

    await Promise.allSettled([authTask, bannerTask, recommendationsTask, shelvesTask]);
    console.info('[CreativeWorkshop] startup settled', {
      ms: Math.round(performance.now() - startedAt),
    });
  }

  init();
`;
