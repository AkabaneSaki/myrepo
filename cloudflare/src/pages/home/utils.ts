export const homeUtilsScript = String.raw`
const BASE_TAG_META = [
  { value: '系统核心', label: '系统核心', typeClass: 'system' },
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

const TOAST_MAX_VISIBLE = 3;
const TOAST_DURATION = {
  success: 3000,
  info: 3000,
  warning: 4200,
  error: 5200,
};
const toastState = { active: [], queue: [] };
const toastTimers = new Map();
let toastSequence = 0;

function normalizeToastType(type) {
  return ['success', 'info', 'warning', 'error'].includes(type) ? type : 'info';
}

function getToastViewport() {
  let viewport = document.getElementById('workshopToastViewport');
  if (viewport) return viewport;
  viewport = document.createElement('div');
  viewport.id = 'workshopToastViewport';
  viewport.className = 'toast-viewport';
  viewport.setAttribute('aria-live', 'polite');
  viewport.setAttribute('aria-relevant', 'additions text');
  document.body.appendChild(viewport);
  return viewport;
}

function getToastTitle(type) {
  if (type === 'success') return '操作完成';
  if (type === 'warning') return '请注意';
  if (type === 'error') return '操作失败';
  return '提示';
}

function getToastIconClass(type) {
  if (type === 'success') return 'fa-circle-check';
  if (type === 'warning') return 'fa-triangle-exclamation';
  if (type === 'error') return 'fa-circle-xmark';
  return 'fa-circle-info';
}

function updateToastCount(item) {
  if (!item.element) return;
  const count = item.element.querySelector('.toast__count');
  if (!count) return;
  if (item.count > 1) {
    count.textContent = '×' + item.count;
    count.hidden = false;
  } else {
    count.textContent = '';
    count.hidden = true;
  }
}

function restartToastProgress(item) {
  if (!item.element) return;
  const progress = item.element.querySelector('.toast__progress > span');
  if (!progress) return;
  progress.style.animation = 'none';
  void progress.offsetWidth;
  progress.style.animation = 'toast-progress ' + item.duration + 'ms linear forwards';
}

function clearToastTimer(id) {
  const timer = toastTimers.get(id);
  if (timer) clearTimeout(timer);
  toastTimers.delete(id);
}

function startToastTimer(item) {
  clearToastTimer(item.id);
  toastTimers.set(item.id, setTimeout(() => dismissToast(item.id), item.duration));
  restartToastProgress(item);
}

function mountToast(item) {
  const viewport = getToastViewport();
  const toast = document.createElement('section');
  toast.className = 'toast';
  toast.dataset.type = item.type;
  toast.dataset.toastId = item.id;
  toast.setAttribute('role', item.type === 'error' ? 'alert' : 'status');

  const icon = document.createElement('div');
  icon.className = 'toast__icon';
  const iconGlyph = document.createElement('i');
  iconGlyph.className = 'fas ' + getToastIconClass(item.type);
  icon.appendChild(iconGlyph);

  const body = document.createElement('div');
  body.className = 'toast__body';
  const title = document.createElement('div');
  title.className = 'toast__title';
  const titleText = document.createElement('span');
  titleText.textContent = getToastTitle(item.type);
  const count = document.createElement('span');
  count.className = 'toast__count';
  count.hidden = true;
  title.append(titleText, count);
  const messageNode = document.createElement('div');
  messageNode.className = 'toast__message';
  messageNode.textContent = item.message;
  body.append(title, messageNode);

  const close = document.createElement('button');
  close.className = 'toast__close';
  close.type = 'button';
  close.setAttribute('aria-label', '关闭通知');
  const closeIcon = document.createElement('i');
  closeIcon.className = 'fas fa-xmark';
  close.appendChild(closeIcon);
  close.addEventListener('click', () => dismissToast(item.id));

  const progress = document.createElement('div');
  progress.className = 'toast__progress';
  progress.appendChild(document.createElement('span'));

  toast.append(icon, body, close, progress);
  item.element = toast;
  viewport.appendChild(toast);
  updateToastCount(item);
  startToastTimer(item);
}

function removeToastNow(id) {
  const index = toastState.active.findIndex(item => item.id === id);
  if (index === -1) return;
  const item = toastState.active[index];
  clearToastTimer(id);
  item.element?.remove();
  toastState.active.splice(index, 1);

  if (toastState.queue.length > 0) {
    const next = toastState.queue.shift();
    toastState.active.push(next);
    mountToast(next);
  }
}

function dismissToast(id) {
  const item = toastState.active.find(activeItem => activeItem.id === id);
  if (!item || item.leaving) return;
  item.leaving = true;
  clearToastTimer(id);
  if (!item.element) {
    removeToastNow(id);
    return;
  }
  item.element.classList.add('toast--leaving');
  setTimeout(() => removeToastNow(id), 170);
}

function showToast(message, type = 'info') {
  const normalizedType = normalizeToastType(type);
  const normalizedMessage = String(message ?? '').trim();
  if (!normalizedMessage) return null;
  const key = normalizedType + '::' + normalizedMessage;

  const activeDuplicate = toastState.active.find(item => item.key === key && !item.leaving);
  if (activeDuplicate) {
    activeDuplicate.count += 1;
    updateToastCount(activeDuplicate);
    startToastTimer(activeDuplicate);
    return activeDuplicate.id;
  }

  const queuedDuplicate = toastState.queue.find(item => item.key === key);
  if (queuedDuplicate) {
    queuedDuplicate.count += 1;
    return queuedDuplicate.id;
  }

  toastSequence += 1;
  const item = {
    id: 'toast-' + toastSequence,
    key,
    type: normalizedType,
    message: normalizedMessage,
    duration: TOAST_DURATION[normalizedType],
    count: 1,
    element: null,
    leaving: false,
  };

  if (toastState.active.length < TOAST_MAX_VISIBLE) {
    toastState.active.push(item);
    mountToast(item);
  } else {
    toastState.queue.push(item);
  }
  return item.id;
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

function normalizeExternalHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 4096) return '';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    if (!parsed.hostname || parsed.username || parsed.password) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

async function copyTextToClipboard(value) {
  const text = String(value || '');
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.warn('Clipboard API unavailable', error);
    }
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  field.style.pointerEvents = 'none';
  document.body.appendChild(field);
  field.focus();
  field.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch (error) { console.warn('Fallback copy failed', error); }
  field.remove();
  return copied;
}

function formatDate(value) {
  if (!value) return '未知日期';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知日期';
  return date.toLocaleDateString('zh-CN');
}

function formatDateTime(value) {
  if (!value) return '未知时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知时间';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function parseWorkshopVersion(value) {
  if (typeof value !== 'string') return null;
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareWorkshopVersions(a, b) {
  const left = parseWorkshopVersion(a);
  const right = parseWorkshopVersion(b);
  if (!left || !right) return null;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

function shouldShowWorkshopReleaseNotice(releaseVersion) {
  if (!state.tavern.clientVersionResolved) return false;
  if (!parseWorkshopVersion(releaseVersion)) {
    console.warn('[CreativeWorkshop] invalid advertised release version', releaseVersion);
    return false;
  }
  if (!parseWorkshopVersion(state.tavern.clientVersion)) return true;
  return compareWorkshopVersions(state.tavern.clientVersion, releaseVersion) < 0;
}

function getProjectPublishedAt(project) {
  return project?.latestApprovedAt || project?.createdAt || '';
}

function normalizeProjectTypeValue(value) {
  const normalized = String(value || '').trim();
  if (normalized === '系统') return '系统核心';
  return BASE_TAGS.includes(normalized) ? normalized : '';
}

function getBaseTag(project) {
  const explicit = normalizeProjectTypeValue(project?.projectType ?? project?.project_type);
  if (explicit) return explicit;
  for (const tag of project?.tags || []) {
    const legacyType = normalizeProjectTypeValue(tag);
    if (legacyType) return legacyType;
  }
  return '系统核心';
}

function getProjectExtensionType(project) {
  const value = String(project?.extensionType ?? project?.extension_type ?? '').trim();
  return (PROJECT_TAXONOMY.extensionTypes || []).includes(value) ? value : '';
}

function getProjectTypeDisplayLabel(project) {
  const projectType = getBaseTag(project);
  const extensionType = projectType === '扩展' ? getProjectExtensionType(project) : '';
  return extensionType ? projectType + ' · ' + extensionType : projectType;
}

function getProjectCustomTags(project) {
  const explicit = project?.customTags ?? project?.custom_tags;
  const values = Array.isArray(explicit)
    ? explicit
    : (project?.tags || []).filter(tag => !normalizeProjectTypeValue(String(tag).trim()));
  return Array.from(new Set(values.map(tag => String(tag).trim()).filter(Boolean)));
}

function getProjectFacetTags(project) {
  const facets = project?.facets && typeof project.facets === 'object' && !Array.isArray(project.facets) ? project.facets : {};
  const result = [];
  for (const key of Object.keys(PROJECT_TAXONOMY.characterFacets || {})) {
    const values = Array.isArray(facets[key]) ? facets[key] : [];
    values.forEach(value => result.push(String(value).trim()));
  }
  return Array.from(new Set(result.filter(Boolean)));
}

function getProjectTagPool(project) {
  return Array.from(new Set([...getProjectFacetTags(project), ...getProjectCustomTags(project)]));
}

function getProjectDisplayTags(project) {
  const maxTags = Number(PROJECT_TAXONOMY.maxDisplayTags || PROJECT_TAXONOMY.display?.maxCardTags || 5);
  const pool = new Set(getProjectTagPool(project));
  const explicit = project?.displayTags ?? project?.display_tags;
  if (Array.isArray(explicit)) {
    return Array.from(new Set(explicit.map(tag => String(tag).trim()).filter(tag => tag && pool.has(tag)))).slice(0, maxTags);
  }
  return getProjectCustomTags(project).slice(0, maxTags);
}

function getProjectDetailTags(project) {
  return getProjectTagPool(project);
}

function getTypeClassByBaseTag(baseTag) {
  const matched = BASE_TAG_META.find(item => item.value === normalizeProjectTypeValue(baseTag));
  return matched ? matched.typeClass : 'system';
}

function getTypeClass(project) {
  return getTypeClassByBaseTag(getBaseTag(project));
}

function matchProjectBaseTag(project, activeBaseTag) {
  if (!activeBaseTag || activeBaseTag === 'all') return true;
  return getBaseTag(project) === normalizeProjectTypeValue(activeBaseTag);
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

function isPrivateLocalPreviewHost() {
  const hostname = String(globalThis.location?.hostname || '').toLowerCase();
  if (hostname === '127.0.0.1' || hostname === 'localhost') return true;
  const octets = hostname.split('.').map(part => Number(part));
  if (octets.length !== 4 || octets.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return octets[0] === 10
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168);
}

function isLocalDiscoverPreviewHost() {
  const hostname = String(globalThis.location?.hostname || '').toLowerCase();
  return isPrivateLocalPreviewHost() || hostname.endsWith('.trycloudflare.com');
}

function getWsrvUrl(url) {
  if (!url) return url;
  if (isLocalDiscoverPreviewHost()) return url;
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
  element.classList.remove('discover-card-cover--title');
  if (element.dataset.coverTitle) element.replaceChildren();
  element.style.backgroundImage = "url('" + url.replace(/'/g, "%27") + "')";
  const x = Math.min(100, Math.max(0, Number(element.dataset.coverPositionX ?? 50)));
  const y = Math.min(100, Math.max(0, Number(element.dataset.coverPositionY ?? 50)));
  const zoom = Math.min(3, Math.max(1, Number(element.dataset.coverZoom ?? 1)));
  element.style.backgroundPosition = x + '% ' + y + '%';
  element.style.transform = 'scale(' + zoom + ')';
  element.style.transformOrigin = x + '% ' + y + '%';
}

function setCoverTitleFallback(element, title) {
  if (!element || !title) return false;
  element.style.backgroundImage = 'none';
  element.classList.add('discover-card-cover--title');
  element.replaceChildren();
  const label = document.createElement('span');
  label.textContent = title;
  element.appendChild(label);
  return true;
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
    const coverTitle = element.dataset.coverTitle || '';
    const showFallback = () => {
      if (!setCoverTitleFallback(element, coverTitle)) setCoverBackground(element, placeholder);
    };

    if (authenticated) {
      showFallback();
      void getAuthenticatedCoverObjectUrl(authenticated)
        .then(url => setCoverBackground(element, url))
        .catch(showFallback);
      return;
    }

    if (!primary || primary === placeholder) {
      showFallback();
      return;
    }

    const probe = new Image();
    probe.onload = () => setCoverBackground(element, primary);
    probe.onerror = () => {
      if (!fallback) {
        showFallback();
        return;
      }

      const directProbe = new Image();
      directProbe.onload = () => setCoverBackground(element, fallback);
      directProbe.onerror = showFallback;
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
  return Array.from(new Set(String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)));
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
