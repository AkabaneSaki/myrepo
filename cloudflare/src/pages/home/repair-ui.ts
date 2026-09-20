export const homeRepairScript = String.raw`
const dlcRepairUiState = {
  overlay: null,
  report: null,
  items: new Map(),
  busy: false,
  postRepairPromptShown: false,
};

function getRepairMetadataLabel(field) {
  const labels = {
    cw_project_id: 'cw_project_id',
    cw_project_name_display: 'cw_project_name_display',
    cw_project_version: 'cw_project_version',
    cw_entry_key: 'cw_entry_key',
    cw_name_format_version: 'cw_name_format_version',
  };
  return labels[field] || String(field || 'unknown');
}

function getRepairStatusLabel(status) {
  return ({
    scanned: '已发现',
    matching: '正在查找对应项目',
    matched: '已检查',
    repairing: '正在重装',
    completed: '已完成',
    failed: '需要重试',
  })[status] || String(status || '');
}

function getRepairMatchLabel(match) {
  if (!match) return '还没查找对应的工坊项目';
  if (match.status === 'unique') {
    const project = match.projects?.[0];
    return project ? '已找到：' + (project.name || project.id) : '已找到对应项目';
  }
  if (match.status === 'ambiguous') return '找到几个可能的项目，请你确认';
  if (match.status === 'candidates') return '找到几个可能的项目，请你确认';
  return '没有自动找到对应项目';
}

function isRepairCandidateSafe(candidate) {
  if (!candidate) return false;
  if (Number(candidate.unaddressableEntryCount || 0) > 0) return false;
  return (Array.isArray(candidate.entryUids) && candidate.entryUids.length > 0)
    || (Array.isArray(candidate.regexIds) && candidate.regexIds.length > 0);
}

function getRepairItem(candidateId) {
  return dlcRepairUiState.items.get(String(candidateId || '')) || null;
}

function initializeRepairItems(report) {
  const problemCandidates = (Array.isArray(report?.candidates) ? report.candidates : [])
    .filter(candidate => Array.isArray(candidate?.problems) && candidate.problems.length > 0);
  dlcRepairUiState.items = new Map(problemCandidates.map(candidate => [
    candidate.candidateId,
    {
      candidate,
      selected: false,
      match: null,
      status: 'scanned',
      error: null,
    },
  ]));
}

function closeDlcRepairModal() {
  const overlay = dlcRepairUiState.overlay;
  dlcRepairUiState.overlay = null;
  dlcRepairUiState.report = null;
  dlcRepairUiState.items = new Map();
  dlcRepairUiState.busy = false;
  if (overlay?.isConnected) overlay.remove();
}

function buildRepairIntegrityFieldsHtml(report) {
  const fields = Array.isArray(report?.repairIntegrityFields) ? report.repairIntegrityFields : [];
  if (!fields.length) return '';
  return '<details class="repair-details" open><summary>工坊精灵资料检查</summary>'
    + '<div class="repair-metadata-grid">' + fields.map(item => {
      const icon = item.status === 'ok' ? '✓' : item.status === 'missing' ? '✕' : '⚠';
      const actual = item.actual === null || item.actual === undefined ? '缺失' : String(item.actual);
      return '<div class="repair-metadata-row repair-metadata-' + escapeHtml(item.status) + '">'
        + '<span class="repair-metadata-icon">' + icon + '</span>'
        + '<code>' + escapeHtml(getRepairMetadataLabel(item.field)) + '</code>'
        + '<span>' + escapeHtml(item.status === 'ok' ? '正常' : item.status === 'missing' ? '缺失' : '异常') + '</span>'
        + '<span class="repair-metadata-values">现在：' + escapeHtml(actual) + '<br>应为：' + escapeHtml(String(item.expected || '')) + '</span>'
        + '</div>';
    }).join('') + '</div></details>';
}

function openDlcRepairRestartNotice() {
  if (dlcRepairUiState.postRepairPromptShown) return null;
  dlcRepairUiState.postRepairPromptShown = true;
  const bodyHtml = '<div class="repair-restart-notice">'
    + '<p><strong>好啦修理成功喵！現在重开酒馆，然后再來工坊DLC检查多次看看吧!</strong></p>'
    + '<div class="release-update-actions">'
    + '<button class="btn btn-primary" id="dlcRepairRestartAcknowledgeBtn" type="button">知道了喵</button>'
    + '<button class="btn btn-outline" id="dlcRepairRestartLookAgainBtn" type="button">不行，再看一眼</button>'
    + '</div></div>';
  const overlay = openModal(bodyHtml, '<i class="fas fa-cat"></i> 工坊精灵');
  overlay.querySelector('.close-btn')?.remove();
  overlay.addEventListener('click', event => { if (event.target === overlay) event.stopImmediatePropagation(); }, true);
  overlay.querySelector('#dlcRepairRestartAcknowledgeBtn')?.addEventListener('click', () => requestCloseWorkshop());
  overlay.querySelector('#dlcRepairRestartLookAgainBtn')?.addEventListener('click', () => showToast('別再点了快点重开酒馆', 'warning'));
  return overlay;
}

function buildRepairMetadataHtml(candidate) {
  const metadata = Array.isArray(candidate?.metadata) ? candidate.metadata : [];
  if (!metadata.length) return '<p class="repair-muted">没有 Workshop metadata 记录</p>';
  return '<div class="repair-metadata-grid">' + metadata.map(item => {
    const icon = item.status === 'complete' ? '✓' : item.status === 'missing' ? '✕' : '⚠';
    const values = Array.isArray(item.values) && item.values.length ? item.values.join(', ') : '—';
    return '<div class="repair-metadata-row repair-metadata-' + escapeHtml(item.status) + '">'
      + '<span class="repair-metadata-icon">' + icon + '</span>'
      + '<code>' + escapeHtml(getRepairMetadataLabel(item.field)) + '</code>'
      + '<span>' + escapeHtml(String(item.presentCount || 0)) + '/' + escapeHtml(String(item.totalCount || 0)) + '</span>'
      + '<span class="repair-metadata-values">' + escapeHtml(values) + '</span>'
      + '</div>';
  }).join('') + '</div>';
}

function buildRepairMatchProjectsHtml(item) {
  const match = item?.match;
  if (!match || match.status === 'unique') return '';
  const projects = Array.isArray(match.projects) ? match.projects.slice(0, 8) : [];
  if (!projects.length) return '';
  return '<p class="repair-project-choice-hint"><i class="fas fa-hand-pointer"></i> 点击下方卡片，确认这是对应的 Workshop 项目</p>'
    + '<div class="repair-project-candidates">' + projects.map(project => {
    const author = project.authorGlobalName || project.authorName || project.authorId || '未知作者';
    return '<button type="button" class="repair-project-choice" data-repair-pick-project="' + escapeHtml(item.candidate.candidateId) + '" data-project-id="' + escapeHtml(project.id || '') + '">'
      + '<span class="repair-project-choice-copy"><strong>' + escapeHtml(project.name || '未命名项目') + '</strong>'
      + '<small>' + escapeHtml(author) + ' · v' + escapeHtml(project.version || '?') + '</small></span>'
      + '<span class="repair-project-choice-action"><i class="fas fa-circle-check"></i> 选择此项目</span>'
      + '</button>';
  }).join('') + '</div>';
}

function buildRepairCandidateHtml(item, repairLocked = false) {
  const candidate = item.candidate;
  const problems = Array.isArray(candidate.problems) ? candidate.problems : [];
  const matchProject = item.match?.status === 'unique' ? item.match.projects?.[0] : null;
  const safe = isRepairCandidateSafe(candidate);
  const matchingEvidence = [];
  if (candidate.detectedProjectId) matchingEvidence.push('projectId=' + candidate.detectedProjectId);
  if (candidate.legacyProjectName) matchingEvidence.push('legacy=' + candidate.legacyProjectName);
  matchingEvidence.push('name=' + candidate.name);
  const projectSummary = matchProject
    ? '<div class="repair-match-project"><strong>' + escapeHtml(matchProject.name || '未命名项目') + '</strong><span>v' + escapeHtml(matchProject.version || '?') + '</span></div>'
    : '';
  const errorHtml = item.error ? '<div class="repair-error"><i class="fas fa-triangle-exclamation"></i> ' + escapeHtml(item.error) + '</div>' : '';
  const problemHtml = problems.length
    ? '<ul class="repair-problems">' + problems.map(problem => '<li>' + escapeHtml(problem) + '</li>').join('') + '</ul>'
    : '<p class="repair-ok"><i class="fas fa-circle-check"></i> 本地内容可以正常读取</p>';
  const matchBoxHtml = (item.selected || item.match)
    ? '<div class="repair-match-box ' + (item.match?.status || 'unmatched') + '">'
      + '<div><strong>对应工坊项目：</strong>' + escapeHtml(getRepairMatchLabel(item.match)) + '</div>'
      + projectSummary
      + buildRepairMatchProjectsHtml(item)
      + ((item.match && item.match.status !== 'unique')
        ? '<div class="repair-manual-search"><input type="text" data-repair-search-input="' + escapeHtml(candidate.candidateId) + '" value="' + escapeHtml(candidate.name || '') + '" placeholder="输入项目名称" ' + (repairLocked ? 'disabled' : '') + '><button type="button" class="btn btn-outline" data-repair-search="' + escapeHtml(candidate.candidateId) + '" ' + (repairLocked ? 'disabled' : '') + '><i class="fas fa-search"></i> 搜索</button></div>'
        : '')
      + '</div>'
    : '';

  return '<article class="repair-candidate ' + (item.selected ? 'selected' : '') + '" data-repair-candidate-card="' + escapeHtml(candidate.candidateId) + '">'
    + '<div class="repair-candidate-head">'
    + '<label class="repair-select"><input type="checkbox" data-repair-select="' + escapeHtml(candidate.candidateId) + '" ' + (item.selected ? 'checked' : '') + ' ' + (repairLocked ? 'disabled' : '') + '><span></span></label>'
    + '<div class="repair-candidate-title"><strong>' + escapeHtml(candidate.name || '未命名 DLC') + '</strong><small>' + escapeHtml(candidate.category || '未知分类') + ' · ' + escapeHtml(candidate.worldbookName || '未知世界书') + '</small></div>'
    + '<span class="repair-item-status">' + escapeHtml(getRepairStatusLabel(item.status)) + '</span>'
    + '</div>'
    + '<div class="repair-facts">'
    + '<span><b>' + escapeHtml(String(candidate.entryCount || 0)) + '</b> 个世界书条目</span>'
    + (candidate.regexCount ? '<span><b>' + escapeHtml(String(candidate.regexCount || 0)) + '</b> 个正则</span>' : '')
    + '</div>'
    + matchBoxHtml
    + (!safe ? '<div class="repair-blocked"><i class="fas fa-shield-halved"></i> 这个 DLC 的本地内容不够完整，为了避免误删，不能自动重装。</div>' : '')
    + errorHtml
    + '<details class="repair-details"><summary>查看详细检查</summary>'
    + '<div class="repair-tech-facts"><span><b>' + escapeHtml(String((candidate.entryUids || []).length)) + '/' + escapeHtml(String(candidate.entryCount || 0)) + '</b> UID 可定位</span><span><b>' + escapeHtml(String(candidate.dlcHeaderCount || 0)) + '</b> DLC Header</span><span><b>' + escapeHtml(String(candidate.workshopSourceMarkerCount || 0)) + '</b> [WS]</span></div>'
    + buildRepairMetadataHtml(candidate)
    + problemHtml
    + '<p class="repair-evidence"><strong>识别依据：</strong>' + escapeHtml(matchingEvidence.join(' · ')) + '</p>'
    + '</details>'
    + '</article>';
}

function buildPendingRepairHtml(report, repairLocked = false) {
  const pending = Array.isArray(report?.pending) ? report.pending : [];
  if (!pending.length) return '';
  return '<section class="repair-pending"><h3><i class="fas fa-clock-rotate-left"></i> 未完成的修复</h3><p>这些任务之前中断或失败，可以直接重新下载 Workshop 最新版并继续。</p>'
    + pending.map(record => '<div class="repair-pending-row"><div><strong>' + escapeHtml(record.target?.candidateId || record.target?.projectId || '未知任务') + '</strong><small>' + escapeHtml(record.status || '') + (record.error ? ' · ' + escapeHtml(record.error) : '') + '</small></div><button type="button" class="btn btn-primary" data-repair-retry="' + escapeHtml(record.repairId || '') + '" ' + (repairLocked ? 'disabled' : '') + '>重新下载并继续</button></div>').join('')
    + '</section>';
}

function buildDlcRepairReportText() {
  const report = dlcRepairUiState.report || {};
  const lines = [];
  lines.push('Creative Workshop DLC Repair Report');
  lines.push('Client: ' + (state.tavern.clientVersion || 'unknown'));
  lines.push('Generated: ' + new Date().toISOString());
  const availableWorldbooks = Array.isArray(report.availableWorldbookNames) ? report.availableWorldbookNames : [];
  const enabledWorldbooks = Array.isArray(report.enabledWorldbookNames) ? report.enabledWorldbookNames : [];
  const scannedWorldbooks = Array.isArray(report.scannedWorldbookNames) ? report.scannedWorldbookNames : [];
  const unreadable = Array.isArray(report.unreadableWorldbookNames) ? report.unreadableWorldbookNames : [];
  const modifiedOfficialBaseline = Array.isArray(report.modifiedOfficialBaselineEntries) ? report.modifiedOfficialBaselineEntries : [];
  lines.push('Available worldbooks: ' + availableWorldbooks.length);
  lines.push('Enabled worldbooks: ' + (enabledWorldbooks.length ? enabledWorldbooks.join(', ') : 'none'));
  lines.push('Scanned worldbooks: ' + (scannedWorldbooks.length ? scannedWorldbooks.join(', ') : 'none'));
  lines.push('Official baseline: ' + (report.officialBaselineVersion || 'unknown'));
  lines.push('Official baseline entries skipped: ' + Number(report.officialBaselineSkippedCount || 0));
  if (modifiedOfficialBaseline.length) {
    lines.push('Modified official baseline entries: ' + modifiedOfficialBaseline.map(item => (item.worldbookName || '?') + ' :: ' + (item.name || '?')).join(' | '));
  }
  lines.push('Unreadable worldbooks: ' + (unreadable.length ? unreadable.join(', ') : 'none'));
  lines.push('Pending repairs: ' + (Array.isArray(report.pending) ? report.pending.length : 0));
  lines.push('Repair integrity: ' + (report.repairIntegrityStatus || 'unknown') + (report.repairIntegrityLocked ? ' LOCKED' : ''));
  lines.push('Repair restart required: ' + (report.repairRestartRequired ? 'yes' : 'no'));
  if (report.repairIntegrityReason) lines.push('Repair integrity reason: ' + report.repairIntegrityReason);
  (Array.isArray(report.repairIntegrityFields) ? report.repairIntegrityFields : []).forEach(item => {
    lines.push('Repair sentinel ' + item.field + ': ' + item.status + ' actual=' + (item.actual ?? 'missing') + ' expected=' + (item.expected ?? ''));
  });
  lines.push('');

  dlcRepairUiState.items.forEach(item => {
    const candidate = item.candidate;
    lines.push('[' + candidate.name + ']');
    lines.push('Selected: ' + (item.selected ? 'yes' : 'no'));
    lines.push('Worldbook: ' + candidate.worldbookName);
    lines.push('Category: ' + (candidate.category || 'unknown'));
    lines.push('Entries: ' + candidate.entryCount + ' (UID addressable ' + (candidate.entryUids || []).length + '/' + candidate.entryCount + ')');
    lines.push('Regexes: ' + candidate.regexCount);
    lines.push('DLC headers: ' + candidate.dlcHeaderCount + '; [WS] markers: ' + candidate.workshopSourceMarkerCount);
    lines.push('Detected project IDs: ' + ((candidate.detectedProjectIds || []).join(', ') || 'none'));
    lines.push('Legacy project name: ' + (candidate.legacyProjectName || 'none'));
    lines.push('Local version: ' + (candidate.localVersion || 'unknown'));
    (candidate.metadata || []).forEach(meta => {
      lines.push('Metadata ' + meta.field + ': ' + meta.status + ' ' + meta.presentCount + '/' + meta.totalCount + ' values=' + ((meta.values || []).join(', ') || 'none'));
    });
    lines.push('Problems: ' + ((candidate.problems || []).join(' | ') || 'none'));
    lines.push('Workshop match: ' + getRepairMatchLabel(item.match) + (item.match?.method ? ' [' + item.match.method + ']' : ''));
    if (item.match?.status === 'unique' && item.match.projects?.[0]) {
      const project = item.match.projects[0];
      lines.push('Matched project: ' + (project.name || '') + ' / ' + (project.id || '') + ' / v' + (project.version || '?'));
    } else if (Array.isArray(item.match?.projects) && item.match.projects.length) {
      lines.push('Candidate projects: ' + item.match.projects.slice(0, 8).map(project => (project.name || '') + ' (' + (project.id || '') + ')').join(' | '));
    }
    lines.push('Repair status: ' + getRepairStatusLabel(item.status));
    if (item.error) lines.push('Error: ' + item.error);
    lines.push('');
  });

  return lines.join('\n');
}

function renderDlcRepairModal() {
  const overlay = dlcRepairUiState.overlay;
  if (!overlay) return;
  const root = overlay.querySelector('#dlcRepairRoot');
  if (!root) return;
  const report = dlcRepairUiState.report;
  const repairLockedUntil = getRepairResolveLockedUntil();
  const repairLocked = Boolean(repairLockedUntil);
  if (!report) {
    root.innerHTML = '<div class="repair-loading"><i class="fas fa-spinner fa-spin"></i><strong>正在检查已启用的世界书...</strong><span>只在本机读取必要资料，不会上传世界书正文。</span></div>';
    return;
  }

  const repairIntegrityLocked = Boolean(report.repairIntegrityLocked);
  const repairRestartRequired = Boolean(report.repairRestartRequired);
  const repairUnavailable = repairLocked || repairIntegrityLocked || repairRestartRequired;
  const availableWorldbooks = Array.isArray(report.availableWorldbookNames) ? report.availableWorldbookNames : [];
  const scannedWorldbooks = Array.isArray(report.scannedWorldbookNames) ? report.scannedWorldbookNames : [];
  const unreadable = Array.isArray(report.unreadableWorldbookNames) ? report.unreadableWorldbookNames : [];
  const selectedItems = Array.from(dlcRepairUiState.items.values()).filter(item => item.selected);
  const selectableItems = Array.from(dlcRepairUiState.items.values()).filter(item => item.status !== 'completed');
  const allSelected = selectableItems.length > 0 && selectableItems.every(item => item.selected);
  const readyItems = selectedItems.filter(item => item.match?.status === 'unique' && isRepairCandidateSafe(item.candidate) && !['repairing', 'completed'].includes(item.status));
  const needsAttention = selectedItems.filter(item => item.match?.status !== 'unique' || !isRepairCandidateSafe(item.candidate));
  const candidateHtml = dlcRepairUiState.items.size
    ? Array.from(dlcRepairUiState.items.values()).map(item => buildRepairCandidateHtml(item, repairUnavailable)).join('')
    : '<div class="repair-empty"><i class="fas fa-circle-check"></i><strong>这些世界书里没有发现需要重装的 DLC</strong><p>如果你要找的 DLC 在其他世界书，点上方「改扫其他世界书」。</p></div>';
  const scannedLabel = scannedWorldbooks.length ? scannedWorldbooks.join('、') : '没有可扫描的世界书';
  const otherWorldbookOptions = availableWorldbooks.slice().sort((a, b) => String(a).localeCompare(String(b))).map(name => '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>').join('');
  const footerText = !selectedItems.length
    ? '选择要重装的 DLC'
    : needsAttention.length
      ? '还有 ' + needsAttention.length + ' 个需要确认'
      : '已准备好 ' + readyItems.length + ' 个 DLC';
  const officialBaselineSkipped = Number(report.officialBaselineSkippedCount || 0);
  const modifiedOfficialBaseline = Array.isArray(report.modifiedOfficialBaselineEntries) ? report.modifiedOfficialBaselineEntries : [];
  const baselineInfoHtml = officialBaselineSkipped || modifiedOfficialBaseline.length
    ? '<div class="repair-baseline-note"><i class="fas fa-shield-halved"></i><div><strong>已自动保护原版内容</strong><span>不会把角色卡自带内容当成 DLC 删除' + (modifiedOfficialBaseline.length ? '；有 ' + modifiedOfficialBaseline.length + ' 个原版条目被改过，系统也不会自动处理它们' : '') + '。</span></div></div>'
    : '';

  const repairLockHtml = repairLocked
    ? '<div class="repair-warning"><i class="fas fa-cat"></i> <strong>' + escapeHtml(REPAIR_DAILY_LOCK_MESSAGE) + '</strong><br><span>今天的自动修复查询已经锁住，下一次日界线后会自动恢复。可以先复制诊断资料并截图去 DC 找我。</span></div>'
    : '';
  const repairIntegrityLockHtml = repairIntegrityLocked
    ? '<div class="repair-warning"><i class="fas fa-shield-halved"></i><div><strong>喵喵！我放在你家养的工坊精灵怎么丢了资料！修理按钮我幫你保管了！去DC找我</strong><span>' + escapeHtml(report.repairIntegrityReason || '本地 Workshop metadata 异常') + '</span></div></div>' + buildRepairIntegrityFieldsHtml(report)
    : '';
  const repairRestartHtml = repairRestartRequired
    ? '<div class="repair-warning"><i class="fas fa-rotate"></i><div><strong>还没重开酒馆喵！</strong><span>先重开酒馆，再回来检查工坊精灵。</span></div></div>'
    : '';
  const repairIntegrityPassHtml = !repairIntegrityLocked && !repairRestartRequired && report.repairIntegrityStatus === 'healthy'
    ? '<div class="repair-baseline-note"><i class="fas fa-circle-check"></i><div><strong>你过关！</strong><span>工坊精灵的资料完整，DLC Repair 可以正常使用喵。</span></div></div>'
    : '';

  root.innerHTML = buildPendingRepairHtml(report, repairUnavailable)
    + repairLockHtml
    + repairIntegrityLockHtml
    + repairRestartHtml
    + repairIntegrityPassHtml
    + baselineInfoHtml
    + (unreadable.length ? '<div class="repair-warning"><i class="fas fa-triangle-exclamation"></i> 有世界书暂时读不到：' + escapeHtml(unreadable.join('、')) + '</div>' : '')
    + '<section class="repair-scan-card"><div class="repair-scan-summary"><div><span class="repair-kicker">已检查这些世界书</span><strong>' + escapeHtml(scannedLabel) + '</strong><small>打开页面时会自动检查你当前正在使用的世界书。</small></div><button type="button" class="btn btn-outline" id="dlcRepairRescanBtn"><i class="fas fa-rotate"></i> 重新扫描</button></div><details class="repair-other-book"><summary>没找到要修的 DLC？改扫其他世界书</summary><div class="repair-other-book-body"><select id="dlcRepairWorldbookSelect"><option value="">选择其他世界书</option>' + otherWorldbookOptions + '</select><small>选中一本后会自动扫描。</small></div></details></section>'
    + '<div class="repair-toolbar"><div><strong>选择要重装的 DLC</strong><small>勾选后会自动查找对应的工坊项目；如果有多个可能结果，再让你确认。</small></div><div class="repair-toolbar-actions"><button type="button" class="btn btn-outline" id="dlcRepairSelectAllBtn" ' + (!selectableItems.length || dlcRepairUiState.busy || repairUnavailable ? 'disabled' : '') + '><i class="fas ' + (allSelected ? 'fa-square-minus' : 'fa-square-check') + '"></i> ' + (allSelected ? '取消全选' : '全选') + '</button><button type="button" class="btn btn-outline" id="dlcRepairCopyBtn"><i class="fas fa-copy"></i> 复制诊断资料</button></div></div>'
    + '<div class="repair-candidate-list">' + candidateHtml + '</div>'
    + '<div class="repair-footer"><div><strong>' + escapeHtml(footerText) + '</strong></div><button type="button" class="btn btn-primary" id="dlcRepairRunBtn" ' + (!selectedItems.length || readyItems.length !== selectedItems.length || dlcRepairUiState.busy || repairUnavailable ? 'disabled' : '') + '><i class="fas fa-screwdriver-wrench"></i> 重装所选最新版</button></div>';

  root.querySelectorAll('[data-repair-select]').forEach(input => {
    input.addEventListener('change', () => {
      const item = getRepairItem(input.dataset.repairSelect);
      if (!item) return;
      item.selected = Boolean(input.checked);
      renderDlcRepairModal();
      if (item.selected && !item.match && isRepairCandidateSafe(item.candidate)) {
        void analyzeDlcRepairItem(item.candidate.candidateId);
      }
    });
  });

  const selectAllBtn = root.querySelector('#dlcRepairSelectAllBtn');
  if (selectAllBtn) selectAllBtn.addEventListener('click', () => {
    const items = Array.from(dlcRepairUiState.items.values()).filter(item => item.status !== 'completed');
    const shouldSelect = !items.length ? false : !items.every(item => item.selected);
    items.forEach(item => { item.selected = shouldSelect; });
    renderDlcRepairModal();
    if (shouldSelect) void analyzeSelectedDlcRepairs();
  });

  root.querySelectorAll('[data-repair-search]').forEach(button => {
    button.addEventListener('click', () => {
      const candidateId = button.dataset.repairSearch;
      const input = root.querySelector('[data-repair-search-input="' + CSS.escape(candidateId) + '"]');
      void analyzeDlcRepairItem(candidateId, input?.value || '');
    });
  });

  root.querySelectorAll('[data-repair-pick-project]').forEach(button => {
    button.addEventListener('click', () => {
      const item = getRepairItem(button.dataset.repairPickProject);
      const projectId = button.dataset.projectId;
      if (!item || !projectId || !Array.isArray(item.match?.projects)) return;
      const project = item.match.projects.find(projectRow => projectRow.id === projectId);
      if (!project) return;
      item.match = { status: 'unique', method: 'manual_selected', projects: [project] };
      item.status = 'matched';
      item.error = null;
      renderDlcRepairModal();
    });
  });

  root.querySelectorAll('[data-repair-retry]').forEach(button => {
    button.addEventListener('click', () => { void retryPendingDlcRepair(button.dataset.repairRetry); });
  });

  const runBtn = root.querySelector('#dlcRepairRunBtn');
  if (runBtn) runBtn.addEventListener('click', () => { void runSelectedDlcRepairs(); });
  const copyBtn = root.querySelector('#dlcRepairCopyBtn');
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    const copied = await copyTextToClipboard(buildDlcRepairReportText());
    showToast(copied ? '诊断资料已复制' : '浏览器禁止自动复制，请手动复制', copied ? 'info' : 'warning');
  });
  const worldbookSelect = root.querySelector('#dlcRepairWorldbookSelect');
  if (worldbookSelect) worldbookSelect.addEventListener('change', () => {
    const worldbookName = String(worldbookSelect.value || '').trim();
    if (worldbookName && availableWorldbooks.includes(worldbookName)) void loadDlcRepairScan([worldbookName]);
  });
  const rescanBtn = root.querySelector('#dlcRepairRescanBtn');
  if (rescanBtn) rescanBtn.addEventListener('click', () => { void loadDlcRepairScan(scannedWorldbooks.length ? scannedWorldbooks : null); });
}

async function analyzeDlcRepairItem(candidateId, manualQuery = '') {
  const item = getRepairItem(candidateId);
  if (!item) return;
  if (getRepairResolveLockedUntil()) {
    showRepairResolveLockNotice(getRepairResolveLockedUntil());
    return;
  }
  item.status = 'matching';
  item.error = null;
  renderDlcRepairModal();
  try {
    item.match = await findWorkshopProjectsForRepair(item.candidate, manualQuery);
    item.status = 'matched';
  } catch (error) {
    if (error?.code === 'REPAIR_DAILY_LOCKED') {
      item.match = null;
      item.status = 'scanned';
      item.error = null;
    } else {
      item.match = { status: 'none', method: manualQuery ? 'manual_search_error' : 'auto_match_error', projects: [] };
      item.status = 'failed';
      item.error = error?.message || String(error);
    }
  }
  renderDlcRepairModal();
}

async function analyzeSelectedDlcRepairs() {
  const selected = Array.from(dlcRepairUiState.items.values()).filter(item =>
    item.selected && !item.match && item.status !== 'matching' && isRepairCandidateSafe(item.candidate)
  );
  if (!selected.length) return;

  const existingLock = getRepairResolveLockedUntil();
  if (existingLock) {
    showRepairResolveLockNotice(existingLock);
    renderDlcRepairModal();
    return;
  }

  selected.forEach(item => {
    item.status = 'matching';
    item.error = null;
  });
  dlcRepairUiState.busy = true;
  renderDlcRepairModal();

  try {
    const requests = selected.map(item => {
      const detectedProjectId = String(item.candidate?.detectedProjectId || '').trim();
      return {
        candidateId: String(item.candidate.candidateId),
        projectId: detectedProjectId && isWorkshopUuid(detectedProjectId) ? detectedProjectId : '',
        name: String(item.candidate?.name || item.candidate?.legacyProjectName || '').trim(),
      };
    });
    const resolved = await resolveWorkshopRepairCandidates(requests);
    const byCandidateId = new Map(resolved.map(result => [String(result?.candidateId || ''), result]));
    selected.forEach(item => {
      item.match = byCandidateId.get(String(item.candidate.candidateId))
        || { status: 'none', method: 'exact_name', projects: [] };
      item.status = 'matched';
    });
  } catch (error) {
    const locked = error?.code === 'REPAIR_DAILY_LOCKED';
    selected.forEach(item => {
      item.match = locked ? null : { status: 'none', method: 'auto_match_error', projects: [] };
      item.status = locked ? 'scanned' : 'failed';
      item.error = locked ? null : (error?.message || String(error));
    });
  } finally {
    dlcRepairUiState.busy = false;
    renderDlcRepairModal();
  }
}

async function runSelectedDlcRepairs() {
  const existingLock = getRepairResolveLockedUntil();
  if (existingLock) {
    showRepairResolveLockNotice(existingLock);
    return;
  }
  const selected = Array.from(dlcRepairUiState.items.values()).filter(item => item.selected);
  const runnable = selected.filter(item => item.match?.status === 'unique' && isRepairCandidateSafe(item.candidate) && item.status !== 'completed');
  if (!runnable.length) {
    showToast('没有已确认且可安全删除的 DLC', 'warning');
    return;
  }

  dlcRepairUiState.busy = true;
  let completed = 0;
  let failed = 0;
  for (const item of runnable) {
    const project = item.match.projects[0];
    item.status = 'repairing';
    item.error = null;
    renderDlcRepairModal();
    try {
      await requestDlcRepairProject({
        candidateId: item.candidate.candidateId,
        projectId: project.id,
        projectVersion: project.version || null,
        worldbookName: item.candidate.worldbookName,
        entryUids: item.candidate.entryUids || [],
        regexIds: item.candidate.regexIds || [],
        expectedEntryCount: Number(item.candidate.entryCount || 0),
        expectedRegexCount: Number(item.candidate.regexCount || 0),
        sourceProjectIds: item.candidate.detectedProjectIds || [],
      });
      item.status = 'completed';
      dlcRepairUiState.items.delete(item.candidate.candidateId);
      completed += 1;
    } catch (error) {
      item.status = 'failed';
      item.error = error?.message || String(error);
      failed += 1;
    }
    if (dlcRepairUiState.items.size > 0) renderDlcRepairModal();
  }
  dlcRepairUiState.busy = false;
  if (failed) {
    renderDlcRepairModal();
    showToast('DLC 修复完成：' + completed + ' 成功，' + failed + ' 失败；失败项可直接重试', 'warning');
  } else if (completed > 0) {
    closeDlcRepairModal();
    openDlcRepairRestartNotice();
  } else {
    renderDlcRepairModal();
  }
}

async function retryPendingDlcRepair(repairId) {
  const existingLock = getRepairResolveLockedUntil();
  if (existingLock) {
    showRepairResolveLockNotice(existingLock);
    return;
  }
  const record = (dlcRepairUiState.report?.pending || []).find(item => item.repairId === repairId);
  if (!record?.target) return;
  dlcRepairUiState.busy = true;
  renderDlcRepairModal();
  try {
    await requestDlcRepairProject(record.target);
    closeDlcRepairModal();
    openDlcRepairRestartNotice();
  } catch (error) {
    showToast('继续修复失败：' + (error?.message || String(error)), 'error');
  } finally {
    dlcRepairUiState.busy = false;
    renderDlcRepairModal();
  }
}

async function loadDlcRepairScan(worldbookNames = null) {
  if (!dlcRepairUiState.overlay) return;
  dlcRepairUiState.report = null;
  dlcRepairUiState.items = new Map();
  renderDlcRepairModal();
  try {
    const report = await requestDlcRepairScan(worldbookNames);
    dlcRepairUiState.report = report || {
      candidates: [],
      unreadableWorldbookNames: [],
      pending: [],
      availableWorldbookNames: [],
      enabledWorldbookNames: [],
      scannedWorldbookNames: [],
    };
    initializeRepairItems(dlcRepairUiState.report);
  } catch (error) {
    dlcRepairUiState.report = {
      candidates: [],
      unreadableWorldbookNames: [],
      pending: [],
      availableWorldbookNames: [],
      enabledWorldbookNames: [],
      scannedWorldbookNames: [],
    };
    showToast('DLC 扫描失败：' + (error?.message || String(error)), 'error');
  }
  renderDlcRepairModal();
}

function openDlcRepairModal() {
  if (!state.tavern.connected) {
    showToast('需要从 SillyTavern 内打开创意工坊才能扫描本地 DLC', 'warning');
    return null;
  }
  const overlay = openModal('<div id="dlcRepairRoot"></div>', '<i class="fas fa-screwdriver-wrench"></i> DLC 修复');
  overlay.classList.add('dlc-repair-modal');
  dlcRepairUiState.overlay = overlay;
  dlcRepairUiState.report = null;
  dlcRepairUiState.items = new Map();
  dlcRepairUiState.busy = false;
  const closeBtn = overlay.querySelector('.close-btn');
  if (closeBtn) closeBtn.addEventListener('click', () => {
    if (dlcRepairUiState.overlay === overlay) closeDlcRepairModal();
  }, { once: true });
  renderDlcRepairModal();
  void loadDlcRepairScan();
  return overlay;
}
`;
