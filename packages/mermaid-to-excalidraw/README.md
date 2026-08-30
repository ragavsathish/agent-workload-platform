# mermaid-to-excalidraw

Convert mermaid diagrams to excalidraw

## Set up

Install packages:

```
yarn
```

Start development playground:

```
yarn start
```

Build command:

```
yarn build
```

## Get started

```ts
parseMermaidToExcalidraw(diagramDefinition: string, config?: MermaidConfig)
```

The `diagramDefinition` is the mermaid diagram definition.
and `config` is the mermaid config. You can use the `config` param when you want to pass some custom config to mermaid.

Currently `mermaid-to-excalidraw` only supports the :point_down: config params

```ts
{
  /**
   * Whether to start the diagram automatically when the page loads.
   * @default false
   */
  startOnLoad?: boolean;
  /**
   * The flowchart curve style.
   * @default "linear"
   */
  flowchart?: {
    curve?: "linear" | "basis";
  };
  /**
   * Theme variables
   * @default { fontSize: "20px" }
   */
  themeVariables?: {
    fontSize?: string;
  };
  /**
   * Maximum number of edges to be rendered.
   * @default 500
   */
  maxEdges?: number;
  /**
   * Maximum number of characters to be rendered.
   * @default 50000
   */
  maxTextSize?: number;
}
```

### Command-line conversion

The repository includes a browser-backed CLI so Mermaid receives real SVG
measurements before the scene is written:

```sh
yarn convert input.mmd output.excalidraw preview.png
```

The PNG argument is optional. Mermaid C4 context, container, component, dynamic,
and deployment sources are preprocessed into editable flowchart elements rather
than falling back to an embedded SVG image.

### Playwright OCI image in Gondolin

The browser-backed conversion can run inside a Gondolin micro-VM whose root
filesystem is imported from a pinned Playwright OCI image. Docker is used only
while constructing the image; Docker does not run inside the VM. The Playwright
base is pinned by multi-platform digest, and Gondolin records the resulting
local OCI digest in its asset manifest.

Build the OCI image and convert it to a reusable Gondolin image for the current
architecture:

```sh
npm run gondolin:playwright:build
```

Convert a diagram inside the resulting VM:

```sh
npm run convert:gondolin -- \
  input.mmd \
  output.excalidraw \
  output.png
```

Pass `aarch64` or `x86_64` to the build script to choose an architecture. The
runtime script accepts the architecture as its fourth argument. Set
`GONDOLIN_BIN` to select a Gondolin executable; otherwise the scripts use one
on `PATH` or the pinned `@earendil-works/gondolin@0.12.0` CLI through `npx`.

The guest is a one-shot worker. It receives a read-only directory containing
the Mermaid source and a writable output directory, launches the bundled
Chromium headless shell, and writes standard Excalidraw JSON plus an optional
PNG. Firefox, WebKit, and full Chromium are removed from the worker filesystem.
The Gondolin root disk is automatically sized from that reduced filesystem. The
guest receives no outbound network allowlist. Gondolin imports the OCI
filesystem rather than its runtime metadata, so browser environment variables
are repeated explicitly in the Gondolin manifests.

Example code:

```ts
import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";

try {
  const { elements, files } = await parseMermaidToExcalidraw(
    diagramDefinition,
    {
      themeVariables: {
        fontSize: "25px",
      },
    }
  );
  // Render elements and files on Excalidraw
} catch (e) {
  // Parse error, displaying error message to users
}
```

## Playground

Try out [here](https://mermaid-to-excalidraw.vercel.app).

## Development

- `yarn test:visual` to run visual tests
- `yarn test:visual:update` to update visual tests
- `yarn test:visual:dev` to run visual test dev server (usually better to use this over the playground)

## API

Head over to the [docs](https://docs.excalidraw.com/docs/@excalidraw/mermaid-to-excalidraw/api).

## Support new Diagram type

Head over to the [docs](https://docs.excalidraw.com/docs/@excalidraw/mermaid-to-excalidraw/codebase/new-diagram-type).
