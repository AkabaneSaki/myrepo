# Repository Operating Rules

These rules apply to all agents and automated sessions working in this repository.

## Canonical Git topology

- User fork / development repository: `https://github.com/uikawinwing/myrepo.git`
- Owner / canonical repository: `https://github.com/AkabaneSaki/myrepo.git`
- Preferred remote names:
  - `origin` = user fork (`uikawinwing/myrepo`)
  - `upstream` = owner repository (`AkabaneSaki/myrepo`)
- Normally, `upstream/main` is the canonical production source branch.
- `origin/main` should be kept synchronized with `upstream/main`; do not use the fork `main` as a task-development branch.
- `origin/staging` is the long-lived integration branch used for Master validation of the active feature line before its owner PR. Production patch hotfixes may use the separate hotfix path defined below, then must be forward-ported into `origin/staging`.
- Normal staging feature/fix task branches start from a freshly fetched `origin/staging`, not from `upstream/main`. `upstream/main` remains the production baseline and the starting point for production-line hotfix/release work.

### Release version policy

- Creative Workshop SemVer belongs to the **SillyTavern client artifact**, not to the Worker/web deployment.
- Before changing any client version, ask: **does the user need to change the `@version` in their Creative Workshop import to receive this change?**
  - If **no**: do not change client SemVer. Track Worker/web releases by exact Git SHA + Cloudflare Worker Version ID.
  - If **yes**: release a new client version.
- Current client release values are read only from `config/workshop.json`. Never duplicate the live values in this file, UI code, tests, or deployment scripts.
- `client.stable` = newest released client tag.
- `client.minimum` = oldest client still allowed to enter the Workshop. A new stable client does not automatically raise this.
- `client.staging` = active staging-client line.
- Client version meaning is strict:
  - `X` = incompatible client / bridge generation.
  - `Y` = new backwards-compatible client capability.
  - `Z` = client-side bugfix only.
- Worker logic, web UI, copy, CSS, ranking, admin UI, D1/R2/backend fixes and other server-only changes do **not** consume patch/minor versions while the old client remains compatible.
- Historical release tags remain immutable backups; temporary hotfix/release branches are workspaces, not archives.
- Run `pnpm check:workshop-config` before client builds/releases and before production integration touching Workshop release configuration.

See `docs/GIT-WORKFLOW.md` for the complete hotfix and forward-port flow.

Before the first Git remote operation in every session, verify both actual remote URLs. Never infer ownership from a remote name alone.

## Issue tracker boundary

Use the two repositories for different lifecycle stages:

- `uikawinwing/myrepo` Issues = staging features, UX/enhancements, experiments, future backlog, staging-only technical debt, and work not yet shipped to production.
- `AkabaneSaki/myrepo` Issues = bugs/regressions already affecting the production line, production hotfixes, production security/privacy problems, production performance problems, and release blockers.

Do not create a feature issue in the owner repository merely because the feature may eventually be promoted upstream.

When migrating an old owner feature issue to the fork:

1. inspect current code/tests first,
2. create the fork issue with only the **remaining real work** rather than copying stale unchecked boxes,
3. add the destination link to the owner issue,
4. close the owner issue as `not planned` with an explicit note that tracking moved rather than pretending the work is complete.

An already-near-complete legacy owner issue may be finished in place when migrating it would add more bookkeeping than value.

## Infrastructure boundary

Git hosting and runtime infrastructure are separate concerns.

- The user fork is a code-development/fork repository only. It does **not** imply ownership or use of the owner's Discord bot/OAuth configuration, Cloudflare Worker, D1, KV, R2, secrets, or production bindings.
- Production Discord and Cloudflare configuration belongs to the production/owner environment and must be verified separately before any deploy or permission change.
- Do not copy, infer, or substitute production credentials/bindings from the user fork.
- A branch being pushed to `origin` does not deploy or reconfigure production.

## UX language contract — mandatory

Treat all user-facing, creator-facing, and admin-facing UI as being used by non-technical people.

- Use plain everyday Chinese. Prefer concrete questions and actions over engineering nouns.
- Do not expose internal terms such as `metadata`, `schema`, `reference`, `registry`, `fingerprint`, database fields, IDs, implementation names, or other backend concepts unless there is no practical alternative.
- File formats may be shown only as a secondary hint, for example `世界书文件 (.json)`; do not make `JSON` the main concept the user must understand.
- Clearly mark optional fields as optional. Do not make users guess whether something can be skipped.
- Error messages must explain what the user should do next, not what the internal parser/database failed to do.
- Keep unavoidable product/domain terms only when the target users already need them to operate SillyTavern, such as `世界书` or `正则`.
- When reviewing a form, first ask whether each field is truly necessary. Hide, automate, or move nonessential choices out of the primary flow before merely rewriting their labels.
- A good default test is: a person with no coding or IT background should understand what to choose without knowing how Creative Workshop is implemented.

