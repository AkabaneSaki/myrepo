export const homeUtilsScript = String.raw`
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.dataset.type = type;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function escapeHtml(unsafe) {
  if (unsafe === null || unsafe === undefined) return '';
  return String(unsafe).replace(/[&<>"']/g, function(char) {
    if (char === '&') return '&amp;';
    if (char === '<') return '&lt;';
    if (char === '>') return '&gt;';
    if (char === '"') return '&quot;';
    if (char === "'") return '&#39;';
    return char;
  });
}

function formatDate(value) {
  if (!value) return '未知日期';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知日期';
  return date.toLocaleDateString('zh-CN');
}

function getBaseTag(project) {
  return (project.tags || []).find(tag => ['系统', '角色', '事件', '扩展'].includes(tag)) || '系统';
}

function getTypeClass(project) {
  const baseTag = getBaseTag(project);
  if (baseTag === '角色') return 'character';
  if (baseTag === '事件') return 'event';
  if (baseTag === '扩展') return 'extension';
  return 'system';
}

function getAuthorName(project) {
  return project.authorGlobalName || project.authorName || '未知作者';
}

function getAuthorAvatar(project) {
  if (!project.authorAvatar) {
    return 'https://cdn.discordapp.com/embed/avatars/0.png';
  }
  if (String(project.authorAvatar).startsWith('http://') || String(project.authorAvatar).startsWith('https://')) {
    return String(project.authorAvatar);
  }
  return 'https://cdn.discordapp.com/avatars/' + project.authorId + '/' + project.authorAvatar + '.png';
}

function getCoverUrl(project) {
  if (project.coverImage) {
    return project.coverImage;
  }

  const fallbackSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160" viewBox="0 0 300 160" fill="none">'
    + '<rect width="300" height="160" rx="20" fill="#0F172A"/>'
    + '<rect x="18" y="18" width="264" height="124" rx="16" fill="#1E293B" stroke="#334155"/>'
    + '<circle cx="92" cy="70" r="18" fill="#334155"/>'
    + '<path d="M54 118L97 84L126 106L158 74L214 118H54Z" fill="#475569"/>'
    + '<text x="150" y="136" text-anchor="middle" fill="#CBD5E1" font-size="16" font-family="Arial, sans-serif">No Preview</text>'
    + '</svg>';

  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(fallbackSvg);
}

function getLikeState(projectId) {
  return state.likesMap.get(projectId) || { count: 0, liked: false };
}

function getSubscribeState(projectId) {
  return state.subsMap.get(projectId) || { count: 0, subscribed: false };
}

function isProjectPending(project) {
  return project?.status === 'pending';
}

function isRejectedDraft(project) {
  return project?.reviewTarget === 'draft' && project?.status === 'rejected';
}

function getProjectReviewBadge(project) {
  if (project?.reviewTarget === 'draft' && project?.status === 'pending') return '<span class="badge badge-admin">草稿审核中</span>';
  if (project?.reviewTarget === 'draft' && project?.status === 'rejected') return '<span class="badge badge-admin badge-rejected">草稿已拒绝</span>';
  if (project?.hasPendingDraft) return '<span class="badge badge-admin">待审核新版本</span>';
  return '';
}

function isProjectEditable(project) {
  return Boolean(state.currentUser?.isAdmin || (state.currentUser && project.authorId === state.currentUser.id));
}

function parseTagsInput(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function getEntryStrategy(entry) {
  if (entry.constant === true) return { symbol: '🔵', className: 'strategy-constant' };
  if (entry.selective === true) return { symbol: '🟢', className: 'strategy-selective' };
  return { symbol: '⚪', className: 'strategy-none' };
}

function normalizeEntryKeywords(entry) {
  if (!entry || entry.key === null || entry.key === undefined || entry.key === '') return [];
  return Array.isArray(entry.key) ? entry.key : String(entry.key).split(',').map(item => item.trim()).filter(Boolean);
}
`;
