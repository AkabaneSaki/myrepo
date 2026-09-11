# Git / Staging / Release SOP

This repository uses a fork-first workflow with a mandatory staging acceptance gate before owner production integration.

Git repository state and runtime deployment state are separate systems. Always report and verify them separately.

## 1. Canonical topology

| Purpose | Repository | Remote |
| --- | --- | --- |
| User development fork | `https://github.com/uikawinwing/myrepo.git` | `origin` |
| Owner / canonical repository | `https://github.com/AkabaneSaki/myrepo.git` | `upstream` |

Branch meaning:

- `upstream/main` = canonical owner / production source branch.
- `origin/main` = synchronized mirror of `upstream/main`; not a task-development branch.
- `origin/staging` = Master-facing integration/test branch.
- task branches = temporary `feature/*`, `fix/*`, `hotfix-*`, etc.

Never infer repository ownership from a remote name. Verify URLs before the first remote operation of every session.

## 2. Mandatory terminology contract

Do not use the single word `staging` when more than one meaning is possible.

| Phrase | Exact meaning |
| --- | --- |
| **local worktree** | Local filesystem checkout/worktree only |
| **task branch** | Short-lived feature/fix branch under development |
| **origin/staging** | GitHub branch `uikawinwing/myrepo:staging` |
| **integrate into staging** | Merge/cherry-pick/fast-forward task commits into the staging branch history |
| **push staging** | Push Git commits to `origin/staging`; GitHub only |
| **staging Worker** | Cloudflare Worker used for Master testing |
| **deploy staging** | Deploy an exact Git commit to the staging Worker; Cloudflare only |
| **staging site** | Test URL served by the staging Worker |
| **owner main** | `upstream/main` / `AkabaneSaki/myrepo:main` |
| **production Worker** | Owner production Cloudflare Worker |
| **promote to production** | PR/merge into owner main, then deploy exact merged owner-main commit |

Current project staging runtime identifiers:

```text
staging Worker = poemofdestinycreativeworkshop-master-staging
staging site   = workshop-test.uika.cc.cd
Cloudflare     = Johnjohnson personal staging environment
```

These runtime identifiers must still be verified before deployment; they are not inferred from Git remotes.

### Forbidden ambiguous reporting

Do not say only:

```text
staging is updated
changed on staging
staging is ready
deployed to staging
```

Instead report both Git and runtime explicitly:

```text
Git
origin/staging = abc1234

Cloudflare
staging Worker deployed Git SHA = abc1234
Worker Version = <cloudflare-version-id>
staging site verification = passed

Production
unchanged
```

## 3. Staging source-of-truth rule

The staging Worker must normally run code that already exists in `origin/staging`.

Mandatory order:

```text
task branch
→ local tests/review
→ integrate into staging
→ push staging
→ record exact origin/staging SHA
→ deploy that exact SHA to staging Worker
→ verify staging site
→ Master acceptance test
```

### Do not skip `origin/staging`

Normal flow must **not** be:

```text
task branch
→ staging Worker
```

If an isolated experiment really needs direct branch deployment, use a separately named **preview Worker / temporary Worker**. Never use the normal staging Worker for code that is not already represented in `origin/staging`.

### Deploy precondition

Before `deploy staging`:

1. refresh `origin/staging`,
2. identify the exact deploy SHA,
3. verify that SHA is contained in `origin/staging`,
4. in the normal staging worktree, prefer the stricter invariant:

```text
local HEAD == refreshed origin/staging
```

If they differ, stop. Integrate/push first; do not deploy the task branch directly.

## 4. Runtime / infrastructure boundary

The user fork is a Git code fork only.

It does **not** imply ownership or use of the owner's:

- Discord bot,
- Discord OAuth application/configuration,
- Cloudflare Worker,
- D1 database,
- KV/R2 resources,
- production secrets,
- production bindings.

Important consequences:

- `push staging` updates GitHub only.
- `deploy staging` updates Cloudflare runtime only.
- A successful Git push does not mean the Worker is updated.
- A successful Worker deploy does not prove GitHub contains the deployed code.
- A successful PR merge does not mean production is deployed.
- Production runtime configuration must be verified separately from repository ownership.

## 5. Start-of-session Git preflight

Before commit, merge, push, tag, PR preparation, deploy, or branch cleanup:

```powershell
git status -sb
git branch --show-current
git remote -v
git fetch upstream main:refs/remotes/upstream/main
git branch -vv
```

Confirm:

1. current branch/worktree,
2. dirty/clean working tree,
3. `origin` = `uikawinwing/myrepo`,
4. `upstream` = `AkabaneSaki/myrepo`,
5. `upstream/main` was freshly updated,
6. exact files belonging to the current task.

Do not rely on `FETCH_HEAD` alone as proof that `upstream/main` is current.