## Deployment helper contract — mandatory

A reusable fail-closed deployment helper already exists on the primary machine. **Use it before considering any raw Wrangler/PowerShell/Bash deployment path.**

- Generic engine: `.cotel/local/one-click-deploy/deploy-worker.ps1`
- Target/source profiles: `.cotel/local/one-click-deploy/profiles/*.json`
- Compatibility shortcuts: `.cotel/local/CHECK_STAGING.cmd`, `.cotel/local/DEPLOY_STAGING.cmd`, `.cotel/local/CHECK_PRODUCTION.cmd`, `.cotel/local/DEPLOY_PRODUCTION.cmd`
- Helper documentation: `.cotel/local/one-click-deploy/README.md`

Treat deployment as composable bricks, not one script per situation:

- **target profile** chooses Cloudflare account, Worker, Wrangler config, D1/KV/R2 and auth policy;
- **source selector** chooses an allowed Git remote + branch/tag;
- `-SourceRepoRoot` may point at another clean worktree;
- `-ConfigPath` may select another Wrangler config when the chosen profile permits that target;
- `-CheckOnly` performs the same preflight without deploying.

Examples of supported variation are multiple staging/preview Workers via additional profiles and temporary production deployment from an explicitly allowed owner `release/*` branch or release tag. A new target/source combination is **not** a reason to create a new deployment script.

Agent rules:

1. Before any Worker deployment, inspect/use the existing helper and an appropriate profile.
2. If the scenario differs only by Worker/account/config/bindings/source branch/tag, add or adjust a profile/selector brick; do not copy the engine.
3. If a genuinely generic capability is missing, extend `deploy-worker.ps1` once, preserving fail-closed checks, then use it.
4. Do **not** fall back to ad-hoc `wrangler deploy`, raw Bash/PowerShell deployment chains, or a freshly invented deploy script merely because a profile/check failed.
5. A failed helper check is a stop signal to fix the profile/source/credential/state mismatch. Do not weaken or bypass the check to make deployment pass.
6. If Cotel exposes a dedicated deployment capability for this helper, prefer that capability over shell execution.

The helper is persistent machine-local operational tooling under `.cotel/local/`. `.ai-bridge/` is reserved for current-session AI handoff state only; long-lived deployment policy remains this `AGENTS.md` plus `docs/GIT-WORKFLOW.md`.

## Staging terminology contract

Use these exact terms. Do not collapse them into the single word "staging":

- **local worktree** = local filesystem checkout/worktree only.
- **task branch** = short-lived feature/fix branch under development.
- **origin/staging** = GitHub branch `uikawinwing/myrepo:staging`.
- **integrate into staging** = merge/cherry-pick/fast-forward task commits into the staging branch history.
- **push staging** = push Git commits to `origin/staging`. This is a GitHub operation only.
- **staging Worker** = the Cloudflare test Worker. This is runtime infrastructure, not a Git branch.
- **deploy staging** = deploy an exact Git commit to the staging Worker. This is a Cloudflare operation only.
- **staging site** = the user-facing test URL backed by the staging Worker.
- **owner main** = `upstream/main` / `AkabaneSaki/myrepo:main`.
- **production Worker** = the owner production Cloudflare Worker.
- **promote to production** = owner PR/merge first, then deploy the exact merged owner-main commit to production.

Never report vague phrases such as "staging is updated", "changed on staging", or "staging is ready". Report Git and runtime states separately, for example:

```text
origin/staging = abc1234
staging Worker = abc1234 (Worker version ...)
production = unchanged
```

### Staging source-of-truth invariant

The staging Worker must normally run code that already exists in `origin/staging`.

Normal order:

```text
task branch
→ test/review
→ integrate into origin/staging
→ push staging
→ record exact origin/staging SHA
→ deploy that SHA to staging Worker
→ verify staging site
→ Master acceptance
```

Do **not** skip `origin/staging` and deploy a task branch directly to the staging Worker. If an isolated experiment must bypass the integration branch, deploy it to a separately named **preview Worker / temporary Worker**, never the staging Worker.

Before a staging deploy, verify the exact commit is contained in `origin/staging`. In the normal staging worktree, prefer the stricter check that local `HEAD` equals refreshed `origin/staging`. If they differ, stop and integrate/push first.

## Required Git preflight

Before commit, merge, rebase, push, tag, PR preparation, deploy, or branch cleanup:

1. Check the current branch and dirty state.
2. Verify `origin` points to `uikawinwing/myrepo`.
3. Verify `upstream` points to `AkabaneSaki/myrepo`.
4. Refresh owner main explicitly with:
   `git fetch upstream main:refs/remotes/upstream/main`
   Do not rely on `FETCH_HEAD` as proof that `upstream/main` is current.
