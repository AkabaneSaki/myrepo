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
- `origin/staging` is the long-lived integration branch used for Master staging validation before any owner PR.

### Temporary production exception — P2/P3 recovery

This repository is currently in a temporary exception state because P2 work was merged into `upstream/main` earlier than intended.

- Current `upstream/main` contains P2 work, including taxonomy/data-model changes that are not intended for the old production UI, plus ongoing P3 UI work.
- P2/P3 development may continue normally through task branches -> `origin/staging` -> Master staging acceptance -> owner PR / `upstream/main`. **Merging accepted P2/P3 work into `upstream/main` does not authorize a production deployment while this exception is active.**
- **Do not deploy current `upstream/main` to production until Master explicitly declares the P2/P3 UI line production-ready.** Do not pressure or accelerate P3 merely to make `main` deployable again.
- The last clean stable production base before the accidental P2 merge is tag `2.0.14`, commit `2ab714e011dfd6f93f0801b1567e9ac2d5d62358`.
- For the current hotfix cycle, create/use `release/2.0.15` from the `2.0.14` stable base and apply only the required 2.0.15 hotfixes. The stable `2.0.15` tag / its exact release commit is the temporary production source.
- Before promoting the P2/P3 staging line into owner `main`, verify that every still-required 2.0.15 reliability fix has been forward-ported into the P2/P3 line. During the 2026-09-11 recovery audit, the forward line was still missing equivalent behavior for version/cache freshness, worldbook duplicate/install-identity handling, and per-project install/update/uninstall mutation locking; re-check current code rather than assuming this list remains exhaustive.
- Keep equivalent hotfix fixes in the forward P2/P3 code line as needed so the later release does not regress.
- Do **not** rewrite, reset, force-push, or otherwise replace `upstream/main` merely to restore its old production role.
- Once P2/P3 and the new UI are complete and accepted by Master, production may return to the normal rule: release from the exact accepted `upstream/main` commit and a stable tag. At that point this temporary exception should be removed or archived.
- Until then, any instruction elsewhere in this file saying production must come from `upstream/main` is overridden by this temporary exception.

Before the first Git remote operation in every session, verify both actual remote URLs. Never infer ownership from a remote name alone.

## Infrastructure boundary

Git hosting and runtime infrastructure are separate concerns.

- The user fork is a code-development/fork repository only. It does **not** imply ownership or use of the owner's Discord bot/OAuth configuration, Cloudflare Worker, D1, KV, R2, secrets, or production bindings.
- Production Discord and Cloudflare configuration belongs to the production/owner environment and must be verified separately before any deploy or permission change.
- Do not copy, infer, or substitute production credentials/bindings from the user fork.
- A branch being pushed to `origin` does not deploy or reconfigure production.

## Deployment helper contract — mandatory

A reusable fail-closed deployment helper already exists on the primary machine. **Use it before considering any raw Wrangler/PowerShell/Bash deployment path.**

- Generic engine: `.ai-bridge/one-click-deploy/deploy-worker.ps1`
- Target/source profiles: `.ai-bridge/one-click-deploy/profiles/*.json`
- Compatibility shortcuts: `.ai-bridge/CHECK_STAGING.cmd`, `.ai-bridge/DEPLOY_STAGING.cmd`, `.ai-bridge/CHECK_PRODUCTION.cmd`, `.ai-bridge/DEPLOY_PRODUCTION.cmd`
- Helper documentation: `.ai-bridge/one-click-deploy/README.md`

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

The helper is local operational tooling under `.ai-bridge/`; long-lived deployment policy remains this `AGENTS.md` plus `docs/GIT-WORKFLOW.md`.

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
5. Compare the task branch against refreshed `upstream/main`.
6. Never use `git add .` in a dirty multi-task workspace. Stage explicit reviewed paths only.
7. Never force-push `upstream/main` or `origin/main`.
8. Before `deploy staging`, refresh/verify `origin/staging` and record the exact deploy SHA.

## Normal task / staging / production flow

1. Refresh `upstream/main`.
2. Synchronize `origin/main` with `upstream/main` when needed.
3. Create a short-lived task branch from refreshed `upstream/main`.
4. Implement, test, and review.
5. Commit only the intended files.
6. Push the task branch to `origin` when useful for backup/review.
7. Integrate the accepted task commit(s) into the staging line.
8. Push the resulting exact commit to `origin/staging`.
9. Verify the exact deploy SHA is present in `origin/staging`.
10. Deploy that SHA to the verified personal staging Worker.
11. Verify the staging site and let Master perform real-world acceptance testing.
12. Repeat fixes through `origin/staging` → staging Worker until Master accepts the result.
13. Only after staging acceptance, open/prepare a PR from the user fork to `AkabaneSaki:main`.
14. Merge through the owner repository when approved.
15. Deploy the exact merged owner-main commit to the verified production environment.
16. Re-sync the fork `main` and clean up temporary task branches when safe.

Do not push task branches directly to the owner repository as the normal workflow. Do not deploy a dirty working tree unless the user explicitly requests an emergency exception. Any emergency exception must be reconciled back through the fork/PR flow before the task is considered complete.

## Branch lifecycle

Keep long-lived branches to a minimum:

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