Before staging deployment, additionally refresh/verify `origin/staging` and record the exact SHA to deploy.

If any item is unclear, stop before publishing or deploying.

## 6. Keep fork main synchronized

Normal direction:

```text
upstream/main
    ↓
origin/main
```

Do not develop features directly on `origin/main`.

Do not force-push either main branch merely to make history look clean.

## 7. Normal feature / fix workflow

This is the default workflow for ordinary changes:

```text
1. refresh upstream/main
2. sync origin/main if needed
3. create task branch from refreshed upstream/main
4. implement
5. local tests + review
6. stage explicit files only
7. commit
8. optionally push task branch to origin for backup/review
9. integrate accepted task commit(s) into the staging line
10. push origin/staging
11. record exact origin/staging SHA
12. deploy that SHA to staging Worker
13. verify staging site
14. Master real-world acceptance test
15. if bugs remain: fix → test → integrate/push origin/staging → deploy staging again
16. after Master accepts staging: prepare PR to owner main
17. owner merges PR
18. deploy exact merged owner-main SHA to production Worker
19. verify production
20. sync origin/main
21. clean up temporary branches when safe
```

The critical gate is:

```text
Master has not accepted staging
→ no owner PR merge
→ no production deploy
```

## 8. What "integrate into staging" means

`integrate into staging` describes Git history only. It can be performed by the safest appropriate method:

- fast-forward,
- cherry-pick of reviewed commits,
- merge when justified.

Do not call a normal push a merge if no merge occurred.

Examples:

```text
"Integrated commit abc1234 into origin/staging"  ✅
"Pushed origin/staging to abc1234"               ✅
"Deployed abc1234 to staging Worker"             ✅
```

These are three different events and should be reported separately.

## 9. Staging deployment SOP

Before deploy:

```text
Git
origin/staging exact SHA known           yes
local deploy source matches that SHA     yes
tests green                              yes
unrelated dirty files excluded           yes

Cloudflare
personal staging account verified        yes
staging Worker verified                  yes
staging D1/KV/R2 verified when relevant  yes
production account/resources untouched   yes
```

Then deploy.

After deploy record:

```text
origin/staging SHA:
staging Worker:
Worker Version ID:
staging site:
live verification:
production changed: no
```

Where practical, verify the live site contains behavior/code unique to the deployed SHA rather than trusting the deploy log alone.

### Composable deployment helper on the primary machine

The primary machine has one fail-closed engine plus target/source profiles:

```text
C:\Project\myrepo-git\.ai-bridge\one-click-deploy\deploy-worker.ps1
C:\Project\myrepo-git\.ai-bridge\one-click-deploy\profiles\*.json
```

Do not clone deployment logic for a second staging Worker, preview Worker, release branch, or release tag. Change/add the target profile and source selector instead. The helper supports `-SourceRepoRoot`, branch/tag selection, config override, and `-CheckOnly` while preserving the same Git/Cloudflare/D1/dry-run checks.

The legacy convenience shortcuts below remain wrappers around that same engine.

### One-click staging shortcut

For routine Workshop staging deployments on the primary development machine, use the fail-closed helper instead of rebuilding the Wrangler command by hand:

```text
C:\Project\myrepo-git\.ai-bridge\CHECK_STAGING.cmd
C:\Project\myrepo-git\.ai-bridge\DEPLOY_STAGING.cmd
```

The helper must verify the exact latest `origin/staging`, expected staging Cloudflare account/Worker/D1/R2, and dry-run before deploying. Deploy mode also applies pending D1 migrations before Worker deployment; check-only mode reports migration state without mutating D1.

`.ai-bridge/` is local operational state and is not the portable source of truth. If the helper is missing on another machine, reproduce the same fail-closed checks rather than weakening the SOP.

## 10. Preview / experimental deployment exception

A task branch may be deployed before `origin/staging` only when all of these are true:

- the purpose is explicitly experimental,
- the runtime is separately named preview/temporary infrastructure,
- it cannot be confused with the Master staging Worker,
- the report explicitly says the code is **not in `origin/staging`**.

Never use this exception silently.

## 11. Production promotion workflow

Production order is:

```text
staging accepted by Master
→ refresh upstream/main
→ prepare/rebase/cherry-pick clean owner PR as appropriate
→ PR from user fork to owner main
→ owner merge
→ record exact merged owner-main SHA
→ deploy that exact SHA to production Worker
→ verify production
→ sync origin/main
```

Do not deploy production from:

- a task branch,
- `origin/staging`,
- an unmerged PR head,
- a dirty worktree.

Production should normally run an exact commit already present in owner main.

### One-click production shortcut on the primary machine

For routine Workshop production deployment after staging acceptance and owner-main promotion, use:

```text
C:\Project\myrepo-git\.ai-bridge\CHECK_PRODUCTION.cmd
C:\Project\myrepo-git\.ai-bridge\DEPLOY_PRODUCTION.cmd
```