5. For staging-line work, also refresh `origin/staging` before creating/synchronizing the task branch and compare the task branch against that base. Keep the `upstream/main` comparison as a production-drift check.
6. Never use `git add .` in a dirty multi-task workspace. Stage explicit reviewed paths only.
7. Never force-push `upstream/main` or `origin/main`.
8. Before `deploy staging`, refresh/verify `origin/staging` and record the exact deploy SHA.

## Normal task / staging / production flow

1. Refresh both `upstream/main` and `origin/staging`.
2. Synchronize `origin/main` with `upstream/main` when needed; this mirror step is independent from staging feature development.
3. Create a short-lived staging feature/fix task branch from refreshed `origin/staging`.
4. Implement, test, and review.
5. Commit only the intended files.
6. Push the task branch to `origin` when useful for backup/review.
7. Integrate the accepted task commit(s) back into the refreshed staging line.
8. Push the resulting exact commit to `origin/staging`.
9. Verify the exact deploy SHA is present in `origin/staging`.
10. Deploy that SHA to the verified personal staging Worker.
11. Verify the staging site and let Master perform real-world acceptance testing.
12. Repeat fixes through `origin/staging` → staging Worker until Master accepts the result.
13. Only after staging acceptance, prepare the owner PR from the accepted fork/staging history as appropriate.
14. Merge through the owner repository when approved.
15. Deploy the exact merged owner-main commit to the verified production environment.
16. Re-sync the fork `main` and clean up temporary task branches when safe.

Do not push task branches directly to the owner repository as the normal workflow. Do not deploy a dirty working tree unless the user explicitly requests an emergency exception. Any emergency exception must be reconciled back through the fork/PR flow before the task is considered complete.

The normal staging-acceptance flow above applies to feature work and fixes targeting the active staging feature line. Production patch hotfixes are the explicit parallel-line exception: validate from the exact production source, merge/tag/deploy through owner main, then forward-port the fix into `origin/staging`.

## Branch lifecycle

Keep long-lived branches to a minimum.

Worktree rules:

- Never create a worktree inside another worktree/repository; do not use nested `.worktrees/<task>` layouts for this project.
- Prefer sibling worktrees beside the main checkout, for example `C:\Project\myrepo-wt-<task>`.
- The same branch must not be checked out in multiple worktrees.
- Do not use junctions/symlinks as a workaround for worktree-relative paths.
- Prefer `git switch` / `git restore` over cross-worktree `git checkout` workflows.

Long-lived branches:

- `upstream/main`: canonical owner / production source branch.
- `origin/main`: synchronized mirror of `upstream/main`, not a development branch.
- `origin/staging`: long-lived integration/test branch while the real staging environment is active. It is not production and is not interchangeable with the staging Worker.
- `fix/*`, `feature/*`, `hotfix-*`, `release-*`, `cw-test-*`, `recovery-*`: temporary task branches on the user fork. Merge through staging/PR or intentionally abandon them, then delete them.

Before deleting a temporary branch, confirm one of:

- its required changes are already contained in refreshed `upstream/main`, or
- its required changes are preserved in `origin/staging` and will continue through the planned promotion flow, or
- its unique commits are intentionally obsolete, or
- its required commits have been cherry-picked/recreated elsewhere.

If a branch conflicts with current `upstream/main`, do not merge it wholesale just to clean up. Inspect its unique commits and cherry-pick only still-needed work.

## Merge safety

For uncertain old branches, test from refreshed `upstream/main` with a temporary audit branch and `git merge --no-commit --no-ff <branch-or-sha>`. Abort after the test. Do not test merges inside a dirty user working tree without first preserving and later restoring those changes.

## Deployment/account safety

For Cloudflare production deploys, use the configured production profile and verify the target account/resources before deployment. Production deployment success does not mean GitHub has been updated; always record and reconcile the Git commit separately.

Before any production deploy, query and record the production Worker's current deployment/version and verify the intended source commit/tag independently. Do not treat the newest local deployment log as proof of current runtime because dashboard/manual deployments may exist.

For staging deploys, verify the personal staging Cloudflare account/resources independently from Git remotes. A successful `push staging` does not mean the staging Worker is updated, and a successful `deploy staging` does not mean `origin/staging` contains that code. Both states must be verified explicitly.

## Session closeout

Before declaring a task finished, report:

- current local branch/worktree
- commit SHA(s) created
- `origin/staging` exact SHA, if staging work occurred
- staging Worker exact deployed Git SHA and Worker version, if staging work occurred
- where each commit was pushed
- whether owner `main` contains the change
- production deployment status, if applicable
- temporary branches that remain and why
- unrelated local changes intentionally left untouched

See `docs/GIT-WORKFLOW.md` for the full human-readable SOP.
