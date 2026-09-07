export const homeUploadPreviewScript = String.raw`
const uploadPreviewObjectUrls = new WeakMap();

function getUploadWorldbookEntries(parsed) {
  const entries = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.entries : null;
  if (Array.isArray(entries)) return entries;
  if (entries && typeof entries === 'object' && !Array.isArray(entries)) return Object.values(entries);
  return [];
}

function getUploadRegexEntries(parsed) {
  if (!parsed) return [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function normalizeUploadPositionType(entry) {
  const positionRecord = entry?.position && typeof entry.position === 'object' && !Array.isArray(entry.position)
    ? entry.position
    : null;
  const raw = positionRecord?.type ?? entry?.positionType ?? (typeof entry?.position === 'number' ? entry.position : 0);
  const aliases = {
    before_char: 'before_character_definition',
    after_char: 'after_character_definition',
  };
  if (typeof raw === 'string') return aliases[raw] || raw;
  const legacy = [
    'before_character_definition',
    'after_character_definition',
    'before_author_note',
    'after_author_note',
    'at_depth',
    'before_example_messages',
    'after_example_messages',
    'outlet',
  ];
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw < legacy.length
    ? legacy[raw]
    : 'unknown:' + String(raw);
}

function normalizeUploadRole(entry) {
  const positionRecord = entry?.position && typeof entry.position === 'object' && !Array.isArray(entry.position)
    ? entry.position
    : null;
  const raw = positionRecord?.role ?? entry?.role;
  if (raw === 1 || raw === 'user') return 'user';
  if (raw === 2 || raw === 'assistant') return 'assistant';
  return 'system';
}

function finiteUploadNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeUploadWorldbookEntry(entry, index) {
  const positionRecord = entry?.position && typeof entry.position === 'object' && !Array.isArray(entry.position)
    ? entry.position
    : null;
  return {
    ...entry,
    comment: typeof entry?.comment === 'string' ? entry.comment : typeof entry?.name === 'string' ? entry.name : '无标题',
    content: typeof entry?.content === 'string' ? entry.content : typeof entry?.text === 'string' ? entry.text : '',
    key: Array.isArray(entry?.key)
      ? entry.key.filter(value => typeof value === 'string')
      : Array.isArray(entry?.keys)
        ? entry.keys.filter(value => typeof value === 'string')
        : [],
    keysecondary: Array.isArray(entry?.keysecondary)
      ? entry.keysecondary.filter(value => typeof value === 'string')
      : Array.isArray(entry?.key_secondary)
        ? entry.key_secondary.filter(value => typeof value === 'string')
        : [],
    positionType: normalizeUploadPositionType(entry),
    role: normalizeUploadRole(entry),
    depth: finiteUploadNumber(positionRecord?.depth ?? entry?.depth, 4),
    order: finiteUploadNumber(positionRecord?.order ?? entry?.order, index),
  };
}

function bindUploadPreviewEntryToggles(root) {
  if (!root) return;
  root.querySelectorAll('[data-entry-toggle]').forEach(header => {
    if (header.dataset.uploadPreviewBound === '1') return;
    header.dataset.uploadPreviewBound = '1';
    header.addEventListener('click', event => {
      if (event.target.closest('button,input,label')) return;
      header.classList.toggle('open');
      const content = header.nextElementSibling;
      if (content) content.classList.toggle('open');
    });
  });
}

function clearUploadPreview(container) {
  if (!container) return;
  const oldUrl = uploadPreviewObjectUrls.get(container);
  if (oldUrl) URL.revokeObjectURL(oldUrl);
  uploadPreviewObjectUrls.delete(container);
  container.innerHTML = '';
  container.hidden = true;
  container.classList.remove('is-error');
}

function renderUploadPreviewError(container, error) {
  if (!container) return;
  const message = error instanceof Error ? error.message : String(error || '无法读取文件');
  clearUploadPreview(container);
  container.hidden = false;
  container.classList.add('is-error');
  container.innerHTML = '<div class="upload-preview-error"><i class="fas fa-triangle-exclamation"></i><span>' + escapeHtml(message) + '</span></div>';
}

function renderWorldbookUploadPreview(container, prepared) {
  if (!container) return;
  clearUploadPreview(container);
  container.hidden = false;
  const entries = prepared?.entries || [];
  container.innerHTML = '<div class="upload-preview-summary"><span><i class="fas fa-file-code"></i> ' + escapeHtml(prepared.file.name) + '</span><strong>' + entries.length + ' 条世界书</strong></div>'
    + renderDetailSection('世界书条目', 'fa-scroll', entries, renderDetailEntry, '无条目内容');
  bindUploadPreviewEntryToggles(container);
}

function renderRegexUploadPreview(container, prepared) {
  if (!container) return;
  clearUploadPreview(container);
  container.hidden = false;
  const groups = prepared?.groups || [];
  const entries = prepared?.entries || [];
  const filesHtml = groups.map(group => '<span class="upload-preview-file-chip"><i class="fas fa-file-code"></i>' + escapeHtml(group.name) + '<b>' + group.count + ' 条</b></span>').join('');
  container.innerHTML = '<div class="upload-preview-summary"><span>已选择 ' + groups.length + ' 个 JSON</span><strong>合计 ' + entries.length + ' 条正则</strong></div>'
    + '<div class="upload-preview-files">' + filesHtml + '</div>'
    + renderDetailSection('正则列表', 'fa-code', entries, renderRegexEntry, '无正则内容');
  bindUploadPreviewEntryToggles(container);
}

function formatUploadBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return value + ' B';
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
  return (value / (1024 * 1024)).toFixed(1) + ' MB';
}

async function renderCoverUploadPreview(container, file) {
  if (!container) return;
  clearUploadPreview(container);
  if (!file) return;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(String(file.type || '').toLowerCase())) {
    throw new Error('预览图仅支持 jpg/png/webp');
  }
  assertUploadSize(file);
  const objectUrl = URL.createObjectURL(file);
  uploadPreviewObjectUrls.set(container, objectUrl);
  const dimensions = await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('无法读取预览图'));
    image.src = objectUrl;
  });
  container.hidden = false;
  container.innerHTML = '<div class="upload-preview-summary"><span><i class="fas fa-image"></i> ' + escapeHtml(file.name) + '</span><strong>'
    + dimensions.width + ' × ' + dimensions.height + ' · ' + formatUploadBytes(file.size) + '</strong></div>'
    + '<img class="upload-cover-image" src="' + escapeHtml(objectUrl) + '" alt="上传前预览图">';
}

async function prepareWorldbookUpload(file) {
  const parsed = await validateJsonUpload(file, 'worldbook');
  const entries = getUploadWorldbookEntries(parsed).map((entry, index) => normalizeUploadWorldbookEntry(entry, index));
  return { file, parsed, entries };
}

async function prepareRegexUploads(files) {
  const selected = Array.from(files || []);
  if (!selected.length) return { files: [], groups: [], entries: [], uploadFile: null };
  const groups = [];
  const entries = [];
  for (const file of selected) {
    const parsed = await validateJsonUpload(file, 'regex');
    const currentEntries = getUploadRegexEntries(parsed);
    groups.push({ name: file.name, count: currentEntries.length });
    entries.push(...currentEntries);
  }
  const uploadFile = selected.length === 1
    ? selected[0]
    : new File([JSON.stringify(entries, null, 2)], 'merged-regex-' + selected.length + '-files.json', { type: 'application/json' });
  assertUploadSize(uploadFile);
  return { files: selected, groups, entries, uploadFile };
}
`;
