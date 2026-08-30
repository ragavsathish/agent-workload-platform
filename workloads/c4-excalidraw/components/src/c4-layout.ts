import { graphlib, layout as runDagreLayout } from "@dagrejs/dagre";

import type {
  ComputedStyle,
  GraphLayoutRequest,
  GraphNode,
  LayoutEdge,
  LayoutNode,
  LayoutSnapshot,
  LayoutText,
  PipelineError,
} from "diagram:c4-pipeline/types@0.1.0";

const NODE_PADDING_X = 24;
const NODE_PADDING_Y = 20;
const BOUNDARY_HEADER = 48;
const FONT_SIZE = 16;
const MAX_LAYOUT_ELEMENTS = 10_000;
const MAX_LABEL_BYTES = 65_536;
const MAX_LABEL_PAYLOAD_BYTES = 1_048_576;
const encoder = new TextEncoder();

type DagreNode = {
  graphNode: GraphNode;
  width: number;
  height: number;
  x?: number;
  y?: number;
};

type DagreEdge = {
  graphEdge: GraphLayoutRequest["edges"][number];
  width: number;
  height: number;
  x?: number;
  y?: number;
  points?: Array<{ x: number; y: number }>;
};

function fail(code: PipelineError["code"], message: string, details?: string): never {
  throw details === undefined ? { code, message } satisfies PipelineError : { code, message, details } satisfies PipelineError;
}

function nodeDimensions(label: string): { width: number; height: number } {
  const lines = label.split("\n");
  const longest = Math.max(1, ...lines.map((line) => [...line].length));
  return {
    width: Math.min(420, Math.max(180, longest * 8.5 + NODE_PADDING_X * 2)),
    height: Math.max(88, lines.length * 22 + NODE_PADDING_Y * 2),
  };
}

function edgeLabelDimensions(label: string): { width: number; height: number } {
  const lines = label.split("\n");
  const longest = Math.max(1, ...lines.map((line) => [...line].length));
  return {
    width: Math.min(320, Math.max(48, longest * 7.5 + 20)),
    height: Math.max(22, lines.length * 18 + 8),
  };
}

function validateId(id: string, kind: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(id)) fail("invalid-source", `${kind} has an invalid id: ${id}`);
}

function validateLabel(label: string, kind: string): void {
  if (encoder.encode(label).length > MAX_LABEL_BYTES) fail("input-limit-exceeded", `${kind} label is too large`);
}

function outputElementCount(request: GraphLayoutRequest): number {
  return request.nodes.length * 2
    + request.edges.length
    + request.edges.filter((edge) => edge.label.length > 0).length
    + (request.title ? 1 : 0);
}

function validateParents(nodes: readonly GraphNode[], graphNodes: ReadonlyMap<string, GraphNode>): void {
  for (const node of nodes) {
    const visited = new Set<string>([node.id]);
    let parentId = node.parentId;
    while (parentId) {
      if (visited.has(parentId)) fail("invalid-source", `Boundary parent cycle includes ${parentId}`);
      visited.add(parentId);
      const parent = graphNodes.get(parentId);
      if (!parent || parent.kind !== "boundary") {
        fail("invalid-source", `Node ${node.id} references unknown boundary ${parentId}`);
      }
      parentId = parent.parentId;
    }
  }
}

