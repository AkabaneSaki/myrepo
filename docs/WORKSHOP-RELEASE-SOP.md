# Creative Workshop Client Release SOP

Creative Workshop has two independent version identities:

1. **SillyTavern client version** — the version embedded in the TavernHelper/Creative Workshop client script.
2. **Worker/web build identity** — exact Git SHA + Cloudflare Worker Version ID.

Do not use client SemVer to identify Worker/web-only changes.

## The deciding question

Before changing any Creative Workshop client version, ask:

> Does this change require a SillyTavern user to change the `@version` in their Creative Workshop import in order to receive the fix/feature?

- **No** → do **not** change client SemVer.
  - Examples: Worker logic, web UI, copy, CSS, ranking, admin UI, D1/R2/backend logic, server-side validation.
  - Track the release by Git SHA and Worker Version ID.
- **Yes** → a client release is required.
  - Bugfix to the client artifact → patch.
  - New backwards-compatible client capability → minor.
  - Incompatible client/bridge contract → major.

## Single source of truth

All current client release values live only in `config/workshop.json`:

- `client.stable`
- `client.staging`
- `client.publicPath`
- `client.stagingPublicPath`
- `client.migrations`

Code, UI, build scripts and tests must reference that manifest; they must not repeat current version numbers or public bundle paths.

### Meaning

- `stable`: newest released client tag required by production.
- `staging`: active staging-client build line.

Use the exact current client version for the selected site: `stable` for production, `staging` for the staging site and its aliases. Other or unknown versions must update before DLC operations. The update notice and the bridge operation check use the same version rule; dismissing the notice does not allow an old client to proceed. There is no separate minimum version.

## Branch source rule

Release identity and branch base are separate decisions:

- normal staging feature/fix work starts from freshly fetched `origin/staging`;
- production hotfix/release work starts from the exact current production baseline (`upstream/main` / owner release line);
- never start a normal staging feature from owner production merely because it may later be promoted upstream.

## Server-only release

```text
change Worker/web code on a task branch based on origin/staging
→ tests
→ origin/staging
→ staging Worker exact SHA
→ acceptance
→ owner PR/main
→ production Worker exact SHA
→ report Git SHA + Worker Version
→ client version unchanged
```

## Client release

```text
client-side change on the active staging line requires new import @version
→ start from refreshed origin/staging
→ update config/workshop.json once
→ run pnpm check:workshop-config
→ build both client bundles
→ verify bundle-reported versions
→ staging validation
→ owner PR/main
→ create immutable release tag
→ deploy production Worker if needed
→ verify stable/staging values and exact-client enforcement from manifest
```

### Legacy import-path migration

When a released client moves its public bundle path, keep the real client bundle only at `client.publicPath`. If backward compatibility is needed, `client.legacyShimPath` may contain one small self-rewrite migration shim generated from the manifest. It is not a second Workshop distribution. The shim must update the current TavernHelper script in place and must not duplicate the full client bundle.

## Mandatory reporting

Every release/status report must state these separately:

```text
Client stable: x.y.z
Client staging: x.y.z-dev
Git source: <sha>
Worker Version: <cloudflare-version-id>
```

Never say only “version updated” or “staging updated”.
