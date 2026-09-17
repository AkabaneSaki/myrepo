export const homePublishCheckScript = String.raw`
function getCurrentWorkshopReference(references) {
  const candidates = (Array.isArray(references) ? references : []).map(reference => {
    const versions = Array.isArray(reference?.versions) ? [...reference.versions] : [];
    versions.sort((a, b) => Number(b.versionOrdinal || 0) - Number(a.versionOrdinal || 0));
    return versions[0] ? { reference, version: versions[0] } : null;
  }).filter(Boolean);
  candidates.sort((a, b) => String(b.version.createdAt || '').localeCompare(String(a.version.createdAt || '')));
  return candidates[0] || null;
}

function parseOriginalBaselineItem(item) {
  if (!item || item.kind !== 'worldbook') return null;
  const raw = String(item.displayName || '').trim();
  const match = /^((?:\[[^\]]+\])+)(.*)$/.exec(raw);
  if (!match) return null;
  const tags = Array.from(match[1].matchAll(/\[([^\]]+)\]/g), part => String(part[1] || '').trim()).filter(Boolean);
  if (tags[0] !== '本体') return null;
  const path = tags.slice(1);
  const title = String(match[2] || '').trim() || path[path.length - 1] || raw;
  const systemTags = new Set(['变量', '控制', 'COT', '快捷功能', '分割线']);
  const system = path.some(tag => systemTags.has(tag)) || title.startsWith('➡️');
  return { id: String(item.id), sourceKey: item.sourceKey || null, path: path.filter(tag => tag !== '分割线'), title, system };
}

function countOriginalTreeEntries(node) {
  return node.entries.length + Array.from(node.groups.values()).reduce((sum, child) => sum + countOriginalTreeEntries(child), 0);
}

function buildOriginalBaselineTree(items, selectedIds, options = {}) {
  const query = String(options.query || '').trim().toLocaleLowerCase();
  const showSystem = Boolean(options.showSystem);
  const root = { groups: new Map(), entries: [] };
  const parsed = (Array.isArray(items) ? items : []).map(parseOriginalBaselineItem).filter(Boolean).filter(entry => {
    if (!showSystem && entry.system) return false;
    if (!query) return true;
    return (entry.path.join(' ') + ' ' + entry.title).toLocaleLowerCase().includes(query);
  });
  for (const entry of parsed) {
    let node = root;
    const path = entry.path.length ? entry.path : ['其他'];
    for (const label of path) {
      if (!node.groups.has(label)) node.groups.set(label, { groups: new Map(), entries: [] });
      node = node.groups.get(label);
    }
    node.entries.push(entry);
  }
  const renderNode = (node, depth = 0) => {
    const groups = Array.from(node.groups.entries()).sort((a, b) => a[0].localeCompare(b[0], 'zh-Hans-CN'));
    const groupHtml = groups.map(([label, child]) => {
      const count = countOriginalTreeEntries(child);
      return '<details class="original-tree-group original-tree-depth-' + Math.min(depth, 5) + '"' + (query ? ' open' : '') + '><summary><span>' + escapeHtml(label) + '</span><small>' + count + '</small></summary><div class="original-tree-children">' + renderNode(child, depth + 1) + '</div></details>';
    }).join('');
    const entryHtml = [...node.entries].sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN')).map(entry => '<label class="original-tree-entry"><input type="checkbox" data-original-entry-id="' + escapeHtml(entry.id) + '"' + (selectedIds.has(entry.id) ? ' checked' : '') + '><span>' + escapeHtml(entry.title) + '</span></label>').join('');
    return groupHtml + entryHtml;
  };
  return { html: renderNode(root), visibleCount: parsed.length };
}

async function openCreatorPublishCheck(references, project = null) {
  const current = getCurrentWorkshopReference(references);
  if (!current?.version?.id) {
    showToast('工坊还没有设置当前角色卡版本，请稍后再试', 'warning');
    return null;
  }
  const versionId = String(current.version.id);
  const versionLabel = String(current.version.versionLabel || '当前版本');
  const selectedIds = new Set(Array.isArray(project?.originalConflictReferenceItemIds) ? project.originalConflictReferenceItemIds.map(String) : []);
  let compatibilityChoice = project?.testedThroughReferenceVersionId === versionId ? 'yes' : (project?.builtForReferenceVersionId === versionId ? 'unsure' : '');
  let conflictChoice = project ? (project.conflictsWithOriginal ? 'yes' : 'no') : '';
  let baselineItems = null;
  let showSystem = false;
  let searchQuery = '';

  const html = '<div class="publish-check">'
    + '<section class="publish-check-question"><span class="publish-check-step">1</span><div><h3>你的 DLC 在 ' + escapeHtml(versionLabel) + ' 可以正常使用吗？</h3><p>当前工坊使用的角色卡版本是 ' + escapeHtml(versionLabel) + '。</p><div class="publish-check-options"><button type="button" data-compatibility-choice="yes">可以，我确认过</button><button type="button" data-compatibility-choice="unsure">不确定</button></div></div></section>'
    + '<section class="publish-check-question"><span class="publish-check-step">2</span><div><h3>需要暂时关掉一些原版内容吗？</h3><p>例如你的 DLC 会替换原版设定、规则或地点。</p><div class="publish-check-options"><button type="button" data-conflict-choice="no">不需要</button><button type="button" data-conflict-choice="yes">需要关掉一些</button></div>'
    + '<div class="original-picker" data-original-picker hidden><div class="original-picker-head"><strong>要关掉哪些原版内容？</strong><span data-original-selected-count>已选 0 项</span></div><input class="original-picker-search" data-original-search type="search" placeholder="搜索名称，例如：白曜城"><label class="original-picker-system-toggle"><input type="checkbox" data-original-show-system> 显示系统内容</label><div class="original-picker-tree" data-original-tree><div class="empty-state">正在读取原版内容…</div></div></div></div></section>'
    + '<div class="publish-check-footer"><button type="button" class="btn btn-outline" data-publish-check-cancel>返回修改</button><button type="button" class="btn btn-primary" data-publish-check-confirm>确认发布</button></div></div>';
  const overlay = openModal(html, '<i class="fas fa-clipboard-check"></i> 发布前检查');
  overlay.classList.add('publish-check-modal');
  const confirmButton = overlay.querySelector('[data-publish-check-confirm]');
  const picker = overlay.querySelector('[data-original-picker]');
  const tree = overlay.querySelector('[data-original-tree]');
  const searchInput = overlay.querySelector('[data-original-search]');
  const showSystemInput = overlay.querySelector('[data-original-show-system]');
  const selectedCount = overlay.querySelector('[data-original-selected-count]');

  const syncButtons = () => {
    overlay.querySelectorAll('[data-compatibility-choice]').forEach(button => button.classList.toggle('active', button.dataset.compatibilityChoice === compatibilityChoice));
    overlay.querySelectorAll('[data-conflict-choice]').forEach(button => button.classList.toggle('active', button.dataset.conflictChoice === conflictChoice));
    if (picker) picker.hidden = conflictChoice !== 'yes';
    const ready = Boolean(compatibilityChoice && conflictChoice && (conflictChoice !== 'yes' || selectedIds.size > 0));
    if (confirmButton) confirmButton.disabled = !ready;
    if (selectedCount) selectedCount.textContent = '已选 ' + selectedIds.size + ' 项';
  };

  const renderTree = () => {
    if (!tree || !baselineItems) return;
    const result = buildOriginalBaselineTree(baselineItems, selectedIds, { query: searchQuery, showSystem });
    tree.innerHTML = result.visibleCount ? result.html : '<div class="empty-state">没有找到符合的原版内容</div>';
    tree.querySelectorAll('[data-original-entry-id]').forEach(input => {
      input.addEventListener('change', () => {
        const id = String(input.dataset.originalEntryId || '');
        if (!id) return;
        if (input.checked) selectedIds.add(id); else selectedIds.delete(id);
        syncButtons();
      });
    });
  };

  const ensureBaselineItems = async () => {
    if (baselineItems) return true;
    try {
      const data = await fetchCharacterReferenceVersionItems(versionId);
      baselineItems = Array.isArray(data?.items) ? data.items : [];
      renderTree();
      return true;
    } catch (error) {
      if (tree) tree.innerHTML = '<div class="empty-state">原版内容读取失败，请稍后再试</div>';
      showToast('原版内容读取失败：' + error.message, 'error');
      return false;
    }
  };

  overlay.querySelectorAll('[data-compatibility-choice]').forEach(button => button.addEventListener('click', () => {
    compatibilityChoice = button.dataset.compatibilityChoice || '';
    syncButtons();
  }));
  overlay.querySelectorAll('[data-conflict-choice]').forEach(button => button.addEventListener('click', async () => {
    conflictChoice = button.dataset.conflictChoice || '';
    syncButtons();
    if (conflictChoice === 'yes') await ensureBaselineItems();
  }));
  searchInput?.addEventListener('input', () => {
    searchQuery = searchInput.value || '';
    renderTree();
  });
  showSystemInput?.addEventListener('change', () => {
    showSystem = Boolean(showSystemInput.checked);
    renderTree();
  });
  if (conflictChoice === 'yes') void ensureBaselineItems();
  syncButtons();

  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      if (overlay.isConnected) overlay.remove();
      resolve(result);
    };
    overlay.querySelector('[data-publish-check-cancel]')?.addEventListener('click', () => finish(null));
    overlay.querySelector('.close-btn')?.addEventListener('click', () => finish(null), { once: true });
    overlay.addEventListener('click', event => { if (event.target === overlay) finish(null); });
    confirmButton?.addEventListener('click', () => {
      if (!compatibilityChoice || !conflictChoice) return;
      if (conflictChoice === 'yes' && selectedIds.size === 0) {
        showToast('请先选择需要暂时关闭的原版内容', 'warning');
        return;
      }
      finish({
        builtForReferenceVersionId: versionId,
        compatibilityConfirmed: compatibilityChoice === 'yes',
        conflictsWithOriginal: conflictChoice === 'yes',
        originalConflictReferenceItemIds: conflictChoice === 'yes' ? Array.from(selectedIds) : [],
      });
    });
  });
}
`;
