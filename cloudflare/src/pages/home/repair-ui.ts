export const homeRepairScript = String.raw`
const dlcRepairUiState = {
  overlay: null,
  report: null,
  items: new Map(),
  busy: false,
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
    scanned: '等待匹配',
    matching: '正在匹配 Workshop',
    matched: '匹配完成',
    repairing: '正在重装最新版',
    completed: '修复完成',
    failed: '失败，可重试',
  })[status] || String(status || '');
}

function getRepairMatchLabel(match) {
  if (!match) return '尚未检查 Workshop 数据库';
  if (match.status === 'unique') {
    const project = match.projects?.[0];
    return project ? '唯一匹配：' + (project.name || project.id) : '唯一匹配';
  }
  if (match.status === 'ambiguous') return '发现多个同名 / 同 ID 候选，需要确认';
  if (match.status === 'candidates') return '找到可能的 Workshop 项目，需要确认';
  return 'Workshop 数据库未找到匹配项目';
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
  dlcRepairUiState.items = new Map((Array.isArray(report?.candidates) ? report.candidates : []).map(candidate => [
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
  return '<div class="repair-project-candidates">' + projects.map(project => {
    const author = project.authorGlobalName || project.authorName || project.authorId || '未知作者';
    return '<button type="button" class="repair-project-choice" data-repair-pick-project="' + escapeHtml(item.candidate.candidateId) + '" data-project-id="' + escapeHtml(project.id || '') + '">'
      + '<strong>' + escapeHtml(project.name || '未命名项目') + '</strong>'
      + '<small>' + escapeHtml(author) + ' · v' + escapeHtml(project.version || '?') + '</small>'
      + '<code>' + escapeHtml(project.id || '') + '</code>'
      + '</button>';
  }).join('') + '</div>';
}

function buildRepairCandidateHtml(item) {
  const candidate = item.candidate;
  const problems = Array.isArray(candidate.problems) ? candidate.problems : [];
  const matchProject = item.match?.status === 'unique' ? item.match.projects?.[0] : null;
  const safe = isRepairCandidateSafe(candidate);
  const matchingEvidence = [];
  if (candidate.detectedProjectId) matchingEvidence.push('projectId=' + candidate.detectedProjectId);
  if (candidate.legacyProjectName) matchingEvidence.push('legacy=' + candidate.legacyProjectName);
  matchingEvidence.push('name=' + candidate.name);
  const matchMethod = item.match?.method ? ' · ' + item.match.method : '';
  const projectSummary = matchProject
    ? '<div class="repair-match-project"><strong>' + escapeHtml(matchProject.name || '未命名项目') + '</strong><span>v' + escapeHtml(matchProject.version || '?') + '</span><code>' + escapeHtml(matchProject.id || '') + '</code></div>'
    : '';
  const errorHtml = item.error ? '<div class="repair-error"><i class="fas fa-triangle-exclamation"></i> ' + escapeHtml(item.error) + '</div>' : '';
  const problemHtml = problems.length
    ? '<ul class="repair-problems">' + problems.map(problem => '<li>' + escapeHtml(problem) + '</li>').join('') + '</ul>'
    : '<p class="repair-ok"><i class="fas fa-circle-check"></i> 未发现明显 metadata 缺失；仍可用本流程完整重装最新版</p>';

  return '<article class="repair-candidate ' + (item.selected ? 'selected' : '') + '" data-repair-candidate-card="' + escapeHtml(candidate.candidateId) + '">'
    + '<div class="repair-candidate-head">'
    + '<label class="repair-select"><input type="checkbox" data-repair-select="' + escapeHtml(candidate.candidateId) + '" ' + (item.selected ? 'checked' : '') + '><span></span></label>'
    + '<div class="repair-candidate-title"><strong>' + escapeHtml(candidate.name || '未命名 DLC') + '</strong><small>' + escapeHtml(candidate.category || '未知分类') + ' · 世界书 ' + escapeHtml(candidate.worldbookName || '未知') + '</small></div>'
    + '<span class="repair-item-status">' + escapeHtml(getRepairStatusLabel(item.status)) + '</span>'
    + '</div>'
    + '<div class="repair-facts">'
    + '<span><b>' + escapeHtml(String(candidate.entryCount || 0)) + '</b> 条目</span>'
    + '<span><b>' + escapeHtml(String(candidate.regexCount || 0)) + '</b> 正则</span>'
    + '<span><b>' + escapeHtml(String((candidate.entryUids || []).length)) + '/' + escapeHtml(String(candidate.entryCount || 0)) + '</b> UID 可定位</span>'
    + '<span><b>' + escapeHtml(String(candidate.dlcHeaderCount || 0)) + '</b> DLC Header</span>'
    + '<span><b>' + escapeHtml(String(candidate.workshopSourceMarkerCount || 0)) + '</b> [WS]</span>'
    + '</div>'
    + '<details class="repair-details" ' + (problems.length ? 'open' : '') + '><summary>本地诊断证据</summary>'
    + buildRepairMetadataHtml(candidate)
    + problemHtml
    + '<p class="repair-evidence"><strong>识别依据：</strong>' + escapeHtml(matchingEvidence.join(' · ')) + '</p>'
    + '</details>'
    + '<div class="repair-match-box ' + (item.match?.status || 'unmatched') + '">'
    + '<div><strong>Workshop 数据库：</strong>' + escapeHtml(getRepairMatchLabel(item.match)) + escapeHtml(matchMethod) + '</div>'
    + projectSummary
    + buildRepairMatchProjectsHtml(item)
    + ((item.match && item.match.status !== 'unique')
      ? '<div class="repair-manual-search"><input type="text" data-repair-search-input="' + escapeHtml(candidate.candidateId) + '" value="' + escapeHtml(candidate.name || '') + '" placeholder="输入 Workshop 项目名称"><button type="button" class="btn btn-outline" data-repair-search="' + escapeHtml(candidate.candidateId) + '"><i class="fas fa-search"></i> 搜索</button></div>'
      : '')
    + '</div>'
    + (!safe ? '<div class="repair-blocked"><i class="fas fa-shield-halved"></i> 有本地条目无法用 UID 安全定位，已禁止自动删除</div>' : '')
    + errorHtml
    + '</article>';
}

function buildPendingRepairHtml(report) {
  const pending = Array.isArray(report?.pending) ? report.pending : [];
  if (!pending.length) return '';
  return '<section class="repair-pending"><h3><i class="fas fa-clock-rotate-left"></i> 未完成的修复</h3><p>这些任务之前中断或失败，可以直接重新下载 Workshop 最新版并继续。</p>'
    + pending.map(record => '<div class="repair-pending-row"><div><strong>' + escapeHtml(record.target?.candidateId || record.target?.projectId || '未知任务') + '</strong><small>' + escapeHtml(record.status || '') + (record.error ? ' · ' + escapeHtml(record.error) : '') + '</small></div><button type="button" class="btn btn-primary" data-repair-retry="' + escapeHtml(record.repairId || '') + '">重新下载并继续</button></div>').join('')
    + '</section>';
}

function buildDlcRepairReportText() {
  const report = dlcRepairUiState.report || {};
  const lines = [];
  lines.push('Creative Workshop DLC Repair Report');
  lines.push('Client: ' + (state.tavern.clientVersion || 'unknown'));
  lines.push('Generated: ' + new Date().toISOString());
  const unreadable = Array.isArray(report.unreadableWorldbookNames) ? report.unreadableWorldbookNames : [];
  lines.push('Unreadable worldbooks: ' + (unreadable.length ? unreadable.join(', ') : 'none'));
  lines.push('Pending repairs: ' + (Array.isArray(report.pending) ? report.pending.length : 0));
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
  if (!report) {
    root.innerHTML = '<div class="repair-loading"><i class="fas fa-spinner fa-spin"></i><strong>正在扫描本地 DLC...</strong><span>只读取 metadata、UID、正则身份，不上传世界书正文。</span></div>';
    return;
  }

  const unreadable = Array.isArray(report.unreadableWorldbookNames) ? report.unreadableWorldbookNames : [];
  const selectedItems = Array.from(dlcRepairUiState.items.values()).filter(item => item.selected);
  const readyItems = selectedItems.filter(item => item.match?.status === 'unique' && isRepairCandidateSafe(item.candidate) && !['repairing', 'completed'].includes(item.status));
  const candidateHtml = dlcRepairUiState.items.size
    ? Array.from(dlcRepairUiState.items.values()).map(buildRepairCandidateHtml).join('')
    : '<div class="repair-empty"><i class="fas fa-magnifying-glass"></i><strong>没有扫描到 DLC 候选</strong><p>如果内容存在但没有 [DLC] 命名头、Workshop metadata 或 legacy metadata，脚本无法安全判断哪些条目属于同一个 Mod。</p></div>';

  root.innerHTML = buildPendingRepairHtml(report)
    + (unreadable.length ? '<div class="repair-warning"><i class="fas fa-triangle-exclamation"></i> 无法读取世界书：' + escapeHtml(unreadable.join('、')) + '</div>' : '')
    + '<div class="repair-toolbar"><div><strong>选择玩家报告有问题的 DLC</strong><small>可以一次选择 A / B / C / D。匹配可并行，实际修改会逐个执行。</small></div><div class="repair-toolbar-actions"><button type="button" class="btn btn-outline" id="dlcRepairRescanBtn"><i class="fas fa-rotate"></i> 重扫</button><button type="button" class="btn btn-outline" id="dlcRepairCopyBtn"><i class="fas fa-copy"></i> 复制报告</button></div></div>'
    + '<div class="repair-candidate-list">' + candidateHtml + '</div>'
    + '<div class="repair-footer"><div><strong>' + selectedItems.length + '</strong> 个已选择 · <strong>' + readyItems.length + '</strong> 个可直接重装</div><div><button type="button" class="btn btn-outline" id="dlcRepairAnalyzeBtn" ' + (!selectedItems.length || dlcRepairUiState.busy ? 'disabled' : '') + '><i class="fas fa-database"></i> 匹配 Workshop</button><button type="button" class="btn btn-primary" id="dlcRepairRunBtn" ' + (!readyItems.length || dlcRepairUiState.busy ? 'disabled' : '') + '><i class="fas fa-screwdriver-wrench"></i> 重装所选最新版</button></div></div>';

  root.querySelectorAll('[data-repair-select]').forEach(input => {
    input.addEventListener('change', () => {
      const item = getRepairItem(input.dataset.repairSelect);
      if (!item) return;
      item.selected = Boolean(input.checked);
      renderDlcRepairModal();
    });
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

  const analyzeBtn = root.querySelector('#dlcRepairAnalyzeBtn');
  if (analyzeBtn) analyzeBtn.addEventListener('click', () => { void analyzeSelectedDlcRepairs(); });
  const runBtn = root.querySelector('#dlcRepairRunBtn');
  if (runBtn) runBtn.addEventListener('click', () => { void runSelectedDlcRepairs(); });
  const copyBtn = root.querySelector('#dlcRepairCopyBtn');
  if (copyBtn) copyBtn.addEventListener('click', async () => {
    const copied = await copyTextToClipboard(buildDlcRepairReportText());
    showToast(copied ? '诊断报告已复制' : '浏览器禁止自动复制，请手动复制', copied ? 'info' : 'warning');
  });
  const rescanBtn = root.querySelector('#dlcRepairRescanBtn');
  if (rescanBtn) rescanBtn.addEventListener('click', () => { void loadDlcRepairScan(); });
}

async function analyzeDlcRepairItem(candidateId, manualQuery = '') {
  const item = getRepairItem(candidateId);
  if (!item) return;
  item.status = 'matching';
  item.error = null;
  renderDlcRepairModal();
  try {
    item.match = await findWorkshopProjectsForRepair(item.candidate, manualQuery);
    item.status = 'matched';
  } catch (error) {
    item.match = { status: 'none', method: manualQuery ? 'manual_search_error' : 'auto_match_error', projects: [] };
    item.status = 'failed';
    item.error = error?.message || String(error);
  }
  renderDlcRepairModal();
}

async function analyzeSelectedDlcRepairs() {
  const selected = Array.from(dlcRepairUiState.items.values()).filter(item => item.selected);
  if (!selected.length) return;
  dlcRepairUiState.busy = true;
  renderDlcRepairModal();
  try {
    await Promise.all(selected.map(item => analyzeDlcRepairItem(item.candidate.candidateId)));
  } finally {
    dlcRepairUiState.busy = false;
    renderDlcRepairModal();
  }
}

async function runSelectedDlcRepairs() {
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
      completed += 1;
    } catch (error) {
      item.status = 'failed';
      item.error = error?.message || String(error);
      failed += 1;
    }
    renderDlcRepairModal();
  }
  dlcRepairUiState.busy = false;
  renderDlcRepairModal();
  if (failed) showToast('DLC 修复完成：' + completed + ' 成功，' + failed + ' 失败；失败项可直接重试', 'warning');
  else showToast('已重装 ' + completed + ' 个 DLC 的 Workshop 最新版');
}

async function retryPendingDlcRepair(repairId) {
  const record = (dlcRepairUiState.report?.pending || []).find(item => item.repairId === repairId);
  if (!record?.target) return;
  dlcRepairUiState.busy = true;
  renderDlcRepairModal();
  try {
    await requestDlcRepairProject(record.target);
    showToast('未完成的 DLC 修复已继续并完成');
    await loadDlcRepairScan();
  } catch (error) {
    showToast('继续修复失败：' + (error?.message || String(error)), 'error');
  } finally {
    dlcRepairUiState.busy = false;
    renderDlcRepairModal();
  }
}

async function loadDlcRepairScan() {
  if (!dlcRepairUiState.overlay) return;
  dlcRepairUiState.report = null;
  dlcRepairUiState.items = new Map();
  renderDlcRepairModal();
  try {
    const report = await requestDlcRepairScan();
    dlcRepairUiState.report = report || { candidates: [], unreadableWorldbookNames: [], pending: [] };
    initializeRepairItems(dlcRepairUiState.report);
  } catch (error) {
    dlcRepairUiState.report = { candidates: [], unreadableWorldbookNames: [], pending: [] };
    showToast('DLC 扫描失败：' + (error?.message || String(error)), 'error');
  }
  renderDlcRepairModal();
}

function openDlcRepairModal() {
  if (!state.tavern.connected) {
    showToast('需要从 SillyTavern 内打开创意工坊才能扫描本地 DLC', 'warning');
    return null;
  }
  const overlay = openModal('<div id="dlcRepairRoot"></div>', '<i class="fas fa-screwdriver-wrench"></i> DLC 诊断与重装');
  overlay.classList.add('dlc-repair-modal');
  dlcRepairUiState.overlay = overlay;
  dlcRepairUiState.report = null;
  dlcRepairUiState.items = new Map();
  dlcRepairUiState.busy = false;
  const closeBtn = overlay.querySelector('.close-btn');
  if (closeBtn) closeBtn.addEventListener('click', () => {
    if (dlcRepairUiState.overlay === overlay) dlcRepairUiState.overlay = null;
  }, { once: true });
  renderDlcRepairModal();
  void loadDlcRepairScan();
  return overlay;
}
`;
