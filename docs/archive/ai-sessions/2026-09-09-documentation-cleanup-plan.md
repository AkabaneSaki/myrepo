> Historical AI-session record. This describes the state seen by that session and is not current project truth.

# Creative Workshop — Current Plan

Updated: **2026-09-09**

This file is short-lived AI handover state only. Long-lived project truth belongs under `docs/`.

## Current workspace

```text
branch = hotfix/2.0.15-worldbook-duplicate
HEAD   = f966717183bea7fca06ab261174e8a6e86199cf6
```

Unrelated local untracked cache-check directories exist under `cloudflare/`; leave them untouched unless the cache investigation explicitly resumes.

Always re-run Git status before using the branch / SHA above. This file is not a substitute for live repository inspection.

## Current task

Organize and reduce Poem Workshop documentation before continuing the UI reconstruction.

Completed in this documentation pass:

- created `docs/README.md` as the long-lived documentation entry point;
- classified `.ai-bridge/` as temporary Cotel / ChatGPT working state, not product truth;
- copied the cover-image delivery plan into `docs/plans/cover-image-delivery.md` and marked it `needs-revalidation`;
- reduced the old `cloudflare/doc/cover-image-delivery-plan.md` location to a compatibility pointer;
- archived the 2026-09-05 Creator capability audit as `docs/archive/2026-09-05-creator-capability-audit.md` because later P2 work changed several findings;
- reduced the old audit path to a compatibility pointer;
- replaced the generic chanfana `cloudflare/README.md` with a Poem Workshop-specific backend entry page;
- added `.ai-bridge/README.md` explaining what belongs in the local bridge workspace.

## Long-lived docs after cleanup

```text
docs/README.md                              documentation index
docs/GIT-WORKFLOW.md                        active Git/staging/release SOP
docs/plans/workshop-persistent-session.md   planned, not implemented
docs/plans/cover-image-delivery.md           needs revalidation
docs/archive/*                               historical evidence only
```

## UI reconstruction continuity

The latest UI design handover remains in `context-handover.md` and the isolated preview implementation remains under `.ai-bridge/parchment-preview/`.

Key direction already established:

- quiet creator-first Workshop visual system;
- graphite / warm-neutral surfaces instead of blue SaaS dashboard styling;
- homepage cards hide vanity stats and heavy admin actions;
- mobile uses thumb-zone search/filter/sort;
- desktop should use its horizontal space instead of rendering as a centered phone shell;
- prototype is reference material, not a second production frontend.

## Next action

1. Review the documentation diff and ensure no useful long-term information was lost.
2. Do not commit documentation cleanup into the active hotfix branch unless deliberately separated later.
3. Return to the Workshop design reconstruction: inspect real staging/DOM when Browser Bridge is available, then define the shared design tokens + desktop/mobile shell before migrating individual pages.
