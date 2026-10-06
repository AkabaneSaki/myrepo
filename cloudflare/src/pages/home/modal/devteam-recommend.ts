export const homeDevTeamRecommendModalScript = String.raw`
function renderDlcKitchenPresetEditorItems(items) {
  if (!items.length) return '<span class="dlc-kitchen-preset-empty">还没有常用 reaction</span>';
  return items.map((item, index) => '<button type="button" class="dlc-kitchen-preset-chip dlc-kitchen-preset-chip--remove" data-preset-remove-index="' + index + '" title="移除这个常用 reaction"><span>' + escapeHtml(item) + '</span><i class="fas fa-xmark"></i></button>').join('');
}

async function openDlcKitchenSettingsModal() {
  if (!state.currentUser?.isAdmin) {
    showToast('只有管理员可以设置鉴赏家资料', 'error');
    return;
  }

  let profile;
  try {
    profile = await fetchDlcKitchenProfile(true);
  } catch (error) {
    showToast('加载鉴赏家设置失败: ' + (error?.message || String(error)), 'error');
    return;
  }

  let reactionPresets = Array.isArray(profile?.reactionPresets) ? [...profile.reactionPresets] : [];
  const html = '<form id="dlcKitchenSettingsForm" class="devteam-editor-form dlc-kitchen-settings-form">'
    + '<div class="devteam-editor-project"><small>个人档案</small><strong>鉴赏家设置</strong><span>这些资料属于你本人，不属于任何一个 DLC。</span></div>'
    + '<label><span>个人称号 <small>显示在你的私房菜头像旁</small></span><input id="dlcKitchenCuratorTitle" type="text" maxlength="48" value="' + escapeHtml(String(profile?.title || '')) + '" placeholder="例如：冷门扩展鉴赏家"></label>'
    + '<label><span>一句简介 <small>可选</small></span><input id="dlcKitchenCuratorBio" type="text" maxlength="160" value="' + escapeHtml(String(profile?.bio || '')) + '" placeholder="例如：偏爱剧情向、世界观与奇怪小工具"></label>'
    + '<div class="dlc-kitchen-preset-editor"><div class="dlc-kitchen-preset-editor-head"><span>常用 reaction</span><small id="dlcKitchenPresetCount"></small></div><div class="dlc-kitchen-preset-list" id="dlcKitchenPresetList"></div><div class="dlc-kitchen-preset-add"><input id="dlcKitchenPresetInput" type="text" maxlength="32" placeholder="例如：🔥 私藏 / 🫶 常驻 / 😭 神"><button type="button" class="btn btn-outline" id="dlcKitchenPresetAdd"><i class="fas fa-plus"></i> 添加</button></div><small class="dlc-kitchen-preset-hint">最多保存 12 个。之后编辑私房菜时可以直接点一下套用。</small></div>'
    + '<div class="devteam-editor-actions"><button type="submit" class="btn btn-primary"><i class="fas fa-floppy-disk"></i> 保存鉴赏家设置</button></div>'
    + '</form>';

  const overlay = openModal(html, '<i class="fas fa-user-pen"></i> 鉴赏家设置');
  const form = overlay.querySelector('#dlcKitchenSettingsForm');
  const list = overlay.querySelector('#dlcKitchenPresetList');
  const input = overlay.querySelector('#dlcKitchenPresetInput');
  const add = overlay.querySelector('#dlcKitchenPresetAdd');
  const count = overlay.querySelector('#dlcKitchenPresetCount');

  const renderPresets = () => {
    list.innerHTML = renderDlcKitchenPresetEditorItems(reactionPresets);
    count.textContent = reactionPresets.length + ' / 12';
  };

  const addPreset = () => {
    const value = String(input.value || '').trim();
    if (!value) return;
    if (reactionPresets.includes(value)) {
      showToast('这个 reaction 已经在常用列表里', 'warning');
      return;
    }
    if (reactionPresets.length >= 12) {
      showToast('常用 reaction 最多保存 12 个', 'warning');
      return;
    }
    reactionPresets.push(value);
    input.value = '';
    renderPresets();
    input.focus();
  };

  add.onclick = addPreset;
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addPreset();
  });
  list.addEventListener('click', event => {
    const button = event.target.closest('[data-preset-remove-index]');
    if (!button) return;
    const index = Number(button.dataset.presetRemoveIndex);
    if (!Number.isInteger(index) || index < 0 || index >= reactionPresets.length) return;
    reactionPresets.splice(index, 1);
    renderPresets();
  });
  renderPresets();

  form.onsubmit = async event => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    const title = overlay.querySelector('#dlcKitchenCuratorTitle').value.trim();
    const bio = overlay.querySelector('#dlcKitchenCuratorBio').value.trim();
    submit.disabled = true;
    try {
      await saveDlcKitchenProfile({ title, bio, reactionPresets });
      overlay.dataset.dirty = 'false';
      overlay.remove();
      showToast('鉴赏家设置已保存');
      renderApp();
    } catch (error) {
      showToast('保存鉴赏家设置失败: ' + (error?.message || String(error)), 'error');
      submit.disabled = false;
    }
  };
}

function openDlcKitchenCuratorModal(curatorId) {
  const curator = (state.devTeamCurators || []).find(item => item?.id === curatorId);
  if (!curator) {
    showToast('找不到这位私房主理人的资料', 'warning');
    return;
  }

  const recommendations = Array.isArray(curator.recommendations)
    ? curator.recommendations.filter(item => item?.project)
    : [];
  const avatar = curator.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png';
  const name = curator.name || '私房主理人';
  const title = String(curator.title || '').trim() || 'DLC 私房主理人';
  const bio = String(curator.bio || '').trim();
  const itemsHtml = recommendations.map(item => {
    const reaction = String(item.reactionLabel || '').trim() || '推荐';
    const comment = String(item.comment || '').trim();
    return '<div class="dlc-kitchen-full-item">'
      + renderDiscoverCard(item.project)
      + '<div class="dlc-kitchen-full-copy"><span class="dlc-kitchen-reaction">' + escapeHtml(reaction) + '</span>'
      + (comment ? '<p>' + escapeHtml(comment) + '</p>' : '')
      + '</div></div>';
  }).join('');

  const html = '<div class="dlc-kitchen-full">'
    + '<header class="dlc-kitchen-full-head"><img src="' + escapeHtml(avatar) + '" alt=""><div><small>' + escapeHtml(name) + '</small><h3>' + escapeHtml(title) + '</h3>'
    + (bio ? '<p>' + escapeHtml(bio) + '</p>' : '')
    + '<span>' + recommendations.length + ' 道私房菜</span></div></header>'
    + '<div class="dlc-kitchen-full-grid">' + itemsHtml + '</div></div>';

  const overlay = openModal(html, '<i class="fas fa-bowl-food"></i> DLC私房菜');
  overlay.querySelectorAll('.discover-card').forEach(card => {
    card.addEventListener('click', event => {
      if (event.target.closest('.like-btn')) return;
      const projectId = card.dataset.id;
      const item = recommendations.find(candidate => candidate?.project?.id === projectId);
      if (!item?.project) return;
      overlay.dataset.dirty = 'false';
      overlay.remove();
      showProjectDetail(item.project);
    });
  });
  overlay.querySelectorAll('.like-btn').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (button.dataset.id) toggleLike(button.dataset.id);
    });
  });
}

async function openDevTeamRecommendationModal(project) {
  if (!state.currentUser?.isAdmin) {
    showToast('只有管理员可以添加私房菜', 'error');
    return;
  }
  if (!project?.id || project.status !== 'approved' || !project.isPublished || project.visibility === false) {
    showToast('只能加入已经公开发布的项目', 'warning');
    return;
  }

  const existing = getMyDevTeamRecommendation(project.id);
  let profile = state.dlcKitchenProfile;
  if (!profile) {
    try {
      profile = await fetchDlcKitchenProfile();
    } catch (error) {
      console.warn('[CreativeWorkshop] 加载鉴赏家快捷 reaction 失败', error);
      profile = { title: '', bio: '', reactionPresets: [] };
    }
  }

  const reactionPresets = Array.isArray(profile?.reactionPresets) ? profile.reactionPresets : [];
  const reactionLabel = String(existing?.recommendation?.reactionLabel || '');
  const comment = String(existing?.recommendation?.comment || '');
  const removeButton = existing
    ? '<button type="button" class="btn btn-outline" id="removeDevTeamRecommendation"><i class="fas fa-xmark"></i> 移出私房菜</button>'
    : '';
  const presetButtons = reactionPresets.map((item, index) => '<button type="button" class="dlc-kitchen-preset-chip" data-reaction-preset-index="' + index + '">' + escapeHtml(item) + '</button>').join('');
  const presetHtml = reactionPresets.length
    ? '<div class="dlc-kitchen-preset-quick-wrap"><span>常用 reaction <small>点一下套用</small></span><div class="dlc-kitchen-preset-quick">' + presetButtons + '</div></div>'
    : '<div class="dlc-kitchen-preset-quick-wrap dlc-kitchen-preset-quick-wrap--empty"><span>常用 reaction</span><small>还没保存快捷项，可在头像菜单 →「鉴赏家设置」添加。</small></div>';
  const html = '<form id="devTeamRecommendationForm" class="devteam-editor-form">'
    + '<div class="devteam-editor-project"><small>正在加入私房菜</small><strong>' + escapeHtml(project.name || '未命名项目') + '</strong></div>'
    + presetHtml
    + '<label><span>Reaction <small>可用 emoji · 留空则显示「推荐」</small></span><input id="devTeamReactionLabel" type="text" maxlength="32" value="' + escapeHtml(reactionLabel) + '" placeholder="也可以临时手输，不必保存为常用项"></label>'
    + '<label><span>推荐语</span><textarea id="devTeamRecommendationComment" maxlength="500" required placeholder="用你自己的语气说说为什么把它放进私房菜">' + escapeHtml(comment) + '</textarea></label>'
    + '<div class="devteam-editor-actions">' + removeButton + '<button type="submit" class="btn btn-primary"><i class="fas fa-bowl-food"></i> ' + (existing ? '更新这道菜' : '加入私房菜') + '</button></div>'
    + '<p class="devteam-editor-note">这里只编辑你对这个作品的 reaction 和推荐语。个人称号、简介与常用 reaction 请到「鉴赏家设置」管理。</p></form>';

  const overlay = openModal(html, '<i class="fas fa-user-pen"></i> DLC私房菜');
  const form = overlay.querySelector('#devTeamRecommendationForm');
  const reactionInput = overlay.querySelector('#devTeamReactionLabel');
  const syncPresetSelection = () => {
    overlay.querySelectorAll('[data-reaction-preset-index]').forEach(button => {
      const preset = reactionPresets[Number(button.dataset.reactionPresetIndex)] || '';
      button.classList.toggle('active', preset === reactionInput.value.trim());
    });
  };
  overlay.querySelectorAll('[data-reaction-preset-index]').forEach(button => {
    button.addEventListener('click', () => {
      const preset = reactionPresets[Number(button.dataset.reactionPresetIndex)] || '';
      reactionInput.value = preset;
      syncPresetSelection();
      reactionInput.focus();
    });
  });
  reactionInput.addEventListener('input', syncPresetSelection);
  syncPresetSelection();

  form.onsubmit = async event => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    const nextReactionLabel = reactionInput.value.trim();
    const nextComment = overlay.querySelector('#devTeamRecommendationComment').value.trim();
    if (!nextComment) {
      showToast('写一句推荐语再保存喵', 'warning');
      return;
    }
    submit.disabled = true;
    try {
      await saveDevTeamRecommendation(project.id, {
        reactionLabel: nextReactionLabel,
        comment: nextComment,
      });
      overlay.dataset.dirty = 'false';
      overlay.remove();
      showToast(existing ? '私房菜已更新' : '已经加入你的 DLC私房菜');
      renderApp();
    } catch (error) {
      showToast('保存私房菜失败: ' + (error?.message || String(error)), 'error');
      submit.disabled = false;
    }
  };

  const remove = overlay.querySelector('#removeDevTeamRecommendation');
  if (remove) {
    remove.onclick = async () => {
      if (!confirm('把这个作品移出你的私房菜吗？')) return;
      remove.disabled = true;
      try {
        await deleteDevTeamRecommendation(project.id);
        overlay.dataset.dirty = 'false';
        overlay.remove();
        showToast('已移出私房菜');
        renderApp();
      } catch (error) {
        showToast('移出私房菜失败: ' + (error?.message || String(error)), 'error');
        remove.disabled = false;
      }
    };
  }
}
`;
