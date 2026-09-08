# Creative Workshop Creator Capability Audit — 2026-09-05

Status: **historical audit record with 2026-09-08 current-status addendum**

## 2026-09-08 Current-status addendum

The findings below describe the 2026-09-05 state and are intentionally preserved as audit history. Before treating a “remaining issue” as current, use this addendum plus the latest code.

### Findings now fixed in the current staging code line

- **Published cover review isolation**: `ProjectCoverUpload` now creates/reuses the review draft first, then writes the cover under the draft project prefix. A newly created draft is cleaned up when the upload itself fails. Published cover bytes are not overwritten before approval.
- **Actual worldbook/regex content validation**: both project and regex upload endpoints call `validateProjectContentText` on the submitted bytes/text rather than trusting MIME/frontend checks alone.
- **Approval minimum-content validation**: admin approval re-reads review payloads, validates each supported payload, then applies `validateProjectContentPolicy`.
- **Regex-only extension flow**: current policy is `系统核心 / 角色 / 事件 => worldbook required`, `扩展 => worldbook OR regex`. The current Web create/edit flow exposes the same either-content behavior for `扩展`, and install flow can proceed when only regex entries exist.
- **Structured taxonomy**: project type / extension subtype / role facets / custom tags / homepage display tags are now normalized server-side. Legacy `tags` remains a compatibility mirror rather than the canonical model.

Relevant current sources:

```text
cloudflare/src/config/project-content-policy.ts
cloudflare/src/config/project-taxonomy.ts
cloudflare/src/endpoints/projects.ts
cloudflare/src/endpoints/admin.ts
cloudflare/src/pages/home/modals.ts
cloudflare/migrations/0008_project_taxonomy.sql
cloudflare/migrations/0009_project_display_tags.sql
```

### Findings that still matter

The following remain valid backlog unless a later task explicitly closes them:

- create/edit submission is not fully atomic; metadata/draft creation and subsequent file uploads can still fail part-way through;
- no-op edit guard is still desirable;
- author/admin private test reads may still distort public download counters;
- `隐藏` semantics still need a product decision between unlisted and truly private;
- optional cover still needs an explicit remove-cover action;
- validation/limits parity should be checked when those limits are next changed rather than triggering a broad refactor now.

### Current review-UX follow-up

`feature/admin-review-continuous-flow` is a local WIP on top of the current staging baseline. It does **not** change creator capabilities. Its goal is reviewer efficiency: remove internal trace metadata from normal review UI, keep it in admin logs/history, add previous/next navigation, and auto-open the next queued item after approve/reject.

The 2026-09-05 sections below should therefore be read as historical evidence, not as the current TODO order.

## Scope

Creator-facing behavior across Workshop frontend and Cloudflare backend for these states:

- first submission: pending;
- first submission: rejected;
- published, no draft;
- published + pending update draft;
- published + rejected update draft.

There is currently no dedicated `creator` role/flag. Every authenticated user can see Upload. Mutation endpoints generally rely on JWT + ownership (or admin). `checkUploadPermission()` exists but is not used by the normal project create/upload/update/delete endpoints.

## Intended behavior that is working

- create with worldbook -> pending, requires admin approval before public;
- optional regex/cover on create;
- rejected first submission can be edited and resubmitted;
- published edit creates/reuses review draft while published row remains live;
- published worldbook/regex replacement through normal frontend targets draft;
- entry removal on published content uses draft semantics;
- author/admin can view/test private pending/rejected content;
- creators cannot control machine version/status/isPublished/author fields;
- creators cannot approve/reject without actual admin JWT;
- ownership checks prevent editing/deleting/hiding other creators' projects;
- pending project cannot become public merely by visibility toggle.

## Fixed on 2026-09-05

### Pending delete / withdraw mismatch — fixed

Previously frontend disabled delete for all pending projects while backend allowed it.

Now:

- first-upload pending can be deleted;
- linked update draft uses `撤回更新` semantics;
- published version survives draft withdrawal.

Commit: `7d38d01`.

### Published delete could orphan linked draft — fixed

Previously deleting the live published row could unlink but leave the draft/R2 behind.

Now deleting the whole published project safely removes the linked draft too and avoids orphan review rows/files.

Commit: `7d38d01`.

### Submitted update draft could still be edited — fixed in frontend

Pending update draft no longer shows `修改`; creator must withdraw before starting another update. Rejected update remains editable.

Commit: `6a11fa2`.

### Redundant detail button / versioned detail schema bug — fixed

