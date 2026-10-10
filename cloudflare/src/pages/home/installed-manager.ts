export const homeInstalledManagerScript = String.raw`
function installedManagerProjectMeta(id) {
  return state.tavern.installedRemoteProjectMap.get(id) ||
    state.projects.find(project => project.id === id) ||
    state.myProjects.find(project => project.id === id) || null;
}
function installedManagerRole(name) {
  const books = state.tavern.worldbooks || {};
  if (name === books.primary) return '角色主世界书';
  if ((books.additional || []).includes(name)) return '角色附加世界书';
  if ((books.global || []).includes(name)) return '全局世界书';
  if (books.chat && books.chat === name) return '聊天世界书';
  return '其他扫描来源';
}
function renderInstalledManagerPage() {
  const tab = state.installedManagerTab || 'installed';
  const connected = state.tavern.connected;
  const loaded = state.tavern.installedProjectsLoaded;
  const instances = state.tavern.installedProjects || [];
  const complete = state.tavern.installedProjectsComplete;
  const bindings = state.tavern.worldbooks || {};
  const scanned = state.tavern.scannedWorldbookNames || [];
  const unreadable = state.tavern.unreadableWorldbookNames || [];
  const subscribed = [...state.subsMap].filter(([, value]) => value?.subscribed).map(([id]) => id);
  const tabs = [
    ['installed', '已安装 DLC', instances.length],
    ['subscribed', '已订阅', subscribed.length],
    ['scan', '扫描范围', scanned.length],
  ];
  const header = '<section class="installed-manager-head"><div><small>LOCAL WORKSHOP LIBRARY</small><h2>我的工坊</h2>' +
    '<p>管理当前角色已安装的 DLC。安装状态以 SillyTavern 本机实际扫描为准。</p></div>' +
    '<button class="btn btn-outline" type="button" id="installedManagerRefresh"><i class="fas fa-arrows-rotate"></i> 重新扫描</button></section>';
  const nav = '<nav class="installed-manager-tabs" aria-label="我的工坊分类">' + tabs.map(([id, label, count]) =>
    '<button type="button" class="' + (id === tab ? 'active' : '') +
    '" data-installed-tab="' + id + '" aria-selected="' + (id === tab) + '">' +
    escapeHtml(label) + '<span>' + count + '</span></button>').join('') + '</nav>';
  const scanWarning = connected && loaded && !complete ?
    '<p class="installed-manager-warning"><i class="fas fa-triangle-exclamation"></i>部分世界书读取失败。当前列表可能不完整，迁移暂时禁用，请先重新扫描。</p>' : '';
  if (!connected && tab !== 'subscribed')
    return header + nav + '<p class="installed-manager-empty">请先在 SillyTavern 中打开工坊，连接后才能管理本机 DLC。</p>';
  if (!loaded && tab !== 'subscribed')
    return header + nav + '<p class="installed-manager-empty">正在读取本机 DLC 与绑定世界书……</p>';
  let content = '';
  if (tab === 'installed') {
    const targets = [bindings.primary, ...(bindings.additional || [])].filter(name =>
      Boolean(name) && scanned.includes(name) && !unreadable.includes(name));
    content = instances.length ? '<div class="installed-manager-list">' + instances.map(instance => {
      const id = instance.projectId;
      const project = installedManagerProjectMeta(id);
      const title = project?.name || instance.name || '本机 DLC';
      const name = instance.worldbookName;
      const busy = Boolean(state.tavern.pendingProjectActions?.get(id));
      const issue = Boolean(instance.mixedVersions || instance.regexVersionMismatch ||
        instance.regexInstallPending || (name && !instance.worldbookBound));
      const status = issue ? '<span class="installed-manager-problem">需检查安装状态</span>' :
        '<span class="installed-manager-ready">已安装</span>';
      const location = name ? (installedManagerRole(name) + ' · ' + name) :
        ('角色 Regex' + (instance.regexRecordWorldbookName ? ' · 记录于 ' + instance.regexRecordWorldbookName : ''));
      const canTransfer = Boolean(connected && complete && name && instance.entryCount > 0 &&
        !issue && state.tavern.installedManagerTransferSupported &&
        targets.some(target => target !== name));
      const cover = project?.coverImage
        ? '<img class="installed-manager-cover" src="' + escapeHtml(project.coverImage) + '" alt="" loading="lazy">'
        : '<span class="installed-manager-cover installed-manager-cover--empty"><i class="fas fa-puzzle-piece"></i></span>';
      return '<article class="installed-manager-item">' + cover +
        '<div class="installed-manager-copy"><strong>' + escapeHtml(title) + '</strong>' +
        '<p><i class="fas fa-book"></i> ' + escapeHtml(location) + '</p>' + status +
        '</div><div class="installed-manager-actions">' +
        '<button class="btn btn-outline" type="button" data-installed-transfer="' + escapeHtml(id) +
        '" data-source-book="' + escapeHtml(name || '') + '" ' + (canTransfer && !busy ? '' : 'disabled') +
        ' title="' + (canTransfer ? '迁移到另一已绑定世界书' : '此项目暂无可安全迁移的目标') +
        '"><i class="fas fa-right-left"></i> 迁移</button>' +
        '<button class="btn btn-outline" type="button" data-installed-uninstall="' + escapeHtml(id) +
        '" data-source-book="' + escapeHtml(name || '') + '" ' + (busy || !complete ? 'disabled' : '') +
        '><i class="fas fa-trash-can"></i> 卸载</button></div></article>';
    }).join('') + '</div>' : '<p class="installed-manager-empty">当前扫描范围内未发现已安装 DLC。</p>';
  } else if (tab === 'subscribed') {
    content = !state.currentUser ? '<p class="installed-manager-empty">登录 Discord 后可以查看订阅的项目。</p>' :
      subscribed.length ? '<div class="installed-manager-list">' + subscribed.map(id => {
        const project = installedManagerProjectMeta(id);
        const title = project?.name || '项目 ' + id;
        const installed = instances.some(item => item.projectId === id);
        return '<article class="installed-manager-item"><span class="installed-manager-cover installed-manager-cover--empty"><i class="fas fa-bookmark"></i></span>' +
          '<div class="installed-manager-copy"><strong>' + escapeHtml(title) + '</strong><p>' +
          (installed ? '本机已安装' : '尚未在本机安装') + '</p></div>' +
          '<div class="installed-manager-actions">' +
          (project ? '<button class="btn btn-outline" type="button" data-subscribed-detail="' +
            escapeHtml(id) + '">查看项目</button>' : '') +
          '<button class="btn btn-outline" type="button" data-subscribed-remove="' + escapeHtml(id) +
          '">取消订阅</button></div></article>';
      }).join('') + '</div>' : '<p class="installed-manager-empty">暂时没有订阅项目。</p>';
  } else {
    const names = [...new Set([...scanned, ...unreadable])];
    content = '<p class="installed-manager-description">仅扫描当前角色已绑定的主／附加世界书、全局世界书及当前聊天世界书。其他未绑定的书不会被扫描。</p>' +
      (names.length ? '<div class="installed-manager-scan-list">' + names.map(name =>
        '<div class="installed-manager-scan-row"><i class="fas fa-book-open"></i><span><strong>' +
        escapeHtml(name) + '</strong><small>' + escapeHtml(installedManagerRole(name)) +
        '</small></span><em class="' + (unreadable.includes(name) ? 'failed' : '') + '">' +
        (unreadable.includes(name) ? '读取失败' : '已扫描') + '</em></div>').join('') + '</div>' :
        '<p class="installed-manager-empty">当前角色没有可扫描的世界书，或尚未收到扫描结果。</p>');
  }
  return header + nav + scanWarning + content;
}

function openInstalledManagerTransferDialog(projectId, sourceName) {
  const books = state.tavern.worldbooks || {};
  const allowed = [books.primary, ...(books.additional || [])];
  const options = [...new Set(allowed)].filter(name =>
    name && name !== sourceName && (state.tavern.scannedWorldbookNames || []).includes(name) &&
    !(state.tavern.unreadableWorldbookNames || []).includes(name));
  if (!state.tavern.installedProjectsComplete || !options.length ||
      !state.tavern.installedManagerTransferSupported) {
    showToast('扫描不完整、ST Client 太旧或没有其他已绑定世界书，无法迁移', 'warning');
    return;
  }
  const source = getLocalProjectInstallations(projectId).find(item =>
    item.worldbookName === sourceName && item.entryCount > 0);
  if (!source) { showToast('来源安装位置已变化，请重新扫描', 'warning'); return; }
  const form = '<div class="installed-transfer-dialog"><p>只移动这一个 DLC 的世界书条目；角色 Regex 不受影响。</p>' +
    '<label>来源世界书<strong>' + escapeHtml(sourceName) + '</strong></label>' +
    '<label for="installedTransferTarget">目标世界书</label>' +
    '<select id="installedTransferTarget">' + options.map(name =>
      '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>').join('') + '</select>' +
    '<p class="installed-transfer-warning">先复制并校验目标，再删除来源。中途中断时可能留下副本，请先重新扫描，不要直接重试。</p>' +
    '<div class="installed-manager-dialog-actions"><button class="btn btn-outline" type="button" data-transfer-cancel>取消</button>' +
    '<button class="btn btn-primary" type="button" data-transfer-confirm>确认迁移</button></div></div>';
  const overlay = openModal(form, '迁移已安装 DLC');
  overlay.querySelector('[data-transfer-cancel]').onclick = () => overlay.remove();
  overlay.querySelector('[data-transfer-confirm]').onclick = event => {
    const destination = overlay.querySelector('#installedTransferTarget')?.value || '';
    if (!options.includes(destination) || destination === sourceName) return;
    try {
      requestInstalledWorldbookTransfer(projectId, sourceName, destination);
      overlay.remove();
    } catch (error) { showToast(error.message || String(error), 'error'); }
  };
}
function openInstalledManagerUninstallDialog(projectId, sourceName) {
  const row = getLocalProjectInstallations(projectId).find(item =>
    (item.worldbookName || '') === (sourceName || ''));
  if (!row || !state.tavern.installedProjectsComplete) {
    showToast('安装位置已变化或扫描不完整，不能卸载', 'warning'); return;
  }
  const form = '<div class="installed-transfer-dialog"><p>确认卸载此 DLC 吗？' +
    (sourceName ? '仅卸载世界书「' + escapeHtml(sourceName) + '」中的这一份。' :
      '此 DLC 仅包含角色 Regex。') + '</p>' +
    '<div class="installed-manager-dialog-actions"><button class="btn btn-outline" type="button" data-uninstall-cancel>取消</button>' +
    '<button class="btn btn-outline" type="button" data-uninstall-confirm>确认卸载</button></div></div>';
  const overlay = openModal(form, '卸载已安装 DLC');
  overlay.querySelector('[data-uninstall-cancel]').onclick = () => overlay.remove();
  overlay.querySelector('[data-uninstall-confirm]').onclick = () => {
    requestUninstallProject(projectId, sourceName || null);
    overlay.remove();
  };
}
function bindInstalledManagerActions() {
  const openManager = async () => {
    state.showSubscribedAndInstalledProjects = true;
    state.showOnlyMyProjects = false;
    state.installedManagerTab = 'installed';
    state.mobileToolMode = '';
    renderApp();
    if (state.tavern.connected) postBridgeMessage('bridge:list-installed-projects');
    if (state.currentUser) await fetchSubscriptions().catch(error =>
      console.warn('[CreativeWorkshop] subscriptions unavailable', error));
    if (state.tavern.connected) await fetchInstalledProjectDetails().catch(error =>
      console.warn('[CreativeWorkshop] local DLC details unavailable', error));
    renderApp();
  };
  const desktop = document.getElementById('desktopInstalledManagerBtn');
  if (desktop) desktop.onclick = event => { event.preventDefault(); void openManager(); };
  document.querySelectorAll('[data-subscribed-detail]').forEach(button => {
    button.onclick = () => {
      const project = installedManagerProjectMeta(button.dataset.subscribedDetail);
      if (project) showProjectDetail(project);
    };
  });
  document.querySelectorAll('[data-subscribed-remove]').forEach(button => {
    button.onclick = async () => {
      const projectId = button.dataset.subscribedRemove;
      if (!projectId) return;
      button.disabled = true;
      try {
        await setProjectSubscription(projectId, false);
        showToast('已取消订阅；本机已安装 DLC 不受影响');
      } catch (error) { showToast('取消订阅失败：' + error.message, 'error'); button.disabled = false; }
    };
  });
  document.querySelectorAll('[data-installed-tab]').forEach(button => {
    button.onclick = () => {
      state.installedManagerTab = button.dataset.installedTab;
      renderApp();
    };
  });
  const refresh = document.getElementById('installedManagerRefresh');
  if (refresh) refresh.onclick = () => {
    if (!state.tavern.connected) { showToast('请先连接 SillyTavern', 'warning'); return; }
    postBridgeMessage('bridge:list-installed-projects');
    postBridgeMessage('bridge:get-context');
    showToast('正在重新扫描已绑定世界书');
  };
  document.querySelectorAll('[data-installed-transfer]').forEach(button => {
    button.onclick = () => openInstalledManagerTransferDialog(
      button.dataset.installedTransfer, button.dataset.sourceBook);
  });
  document.querySelectorAll('[data-installed-uninstall]').forEach(button => {
    button.onclick = () => openInstalledManagerUninstallDialog(
      button.dataset.installedUninstall, button.dataset.sourceBook);
  });
}
`;
