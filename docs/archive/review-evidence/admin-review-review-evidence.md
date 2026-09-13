# Admin review continuous-flow evidence

## cloudflare/src/pages/home/modals.ts — queue navigation and auto-advance

```js
function getAdminReviewQueueProjects(queueOverlay, queueProjects) {
  const source = Array.isArray(queueProjects) ? queueProjects : [];
  const byId = new Map(source.map(item => [String(item.id), item]));
  return Array.from(queueOverlay?.querySelectorAll?.("[data-review-card]") || []).map(card => byId.get(String(card.dataset.projectId))).filter(Boolean);
}

function getAdminReviewAdjacentProject(queueOverlay, queueProjects, projectId, direction) {
  const ordered = getAdminReviewQueueProjects(queueOverlay, queueProjects);
  if (ordered.length <= 1) return null;
  const currentIndex = ordered.findIndex(item => String(item.id) === String(projectId));
  if (currentIndex < 0) return null;
  const nextIndex = currentIndex + (direction < 0 ? -1 : 1);
  if (nextIndex < 0 || nextIndex >= ordered.length) return null;
  return ordered[nextIndex] || null;
}

function removeAdminReviewQueueProject(queueOverlay, queueProjects, projectId) {
  const card = Array.from(queueOverlay?.querySelectorAll?.("[data-review-card]") || []).find(item => item.dataset.projectId === String(projectId));
  card?.remove();
  if (Array.isArray(queueProjects)) {
    const index = queueProjects.findIndex(item => String(item.id) === String(projectId));
    if (index >= 0) queueProjects.splice(index, 1);
  }
  refreshAdminReviewPositions(queueOverlay);
  const count = queueOverlay?.querySelector(".admin-review-queue-summary strong");
  if (count) count.textContent = String(queueOverlay.querySelectorAll("[data-review-card]").length);
}
```

Inside `openAdminReviewDetail(project, queueOverlay, queueProjects = [])`:

```js
const orderedQueueProjects = getAdminReviewQueueProjects(queueOverlay, queueProjects);
const currentQueueIndex = orderedQueueProjects.findIndex(item => String(item.id) === String(project.id));
const canPrev = currentQueueIndex > 0;
const canNext = currentQueueIndex >= 0 && currentQueueIndex < orderedQueueProjects.length - 1;

// buttons
<button data-admin-review-back>返回队列</button>
<button data-admin-review-prev ${canPrev ? "" : "disabled"}>上一个</button>
<button data-admin-review-next ${canNext ? "" : "disabled"}>下一个</button>
<button data-admin-review-submit="reject">拒绝</button>
<button data-admin-review-submit="approve">批准</button>

const openAdjacent = direction => {
  const adjacent = getAdminReviewAdjacentProject(queueOverlay, queueProjects, project.id, direction);
  if (!adjacent) return;
  overlay.remove();
  openAdminReviewDetail(adjacent, queueOverlay, queueProjects);
};

// approve/reject success path
const orderedBefore = getAdminReviewQueueProjects(queueOverlay, queueProjects);
const currentIndex = orderedBefore.findIndex(item => String(item.id) === String(project.id));
await reviewProject(project.id, {
  action,
  ...(rejectReason ? { rejectReason } : {}),
  expectedRevision: project?.draftRevision || reviewProjectData?.draftRevision,
});
showToast(action === 'approve' ? '已批准' : '已拒绝');
overlay.remove();
removeAdminReviewQueueProject(queueOverlay, queueProjects, project.id);
await fetchProjects(true);
const remaining = getAdminReviewQueueProjects(queueOverlay, queueProjects);
if (remaining.length > 0) {
  const nextIndex = currentIndex >= 0 ? Math.min(currentIndex, remaining.length - 1) : 0;
  openAdminReviewDetail(remaining[nextIndex], queueOverlay, queueProjects);
} else {
  const sort = queueOverlay?.dataset.reviewSort || "oldest";
  const projectType = queueOverlay?.dataset.reviewProjectType || "";
  queueOverlay.remove();
  openAdminPanel({ sort, projectType });
}
```

Queue-level skip deliberately reorders the DOM only and then refreshes positions:

```js
function skipAdminReviewCard(overlay, projectId) {
  const card = Array.from(overlay.querySelectorAll("[data-review-card]")).find(item => item.dataset.projectId === String(projectId));
  if (!card || !card.parentElement) return;
  const list = card.parentElement;
  list.appendChild(card);
  refreshAdminReviewPositions(overlay);
}
```

