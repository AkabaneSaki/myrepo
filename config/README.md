# Workshop configuration

`config/workshop.json` is the single source of truth for operator-managed Workshop release values.

Managed here:

- `client.stable`
- `client.minimum`
- `client.staging`
- `client.publicPath`
- `client.stagingPublicPath`
- `client.legacyShimPath`
- `client.migrations`
- production/staging Worker endpoints and staging aliases
- companion-script release registry
- release repository/CDN metadata

## Compatibility path

`client.legacyShimPath` is a historical public compatibility endpoint. Its physical directory name may be `test-dist`, but it is not a test distribution.

It must contain only the small migration shim that rewrites an affected TavernHelper script to `client.publicPath`.

Do not delete or repurpose this endpoint while real historical installs still depend on it.

## Do not duplicate live values

UI code, build scripts, QA scripts, docs and deployment logic should read the manifest rather than copying current version numbers, endpoints, bundle paths or companion-script versions.

Normal implementation constants that are not operator-managed release values should stay close to the code that owns them. Do not turn this manifest into a dump of every constant in the repository.
