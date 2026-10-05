export const homeUploadPreviewScript = String.raw`
const uploadPreviewObjectUrls = new WeakMap();

function getUploadWorldbookEntryRefs(parsed) {
  const entries = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.entries : null;
  if (Array.isArray(entries)) {
    return entries.map((entry, index) => ({ entry, index, objectKey: null }));
  }
  if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
    return Object.entries(entries).map(([objectKey, entry], index) => ({ entry, index, objectKey }));
  }
  return [];
}

function getUploadWorldbookEntryKey(entry, index, objectKey) {
  if (objectKey !== null && objectKey !== undefined) return 'object:' + String(objectKey);
  const extensions = entry?.extensions && typeof entry.extensions === 'object' && !Array.isArray(entry.extensions)
    ? entry.extensions
    : null;
  const id = entry?.uid ?? extensions?.cw_entry_id;
  return id !== null && id !== undefined ? 'uid:' + String(id) : 'index:' + index;
}

function getUploadWorldbookInspectableContent(entry) {
  const content = typeof entry?.content === 'string' ? entry.content : typeof entry?.text === 'string' ? entry.text : '';
  return content.replace(/<%# poem-workshop-meta:v1-start\n[\s\S]*?\npoem-workshop-meta:v1-end %>/g, '');
}

function uploadWorldbookEntryHasEjs(entry) {
  return /<%[\s\S]*?%>/.test(getUploadWorldbookInspectableContent(entry));
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

function normalizeUploadWorldbookEntry(entry, index, entryKey) {
  const positionRecord = entry?.position && typeof entry.position === 'object' && !Array.isArray(entry.position)
    ? entry.position
    : null;
  const hasEjs = uploadWorldbookEntryHasEjs(entry);
  const inspectableContent = getUploadWorldbookInspectableContent(entry);
  return {
    ...entry,
    entryKey,
    hasEjs,
    authorEstimatedLength: '',
    contentCharacterCount: hasEjs ? undefined : Array.from(inspectableContent).length,
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

function getUploadPreparedEntryName(entry, kind, index) {
  if (kind === 'regex') return String(entry?.scriptName || entry?.name || entry?.id || ('Regex ' + (index + 1)));
  return String(entry?.comment || entry?.name || ('Entry ' + index));
}

function getUploadPreparedEntrySource(entry, kind) {
  if (kind === 'regex') return String(entry?.replaceString || '');
  return String(entry?.content || entry?.text || '');
}

function groupUploadPreflightFindings(findings) {
  const groups = [];
  const byKey = new Map();
  (findings || []).forEach(item => {
    const entry = String(item?.entry || '').trim();
    const book = String(item?.book || '').trim();
    const key = entry ? 'entry:' + book + ':' + entry : 'file:' + book;
    let group = byKey.get(key);
    if (!group) {
      group = { key, entry, book, findings: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.findings.push(item);
  });
  return groups;
}

function getUploadPromptSources(findings, prepared, kind) {
  const entries = Array.isArray(prepared?.entries) ? prepared.entries : [];
  if (!entries.length) return [];
  const wantedNames = new Set();
  const wantedUids = new Set();
  (findings || []).forEach(item => {
    String(item?.entry || '').split(/\s*↔\s*/).filter(Boolean).forEach(name => wantedNames.add(name));
    String(item?.uid ?? '').split(/\s*↔\s*/).filter(Boolean).forEach(uid => wantedUids.add(uid));
  });
  const matched = entries.map((entry, index) => ({
    entry,
    index,
    name: getUploadPreparedEntryName(entry, kind, index),
    uid: String(kind === 'regex' ? (entry?.id ?? index) : (entry?.uid ?? index)),
  })).filter(item => wantedNames.has(item.name) || wantedUids.has(item.uid));
  if (!matched.length && entries.length === 1) {
    return [{ entry: entries[0], index: 0, name: getUploadPreparedEntryName(entries[0], kind, 0), uid: String(entries[0]?.uid ?? entries[0]?.id ?? 0) }];
  }
  return matched;
}

function buildUploadLlmFixPrompt(findings, prepared, kind) {
  const visible = Array.isArray(findings) ? findings.filter(item => item?.ruleId !== 'CHECKER-INTERNAL') : [];
  if (!visible.length && findings?.some(item => item?.ruleId === 'CHECKER-INTERNAL')) return '检查服务未能完成检查，请稍后重试；无需因此修改源码。';
  const issues = visible.map(item => {
    const location = (item?.entry ? String(item.entry) : (item?.book ? String(item.book) : '文件'))
      + ' · 第 ' + Number(item?.line || 1) + ' 行，第 ' + Number(item?.column || 1) + ' 列';
    return '- [' + String(item?.ruleId || 'CHECK') + '] ' + String(item?.title || '需要处理')
      + '\n  位置：' + location
      + (item?.detail ? '\n  问题：' + String(item.detail) : '')
      + (item?.suggestion ? '\n  Workshop 要求：' + String(item.suggestion) : '');
  }).join('\n');
  const sources = getUploadPromptSources(visible, prepared, kind);
  const sourceText = sources.map(item => {
    const language = kind === 'regex' ? 'javascript' : 'ejs';
    return '### ' + item.name + '\n\n\`\`\`' + language + '\n' + getUploadPreparedEntrySource(item.entry, kind) + '\n\`\`\`';
  }).join('\n\n');
  return '你正在修复 SillyTavern / Poem Workshop 上传内容。请只修复下面列出的 Workshop 自动检查问题，不要改变原本功能、输出内容、变量含义、角色设定、YAML/文本内容或业务逻辑，也不要通过删除功能、隐藏代码、混淆代码来绕过检查。\n\n'
    + '修复要求：\n'
    + '1. 保持现有行为；只做解决这些检查项所需的最小修改。\n'
    + '2. L1-L7 属于 Workshop EJS 组合兼容公约：临时状态应放在正确局部作用域；不要依赖 placement、depth、role 或 message 隔离顶层名称。\n'
    + '3. 如果必须跨条目共享，只使用项目专属、明确的 globalThis 命名空间，并说明 Owner / Lifecycle / Cleanup；不要制造裸全局。\n'
    + '4. @@private / 其他 decorator 必须保持在 entry 真正开头的连续 decorator 区；不要移动或删除 poem-workshop-meta。\n'
    + '5. 不要把 let 机械替换成 const；只有不会重新赋值时才改 const。\n'
    + '6. 若报告含 EJS-PARSE，先判断是否真是 JavaScript/EJS 语法错误；不要为了消警告破坏合法代码。\n'
    + '7. 返回每个受影响条目的完整修正版，并在最后按 [规则ID] 简短说明如何修复；不要省略原有正文。\n\n'
    + '需要处理的问题：\n' + (issues || '- 无') + '\n\n'
    + (sourceText ? '原始受影响内容：\n\n' + sourceText : '原始内容未能自动定位，请根据上面的条目名和行列位置在上传文件中查找。');
}

function buildUploadCheckReport(codeCheck, prepared, kind) {
  const findings = Array.isArray(codeCheck?.findings) ? codeCheck.findings : [];
  const blockers = findings.filter(item => item?.severity === 'high').length;
  const groups = groupUploadPreflightFindings(findings);
  return '# Poem Workshop 上传检查报告\n\n'
    + '- 状态：' + (codeCheck?.gate === 'reject' ? '未通过' : '通过自动门禁') + '\n'
    + '- 阻断项：' + blockers + '\n'
    + '- 受影响内容：' + groups.length + '\n'
    + '- 检查版本：' + String(codeCheck?.engine || '未记录') + '\n'
    + '- 语法检查依据：' + String(codeCheck?.parserCompatibility || '未记录') + '\n'
    + '- 导出时间：' + new Date().toISOString() + '\n\n'
    + '## 给 LLM 的修复提示\n\n'
    + buildUploadLlmFixPrompt(findings, prepared, kind) + '\n';
}

function downloadUploadCheckReport(codeCheck, prepared, kind) {
  const text = buildUploadCheckReport(codeCheck, prepared, kind);
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'workshop-upload-check-' + new Date().toISOString().replace(/[:.]/g, '-') + '.md';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderUploadPreflightStatus(container, status, message, codeCheck = null, prepared = null, kind = 'worldbook') {
  if (!container) return;
  container.querySelector('[data-upload-preflight-status]')?.remove();
  const normalized = ['checking', 'ok', 'error'].includes(status) ? status : 'checking';
  const icon = normalized === 'ok' ? 'fa-circle-check' : (normalized === 'error' ? 'fa-circle-xmark' : 'fa-spinner fa-spin');
  const findings = Array.isArray(codeCheck?.findings) ? codeCheck.findings : [];
  const blockerCount = findings.filter(item => item?.severity === 'high').length;
  const groups = groupUploadPreflightFindings(findings);
  const headline = normalized === 'error' && blockerCount
    ? '自动检查未通过：发现 ' + blockerCount + ' 个阻断项，涉及 ' + groups.length + ' 个内容。'
    : normalized === 'error' && !codeCheck ? '文件检查未完成，暂时不能提交' : String(message || '');
  const failureDetailHtml = normalized === 'error' && !codeCheck && message
    ? '<p class="upload-preflight-finding-detail">' + escapeHtml(message) + '</p>'
    : '';
  const toolsHtml = findings.length
    ? '<div class="upload-preflight-tools"><button type="button" class="upload-preflight-action" data-upload-copy-all><i class="fas fa-wand-magic-sparkles"></i> 复制全部给 LLM</button><button type="button" class="upload-preflight-action" data-upload-export-report><i class="fas fa-file-arrow-down"></i> 导出检查报告</button></div>'
    : '';
  const findingsHtml = groups.length
    ? '<div class="upload-preflight-groups">' + groups.map((group, groupIndex) => {
      const groupBlockers = group.findings.filter(item => item?.severity === 'high').length;
      const groupLabel = group.entry ? (group.entry.includes('↔') ? '跨条目：' + group.entry : group.entry) : (group.book || '文件检查');
      const itemsHtml = group.findings.map(item => {
        const ruleId = escapeHtml(item?.ruleId || 'CHECK');
        const title = escapeHtml(item?.title || '需要处理');
        const locationParts = [];
        if (Number.isFinite(Number(item?.line))) {
          locationParts.push('第 ' + Number(item.line) + ' 行' + (Number.isFinite(Number(item?.column)) ? '，第 ' + Number(item.column) + ' 列' : ''));
        }
        const severityClass = item?.severity === 'high' ? 'high' : (item?.severity === 'warn' ? 'warn' : 'info');
        return '<div class="upload-preflight-finding upload-preflight-finding--' + severityClass + '">'
          + '<div class="upload-preflight-finding-title"><strong>[' + ruleId + '] ' + title + '</strong></div>'
          + (locationParts.length ? '<div class="upload-preflight-finding-meta">' + escapeHtml(locationParts.join(' · ')) + '</div>' : '')
          + (item?.detail ? '<div class="upload-preflight-finding-detail">' + escapeHtml(item.detail) + '</div>' : '')
          + (item?.suggestion ? '<div class="upload-preflight-finding-fix"><strong>建议：</strong>' + escapeHtml(item.suggestion) + '</div>' : '')
          + '</div>';
      }).join('');
      return '<details class="upload-preflight-group"' + (groupIndex === 0 ? ' open' : '') + '>'
        + '<summary><span class="upload-preflight-group-name">' + escapeHtml(groupLabel) + '</span><span class="upload-preflight-group-count">' + (groupBlockers ? '阻断 ' + groupBlockers : '提示 ' + group.findings.length) + '</span></summary>'
        + '<div class="upload-preflight-group-body">' + itemsHtml
        + '<button type="button" class="upload-preflight-action upload-preflight-action--entry" data-upload-copy-group="' + groupIndex + '"><i class="fas fa-wand-magic-sparkles"></i> 复制此内容给 LLM 修复</button>'
        + '</div></details>';
    }).join('') + '</div>'
    : '';
  const node = document.createElement('div');
  node.className = 'upload-preflight-status upload-preflight-status--' + normalized;
  node.dataset.uploadPreflightStatus = normalized;
  node.setAttribute('role', normalized === 'error' ? 'alert' : 'status');
  node.setAttribute('aria-live', normalized === 'error' ? 'assertive' : 'polite');
  const versionHtml = codeCheck?.engine ? '<details><summary>检查版本：' + escapeHtml(codeCheck.engine) + '</summary><p>语法检查依据：' + escapeHtml(codeCheck.parserCompatibility || '未记录') + '</p></details>' : '';
  node.innerHTML = '<i class="fas ' + icon + '"></i><div class="upload-preflight-status-body"><strong class="upload-preflight-headline">' + escapeHtml(headline) + '</strong>' + failureDetailHtml + versionHtml + toolsHtml + findingsHtml + '</div>';
  const summary = container.querySelector('.upload-preview-summary');
  if (summary?.nextSibling) container.insertBefore(node, summary.nextSibling);
  else container.appendChild(node);

  node.querySelectorAll('[data-upload-copy-group]').forEach(button => button.addEventListener('click', async () => {
    const group = groups[Number(button.dataset.uploadCopyGroup)];
    if (!group) return;
    const copied = await copyTextToClipboard(buildUploadLlmFixPrompt(group.findings, prepared, kind));
    showToast(copied ? '修复提示已复制，可以直接贴给 LLM。' : '浏览器禁止自动复制，请导出报告。', copied ? 'info' : 'warning');
  }));
  const copyAll = node.querySelector('[data-upload-copy-all]');
  if (copyAll) copyAll.addEventListener('click', async () => {
    const copied = await copyTextToClipboard(buildUploadLlmFixPrompt(findings, prepared, kind));
    showToast(copied ? '全部修复提示已复制，可以直接贴给 LLM。' : '浏览器禁止自动复制，请导出报告。', copied ? 'info' : 'warning');
  });
  const exportButton = node.querySelector('[data-upload-export-report]');
  if (exportButton) exportButton.addEventListener('click', () => {
    downloadUploadCheckReport(codeCheck, prepared, kind);
    showToast('检查报告已导出为 Markdown，可直接交给 LLM。', 'info');
  });
}

function renderWorldbookUploadPreview(container, prepared) {
  if (!container) return;
  clearUploadPreview(container);
  container.hidden = false;
  const entries = prepared?.entries || [];
  container.innerHTML = '<div class="upload-preview-summary"><span><i class="fas fa-file-code"></i> ' + escapeHtml(prepared.file.name) + '</span><span class="upload-preview-summary-actions"><strong>' + entries.length + ' 条世界书</strong><button class="upload-preview-clear-btn" type="button" data-upload-preview-clear="worldbook" title="取消选择">×</button></span></div>'
    + renderDetailSection('世界书条目', 'fa-scroll', entries, renderDetailEntry, '无条目内容', null, false, null, { estimateEditable: true });
  bindUploadPreviewEntryToggles(container);
}

function renderRegexUploadPreview(container, prepared) {
  if (!container) return;
  clearUploadPreview(container);
  container.hidden = false;
  const groups = prepared?.groups || [];
  const entries = prepared?.entries || [];
  const filesHtml = groups.map((group, index) => '<span class="upload-preview-file-chip"><i class="fas fa-file-code"></i><span>' + escapeHtml(group.name) + '</span><b>' + group.count + ' 条</b><button class="upload-preview-remove-btn" type="button" data-regex-upload-remove="' + index + '" title="移除此文件" aria-label="移除 ' + escapeHtml(group.name) + '">×</button></span>').join('');
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
  container.innerHTML = '<div class="upload-preview-summary"><span><i class="fas fa-image"></i> ' + escapeHtml(file.name) + '</span><span class="upload-preview-summary-actions"><strong>'
    + dimensions.width + ' × ' + dimensions.height + ' · ' + formatUploadBytes(file.size) + '</strong><button class="upload-preview-clear-btn" type="button" data-upload-preview-clear="cover" title="取消选择">×</button></span></div>'
    + '<img class="upload-cover-image" src="' + escapeHtml(objectUrl) + '" alt="上传前预览图">';
}

async function prepareWorldbookUpload(file) {
  const parsed = await validateJsonUpload(file, 'worldbook');
  const entries = getUploadWorldbookEntryRefs(parsed).map(({ entry, index, objectKey }) =>
    normalizeUploadWorldbookEntry(entry, index, getUploadWorldbookEntryKey(entry, index, objectKey)),
  );
  return { file, parsed, entries };
}

function appendUniqueUploadFiles(currentFiles, incomingFiles) {
  const result = Array.from(currentFiles || []);
  const keys = new Set(result.map(file => JSON.stringify([file.name, file.size, file.lastModified])));
  Array.from(incomingFiles || []).forEach(file => {
    const key = JSON.stringify([file.name, file.size, file.lastModified]);
    if (keys.has(key)) return;
    keys.add(key);
    result.push(file);
  });
  return result;
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