`getAdminReviewQueueProjects()` derives order from the current DOM and maps ids back to `queueProjects`, so detail navigation and auto-advance follow the visible post-skip order.

`openAdminPanel(options)` obtains the queue from server-side `fetchPendingProjects({ sort, projectType })`, stores `reviewSort` and `reviewProjectType` on the queue overlay, and passes that same `pending` array into every `openAdminReviewDetail` call.

## cloudflare/src/endpoints/admin.ts — stale revision + audit trace

```ts
const { action, rejectReason, expectedRevision } = data.body;
const project = await projectDb.get(c, projectId);
if (!project) return c.json({ error: 'Project not found' }, 404);

if (!expectedRevision || expectedRevision !== project.draftRevision) {
  return c.json(
    { error: 'Draft changed while under review. Refresh and review the latest revision.' },
    409,
  );
}

if (action === 'reject' && !rejectReason) {
  return c.json({ error: 'Reject reason required' }, 400);
}

if (action === 'approve') {
  const contentValidation = await validateReviewPayloads(c, project);
  if (contentValidation.valid === false) {
    return c.json({ error: contentValidation.error }, 409);
  }
}
```

After the review mutation, audit log detail keeps trace-only fields:

```ts
await projectDb.logAdminAction(c, {
  action: action === 'approve' ? 'project_approved' : 'project_rejected',
  targetType: project.reviewTarget === 'draft' ? 'project_draft' : 'project',
  targetId: projectId,
  actorId: payload.userId,
  actorName: payload.globalName || payload.username,
  detail: {
    rejectReason: rejectReason || null,
    projectName: project.name,
    version: approvedVersion || project.version,
    previousVersion: publishedVersionBeforeApproval,
    versionLabel: project.versionLabel ?? null,
    draftRevision: project.draftRevision,
    reviewTarget: project.reviewTarget,
    publishedProjectId: project.publishedProjectId || null,
    projectCreatedAt: project.createdAt,
    projectUpdatedAt: project.updatedAt,
  },
});
```

Normal queue/detail UI removed version/revision/created/updated metadata. `openAdminLogsModal()` parses `log.detail`, shows the human-readable action/project/actor/reject reason, and puts target id, revision, review target, published id, project timestamps, version change and version label inside collapsed `<details class="admin-log-trace">追踪信息</details>`.

## cloudflare/src/pages/home/styles.ts — new log/mobile rules

```css
.admin-log-card { display:flex; flex-direction:column; gap:10px; }
.admin-log-head { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; }
.admin-log-head time { flex:none; color:rgba(148,163,184,.82); font-size:.76rem; white-space:nowrap; }
.admin-log-actor { display:flex; align-items:center; gap:7px; color:rgba(226,232,240,.7); font-size:.8rem; }
.admin-log-reason { padding:9px 11px; border-radius:10px; border:1px solid rgba(248,113,113,.24); background:rgba(127,29,29,.12); color:#FECACA; line-height:1.45; }
.admin-log-trace { border:1px solid rgba(148,163,184,.14); border-radius:11px; background:rgba(15,23,42,.5); overflow:hidden; }
.admin-log-trace summary { padding:9px 11px; cursor:pointer; color:rgba(203,213,225,.76); font-size:.78rem; font-weight:650; }
.admin-log-trace > div { display:grid; grid-template-columns:110px minmax(0,1fr); gap:10px; padding:7px 11px; border-top:1px solid rgba(148,163,184,.08); align-items:start; }
.admin-log-trace code { min-width:0; white-space:pre-wrap; overflow-wrap:anywhere; color:#CBD5E1; font-size:.73rem; }

@media (max-width: 640px) {
  .admin-review-sticky-actions { display:grid; grid-template-columns:1fr 1fr; padding:10px; }
  .admin-review-sticky-actions .btn { min-width:0; }
  .admin-review-sticky-actions [data-admin-review-back] { grid-column:1 / -1; }
  .admin-log-head { flex-direction:column; gap:5px; }
  .admin-log-head time { white-space:normal; }
  .admin-log-trace > div { grid-template-columns:1fr; gap:4px; }
}
```

## Current verification

- `npm run check:types` PASS
- `npm run check:home-js-smoke` PASS
- `npm run check:review-diff` PASS
- `pnpm run build` PASS

The smoke test now explicitly asserts previous/next markers, canPrev/canNext boundary logic, absence of circular modulo navigation, queue removal + auto-next call, admin-log-trace presence, and absence of the removed version/time helper UI.
