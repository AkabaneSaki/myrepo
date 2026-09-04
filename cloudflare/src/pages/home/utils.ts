export const homeUtilsScript = String.raw`
const BASE_TAG_META = [
  { value: '系统', label: '系统', typeClass: 'system' },
  { value: '扩展', label: '扩展', typeClass: 'extension' },
  { value: '角色', label: '角色', typeClass: 'character' },
  { value: '事件', label: '事件', typeClass: 'event' },
];
const BASE_TAGS = BASE_TAG_META.map(item => item.value);
const authenticatedCoverObjectUrls = new Map();

function clearAuthenticatedCoverObjectUrls() {
  authenticatedCoverObjectUrls.forEach(objectUrl => URL.revokeObjectURL(objectUrl));
  authenticatedCoverObjectUrls.clear();
}

async function getAuthenticatedCoverObjectUrl(url) {
  const cached = authenticatedCoverObjectUrls.get(url);
  if (cached) return cached;
  const response = await apiFetch(url, { rawResponse: true });
  const objectUrl = URL.createObjectURL(await response.blob());
  authenticatedCoverObjectUrls.set(url, objectUrl);
  if (authenticatedCoverObjectUrls.size > 40) {
    const oldestKey = authenticatedCoverObjectUrls.keys().next().value;
    const oldestUrl = authenticatedCoverObjectUrls.get(oldestKey);
    if (oldestUrl) URL.revokeObjectURL(oldestUrl);
    authenticatedCoverObjectUrls.delete(oldestKey);
  }
  return objectUrl;
}

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
  return (project.tags || []).find(tag => BASE_TAGS.includes(tag)) || BASE_TAGS[0];
}

function getTypeClassByBaseTag(baseTag) {
  const matched = BASE_TAG_META.find(item => item.value === baseTag);
  return matched ? matched.typeClass : 'system';
}

function getTypeClass(project) {
  return getTypeClassByBaseTag(getBaseTag(project));
}

function matchProjectBaseTag(project, activeBaseTag) {
  if (!activeBaseTag || activeBaseTag === 'all') return true;
  return getBaseTag(project) === activeBaseTag;
}

function getAuthorName(project) {
  return project.authorGlobalName || project.authorName || '未知作者';
}

function appendCacheVersion(url, version) {
  if (!url) return url;

  try {
    const parsed = new URL(String(url), window.location.origin);
    if (version) {
      parsed.searchParams.set('v', String(version));
    }
    return parsed.toString();
  } catch {
    return String(url);
  }
}

function encodeWsrvSource(url) {
  if (!url) return '';

  try {
    const parsed = new URL(String(url), window.location.origin);
    return encodeURIComponent(parsed.toString());
  } catch {
    return encodeURIComponent(String(url));
  }
}

function getWsrvUrl(url) {
  if (!url) return url;
  return 'https://wsrv.nl/?url=' + encodeWsrvSource(url) + '&w=640&output=webp';
}

function getFallbackSvgUrl() {
  const fallbackSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160" viewBox="0 0 300 160" fill="none">'
    + '<rect width="300" height="160" rx="20" fill="#0F172A"/>'
    + '<rect x="18" y="18" width="264" height="124" rx="16" fill="#1E293B" stroke="#334155"/>'
    + '<circle cx="92" cy="70" r="18" fill="#334155"/>'
    + '<path d="M54 118L97 84L126 106L158 74L214 118H54Z" fill="#475569"/>'
    + '<text x="150" y="136" text-anchor="middle" fill="#CBD5E1" font-size="16" font-family="Arial, sans-serif">No Preview</text>'
    + '</svg>';

  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(fallbackSvg);
}

function getDirectCoverUrl(project) {
  if (!project?.coverImage) {
    return '';
  }

  return appendCacheVersion(project.coverImage, project.updatedAt || project.latestApprovedAt || project.coverImage);
}

function getCoverImageSources(project) {
  const placeholder = getFallbackSvgUrl();
  const fallback = getDirectCoverUrl(project);
  const requiresAuth = Boolean(fallback && project?.status !== 'approved' && String(fallback).includes('/api/files/'));
  if (requiresAuth) {
    return {
      primary: placeholder,
      fallback: '',
      placeholder,
      authenticated: fallback,
    };
  }

  if (!fallback) {
    return {
      primary: placeholder,
      fallback: '',
      placeholder,
    };
  }

  return {
    primary: getWsrvUrl(fallback),
    fallback,
    placeholder,
  };
}

function setCoverBackground(element, url) {
  if (!element || !url) return;
  element.style.backgroundImage = "url('" + url.replace(/'/g, "%27") + "')";
}

function bindCoverImageFallbacks(root) {
  const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
  scope.querySelectorAll('[data-cover-src]').forEach(element => {
    if (!(element instanceof HTMLElement) || element.dataset.coverBound === '1') {
      return;
    }

    element.dataset.coverBound = '1';

    const primary = element.dataset.coverSrc || '';
    const fallback = element.dataset.coverFallbackSrc || '';
    const placeholder = element.dataset.coverPlaceholderSrc || '';
    const authenticated = element.dataset.coverAuthSrc || '';

    if (authenticated) {
      setCoverBackground(element, placeholder);
      void getAuthenticatedCoverObjectUrl(authenticated)
        .then(url => setCoverBackground(element, url))
        .catch(() => setCoverBackground(element, placeholder));
      return;
    }

    if (!primary || primary === placeholder) {
      setCoverBackground(element, placeholder);
      return;
    }

    const probe = new Image();
    probe.onload = () => setCoverBackground(element, primary);
    probe.onerror = () => {
      if (!fallback) {
        setCoverBackground(element, placeholder);
        return;
      }

      const directProbe = new Image();
      directProbe.onload = () => setCoverBackground(element, fallback);
      directProbe.onerror = () => setCoverBackground(element, placeholder);
      directProbe.src = fallback;
    };
    probe.src = primary;
  });

  scope.querySelectorAll('img[data-cover-img-auth-src]').forEach(element => {
    if (!(element instanceof HTMLImageElement) || element.dataset.coverBound === '1') return;
    element.dataset.coverBound = '1';
    const authenticated = element.dataset.coverImgAuthSrc || '';
    const placeholder = element.dataset.coverImgPlaceholderSrc || getFallbackSvgUrl();
    element.src = placeholder;
    if (!authenticated) return;
    void getAuthenticatedCoverObjectUrl(authenticated)
      .then(url => {
        if (element.isConnected) element.src = url;
      })
      .catch(() => {
        if (element.isConnected) element.src = placeholder;
      });
  });
}

function getAuthorAvatar(project) {
  if (!project.authorAvatar) {
    return 'https://cdn.discordapp.com/embed/avatars/0.png';
  }
  if (String(project.authorAvatar).startsWith('http://') || String(project.authorAvatar).startsWith('https://')) {
    return appendCacheVersion(String(project.authorAvatar), project.authorAvatar);
  }
  return appendCacheVersion(
    'https://cdn.discordapp.com/avatars/' + project.authorId + '/' + project.authorAvatar + '.png',
    project.authorAvatar,
  );
}

function getCoverUrl(project) {
  if (project.coverImage) {
    return appendCacheVersion(project.coverImage, project.updatedAt || project.latestApprovedAt || project.coverImage);
  }

  return getFallbackSvgUrl();
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

function getLinkedDraftReview(project) {
  if (!project) return null;
  if (project.reviewTarget === 'draft') return project;
  if (!project.draftProjectId) return null;
  return state.myProjects.find(item =>
    item?.reviewTarget === 'draft' &&
    (item.id === project.draftProjectId || item.publishedProjectId === project.id)
  ) || null;
}

function getProjectReviewBadge(project) {
  const linkedDraft = getLinkedDraftReview(project);
  if (linkedDraft?.status === 'pending') return '<span class="badge badge-admin">待审核新版本</span>';
  if (linkedDraft?.status === 'rejected') return '<span class="badge badge-admin badge-rejected">已退回</span>';
  if (project?.reviewTarget === 'draft' && project?.status === 'pending') return '<span class="badge badge-admin">草稿审核中</span>';
  if (project?.reviewTarget === 'draft' && project?.status === 'rejected') return '<span class="badge badge-admin badge-rejected">已退回</span>';
  if (project?.hasPendingDraft) return '<span class="badge badge-admin">待审核新版本</span>';
  return '';
}

function getProjectRejectReason(project) {
  const linkedDraft = getLinkedDraftReview(project);
  if (linkedDraft?.status === 'rejected') return linkedDraft.rejectReason || '';
  return project?.status === 'rejected' ? (project.rejectReason || '') : '';
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
  const type = entry?.strategyType || (entry?.constant === true ? 'constant' : entry?.vectorized === true ? 'vectorized' : 'selective');
  if (type === 'constant') return { symbol: '🔵', label: '常驻', className: 'strategy-constant' };
  if (type === 'vectorized') return { symbol: '🔗', label: '向量化', className: 'strategy-none' };
  return { symbol: '🟢', label: '关键词', className: 'strategy-selective' };
}

function normalizeEntryKeywords(entry) {
  if (!entry || entry.key === null || entry.key === undefined || entry.key === '') return [];
  return Array.isArray(entry.key) ? entry.key : String(entry.key).split(',').map(item => item.trim()).filter(Boolean);
}

function normalizeEntrySecondaryKeywords(entry) {
  if (!entry || entry.keysecondary === null || entry.keysecondary === undefined || entry.keysecondary === '') return [];
  return Array.isArray(entry.keysecondary) ? entry.keysecondary : String(entry.keysecondary).split(',').map(item => item.trim()).filter(Boolean);
}
`;
