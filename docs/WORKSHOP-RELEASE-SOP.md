# Creative Workshop Release SOP

Creative Workshop uses one user-facing version line and two Worker environments.

- **SillyTavern client tag** is the version users import. The current value is always read from `config/workshop.json`.
- **Worker** has only two runtime environments: **staging** and **production**.
- Do not invent or maintain a Worker SemVer. A Worker deployment is simply the current state of that environment.
- Exact Git SHA or Cloudflare deployment identity may still be used internally for deployment verification and rollback, but it is not a product version and does not drive client tagging.

## Core release model

The production client tag is the current support baseline.

The staging client line is the next planned feature release.

Model:

```text
production client = client.stable
staging client    = client.staging
```

The staging line therefore releases the base SemVer of `client.staging`. When the accepted staging feature line is promoted to production, release and tag that planned base version.

Do **not** re-audit the entire staging release at the end and ask whether enough SillyTavern-side code changed to "deserve" the tag. The release boundary was already chosen when the staging feature line was opened. The tag moves with the planned production release so users, support, and the deployed feature set share one clear baseline.

## Production bug / hotfix flow

A bug reported against the live Workshop is a production-line bug until proven otherwise.

Before investigating an old-client report, first reproduce on the latest production client tag. If the bug is already fixed on the latest tag, direct the user to update before further triage.

Then split the fix by where it lives.

### Worker/web-only hotfix

Examples include Worker routes, web UI, CSS, copy, ranking, admin UI, D1/R2 logic, backend validation, or other code that does not require a new SillyTavern client artifact.

```text
production bug
→ fix from the exact production source
→ test
→ deploy production Worker
→ do not create a client tag
→ record the bug/fix
→ forward-port the logical fix into origin/staging
→ staging continues toward its planned next release
```

A Worker-only production hotfix does not consume any client patch version.

### SillyTavern client hotfix

If the production fix changes the SillyTavern client and users need a new imported client to receive the fix, release a patch on the current production line.

Model:

```text
production client = client.stable
ST-side production bug
→ fix production client
→ release/tag next patch of client.stable
→ latest supported production client becomes that patch
→ deploy production Worker too if the fix requires Worker changes
→ forward-port the logical fix into origin/staging
→ planned next release must contain the same fix
```

Production hotfix tags are immutable. Do not overwrite an existing release tag.

## Planned staging → production release

Feature work accumulates on the staging line and is validated against the staging Worker.

Model:

```text
production client = client.stable
staging client    = client.staging

feature/fix work
→ origin/staging
→ staging Worker
→ staging validation
→ repeat until accepted
→ owner production integration
→ production Worker
→ build/release base SemVer of client.staging
→ create immutable tag for that release
→ production support baseline moves to that tag
```

The final planned tag is required for the release even if some or most changes in that staging cycle happened to be Worker/web-only.

That rule is deliberate: the tag is not merely a diff counter for the client bundle. It is also the supported client baseline for that production release. This prevents users from staying on much older imports and reporting bugs that have already been fixed in newer releases.

After the planned release is shipped, `client.staging` may advance to the next planned feature line.

## Hotfix while a newer feature line is in staging

Keep production and staging source lines separate.

Model:

```text
production = client.stable
staging    = future release represented by client.staging
```

If production gets a Worker-only hotfix, production receives the Worker fix and staging receives the forward-port. `client.stable` and `client.staging` do not change.

If production gets an ST client hotfix, `client.stable` moves to the next patch. Staging remains the planned future release, but the same logical fix must be included there before release.

Never merge the old production hotfix branch wholesale into staging just to synchronize it. Forward-port or recreate the required fix against current staging when necessary.

## Client version source of truth

Current client release values live in `config/workshop.json`.

Relevant fields are:

- `client.stable` — latest released production client tag and current production support baseline.
- `client.staging` — active staging client build line for the next planned release.
- `client.publicPath` — production client bundle path.
- `client.stagingPublicPath` — staging client bundle path.
- `client.migrations` — explicit historical client/import migrations.

Code, UI, tests, and build scripts must read these values instead of duplicating live version numbers.

There is no general-purpose `minimum supported version` in the release model. Historical migrations may have a `beforeVersion` cutoff for that specific migration, but that must not be interpreted as the normal production support baseline.

## Support policy

For normal bug support:

1. Check which client tag the reporter is using.
2. If it is older than the current production `client.stable`, update to the latest production tag first.
3. Reproduce the bug on the latest client against the production Worker.
4. If the problem exists only on the old tag and is already fixed on the current tag, treat it as an outdated-client report rather than a new production bug.
5. If the problem still reproduces on the latest tag, triage it as a real production bug and follow the hotfix flow above.

Old immutable tags remain useful as release history and rollback artifacts; they are not the default support baseline forever.

## Worker environments

Treat the Worker model as:

```text
staging Worker
production Worker
```

That is all the version model needs.

Do not label Workers with client SemVer values. Those numbers belong to the client import/release line.

For operational safety, deployment tooling may record the exact source Git SHA or Cloudflare deployment identity. This is verification metadata only; Master does not need a separate Worker version number for release management.

## Release checklist

### Production Worker-only hotfix

```text
[ ] start from exact production source
[ ] fix and test
[ ] deploy production Worker
[ ] no client tag
[ ] record the bug/fix
[ ] forward-port into origin/staging
[ ] verify staging still contains the fix
```

### Production ST client hotfix

```text
[ ] start from exact production source
[ ] fix and test Worker/client as applicable
[ ] bump production patch client version
[ ] build and verify the production client bundle
[ ] create immutable patch tag
[ ] deploy production Worker if needed
[ ] forward-port the fix into origin/staging
[ ] verify the future staging release contains the fix
```

### Planned staging feature release

```text
[ ] staging target version was chosen in advance
[ ] all accepted staging fixes/features are integrated
[ ] production hotfixes were forward-ported
[ ] staging Worker/site validation passed
[ ] build final production client for the planned version
[ ] promote accepted code to production
[ ] deploy production Worker
[ ] create immutable final client tag
[ ] update client.stable to the released tag
[ ] move client.staging to the next planned development line
```

## Status reporting

Do not report a separate Worker SemVer.

Use a compact release status such as:

```text
Production client: <client.stable>
Staging target: <base SemVer of client.staging>
Staging Worker: deployed / not deployed
Production Worker: deployed / unchanged
Git source: <sha when relevant>
```

Never use a single ambiguous phrase such as "Workshop version updated" when it is unclear whether the statement refers to the client tag or a Worker deployment.
