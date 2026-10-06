# Configuration sources of truth

This directory contains cross-runtime product configuration that must be shared by the SillyTavern client bundle and the Workshop Worker.

## `workshop.json`

This is the single source of truth for:

- `client.stable`: latest released Creative Workshop client tag users may install.
- `client.minimum`: oldest Creative Workshop client still allowed to use the Workshop.
- `client.staging`: active staging-client version.
- `client.publicPath`: stable client bundle path.
- `client.stagingPublicPath`: staging client bundle path.
- `client.migrations`: one-time client import-path migrations shown to affected old clients.
- production/staging Workshop endpoints and staging aliases.
- known companion-script dependency display names and latest versions.

Do not duplicate these values in UI, client, Worker, tests, release docs, or deployment scripts. Import/read this manifest instead.

## What does not belong here

Do not turn every implementation constant into global config.

Server-only domain configuration already has its own single source:
- project taxonomy: `cloudflare/src/config/project-taxonomy.ts`
- project content policy: `cloudflare/src/config/project-content-policy.ts`
- discovery/ranking parameters: `cloudflare/src/utils/project-ranking.ts`
- upload/request/banner limits: `cloudflare/src/config/runtime-limits.ts`
- DLC/project semantic-version helpers and initial machine version: `cloudflare/src/utils/version.js`

Implementation constants such as polling intervals, DOM storage keys, protocol namespaces, cache TTLs, and UI timing values stay near the code unless they are duplicated or become operator-tuned settings.

See `docs/CONFIG-HARDCODE-AUDIT.md` for the latest duplication audit and the rule for deciding whether a literal belongs in configuration.
