# Worker deployment helper source (#46)

Status: **candidate implementation, not activated**.

These files are the reviewed source for the machine-owned deployment helper. The production/staging Cloudflare accounts, Wrangler configurations, API token paths, locks, and logs remain **machine-local** under `.cotel/local/one-click-deploy/`. Do not commit or copy those profiles into this directory.

Do **not** run the scripts directly from `scripts/deployment/`: their relative-path assumptions are for the installed helper layout. Deployment is not enabled by merely merging this directory.

## Candidate staging flow (after controlled local installation)

1. Use an isolated task branch based on the refreshed `upstream/main`. Push that branch to `origin`.
2. Resolve its full 40-character commit SHA and pass both `-SourceBranch` and `-SourceSha` to the installed `deploy-staging.ps1`.
3. The helper fetches the named `origin` branch, validates the full SHA pin and that the commit descends from latest `upstream/main`, validates existing profile allowlist/target/account/bindings, runs D1 cost gate and Wrangler dry-run, and restores the original checkout.
4. First run `-CheckOnly`; only explicitly invoke actual staging deployment after reviewing the result.
5. Shared Staging testing and production promotion stay serialized. Cloudflare Staging remains a runtime environment, not a long-lived future-release integration baseline.

The old `origin/staging` route remains available for migration only; after #46 closeout it must be retired deliberately, not deleted/reset prematurely.

## Activation prerequisites

- Test the tracked source with `pwsh -NoProfile -File scripts/deployment/tests/test-deploy-worker.ps1`; all mock tests must pass without any real Cloudflare calls.
- Install the verified helper files using a **separate, lock-aware machine-local rollout** with backups and the existing target/source locks. Do not overwrite a running helper. This source branch does not implement automatic installation.
- Update only the `source.allowed` list of the **machine-owned staging profile** with the anchored candidate branch pattern from `staging-source-policy.example.json`; preserve every other profile field, especially account, Worker, D1, R2, and auth.
- Re-run installed-helper tests; verify the real machine-specific production/staging profile assertions (the portable source test intentionally skips those).
- Pilot a previously unshipped, backward-compatible Worker/Web issue in staging. Do not use already-deployed #44.
- After the pilot succeeds, update the normative SOP exclusively in `origin/documentation:docs/AGENT-POLICY.md` and its linked guides. This README is tooling documentation, not an independent operating policy.

## Safety boundary

The prototype rejects an unpinned task branch, moved SHA, stale/diverged production base, non-allowlisted branch, or a pinned candidate aimed at production. A full SHA pin is *not* a bypass for release acceptance, D1 migration review, rollback planning, or the target-specific safeguards.

Related migration tracker: https://github.com/uikawinwing/myrepo/issues/46