- whole card opens detail;
- `详情` card button removed;
- `GET /api/projects/:id?v=<version>` now accepts the version query instead of failing with `Unrecognized key(s) in object: 'query'`.

Commit: `0e24b44`.

## Remaining high-priority issues

### 1. Published cover can bypass review isolation

`ProjectCoverUpload` can write under the published project R2 prefix before it creates/checks the review draft. A direct API request against a published id may overwrite the live cover before approval.

Required fix:

```text
published id
→ create/reuse draft first
→ upload cover under draft id
→ promote/copy during approval only
```

Normal frontend often avoids the bug by targeting the draft id, but backend must be safe independently.

### 2. Create/edit submission is not atomic

Create flow creates metadata then uploads worldbook/regex/cover sequentially. Published edit can create a draft before replacement uploads finish.

A later failure may leave:

- partial pending project;
- partial review draft;
- duplicate retries.

Minimal safeguards:

- best-effort rollback/cleanup on failed first create;
- approval preconditions that reject incomplete submissions.

Longer-term option: explicit unsubmitted editing state + submit-for-review finalization.

### 3. No-op edit creates review work

Saving a published project without a real change can create/bump a review draft because metadata is always submitted.

Required:

- frontend no-op detection;
- preferably backend idempotency as a defensive second guard.

### 4. Worker does not validate actual JSON/schema

Worldbook/regex endpoints rely too much on MIME/frontend checks. Direct API clients can submit arbitrary/unsupported JSON-shaped content.

Required Worker-side validation before R2 persistence:

- parse actual bytes/text;
- validate supported worldbook structure;
- validate supported regex structure;
- reject valid-but-unsupported JSON shape;
- share parsing/recognition rules with preview/install where practical.

### 5. Admin can approve empty/invalid content

Project metadata can exist without valid uploaded content. Admin review currently lacks a minimum-valid-content precondition.

Correct rule for future regex-only support:

```text
at least one valid supported payload
= valid worldbook OR valid regex
```

Do not hard-code worldbook required.

### 6. Regex-only is backend-capable but frontend-blocked

Backend can create metadata + regex without worldbook. Current create modal requires a worldbook file.

Implement after approval validation is based on `worldbook OR regex`.

## Remaining behavior/validation cleanup

### Hide means unlisted, not private

Public list filters hidden projects, but an approved hidden project can still be fetched/downloaded by id.

Decision required:

- if intended: rename/describe as `从列表隐藏 / unlisted`;
- if intended to be private: enforce visibility on detail/file endpoints.

### Private creator tests inflate download count

Author/admin reads of pending/rejected worldbook JSON currently count as downloads. Public popularity should not include private review/test reads.

### Backend/frontend validation parity

Known mismatches include:

- update name validation weaker than create;
- frontend project name lacks matching max length;
- tag count/length not equally enforced backend-side;
- regex/cover size limits not aligned with worldbook;
- MIME-only checks are both bypassable and sometimes unfriendly to legitimate files with blank `File.type`.

### Optional cover cannot be cleared

Creator can replace cover but cannot explicitly remove it even though cover is optional.

### Pending visibility UI is confusing

Pending/rejected cards expose visibility controls even though those rows cannot be publicly listed before approval. Clarify that this is post-approval/listing intent or redesign the control.

## Current state matrix

| State | Edit | Replace files | Remove entry | Delete / withdraw | Visibility |
| --- | --- | --- | --- | --- | --- |
| First pending | Yes | Yes | Yes | Delete project | Yes, but not public until approval |
| First rejected | Yes -> resubmit | Yes | Yes | Delete project | Yes |
| Published, no draft | Yes -> draft | Yes -> draft | Yes -> draft | Delete whole project | Immediate |
| Published + pending draft | **Locked; withdraw first** | Draft already submitted | Draft already submitted | Withdraw update or delete whole project | Linked behavior |
| Published + rejected draft | Yes -> resubmit | Yes | Yes | Delete draft or whole project | Linked behavior |

## Recommended remaining cleanup order

1. published-cover isolation;
2. Worker JSON/schema validation + approval preconditions;
3. regex/cover size-limit parity;
4. partial-failure cleanup;
5. no-op edit detection;
6. regex-only creator flow;
7. hide semantics + private download counting;
8. metadata validation parity + remove-cover capability.

## Access-control note

There is still no separate creator permission role. Login/community membership may gate initial access, but project mutation routes themselves generally rely on JWT identity + project ownership/admin status rather than a separate creator flag.
