import { convertToExcalidrawElements } from "@excalidraw/excalidraw";

import { parseMermaidToExcalidraw } from "@excalidraw/mermaid-to-excalidraw";
import {
  extractC4Title,
  isC4Diagram,
  preprocessMermaid,
} from "../src/c4.js";

declare global {
  interface Window {
    mermaidToLayoutSnapshot: (definition: string) => Promise<unknown>;
  }
}


const parseForAdapter = async (definition: string) => {
  const title = isC4Diagram(definition) ? extractC4Title(definition) : undefined;
  const result = await parseMermaidToExcalidraw(preprocessMermaid(definition));
  if (title) {
    const drawable = result.elements.filter(
      (element) => "x" in element && "y" in element
    );
    const minX = Math.min(...drawable.map((element) => Number(element.x)));
    const minY = Math.min(...drawable.map((element) => Number(element.y)));
    result.elements.unshift({
      id: "c4_title",
      type: "text",
      x: minX,
      y: minY - 60,
      text: title,
      fontSize: 28,
    });
  }
  return result;
};


const elementStyle = (element: any) => ({
  fill: typeof element.backgroundColor === "string" ? element.backgroundColor : null,
  stroke: typeof element.strokeColor === "string" ? element.strokeColor : null,
  strokeWidth: typeof element.strokeWidth === "number" ? element.strokeWidth : null,
  strokeDasharray: element.strokeStyle === "dashed" ? "8 8" : null,
  color: typeof element.strokeColor === "string" ? element.strokeColor : null,
  fontFamily: typeof element.fontFamily === "number" ? String(element.fontFamily) : null,
  fontSize: typeof element.fontSize === "number" ? element.fontSize : null,
  fontWeight: null,
});

/**
 * Gondolin's adapter interface: expose browser-derived geometry only. The
 * temporary Excalidraw elements never cross the adapter seam; scene creation
 * for the returned snapshot belongs to c4-compiler.wasm.
 */
window.mermaidToLayoutSnapshot = async (definition: string) => {
  const { elements } = await parseForAdapter(definition);
  const rendered = convertToExcalidrawElements(elements as any) as any[];
  const nodes = rendered
    .filter((element) => ["rectangle", "ellipse", "diamond"].includes(element.type))
    .map((element) => ({
      id: element.id,
      shape: element.type,
      bounds: { x: element.x, y: element.y, width: element.width, height: element.height },
      style: elementStyle(element),
    }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = rendered
    .filter((element) => ["arrow", "line"].includes(element.type))
    .map((element) => ({
      id: element.id,
      sourceId: nodeIds.has(element.startBinding?.elementId) ? element.startBinding.elementId : "",
      targetId: nodeIds.has(element.endBinding?.elementId) ? element.endBinding.elementId : "",
      points: element.points.map(([x, y]: [number, number]) => ({ x: element.x + x, y: element.y + y })),
      style: elementStyle(element),
    }));
  const texts = rendered
    .filter((element) => element.type === "text")
    .map((element) => ({
      id: element.id,
      text: element.text,
      bounds: { x: element.x, y: element.y, width: element.width, height: element.height },
      style: elementStyle(element),
    }));
  const visual = [...nodes.map((node) => node.bounds), ...texts.map((text) => text.bounds)];
  const minX = Math.min(0, ...visual.map((bounds) => bounds.x));
  const minY = Math.min(0, ...visual.map((bounds) => bounds.y));
  const maxX = Math.max(1, ...visual.map((bounds) => bounds.x + bounds.width));
  const maxY = Math.max(1, ...visual.map((bounds) => bounds.y + bounds.height));
  return {
    width: maxX - minX,
    height: maxY - minY,
    nodes,
    edges,
    texts,
    renderer: "@excalidraw/mermaid-to-excalidraw+playwright",
    warnings: [],
  };
};