function styleFor(node: GraphNode, theme: GraphLayoutRequest["theme"]): ComputedStyle {
  const dark = theme === "dark";
  const styles: Record<GraphNode["kind"], { fill: string; stroke: string; dashed?: boolean }> = {
    person: { fill: dark ? "#1c4f75" : "#a5d8ff", stroke: "#1971c2" },
    "external-person": { fill: dark ? "#343a40" : "#e9ecef", stroke: "#868e96", dashed: true },
    "software-system": { fill: dark ? "#155b89" : "#74c0fc", stroke: "#1971c2" },
    "external-software-system": { fill: dark ? "#343a40" : "#e9ecef", stroke: "#868e96", dashed: true },
    container: { fill: dark ? "#285f35" : "#b2f2bb", stroke: "#2f9e44" },
    component: { fill: dark ? "#1b6657" : "#c3fae8", stroke: "#099268" },
    database: { fill: dark ? "#443078" : "#d0bfff", stroke: "#7048e8" },
    queue: { fill: dark ? "#74410f" : "#ffe8cc", stroke: "#e67700" },
    boundary: { fill: "transparent", stroke: dark ? "#adb5bd" : "#495057", dashed: true },
  };
  const selected = styles[node.kind];
  return {
    fill: selected.fill,
    stroke: selected.stroke,
    strokeWidth: node.kind === "boundary" ? 2 : 2.5,
    ...(selected.dashed ? { strokeDasharray: "8 8" } : {}),
    color: dark ? "#f8f9fa" : "#102a43",
    fontFamily: "5",
    fontSize: node.kind === "boundary" ? 18 : FONT_SIZE,
    fontWeight: node.kind === "boundary" ? "600" : "500",
  };
}

function shapeFor(kind: GraphNode["kind"]): string {
  if (kind === "person" || kind === "external-person" || kind === "database") return "ellipse";
  return "rectangle";
}

