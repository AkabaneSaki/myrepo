# Creative Workshop P0 / P1 Closeout — 2026-09-07

Status: **completed, accepted, promoted to production**
Date: 2026-09-07

This is a historical release/closeout record, not the active TODO.

## GitHub milestones

```text
Workshop P0 — 审核安全与发布可靠性    CLOSED
Workshop P1 — 审核透明度增强          CLOSED
```

P1 issues closed:

```text
#10 展示世界书条目的深度、顺序与插入位置
#16 自动检测上传内容中的 EJS
#17 检测并展示静态外链
#18 为修改条目增加 Git 风格文本 Diff
```

## Production promotion record

```text
Owner repo: AkabaneSaki/myrepo
Production source commit: 368f09ad4e5bdc380b615adf569e6961cefbb086
Production Worker: poemofdestinycreativeworkshop
Production Worker Version ID: 64c6fa11-4c78-4faf-a0ae-9b138348d171
Production Cloudflare account: 873e2527b7bad1a15418e77bf5672277
Production D1: creative_workshop
Production D1 ID: d15eff29-c6a2-4bc8-9e5d-c7e3752bbc39
```

The production deployment was executed through the local fail-closed one-click production helper after staging acceptance and promotion into owner main.

## Staging record before promotion

```text
origin/staging: 52f7513d2fab6c9e71f9b14bff63a1ef1037ade0
Staging Worker: poemofdestinycreativeworkshop-master-staging
Staging Worker Version ID: de69c743-23cd-49f3-8169-51bed2d87e94
Staging site: https://workshop-test.uika.cc.cd
Staging Cloudflare account: 244413515a4546e4901b821c957158f7
Staging D1: creative-workshop-recovery-bench-staging-20260906
Staging D1 ID: 3348574a-9058-43e5-822a-9e39bf9937e9
```

## P1 delivered behavior

### Worldbook behavior metadata (#10)

Creator/reviewer inspection surfaces show human-readable insertion metadata such as position and order. `depth`/`role` are shown only for `at_depth` entries where those fields are semantically meaningful, avoiding the earlier misleading `角色定义后 · 深度 4` display.

### Content inspection (#16)

Supported content is inspected server-side for EJS. The result is presented as a system-generated `EJS` badge rather than a creator-controlled tag.

Character-artwork template detection is also exposed as a system badge:

```text
👍🏻有角色立绘
```

System badges are visually distinct and ordered before creator tags.

### Static external links (#17)

Project detail and admin review surfaces show detected static HTTP/HTTPS URLs, including domain/source context where available.

The UI explicitly says the URLs were detected from strings and were **not visited or remotely validated**. This disclaimer is visually emphasized in amber instead of ordinary informational blue.

The accepted scope does not require repeating the same panel in every install/download/update confirmation dialog; project detail plus review visibility is sufficient.

### Git-style text diff (#18)

Reviewer diff keeps the existing entry-level added/modified/removed structure and adds Git-like text comparison inside modified worldbook/regex entries.

## Homepage official badges without extra per-card content reads

Migration:

```text
0007_project_inspection_summary.sql
```

Added project-level summary fields:

```text
has_ejs
has_character_artwork
```

These are maintained during upload/update/removal/draft approval. The homepage reads them from the same project-list row instead of opening R2/project detail for each card.

At rollout, both staging and production had 376 published projects. The one-time backfill produced:

```text
EJS projects: 172
character-artwork projects: 76
```

The one-time production backfill cost reported by D1 was 376 rows read and 376 rows written. This is not a recurring homepage cost.

## Deployment automation introduced during closeout

Local operational helpers:

```text
.ai-bridge\CHECK_STAGING.cmd
.ai-bridge\DEPLOY_STAGING.cmd
.ai-bridge\CHECK_PRODUCTION.cmd
.ai-bridge\DEPLOY_PRODUCTION.cmd
```

The deploy helpers verify the intended Git source and Cloudflare target, check account/D1 identity, inspect/apply pending D1 migrations in deploy mode, run Wrangler dry-run, then deploy. Any mismatch fails closed.

This replaced repeated manual copy/paste command chains for routine Workshop deployments.
