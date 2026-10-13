import type {
  Bounds,
  CompileOptions,
  CompileRequest,
  CompiledScene,
  ComputedStyle,
  ErrorCode,
  GraphEdge,
  GraphLayoutRequest,
  GraphNode,
  LayoutEdge,
  LayoutNode,
  LayoutSnapshot,
  LayoutText,
  PipelineError,
  PreparedCompilation,
} from "diagram:c4-pipeline/types@0.1.0";

type CompilerCore = {
  prepare(request: CompileRequest): PreparedCompilation;
  finish(state: Uint8Array, layout: LayoutSnapshot): CompiledScene;
};

interface CompilerState {
  version: number;
  source: string;
  options: CompileOptions;
}

type ElementType = "rectangle" | "ellipse" | "diamond" | "arrow" | "text";
type LinearPoint = [number, number];

interface ExcalidrawElement {
  [key: string]: unknown;
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const STATE_VERSION = 1;
const MAX_COORDINATE = 1_000_000;
const MAX_STATE_BYTES = 8 * 1024 * 1024;
const C4_HEADER = /^C4(?:Context|Container|Component|Dynamic|Deployment)$/u;
const NODE_DECLARATION = /^(Person(?:_Ext)?|System(?:_Ext)?|Container(?:Db|Queue)?(?:_Instance)?|Component)\s*\((.*)\)\s*$/u;
const BOUNDARY_DECLARATION = /^(Deployment_Node|Node(?:_[LR])?|(?:System|Container|Enterprise)_Boundary)\s*\((.*)\)\s*\{\s*$/u;
const RELATION_DECLARATION = /^Rel(?:_[RLUD])?\s*\((.*)\)\s*$/u;

function fail(code: ErrorCode, message: string, details?: string): never {
  const error: PipelineError = details === undefined ? { code, message } : { code, message, details };
  throw error;
}

function byteLength(value: string): number {
  return encoder.encode(value).length;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateLimit(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    fail("invalid-source", `${name} must be a positive integer`);
  }
}

function stripFence(source: string): string {
  return source.replace(/^\s*```(?:mermaid)?\s*/iu, "").replace(/```\s*$/u, "").trim();
}

function splitArguments(source: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;
  for (const character of source) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  if (quoted) fail("invalid-source", "Unterminated quoted C4 argument");
  values.push(current.trim());
  return values.map((value) => value.replace(/^"|"$/gu, "").trim());
}

function nodeKind(type: string): GraphNode["kind"] {
  if (type === "Person") return "person";
  if (type === "Person_Ext") return "external-person";
  if (type === "System") return "software-system";
  if (type === "System_Ext") return "external-software-system";
  if (type.startsWith("ContainerDb")) return "database";
  if (type.startsWith("ContainerQueue")) return "queue";
  if (type === "Component") return "component";
  return "container";
}

function displayLabel(name: string, technology: string, description: string): string {
  return [name, technology && `[${technology}]`, description].filter(Boolean).join("\n");
}

function parseLayoutRequest(source: string, options: CompileOptions): GraphLayoutRequest {
  const lines = source.split(/\r?\n/u).map((line) => line.trim());
  const header = lines[0] ?? "";
  if (!C4_HEADER.test(header)) fail("invalid-source", "Expected native Mermaid C4 syntax");
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const ids = new Set<string>();
  const parents: string[] = [];
  let title: string | undefined;

  for (const line of lines.slice(1)) {
    if (!line || line === "{" || line.startsWith("%%")) continue;
    const titleMatch = /^title\s+(.+)$/iu.exec(line);
    if (titleMatch?.[1]) {
      title = titleMatch[1].trim();
      continue;
    }
    if (line === "}") {
      if (!parents.pop()) fail("invalid-source", "Unexpected closing C4 boundary");
      continue;
    }
    const boundaryMatch = BOUNDARY_DECLARATION.exec(line);
    if (boundaryMatch?.[1] && boundaryMatch[2]) {
      const [id, name, technology = "", description = ""] = splitArguments(boundaryMatch[2]);
      if (!id || !name) fail("invalid-source", `Invalid C4 boundary: ${line}`);
      if (ids.has(id)) fail("invalid-source", `Duplicate C4 id: ${id}`);
      ids.add(id);
      nodes.push({
        id,
        parentId: parents.at(-1) ?? "",
        kind: "boundary",
        label: displayLabel(name, technology, description),
      });
      parents.push(id);
      continue;
    }
    const nodeMatch = NODE_DECLARATION.exec(line);
    if (nodeMatch?.[1] && nodeMatch[2]) {
      const args = splitArguments(nodeMatch[2]);
      const [id, name] = args;
      const hasTechnology = nodeMatch[1].startsWith("Container") || nodeMatch[1] === "Component";
      const technology = hasTechnology ? args[2] ?? "" : "";
      const description = hasTechnology ? args[3] ?? "" : args[2] ?? "";
      if (!id || !name) fail("invalid-source", `Invalid C4 declaration: ${line}`);
      if (ids.has(id)) fail("invalid-source", `Duplicate C4 id: ${id}`);
      ids.add(id);
      nodes.push({
        id,
        parentId: parents.at(-1) ?? "",
        kind: nodeKind(nodeMatch[1]),
        label: displayLabel(name, technology, description),
      });
      continue;
    }
    const relationMatch = RELATION_DECLARATION.exec(line);
    if (relationMatch?.[1]) {
      const [sourceId, targetId, label = "", technology = ""] = splitArguments(relationMatch[1]);
      if (!sourceId || !targetId) fail("invalid-source", `Invalid C4 relationship: ${line}`);
      edges.push({
        id: `relation-${edges.length + 1}`,
        sourceId,
        targetId,
        label: [label, technology].filter(Boolean).join("\n"),
      });
      continue;
    }
    if (/^(?:Update|Lay_|SHOW_|HIDE_)/u.test(line)) continue;
    fail("unsupported-syntax", `Unsupported Mermaid C4 line: ${line}`);
  }
  if (parents.length > 0) fail("invalid-source", "Unclosed C4 boundary");
  for (const edge of edges) {
    if (!ids.has(edge.sourceId) || !ids.has(edge.targetId)) {
      fail("invalid-source", `Relationship references unknown C4 id: ${edge.sourceId} -> ${edge.targetId}`);
    }
  }
  const outputElements = nodes.length * 2
    + edges.length
    + edges.filter((edge) => edge.label.length > 0).length
    + (title ? 1 : 0);
  if (outputElements > options.maximumElements) {
    fail("input-limit-exceeded", `C4 graph generates ${outputElements} scene elements; limit is ${options.maximumElements}`);
  }
  const direction = options.direction === "automatic"
    ? header === "C4Deployment" ? "top-to-bottom" : "left-to-right"
    : options.direction;
  return {
    ...(title === undefined ? {} : { title }),
    direction,
    theme: options.theme,
    maximumElements: options.maximumElements,
    nodes,
    edges,
  };
}

function validateSource(request: CompileRequest): string {
  const { options } = request;
  validateLimit(options.maximumSourceBytes, "maximum-source-bytes");
  validateLimit(options.maximumElements, "maximum-elements");
  const source = stripFence(request.source);
  if (byteLength(source) > options.maximumSourceBytes) {
    fail("input-limit-exceeded", `C4 source exceeds ${options.maximumSourceBytes} bytes`);
  }
  if (!C4_HEADER.test(source.split(/\r?\n/u)[0]?.trim() ?? "")) {
    fail("invalid-source", "Expected native Mermaid C4 syntax");
  }
  return source;
}

function prepare(request: CompileRequest): PreparedCompilation {
  const source = validateSource(request);
  const layoutRequest = parseLayoutRequest(source, request.options);
  const state = encoder.encode(JSON.stringify({
    version: STATE_VERSION,
    source,
    options: request.options,
  }));
  if (state.length > MAX_STATE_BYTES) fail("input-limit-exceeded", "Compiler state is too large");
  return {
    state,
    layoutRequest,
    renderRequest: {
      mermaid: source,
      configurationJson: JSON.stringify({
        theme: request.options.theme,
        direction: request.options.direction,
      }),
      maximumOutputBytes: Math.min(0xffffffff, Math.max(1_048_576, request.options.maximumElements * 65_536)),
    },
  };
}

function isPipelineError(error: unknown): error is PipelineError {
  return typeof error === "object" && error !== null && "code" in error && "message" in error;
}

function isCompilerState(value: unknown): value is CompilerState {
  if (typeof value !== "object" || value === null || !("options" in value)) return false;
  const state = value as Record<string, unknown>;
  const options = state.options;
  if (typeof options !== "object" || options === null) return false;
  const fields = options as Record<string, unknown>;
  return state.version === STATE_VERSION
    && typeof state.source === "string"
    && ["automatic", "top-to-bottom", "left-to-right"].includes(String(fields.direction))
    && ["light", "dark"].includes(String(fields.theme))
    && typeof fields.maximumSourceBytes === "number"
    && typeof fields.maximumElements === "number";
}

function readState(bytes: Uint8Array): CompilerState {
  if (!bytes || typeof bytes.length !== "number" || bytes.length === 0 || bytes.length > MAX_STATE_BYTES) {
    fail("invalid-source", "Invalid opaque compiler state");
  }
  try {
    const state: unknown = JSON.parse(decoder.decode(bytes));
    if (!isCompilerState(state)) throw new Error("shape");
    validateSource({ source: state.source, options: state.options });
    return state;
  } catch (error) {
    if (isPipelineError(error)) throw error;
    fail("invalid-source", "Opaque compiler state is corrupt or unsupported");
  }
}

function validateId(id: string, kind: string): void {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(id)) {
    fail("invalid-layout", `${kind} has an invalid id`, String(id));
  }
}

function validateBounds(bounds: Bounds, kind: string): void {
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(finite)) {
    fail("invalid-layout", `${kind} has non-finite bounds`);
  }
  if (bounds.width < 0 || bounds.height < 0 || [bounds.x, bounds.y, bounds.width, bounds.height].some((value) => Math.abs(value) > MAX_COORDINATE)) {
    fail("invalid-layout", `${kind} has out-of-range bounds`);
  }
}

