import { DEFAULT_FONT_SIZE } from "./constants.js";
import { graphToExcalidraw } from "./graphToExcalidraw.js";
import { parseMermaid } from "./parseMermaid.js";
import { extractC4Title, isC4Diagram } from "./preprocessors/c4.js";

export interface MermaidConfig {
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
   * @default { fontSize: "25px" }
   */
  themeVariables?: {
    fontSize?: string;
  };
  /**
   * Maximum number of edges to be rendered.
   * @default 1000
   */
  maxEdges?: number;
  /**
   * Maximum number of characters to be rendered.
   * @default 1000
   */
  maxTextSize?: number;
}

export interface ExcalidrawConfig {
  fontSize?: number;
}

const parseMermaidToExcalidraw = async (
  definition: string,
  config?: MermaidConfig
) => {
  const c4Title = isC4Diagram(definition)
    ? extractC4Title(definition)
    : undefined;
  const mermaidConfig = config || {};
  const fontSize =
    parseInt(mermaidConfig.themeVariables?.fontSize ?? "") || DEFAULT_FONT_SIZE;
  const parsedMermaidData = await parseMermaid(definition, {
    ...mermaidConfig,
    themeVariables: {
      ...mermaidConfig.themeVariables,
    },
  });
  // Only font size supported for excalidraw elements
  const excalidrawElements = graphToExcalidraw(parsedMermaidData, {
    fontSize,
  });
  if (c4Title) {
    const drawableElements = excalidrawElements.elements.filter(
      (element) =>
        "x" in element &&
        "y" in element &&
        Number.isFinite(element.x) &&
        Number.isFinite(element.y)
    );
    const minX = Math.min(...drawableElements.map((element) => element.x));
    const minY = Math.min(...drawableElements.map((element) => element.y));
    excalidrawElements.elements.unshift({
      id: "c4_title",
      type: "text",
      x: minX,
      y: minY - fontSize * 3,
      text: c4Title,
      fontSize: Math.round(fontSize * 1.4),
    });
  }
  return excalidrawElements;
};

export { parseMermaidToExcalidraw };
