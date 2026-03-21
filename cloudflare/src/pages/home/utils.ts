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
  return project.coverImage || 'https://via.placeholder.com/300x160?text=No+Preview';
}

function getLikeState(projectId) {
  return state.likesMap.get(projectId) || { count: 0, liked: false };
}

function getSubscribeState(projectId) {
  return state.subsMap.get(projectId) || { count: 0, subscribed: false };
}

function isProjectPending(project) {
  return project?.status === 'pending' || Boolean(project?.hasPendingDraft) || project?.reviewTarget === 'draft';
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