function color(value: string | undefined, fallback: string): string {
  return typeof value === "string" && value.length <= 64 ? value : fallback;
}

function number(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  return finite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function baseElement(
  id: string,
  type: ElementType,
  x: number,
  y: number,
  width: number,
  height: number,
  style: ComputedStyle,
): ExcalidrawElement {
  const seed = hash(id);
  return {
    id, type, x, y, width, height, angle: 0,
    strokeColor: color(style.stroke ?? style.color, "#1e1e1e"),
    backgroundColor: color(style.fill, "transparent"),
    fillStyle: "solid",
    strokeWidth: number(style.strokeWidth, 2, 0.5, 10),
    strokeStyle: style.strokeDasharray ? "dashed" : "solid",
    roughness: 1, opacity: 100, groupIds: [], frameId: null,
    roundness: type === "rectangle" ? { type: 3 } : null,
    seed, version: 1, versionNonce: seed ^ 0x9e3779b9,
    isDeleted: false, boundElements: null, updated: 1,
    link: null, locked: false,
  };
}

function compileNode(node: LayoutNode): ExcalidrawElement {
  const allowed = new Set<ElementType>(["rectangle", "ellipse", "diamond"]);
  const type: ElementType = allowed.has(node.shape as ElementType) ? node.shape as ElementType : "rectangle";
  const { x, y, width, height } = node.bounds;
  return baseElement(node.id, type, x, y, width, height, node.style ?? {});
}

function compileText(text: LayoutText): ExcalidrawElement {
  const { x, y, width, height } = text.bounds;
  const style = text.style ?? {};
  const element = baseElement(text.id, "text", x, y, width, height, style);
  const fontFamily = Number.parseInt(style.fontFamily ?? "", 10);
  return {
    ...element,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
    roundness: null,
    text: text.text,
    fontSize: number(style.fontSize, 16, 6, 96),
    fontFamily: Number.isInteger(fontFamily) && fontFamily >= 1 && fontFamily <= 5 ? fontFamily : 5,
    textAlign: "left", verticalAlign: "top", containerId: null,
    originalText: text.text, autoResize: true, lineHeight: 1.25,
  };
}

function compileEdge(edge: LayoutEdge, nodeIds: ReadonlySet<string>): ExcalidrawElement {
  if (edge.points.length < 2) fail("invalid-layout", `Edge ${edge.id} requires at least two points`);
  for (const point of edge.points) {
    if (!finite(point.x) || !finite(point.y) || Math.abs(point.x) > MAX_COORDINATE || Math.abs(point.y) > MAX_COORDINATE) {
      fail("invalid-layout", `Edge ${edge.id} contains an invalid point`);
    }
  }
  const start = edge.points[0];
  if (!start) fail("invalid-layout", `Edge ${edge.id} requires a starting point`);
  const localPoints: LinearPoint[] = edge.points.map((point) => [point.x - start.x, point.y - start.y]);
  const xs = localPoints.map(([x]) => x);
  const ys = localPoints.map(([, y]) => y);
  const style = edge.style ?? {};
  return {
    ...baseElement(edge.id, "arrow", start.x, start.y, Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), style),
    roundness: { type: 2 },
    points: localPoints,
    lastCommittedPoint: null,
    startBinding: nodeIds.has(edge.sourceId) ? { elementId: edge.sourceId, focus: 0, gap: 1 } : null,
    endBinding: nodeIds.has(edge.targetId) ? { elementId: edge.targetId, focus: 0, gap: 1 } : null,
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
  };
}

