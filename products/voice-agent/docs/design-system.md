# Pi Voice MCP App design system

**Contract:** `apps/client/design_system/tokens.json` is the versioned source of truth for shared geometry and style (currently **1.2.0**); `apps/client/design_system/icons.json` is the source of truth for shared Material icon names and codepoints. `node apps/client/tool/generate-design-tokens.mjs` deterministically emits `design_system/tokens.css`, `lib/design_tokens.dart`, `design_system/icons.css`, and `lib/design_icons.dart`; never hand-edit those outputs. `design_system/elements.css` is the small, hand-maintained web UX interface built on those tokens. A token or icon change is a contract change: update the source JSON, regenerate, update this guide/specimen, and migrate consumers deliberately. Semantic names, not raw codepoints or colors, are the stable interface.

## Architecture and boundaries

The Flutter host is a native Flutter UI, not React. First-party opaque-origin MCP App iframes are Mermaid, Marp, Journal Review (plain DOM plus Recogito), and Trace Explainer (plain DOM). Journal Review and Trace Explainer are also packaged by their respective MCP TypeScript services. Excalidraw is the separately built, vendor `vendor/excalidraw-mcp` React integration. Grafana's trace app and Recogito are vendor/official integrations; do not bulk-restyle them. There is no Vue app on this path.

The host passes its MCP `hostContext.theme` and puts the selected theme in the first-party iframe URL for the first paint. Each iframe embeds its own generated tokens, UX elements, and Source Code Pro WOFF2 data, so no parent CSS, CDN, same-origin permission, credential, tool, or task-action access is needed. The app CSPs allow only hashed scripts and local data fonts. CSS only paints; it does not enlarge the existing sandbox (`allow-scripts`) or bridge allowlist. The CSS also has a system-preference fallback for standalone specimens. `design_system/mcp-app-runtime.js` applies the authoritative theme after the MCP handshake and on later host-context notifications. The current host sets theme at mount time; it does not yet expose a live theme switch.

## Microfrontend contract

Each first-party MCP App is a separately rendered View behind the host's `ui://` resource registry. The host owns the sandbox, display mode, capability allowlist, and initial context. The View owns its rendering, state, and tool-result handling. Views do not read the host DOM or share a live CSS runtime. This follows the [MCP Apps host/View model](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/overview.md) and its [host-context change pattern](https://github.com/modelcontextprotocol/ext-apps/blob/main/docs/patterns.md).

| Module | Owner | Interface |
|---|---|---|
| Host bridge | `bridge/voice_bridge.js` | `ui://` registration, sandboxed iframe, MCP handshake, bounded host capabilities |
| Design system | `design_system/tokens.json`, `icons.json`, `elements.css`, fonts | Versioned semantic tokens, icon names/codepoints, and CSS class contract, bundled into each View |
| Runtime adapter | `design_system/mcp-app-runtime.js` | One connection call; initial and updated host theme |
| Build module | `tool/mcp-app-html.mjs` | One self-contained HTML artifact with inlined JS/CSS/font and matching CSP hashes |
| Individual View | `bridge/*_app.js` and app template | Validate input, render app-specific content, handle tool events and teardown |

Build-time sharing keeps each View deployable as a self-contained resource. A new first-party View imports `elements.css`, calls `connectFirstPartyMcpApp` after registering its handlers, uses `buildMcpAppHtml` for packaging, and registers its `ui://` resource in the host. Keep app-specific layouts and tool permissions local to that View. Vendor Views are integrated through the host registry without rewriting their internals.

## Typeface

Source Code Pro is the first-party UI typeface. The repository bundles Adobe's release-branch fonts at commit `803b7e23ec97ae58b6232ea76519a76d428ba268`: variable upright and italic WOFF2 for MCP App iframes, and regular/semibold TTF for Flutter web and native builds. The files, provenance, and full SIL Open Font License 1.1 are under `apps/client/design_system/fonts/`. Each MCP build uses esbuild's `dataurl` font loader to keep the HTML self-contained; Flutter declares the TTFs in `pubspec.yaml`. Do not depend on a user's installed font or a remote font service.

## Taxonomy

- `--pi-color-*`: semantic canvas, surface, border, text, accent, info, warning, danger, focus. Use `accent-text` on accent fills.
- `--pi-space-*`: 4px scale; `--pi-radius-{sm,md,lg,pill}`; `--pi-shadow-raised`.
- `--pi-font-{sans,mono,body,small,title,line}` and `--pi-size-{touch,content,focus}`.
- `--pi-motion-{fast,standard,easing}`. The stylesheet removes motion under `prefers-reduced-motion`.

Dark is the default; `data-pi-theme="light"` and `data-pi-theme="dark"` select an explicit local palette. Colors meet normal-text contrast intent: never use muted text for essential instructions. Flutter consumes the dark token projection through `PiDesignTokens`; native light theme is a future host decision, rather than pretending CSS can control Flutter.

## Patterns and accessibility

The reusable web interface is `elements.css`. Import it once from an MCP App entry point; it imports generated tokens and the bundled typeface. These are CSS classes and semantic HTML attributes; React, Vue, and plain DOM apps do not need separate runtime packages. Keep app-specific layout and behavior in the app.

