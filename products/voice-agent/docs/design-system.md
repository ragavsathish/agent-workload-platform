# Pi Voice MCP App design system

**Contract:** `apps/client/design_system/tokens.json` is the versioned source of truth (currently **1.1.0**), owned by Voice Agent client maintainers. `node apps/client/tool/generate-design-tokens.mjs` deterministically emits `design_system/tokens.css` and `lib/design_tokens.dart`; never hand-edit those outputs. `design_system/elements.css` is the small, hand-maintained web UX interface built on those tokens. A token addition or changed value is a contract change: bump the version, regenerate, update this guide/specimen, and migrate consumers deliberately. Semantic aliases, not raw colors, are the stable interface.

## Architecture and boundaries

The Flutter host is a native Flutter UI, not React. First-party opaque-origin MCP App iframes are Mermaid, Marp, Journal Review (plain DOM plus Recogito), and Trace Explainer (plain DOM). Journal Review and Trace Explainer are also packaged by their respective MCP TypeScript services. Excalidraw is the separately built, vendor `vendor/excalidraw-mcp` React integration. Grafana's trace app and Recogito are vendor/official integrations; do not bulk-restyle them. There is no Vue app on this path.

The host passes its MCP `hostContext.theme` and puts the selected theme in the first-party iframe URL. Each iframe embeds its own generated tokens, UX elements, and Source Code Pro WOFF2 data, so no parent CSS, CDN, same-origin permission, credential, tool, or task-action access is needed. Both app CSPs allow only hashed scripts and local data fonts. CSS only paints; it does not enlarge the existing sandbox (`allow-scripts`) or bridge allowlist. The CSS also has a system-preference fallback for standalone specimens. Theme changes currently take effect on the next mount; an app that needs live changes should apply its received host-context theme to `document.documentElement.dataset.piTheme`.

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

**Plain HTML/CSS:** bundle `elements.css` in the app build, then use its classes and `var(--pi-color-surface)`. This is required for opaque iframes. When inlining into self-contained HTML, configure `.woff2` as an esbuild `dataurl` asset and permit `font-src data:` in that iframe's CSP.

**Dart/Flutter:** import `lib/design_tokens.dart` and use `PiDesignTokens.fontFamily`, accent, spacing, radius, and touch target in `ThemeData`/widgets. Declare the local TTFs in `pubspec.yaml`. CSS is not shared with Flutter; JSON values and generated Dart are.

**React:** `design_system/examples/react-adapter.jsx` is a thin compile-time fixture: import `elements.css` in the app entry and render the `.pi-button`. It adds no React runtime to this client.

**Vue:** `design_system/examples/vue-adapter.vue` is the equivalent thin fixture and adds no Vue runtime. Both frameworks share token names/CSS, while lifecycle and bindings stay framework-specific.

## Packaging, migration, and validation

Client build commands regenerate first. The Journal Review and Trace Explainer MCP packages bundle their self-contained HTML from the client entry points. Preserve **two separate quoted CSP hash sources** when changing the inline bootstrap or app script. Open `apps/client/design_system/specimen.html` directly in a browser for the component gallery. It shows every shared element and variant on one page, with section navigation, a dark/light theme toggle, labeled fields, progress, and an interactive native dialog.

Remaining work: align Marp's generated slide palette separately from its frame, and review first-party Excalidraw wrapper styling only if vendor updates permit. Never patch Grafana/Recogito vendor internals. Run `npm run test:design-tokens`, the relevant MCP App build, then browser rendering tests.

## Validation recorded

In the restored task VM: `node tool/design-tokens.test.mjs`, `npm run build:mermaid`, `npm run build:journal-review`, and `npm run build:excalidraw` passed. The generated Mermaid and Journal HTML contains the local Source Code Pro font data and shared UX CSS. `npm run test:browser` passed **12/12** after repairing the two CSP hash sources. `./tool/flutterw analyze` reported one pre-existing unused import warning in `patrol_test/live_edge_web_test.dart` and no errors from these changes.