function layout(request: GraphLayoutRequest): LayoutSnapshot {
  if (!Number.isInteger(request.maximumElements) || request.maximumElements <= 0 || request.maximumElements > MAX_LAYOUT_ELEMENTS) {
    fail("invalid-source", `maximum-elements must be between 1 and ${MAX_LAYOUT_ELEMENTS}`);
  }
  const count = outputElementCount(request);
  if (count > request.maximumElements) {
    fail("input-limit-exceeded", `Graph generates ${count} scene elements; limit is ${request.maximumElements}`);
  }
  if (request.title) validateLabel(request.title, "Title");
  const labelPayloadBytes = encoder.encode(request.title ?? "").length
    + request.nodes.reduce((total, node) => total + encoder.encode(node.label).length, 0)
    + request.edges.reduce((total, edge) => total + encoder.encode(edge.label).length, 0);
  if (labelPayloadBytes > MAX_LABEL_PAYLOAD_BYTES) {
    fail("input-limit-exceeded", `Graph labels exceed ${MAX_LABEL_PAYLOAD_BYTES} aggregate bytes`);
  }

  const graph = new graphlib.Graph({ compound: true, multigraph: true })
    .setGraph({
      rankdir: request.direction === "top-to-bottom" ? "TB" : "LR",
      ranker: "network-simplex",
      nodesep: 48,
      ranksep: 72,
      edgesep: 28,
      marginx: 32,
      marginy: 32,
    })
    .setDefaultEdgeLabel(() => ({}));

  const ids = new Set<string>();
  const graphNodes = new Map(request.nodes.map((node) => [node.id, node]));
  for (const node of request.nodes) {
    validateId(node.id, "Graph node");
    validateLabel(node.label, `Node ${node.id}`);
    if (ids.has(node.id)) fail("invalid-source", `Duplicate graph node: ${node.id}`);
    ids.add(node.id);
    const size = node.kind === "boundary"
      ? { width: NODE_PADDING_X * 2, height: BOUNDARY_HEADER }
      : nodeDimensions(node.label);
    graph.setNode(node.id, { graphNode: node, ...size } satisfies DagreNode);
  }
  validateParents(request.nodes, graphNodes);
  for (const node of request.nodes) {
    if (!node.parentId) continue;
    graph.setParent(node.id, node.parentId);
  }
  for (const edge of request.edges) {
    validateId(edge.id, "Graph edge");
    validateLabel(edge.label, `Edge ${edge.id}`);
    if (ids.has(edge.id)) fail("invalid-source", `Duplicate graph element id: ${edge.id}`);
    ids.add(edge.id);
    if (!graphNodes.has(edge.sourceId) || !graphNodes.has(edge.targetId)) {
      fail("invalid-source", `Edge ${edge.id} references an unknown node`);
    }
    const size = edge.label ? edgeLabelDimensions(edge.label) : { width: 0, height: 0 };
    graph.setEdge(edge.sourceId, edge.targetId, { graphEdge: edge, ...size } satisfies DagreEdge, edge.id);
  }

  const outputIds = new Set(ids);
  const allocateId = (preferred: string): string => {
    let candidate = preferred;
    let suffix = 2;
    while (outputIds.has(candidate)) candidate = `${preferred}-${suffix++}`;
    outputIds.add(candidate);
    return candidate;
  };

  try {
    runDagreLayout(graph);
  } catch (error) {
    fail("invalid-layout", "Dagre could not lay out the C4 graph", error instanceof Error ? error.message : String(error));
  }

  const nodes: LayoutNode[] = [];
  const texts: LayoutText[] = [];
  const titleOffset = request.title ? 56 : 0;
  for (const id of graph.nodes()) {
    const positioned = graph.node(id) as DagreNode;
    const x = (positioned.x ?? 0) - positioned.width / 2;
    const y = (positioned.y ?? 0) - positioned.height / 2 + titleOffset;
    const style = styleFor(positioned.graphNode, request.theme);
    nodes.push({ id, shape: shapeFor(positioned.graphNode.kind), bounds: { x, y, width: positioned.width, height: positioned.height }, style });
    texts.push({
      id: allocateId(`${id}-label`),
      text: positioned.graphNode.label,
      bounds: {
        x: x + NODE_PADDING_X,
        y: y + (positioned.graphNode.kind === "boundary" ? 12 : NODE_PADDING_Y),
        width: Math.max(1, positioned.width - NODE_PADDING_X * 2),
        height: positioned.graphNode.kind === "boundary" ? 28 : Math.max(1, positioned.height - NODE_PADDING_Y * 2),
      },
      style,
    });
  }

  const edges: LayoutEdge[] = graph.edges().map((descriptor) => {
    const positioned = graph.edge(descriptor) as DagreEdge;
    const points = (positioned.points ?? []).map((point) => ({ x: point.x, y: point.y + titleOffset }));
    if (points.length < 2) fail("invalid-layout", `Dagre returned no route for edge ${descriptor.name ?? `${descriptor.v}-${descriptor.w}`}`);
    if (positioned.graphEdge.label) {
      const size = edgeLabelDimensions(positioned.graphEdge.label);
      const middle = points[Math.floor(points.length / 2)]!;
      texts.push({
        id: allocateId(`${positioned.graphEdge.id}-label`),
        text: positioned.graphEdge.label,
        bounds: {
          x: (positioned.x ?? middle.x) - size.width / 2,
          y: (positioned.y === undefined ? middle.y : positioned.y + titleOffset) - size.height / 2,
          width: size.width,
          height: size.height,
        },
        style: { color: request.theme === "dark" ? "#f8f9fa" : "#343a40", fontFamily: "5", fontSize: 14 },
      });
    }
    return {
      id: positioned.graphEdge.id,
      sourceId: positioned.graphEdge.sourceId,
      targetId: positioned.graphEdge.targetId,
      points,
      style: { stroke: request.theme === "dark" ? "#ced4da" : "#495057", strokeWidth: 2 },
    };
  });

  const graphSize = graph.graph() as { width?: number; height?: number };
  if (request.title) {
    texts.unshift({
      id: allocateId("c4-title"),
      text: request.title,
      bounds: { x: 32, y: 12, width: Math.max(180, (graphSize.width ?? 244) - 64), height: 32 },
      style: {
        color: request.theme === "dark" ? "#f8f9fa" : "#102a43",
        fontFamily: "5",
        fontSize: 28,
        fontWeight: "700",
      },
    });
  }
  return {
    width: graphSize.width ?? Math.max(1, ...nodes.map((node) => node.bounds.x + node.bounds.width)),
    height: (graphSize.height ?? Math.max(1, ...nodes.map((node) => node.bounds.y + node.bounds.height))) + titleOffset,
    nodes,
    edges,
    texts,
    renderer: "c4-layout-wasm/dagre",
    warnings: [],
  };
}

export const graphLayout = { layout };