| Need | Shared contract | Native semantics to keep |
|---|---|---|
| Layout and hierarchy | `.pi-stack`, `.pi-inline`, `.pi-surface`, `.pi-section-title`, `.pi-kicker` | Meaningful headings and sections |
| Actions | `.pi-button` with `data-variant="primary|danger"`; `.pi-icon-button` | `<button type="button">`; icon-only actions need an accessible name |
| Forms | `.pi-field`, `.pi-label`, `.pi-input`, `.pi-hint`, `.pi-error` | Explicit `<label for>`; `aria-describedby` for help/error; `aria-invalid="true"` for invalid fields |
| Navigation | `.pi-nav`, `.pi-toolbar` | `<nav>` for destinations, links for navigation, buttons for actions; `aria-current="page"` |
| Status | `.pi-badge`, `.pi-notice`, `.pi-empty-state` | Text labels for every tone; `role="status"` or `role="alert"` for updates |
| App header | `.pi-app-header` with identity, title/subtitle, and actions slots | Flutter `PiAppHeader` uses the same 64px desktop / 56px mobile heights, 16px / 12px insets, 44px mark and 12px slot gap from `tokens.json` |
| Header navigation and icons | `.pi-app-header__nav`, `.pi-icon`, `.pi-icon-button` | Flutter uses 44px `IconButton` targets, 20px glyphs, and a tooltip/accessibility label; keep navigation order and destination names aligned between apps |
| Progress | `.pi-loading` with decorative `.pi-spinner`; `.pi-progress` | Text status for unknown duration, labeled native `<progress>` for known amount |
| Modal | `.pi-dialog` | Native `<dialog>` opened with `showModal()` and a labeled heading; close via a dialog form or `close()` |

Focus must be visible (`--pi-color-focus`, 3px); do not remove it. Keep keyboard activation native, status updates in live regions, and interactive controls at least 44px. Use responsive `clamp` typography and collapse grids at small widths. Avoid color-only status; preserve labels/icons. Respect reduced motion for the decorative spinner. Do not create a custom dialog focus trap when the native modal provides it. The choices follow [W3C form labeling](https://www.w3.org/WAI/tutorials/forms/labels/), [dialog guidance](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), and [WCAG target sizing](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum). For example:

```html
<section class="pi-surface pi-stack" aria-labelledby="review-title">
  <h2 id="review-title" class="pi-section-title">Review</h2>
  <span class="pi-badge" data-tone="warning">Pending</span>
  <button class="pi-button" data-variant="primary" type="button">Accept</button>
</section>
```

Journal Review uses the shared surfaces, badges, actions, kicker, and typeface while retaining its evidence-specific layout. Mermaid uses the shared surface, section title, notice, and typeface. Marp uses shared navigation buttons, toolbar, font, and host theme for its frame; generated slide content still has its own theme. Trace Explainer uses shared buttons, toolbar, font, and host theme while retaining its evidence-specific layout. Flutter's theme maps the same dark values and Source Code Pro family through generated Dart tokens. Excalidraw/Grafana remain separately owned.

## Framework use

**Plain HTML/CSS:** import `elements.css` in the View entry point, then use its classes and `var(--pi-color-surface)`. The shared build module handles the `.woff2` data URL and inline assets for opaque iframes; the template must permit `font-src data:` in its CSP.

**Dart/Flutter:** import `lib/design_tokens.dart` and `lib/design_icons.dart`; use `PiDesignTokens` for font family, accent, spacing, radius, header geometry, icon size, and touch target, and `PiHeaderIcons` for the common Material glyphs. Use `lib/widgets/pi_app_header.dart` for the common shell and keep page-specific controls in its identity/actions slots. Declare the local TTFs in `pubspec.yaml`. CSS is not shared with Flutter; JSON values and generated Dart are.

**React:** `design_system/examples/react-adapter.jsx` is a thin compile-time fixture: import `elements.css` in the app entry and use `.pi-app-header`, `.pi-app-header__identity`, `.pi-app-header__actions`, `.pi-app-header__nav`, and `.pi-icon` for the common shell. It adds no React runtime to this client. Keep action labels/accessible names and navigation order consistent with Flutter; use the named Material glyphs (`mic`, `audio`, `chat`, `system`, `knowledge`, `history`, `tasks`, `new-session`, `add`, `theme-light`, `theme-dark`) through `.pi-icon[data-pi-icon="…"]`. `icons.json` generates both the CSS mappings and Flutter `IconData` constants, so mobile and desktop use the same codepoints. The locally bundled 11 KB subset comes from Flutter's Material Icons font; avoid emoji or text-symbol substitutes in app headers.

**Vue:** `design_system/examples/vue-adapter.vue` is the equivalent thin fixture and adds no Vue runtime. Both frameworks share token names/CSS, while lifecycle and bindings stay framework-specific.

## Packaging, migration, and validation

Client build commands regenerate first. The Journal Review and Trace Explainer MCP packages bundle their self-contained HTML from the client entry points through the same build module. The build module inserts the early theme bootstrap and hashes the exact inline script bytes; the template supplies **two separate quoted CSP hash sources**. Open `apps/client/design_system/specimen.html` directly in a browser for the component gallery. It shows every shared element and variant on one page, with section navigation, a dark/light theme toggle, labeled fields, progress, and an interactive native dialog.

Remaining work: align Marp's generated slide palette separately from its frame, and review first-party Excalidraw wrapper styling only if vendor updates permit. Never patch Grafana/Recogito vendor internals. Run `npm run test:design-tokens`, the relevant MCP App build, then browser rendering tests.

## Validation recorded

In the restored task VM: `node tool/design-tokens.test.mjs`, `npm run build:mermaid`, `npm run build:journal-review`, and `npm run build:excalidraw` passed. The generated Mermaid and Journal HTML contains the local Source Code Pro font data and shared UX CSS. `npm run test:browser` passed **12/12** after repairing the two CSP hash sources. `./tool/flutterw analyze` reported one pre-existing unused import warning in `patrol_test/live_edge_web_test.dart` and no errors from these changes.

After aligning the first-party Views through the shared build and runtime modules, `npm run test:browser` passed **13/13** iframe tests plus three focused build/runtime checks. The standalone Journal Review and Trace Explainer MCP packages built successfully; their HTML artifact hashes matched the corresponding client builds.
