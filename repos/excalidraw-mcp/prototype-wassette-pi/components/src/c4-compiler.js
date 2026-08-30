const encoder = new TextEncoder();
const decoder = new TextDecoder();
const STATE_VERSION = 1;
const MAX_COORDINATE = 1_000_000;
const MAX_STATE_BYTES = 8 * 1024 * 1024;

function fail(code, message, details) {
  throw { code, message, details };
}

function byteLength(value) {
  return encoder.encode(value).length;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validateLimit(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    fail("invalid-source", `${name} must be a positive integer`);
  }
}

function stripFence(source) {
  return source.replace(/^\s*```(?:mermaid)?\s*/iu, "").replace(/```\s*$/u, "").trim();
}

function validateSource(request) {
  const { options } = request;
  validateLimit(options.maximumSourceBytes, "maximum-source-bytes");
  validateLimit(options.maximumElements, "maximum-elements");
  const source = stripFence(request.source);
  if (byteLength(source) > options.maximumSourceBytes) {
    fail("input-limit-exceeded", `C4 source exceeds ${options.maximumSourceBytes} bytes`);
  }
  if (!/^C4(?:Context|Container|Component|Dynamic|Deployment)\b/mu.test(source)) {
    fail("invalid-source", "Expected native Mermaid C4 syntax");
  }
  return source;
}

function prepare(request) {
  const source = validateSource(request);
  const state = encoder.encode(JSON.stringify({
    version: STATE_VERSION,
    source,
    options: request.options,
  }));
  if (state.length > MAX_STATE_BYTES) fail("input-limit-exceeded", "Compiler state is too large");
  return {
    state,
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

function readState(bytes) {
  if (!bytes || typeof bytes.length !== "number" || bytes.length === 0 || bytes.length > MAX_STATE_BYTES) {
    fail("invalid-source", "Invalid opaque compiler state");
  }
  try {
    const state = JSON.parse(decoder.decode(bytes));
    if (state.version !== STATE_VERSION || typeof state.source !== "string" || !state.options) throw new Error("shape");
    validateSource({ source: state.source, options: state.options });
    return state;
  } catch (error) {
    if (error?.code) throw error;
    fail("invalid-source", "Opaque compiler state is corrupt or unsupported");
  }
}

function validateId(id, kind) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(id)) {
    fail("invalid-layout", `${kind} has an invalid id`, String(id));
  }
}

function validateBounds(bounds, kind) {
  if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(finite)) {
    fail("invalid-layout", `${kind} has non-finite bounds`);
  }
  if (bounds.width < 0 || bounds.height < 0 || [bounds.x, bounds.y, bounds.width, bounds.height].some((value) => Math.abs(value) > MAX_COORDINATE)) {
    fail("invalid-layout", `${kind} has out-of-range bounds`);
  }
}

function color(value, fallback) {
  return typeof value === "string" && value.length <= 64 ? value : fallback;
}

function number(value, fallback, minimum, maximum) {
  return finite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function hash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function baseElement(id, type, x, y, width, height, style) {
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

function compileNode(node) {
  const allowed = new Set(["rectangle", "ellipse", "diamond"]);
  const type = allowed.has(node.shape) ? node.shape : "rectangle";
  const { x, y, width, height } = node.bounds;
  return baseElement(node.id, type, x, y, width, height, node.style ?? {});
}

function compileText(text) {
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

function compileEdge(edge, nodeIds) {
  if (edge.points.length < 2) fail("invalid-layout", `Edge ${edge.id} requires at least two points`);
  for (const point of edge.points) {
    if (!finite(point.x) || !finite(point.y) || Math.abs(point.x) > MAX_COORDINATE || Math.abs(point.y) > MAX_COORDINATE) {
      fail("invalid-layout", `Edge ${edge.id} contains an invalid point`);
    }
  }
  const start = edge.points[0];
  const localPoints = edge.points.map((point) => [point.x - start.x, point.y - start.y]);
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

function finish(stateBytes, layout) {
  const state = readState(stateBytes);
  if (!layout || !finite(layout.width) || !finite(layout.height) || layout.width <= 0 || layout.height <= 0) {
    fail("invalid-layout", "Browser adapter returned invalid canvas dimensions");
  }
  const count = layout.nodes.length + layout.edges.length + layout.texts.length;
  if (count > state.options.maximumElements) {
    fail("input-limit-exceeded", `Layout contains ${count} elements; limit is ${state.options.maximumElements}`);
  }
  const ids = new Set();
  for (const [kind, values] of [["Node", layout.nodes], ["Edge", layout.edges], ["Text", layout.texts]]) {
    for (const value of values) {
      validateId(value.id, kind);
      if (ids.has(value.id)) fail("invalid-layout", `Duplicate layout id: ${value.id}`);
      ids.add(value.id);
      if (value.bounds) validateBounds(value.bounds, `${kind} ${value.id}`);
      if (kind === "Text" && byteLength(value.text) > 65_536) fail("invalid-layout", `Text ${value.id} is too large`);
    }
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

export const compilerCore = { prepare, finish };
