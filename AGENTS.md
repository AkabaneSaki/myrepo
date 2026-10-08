# Repository Agent Bootstrap

This file is intentionally minimal.

It is not the repository's full operating policy and must not duplicate Git, release, deployment, cleanup, UX, or project-specific rules.

## Canonical documentation

The single shared documentation source is:

`origin/documentation:docs/`

The documentation catalogue is:

`origin/documentation:docs/INDEX.md`

The normative repository operating policy is:

`origin/documentation:docs/AGENT-POLICY.md`

Ordinary code/task branches must not maintain their own shared `docs/` copy.

## Required bootstrap

Before repository mutation, deployment/release decisions, branch/worktree cleanup, or other project-level decisions:

1. Verify the actual remotes:
   - `origin` → `https://github.com/uikawinwing/myrepo.git`
   - `upstream` → `https://github.com/AkabaneSaki/myrepo.git`
2. Refresh the documentation ref:
   `git fetch origin documentation:refs/remotes/origin/documentation`
3. Read:
   `git show origin/documentation:docs/INDEX.md`
4. Read:
   `git show origin/documentation:docs/AGENT-POLICY.md`
5. Read any additional document selected by the canonical index for the task.

If canonical documentation cannot be refreshed/read, stop before destructive repository mutation, deployment, release, or cleanup. Do not silently fall back to stale policy copied from an old worktree or chat.

## Canonical Git refs

- Code baseline for all new features, fixes and hotfixes: refreshed `upstream/main` exact SHA
- Master Staging: a Cloudflare candidate runtime, not a Git integration line
- Historical `origin/staging`: frozen/retired, preserved for audit only (#46)
- Shared documentation source of truth: `origin/documentation`

Local branches named `main` or `staging` are not authoritative and may not exist.

Never use the current workspace HEAD, a local mirror branch, or `mergedIntoWorkspaceHead` as a substitute for the explicit canonical ref when deciding whether work is current, merged, deployable, or safe to delete.

## Worktrees

Development happens on short-lived code task branches/worktrees from exact `upstream/main`; documentation edits use `origin/documentation`.

Prefer direct sibling worktrees beside the primary checkout. Do not create long-lived nested task worktrees.

The primary checkout may use a management-only branch such as `workspace/control`. It is not an integration baseline or deployment source.

## Shared documentation changes

Do not edit shared docs in a code feature/fix/refactor/hotfix branch.

Documentation changes must start from refreshed `origin/documentation`, use a short-lived docs task branch/worktree, and integrate back into `origin/documentation`.

Plans/reports should state the related GitHub issue(s), or explicitly explain why there is no issue.

## Policy changes

Change normative operating rules only in:

`origin/documentation:docs/AGENT-POLICY.md`

Do not recreate duplicate policy in root/nested `AGENTS.md`, README files, task notes, or code branches.

The goal is one documentation source, not synchronized copies.
