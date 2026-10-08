export const homeDevTeamRecommendModalScript = String.raw`
async function openDevTeamRecommendationModal(project) {
  if (!state.currentUser?.isAdmin) {
    showToast('只有管理员可以管理编辑精选', 'error');
    return;
  }
  if (!project?.id || project.status !== 'approved' || !project.isPublished || project.visibility === false) {
    showToast('只能推荐已经公开发布的项目', 'warning');
    return;
  }
  const existing = Boolean(getMyDevTeamRecommendation(project.id));
  const actionLabel = existing ? '取消我的推荐' : '加入编辑精选';
  const html = '<div class="devteam-editor-form">'
    + '<div class="devteam-editor-project"><small>编辑精选</small><strong>' + escapeHtml(project.name || '未命名项目') + '</strong>'
    + '<span>所有管理员的推荐会统一显示，不公开推荐人或评语。操作会记录在后台日志中。</span></div>'
    + '<div class="devteam-editor-actions"><button type="button" class="btn ' + (existing ? 'btn-outline' : 'btn-primary')
    + '" id="toggleEditorPick">' + actionLabel + '</button></div></div>';
  const overlay = openModal(html, '<i class="fas fa-star"></i> 编辑精选');
  const button = overlay.querySelector('#toggleEditorPick');
  button.onclick = async () => {
    button.disabled = true;
    try {
      if (existing) await deleteDevTeamRecommendation(project.id);
      else await saveDevTeamRecommendation(project.id, {});
      overlay.dataset.dirty = 'false';
      overlay.remove();
      showToast(existing ? '已取消你的推荐' : '已加入编辑精选');
      renderApp();
    } catch (error) {
      showToast('更新编辑精选失败: ' + (error?.message || String(error)), 'error');
      button.disabled = false;
    }
  };
}
`;
