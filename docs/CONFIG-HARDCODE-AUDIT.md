# Configuration / Hardcode Audit

Date: 2026-09-19
Last reviewed: 2026-09-29 — no new high-risk duplicated source of truth found during the documentation audit.

## Rule

The goal is **one source of truth per domain**, not one giant config file.

A value belongs in shared configuration when changing that real-world fact would otherwise require editing multiple unrelated files, or when it is operator/release state rather than implementation logic.

## High-risk duplication fixed in this refactor

| Domain fact | Single source now | Previous problem |
| --- | --- | --- |
| Creative Workshop stable / staging client versions | `config/workshop.json` | release docs, client source and Worker UI could disagree |
| Production / staging Workshop endpoints and staging aliases | `config/workshop.json` | client entry, staging entry and Worker host checks copied URLs independently |
| Companion-script repository key, display name and latest version | `config/workshop.json` | dependency-health logic owned operational release data |
| Project upload / cover request / banner upload limits | `cloudflare/src/config/runtime-limits.ts` | frontend and backend repeated byte limits and user-facing size labels |
| DLC/project initial machine version | `cloudflare/src/utils/version.js` via `LEGACY_PROJECT_VERSION_BASE` | endpoint/schema code repeated the initial version literal |

The staging-host QA check also now derives from the endpoint/alias source instead of copying hostnames.

## Guardrails added

- `pnpm check:workshop-config` validates the shared manifest and rejects managed values copied back into key implementation files.
- Cloudflare `check:home` runs the source-of-truth guard.
- Both GitHub workflows run when shared config changes.
- Stable and staging client bundles are built from the same manifest.
- `pnpm check:workshop-bundles` verifies the **final generated JS artifacts**, not just source code.
- Client release policy lives in `docs/WORKSHOP-RELEASE-SOP.md`; current live version numbers do not belong in SOP prose.

## Already centralized correctly

These are not part of the problem and should stay in their existing domain files:

- project taxonomy, facets and tag limits → `cloudflare/src/config/project-taxonomy.ts`
- content requirements by project type → `cloudflare/src/config/project-content-policy.ts`
- discovery/rating parameters → `cloudflare/src/utils/project-ranking.ts`
- DLC/project SemVer helpers → `cloudflare/src/utils/version.js`
- official-card baseline identity → the baseline directory + its own `manifest.json` / fingerprint data

The official-card baseline version is historical data identity. It should **not** be replaced by the current Workshop client version.

## Remaining cleanup candidates

These are duplicated code/config smells, but they are **not release-state facts** and do not justify blocking this release-config fix:

1. **Project sort contract** — sort identifiers are repeated in API schema/type/backend, while UI exposes its own label subset. If new sort modes are added often, move the shared identifiers/types into a `project-sorting` domain config and keep UI labels derived from it.
2. **Discord avatar URL/fallback construction** — repeated across endpoints and UI. Prefer a shared formatter/helper when touching this area.
3. **External provider/CSP hosts** — Discord, jsDelivr, cdnjs and image proxy hosts appear in security policy and asset code. Consolidate only with a security review; do not blindly convert the CSP into generic runtime config.

Font choices themselves are already grouped in the home state module. Poll intervals, OAuth timeouts, cache TTLs, protocol namespaces, DOM/storage keys and UI animation timing remain implementation constants unless they become operator-managed settings.

## Decision test for future hardcodes

Before adding a literal, ask:

1. Is this value a real product/deployment fact that another runtime or UI also needs?
2. Would changing it require searching the repo for copies?
3. Is it expected to change independently of the surrounding implementation?

If yes, give that domain one owning config/module and make all other code reference it.

If no, keep the constant next to the implementation. Do not create a global configuration dumping ground.
