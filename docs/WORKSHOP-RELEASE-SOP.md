# Creative Workshop Release SOP

This document defines client-artifact release behavior. Git branch routing is defined in `AGENTS.md` and `docs/GIT-WORKFLOW.md`.

## Three artifact lifecycles

Creative Workshop has three distinct client artifact lifecycles. Do not merge them into one release command.

### Stable distribution

- Manifest: `client.stable`
- Canonical path: `client.publicPath`
- Endpoint role: current released Creative Workshop client
- Build: `pnpm build:stable`

### Historical public compatibility endpoint

- Manifest: `client.legacyShimPath`
- Physical path may still contain the historical name `test-dist`, but its role is **not testing**.
- It exists because real users previously received that public import path.
- It must contain only the small self-rewrite compatibility shim.
- It must never contain a second full Workshop bundle or a staging bundle.
- Build: `pnpm build:compat`
- Acceptance: `pnpm check:workshop-compat`

### Staging distribution

- Manifest: `client.staging`
- Path: `client.stagingPublicPath`
- Endpoint role: future feature-line client used with the staging Worker
- Build: `pnpm build:staging`

## Build commands

```text
pnpm build:release
= build:stable + build:compat

pnpm build:staging
= staging only

pnpm build:all
= release artifacts + staging artifact
```

A production release must not require building the future staging artifact. CI may use `build:all` to validate all artifact lifecycles together.

Webpack requires an explicit target. Do not invoke it without `--env target=stable` or `--env target=staging`.

## Version policy

Live values come only from `config/workshop.json`:

- `client.stable`: newest released client
- `client.minimum`: oldest client allowed to enter the Workshop
- `client.staging`: active future/staging client

Before changing client SemVer, ask:

> Does a SillyTavern user need to change the `@version` in their Creative Workshop import to receive this change?

If no, do not bump client SemVer. Track Worker/web/backend deployment by exact Git SHA and Worker Version ID.

A new stable release does not automatically raise `client.minimum`.

## Git routing

Normal development:

```text
origin/staging → task branch → origin/staging → acceptance → upstream/main → production
```

Production hotfix / patch release:

```text
upstream/main / exact production source → hotfix branch → upstream/main → production
```

Never implement a production hotfix on staging first and backport it into production.

After production is complete, forward-port the finished logical fix into `origin/staging` only if the future line still needs it. That synchronization is separate from the hotfix direction.

## Release acceptance

Before publishing a client release:

1. Run `pnpm check:workshop-config`.
2. Run `pnpm build:release`.
3. Run `pnpm check:workshop-release`.
4. Verify the canonical `dist` client contains the intended stable client version and production endpoint.
5. Verify the historical compatibility endpoint self-rewrites its own TavernHelper import to the canonical `dist` path.
6. Verify the compatibility directory contains only the one shim.
7. Merge the release into owner main.
8. Create an immutable release tag at the exact accepted owner-main release commit.
9. Use the guarded production deployment helper for Worker deployment.
10. Record client tag separately from Worker Git SHA / Worker Version ID.

Historical tags are immutable.