These shortcuts wrap the same composable deploy engine. The default production source is refreshed `upstream/main`. When an explicitly authorized release exception is active, the same helper can select an owner `release/*` branch or owner release tag without creating another deploy script:

```text
DEPLOY_PRODUCTION.cmd -ReleaseBranch release/2.0.15
DEPLOY_PRODUCTION.cmd -ReleaseTag 2.0.15
```

The production profile accepts only source selectors allowed by policy (currently `upstream/main`, `upstream/release/*`, or an owner semver release tag). The engine fetches and resolves that exact source, temporarily locks the checkout to the exact commit, verifies the expected production Cloudflare account/Worker/D1/KV/R2, checks/applies migrations, performs a Wrangler dry-run, deploys only after all checks pass, and restores the original checkout afterward. `CHECK_PRODUCTION.cmd` performs the same preflight without applying migrations or deploying.

Do not substitute a staging profile/account for production, and do not bypass the helper with ad-hoc Wrangler/PowerShell/Bash commands merely because a profile or preflight check fails.

### Emergency production exception

Do not deploy a dirty/unmerged build unless Master explicitly requests an emergency exception.

If an emergency deploy occurs, the task remains unreconciled until the exact deployed code is:

- committed,
- preserved in the user fork,
- reconciled into owner main,
- mapped back to a known production deployment.

## 12. Safe commits in a dirty workspace

Use explicit paths:

```powershell
git add path/to/file1 path/to/file2
git diff --cached
git commit -m "..."
```

Do not use:

```powershell
git add .
```

unless the entire working tree has intentionally been reviewed as one task.

Unrelated local edits must remain unstaged and untouched.

## 13. Push safety

Before any push:

1. verify actual remote URL,
2. verify exact source commit/branch,
3. verify destination branch,
4. verify no unrelated files are included,
5. never force-push `origin/main` or `upstream/main`.

For `push staging`, say explicitly:

```text
Pushing <old-sha> → <new-sha> to uikawinwing/myrepo:staging
```

If rejected as non-fast-forward, inspect remote tip and ancestry first. Never guess who changed the branch and never force merely to bypass the rejection.

## 14. Old branch cleanup SOP

Classify every old branch against refreshed `upstream/main` and, where relevant, `origin/staging`.

### A. Required changes already in owner main

Safe to delete after verification.

### B. Required changes preserved in `origin/staging`, awaiting promotion

May be deleted if the needed commits are safely represented in `origin/staging` and no unique local-only work remains.

### C. Still-needed unique work

Move only the needed commits into a clean task/staging line. Do not preserve an obsolete branch merely as an archive.

### D. Conflicts with current owner main

Do not merge the whole old branch just to clean it. Inspect unique commits and cherry-pick/recreate only the needed work.

### E. Obsolete test/recovery branch

Record that the unique work is obsolete, then delete it.

## 15. Branch lifetime policy

Long-lived:

- `upstream/main`,
- `origin/main`,
- `origin/staging` while the real staging environment is actively used.

Temporary:

- `feature/*`,
- `fix/*`,
- `hotfix-*`,
- `release-*`,
- `cw-test-*`,
- `cw-staging-*`,
- `recovery-*`.

Temporary branches are workspaces, not archives.

## 16. Cloudflare / Discord production checklist

Before production deploy:

- exact owner-main commit known,
- owner main contains intended change,
- staging acceptance already completed unless explicitly waived,
- tests green,
- production Cloudflare account/profile verified,
- Worker and bindings verified,
- D1 migration order correct; the primary-machine production helper must inspect/apply pending migrations before Worker deployment,
- production Discord/OAuth environment verified when relevant,
- no production credential/binding is inferred from the user fork.

After deploy:

- verify Worker deployment success,
- verify critical endpoint/UI behavior,
- record Worker/version information,
- record exact Git commit deployed,
- confirm owner main contains that commit,
- sync fork main afterward.

## 17. Required status reporting template

For staging work, report this format:

```text
Local
worktree/branch = ...
local HEAD = ...

Git
origin/staging = ...
task branch = ... (if relevant)
owner main = ... / unchanged

Cloudflare staging
staging Worker = ...
deployed Git SHA = ...
Worker Version = ...
staging site verification = passed/failed/not-yet-run

Production
owner main contains change = yes/no
production deployed = yes/no
```

For production work add the exact production Worker version/deployment identity.

Never let the phrase "staging done" substitute for this separation.

## 18. Default principle

Use the user fork for development, `origin/staging` as the Master acceptance integration branch, and owner main as the production source of truth.

The normal chain is:

```text
task branch
→ origin/staging
→ staging Worker
→ Master acceptance
→ owner main
→ production Worker
```

Git state and runtime state must always be verified and reported separately.
