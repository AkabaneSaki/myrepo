# Creative Workshop Persistent Session Plan

Status: **design complete, not implemented**  
Last reviewed: 2026-09-29

## Purpose

Keep one Workshop iframe/session alive when the user closes the Workshop, so reopening is instant and does not repeat `/api/auth/me`, `/api/projects`, bridge setup, image loads, and local UI reconstruction every time.

This is a lifecycle/performance feature, not a backend cache rewrite.

## Approved behavior contract

```text
First open
→ create one Workshop iframe/session
→ normal init

Close / X
→ fake close only
→ hide overlay/iframe
→ keep iframe, bridge, child JS state and UI state alive
→ detach outer ST viewport listeners
→ start hidden-idle cleanup timer

Reopen within 60 minutes
→ cancel idle timer
→ show same iframe/session
→ reattach viewport listeners once
→ run one layout update
→ do not rerun Workshop init
→ expected new /api/projects request count: 0

Manual reload / ↻
→ reload/navigate existing Workshop iframe
→ reset child UI/runtime
→ Discord login localStorage survives
→ fresh /api/auth/me + /api/projects expected
→ keep ST-side install/diff caches

Hidden continuously for ~60 minutes
→ hard destroy iframe/session
→ bridge.destroy()
→ remove overlay/style/listeners/timer
→ release RAM

Visible session
→ never auto-destroy merely because one hour elapsed

ST page unload/pagehide
→ hard destroy if session exists
```

No separate Terminate button is required. The chosen UX is **fake close + reload**, with hidden-idle cleanup as the memory safety net.

## Cache/lifecycle distinction

Two layers must not be confused.

### Child Workshop iframe state

Includes project list/UI state, filters/sort/search, modal state, loaded images and child-page detail cache.

- fake close preserves it;
- manual iframe reload recreates it.

### ST-side service caches

Current services include project/detail/worldbook/diff caches outside the child iframe. These survive iframe reload and should **not** be cleared by ordinary `↻` reload.

The main read saving comes from not rerunning the child `init()` at all on fake close/reopen.

## Recommended implementation shape

Primary implementation file:

```text
src/CreativeWorkshop/index.ts
```

Move from a disposable local overlay to one module-level session object, conceptually:

```text
WORKSHOP_IDLE_DESTROY_MS = 60 * 60 * 1000
workshopSession = null | active session
```

Useful lifecycle helpers:

```text
createWorkshopSession()
showWorkshopSession()
hideWorkshopSession()
reloadWorkshopSession()
destroyWorkshopSession()
bindWorkshopViewportListeners()
unbindWorkshopViewportListeners()
scheduleWorkshopIdleDestroy()
cancelWorkshopIdleDestroy()
```

Important rules:

1. Never allow two Workshop iframes at once.
2. Fake hide must not destroy bridge, remove iframe, or remove teleported styles.
3. Reopen must rebind host listeners exactly once.
4. Hidden cleanup uses one `setTimeout`, not a recurring interval.
5. Old timers must not destroy a newer session.
6. Hard destroy must be idempotent and end with `workshopSession = null`.
7. Backdrop/embedded close should fake-hide.
8. `pagehide` should hard-destroy.
9. If an orphan overlay exists from an older script runtime, remove it rather than trying to adopt it without the original bridge/timer closures.

## Manual reload

Preferred first attempt:

```text
iframe.contentWindow?.location.replace(getCreativeWorkshopUrl())
```

If a browser/WebView rejects the cross-origin navigation, fallback may hard-destroy and immediately create a fresh session. Do not leave a dead iframe.

Reload semantics:

```text
YES reset child iframe runtime/UI
YES refetch child auth/project list
YES keep Discord login localStorage
YES keep ST-side service caches
NO do not clear browser HTTP cache
NO do not reload the whole SillyTavern page
```

## Related files to re-check before implementation

Likely implementation touch points:

```text
src/CreativeWorkshop/index.ts
cloudflare/src/pages/home/render/layout.ts
cloudflare/src/pages/home/styles.ts
```

Normally read/verify first, not automatically edit:

```text
src/CreativeWorkshop/bridge/host.ts
src/CreativeWorkshop/bridge/protocol.ts
cloudflare/src/pages/home/app/bootstrap.ts
cloudflare/src/pages/home/app/actions.ts
cloudflare/src/pages/home/tavern-bridge.ts
cloudflare/src/pages/home/api.ts
src/CreativeWorkshop/services/project-fetch.ts
src/CreativeWorkshop/services/diff.ts
util/script.ts
src/CreativeWorkshop/staging.ts
```

No D1 migration or backend endpoint is expected solely for this lifecycle feature.

## Mobile/UI warning

The old planning document contained concrete button placement based on the previous mobile UI. **That placement is no longer authoritative.** The current mobile Workshop now uses the bottom tool dock plus account/tool sheets, so any persistent-session close/reload controls must fit that information architecture instead of reviving the old header/button layout.

Preserve only the behavior contract here:

- user must have a clear fake-close action;
- user must have a clear reload action;
- controls should not be easy to mis-tap;
- final placement/styling must be reconciled with the new mobile design before implementation.

Historical reference only: the old dirty release worktree contained an uncommitted mobile close-button tweak that moved the control slightly off the left edge and made it a larger half-pill (`safe-area-left - 10px`, `min-height 40px`, asymmetric padding, left-open pill radius, opacity ~0.78). The intent was to reduce card obstruction and accidental taps. Those exact values are **not** current requirements; use them only as evidence of the prior UX intent when evaluating the new mobile design.

The same old diff also contained unfinished `mobileExitArmed` state/timer code. That code was never wired into the click flow and should be treated as dead experimental state, not something to preserve.

Do not revive old exact pixel/button-location instructions just because they existed in the historical plan.

## Performance constraints

Keeping one hidden iframe is expected to cost retained RAM, not continuous D1 activity. Do not add permanent polling or recurring intervals for this feature.

While hidden, detach outer host resize/scroll/visualViewport listeners so the hidden overlay does not keep doing layout work.

## Edge cases

Test at minimum:

- hide with search/filter/sort/scroll/modal state open;
- hide during install/update/diff;
- hide during OAuth;
- manual reload and bridge reconnect;
- 10+ open/close cycles without duplicate iframe/listeners/styles;
- hidden idle hard destroy;
- reopen after idle destroy;
- desktop + mobile final control placement against the current bottom-dock / tool-sheet UI.

## Validation

Minimum static/build checks when implemented:

```text
repo root: pnpm run build
cloudflare: npm run check:types
cloudflare: npm run check:home-js-smoke
```

Manual proof should confirm:

```text
fake close/reopen preserves child state
fake close/reopen adds 0 new /api/auth/me requests
fake close/reopen adds 0 new /api/projects requests
exactly one overlay/iframe exists after repeated cycles
manual reload does trigger fresh child init
idle hard destroy releases/removes the session
```

For idle testing, a temporary short timeout may be used locally/staging, but restore the production 60-minute value before commit.

## Implementation prerequisite

Before coding this plan:

1. work from the current primary repo state, not the old dirty release branch;
2. inspect current `src/CreativeWorkshop/index.ts` and new mobile UI first;
3. refresh owner main and follow the current staging SOP;
4. keep this as a focused lifecycle change rather than mixing it with broader frontend redesign.