function finish(stateBytes: Uint8Array, layout: LayoutSnapshot): CompiledScene {
  const state = readState(stateBytes);
  if (!layout || !finite(layout.width) || !finite(layout.height) || layout.width <= 0 || layout.height <= 0) {
    fail("invalid-layout", "Browser adapter returned invalid canvas dimensions");
  }
  const count = layout.nodes.length + layout.edges.length + layout.texts.length;
  if (count > state.options.maximumElements) {
    fail("input-limit-exceeded", `Layout contains ${count} elements; limit is ${state.options.maximumElements}`);
  }
  const ids = new Set<string>();
  const register = (id: string, kind: string): void => {
    validateId(id, kind);
    if (ids.has(id)) fail("invalid-layout", `Duplicate layout id: ${id}`);
    ids.add(id);
  };
  for (const node of layout.nodes) {
    register(node.id, "Node");
    validateBounds(node.bounds, `Node ${node.id}`);
  }
  for (const edge of layout.edges) register(edge.id, "Edge");
  for (const text of layout.texts) {
    register(text.id, "Text");
    validateBounds(text.bounds, `Text ${text.id}`);
    if (byteLength(text.text) > 65_536) fail("invalid-layout", `Text ${text.id} is too large`);
  }
  const nodeIds = new Set(layout.nodes.map((node) => node.id));
  for (const edge of layout.edges) {
    if (edge.sourceId && !nodeIds.has(edge.sourceId)) fail("invalid-layout", `Edge ${edge.id} references unknown source ${edge.sourceId}`);
    if (edge.targetId && !nodeIds.has(edge.targetId)) fail("invalid-layout", `Edge ${edge.id} references unknown target ${edge.targetId}`);
  }
  const elements = [
    ...layout.nodes.map(compileNode),
    ...layout.edges.map((edge) => compileEdge(edge, nodeIds)),
    ...layout.texts.map(compileText),
  ];
  return {
    scene: {
      format: "excalidraw",
      formatVersion: 2,
      elementsJson: JSON.stringify(elements),
      filesJson: "{}",
    },
    warnings: [...layout.warnings],
  };
}

export const compilerCore: CompilerCore = { prepare, finish };
