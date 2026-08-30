import type { ViewResult } from "prototype:excalidraw-core/diagrams";

type JsonObject = Record<string, unknown>;
type Shape = "rectangle" | "ellipse";

interface C4Node {
  id: string;
  type: string;
  name: string;
  technology: string;
  description: string;
}

interface C4Relation {
  from: string;
  to: string;
  label: string;
  technology: string;
}

interface C4Model {
  title: string;
  nodes: C4Node[];
  relations: C4Relation[];
}

interface Position {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface C4ElementStyle {
  shape: Shape;
  backgroundColor: string;
  strokeColor: string;
}

type Diagrams = {
  readMe(): string;
  createView(input: string, baseInput: string): ViewResult;
  saveCheckpoint(id: string, input: string): string;
  mermaidToElements(mermaid: string): string;
};

const MAX_INPUT_BYTES = 5 * 1024 * 1024;

const instructions = `Excalidraw elements are supplied as a JSON array. Start with a cameraUpdate pseudo-element, then rectangles, ellipses, diamonds, arrows, and text. Every drawn element needs a unique id, type, x, y, width, and height. Use {"type":"restoreCheckpoint","id":"..."} to restore state and {"type":"delete","ids":"a,b"} to remove restored elements.`;

function ok<T>(value: T): T {
  return value;
}

function err(message: string): never {
  throw message;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{1,64}$/u.test(id);
}

function checkpointId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function parseElements(input: string): unknown[] {
  if (new TextEncoder().encode(input).length > MAX_INPUT_BYTES) {
    throw new Error(`Input exceeds ${MAX_INPUT_BYTES} bytes`);
  }
  const parsed: unknown = JSON.parse(input);
  if (!Array.isArray(parsed)) throw new Error("Elements must be a JSON array");
  return parsed;
}

function readMe(): string {
  return instructions;
}

function createView(input: string, baseInput: string): ViewResult {
  try {
    const parsed = parseElements(input);
    const restore = parsed.find((element) => isObject(element) && element.type === "restoreCheckpoint");
    let resolved: unknown[];

    if (isObject(restore) && typeof restore.id === "string") {
      if (!validId(restore.id)) return err("Invalid checkpoint id");
      if (!baseInput) return err(`Checkpoint ${restore.id} not supplied by host`);
      const base = parseElements(baseInput);

      const deleted = new Set<string>();
      for (const element of parsed) {
        if (!isObject(element) || element.type !== "delete") continue;
        for (const id of String(element.ids ?? element.id ?? "").split(",")) {
          if (id.trim()) deleted.add(id.trim());
        }
      }

      const retained = base.filter((element) => {
        if (!isObject(element)) return true;
        return !deleted.has(String(element.id ?? "")) && !deleted.has(String(element.containerId ?? ""));
      });
      const added = parsed.filter((element) =>
        !isObject(element) || (element.type !== "restoreCheckpoint" && element.type !== "delete"));
      resolved = [...retained, ...added];
    } else {
      resolved = parsed.filter((element) => !isObject(element) || element.type !== "delete");
    }

    let warning = "";
    for (const camera of parsed.filter((element): element is JsonObject => isObject(element) && element.type === "cameraUpdate")) {
      if (typeof camera.width !== "number" || typeof camera.height !== "number" || !camera.width || !camera.height) continue;
      if (Math.abs(camera.width / camera.height - 4 / 3) > 0.15) {
        warning = `Camera ${camera.width}x${camera.height} is not close to 4:3`;
        break;
      }
    }

    const id = checkpointId();
    return ok({ checkpointId: id, elements: JSON.stringify(resolved), warning });
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

function saveCheckpoint(id: string, input: string): string {
  try {
    if (!validId(id)) return err("Invalid checkpoint id");
    const elements = parseElements(input);
    return ok(JSON.stringify(elements));
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

function splitMermaidArgs(source: string): string[] {
  const args: string[] = [];
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
      args.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  args.push(current.trim());
  return args.map((value) => value.replace(/^"|"$/gu, "").trim());
}

function safeElementId(id: string): string {
  return `c4_${id.replace(/[^a-zA-Z0-9_-]/gu, "_")}`;
}

function c4Style(type: string): C4ElementStyle {
  if (type.startsWith("Person")) return { shape: "ellipse", backgroundColor: "#a5d8ff", strokeColor: "#1971c2" };
  if (type.includes("Db")) return { shape: "rectangle", backgroundColor: "#d0bfff", strokeColor: "#7048e8" };
  if (type.includes("Queue")) return { shape: "rectangle", backgroundColor: "#ffe8cc", strokeColor: "#e67700" };
  if (type.startsWith("System_Ext")) return { shape: "rectangle", backgroundColor: "#e9ecef", strokeColor: "#868e96" };
  if (type.startsWith("System")) return { shape: "rectangle", backgroundColor: "#74c0fc", strokeColor: "#1971c2" };
  if (type.startsWith("Component")) return { shape: "rectangle", backgroundColor: "#c3fae8", strokeColor: "#099268" };
  return { shape: "rectangle", backgroundColor: "#b2f2bb", strokeColor: "#2f9e44" };
}

function parseC4Mermaid(input: string): C4Model {
  if (new TextEncoder().encode(input).length > MAX_INPUT_BYTES) return err(`Input exceeds ${MAX_INPUT_BYTES} bytes`);
  const source = input.replace(/^```(?:mermaid)?\s*/iu, "").replace(/```\s*$/u, "");
  const lines = source.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const header = lines.find((line) => /^C4(?:Context|Container|Component)$/u.test(line));
  if (!header) return err("Expected Mermaid C4Context, C4Container, or C4Component syntax");

  const nodes: C4Node[] = [];
  const relations: C4Relation[] = [];
  let title = header;
  for (const line of lines) {
    if (line.startsWith("%%") || line === header || line === "{") continue;
    const titleMatch = /^title\s+(.+)$/iu.exec(line);
    if (titleMatch) {
      title = (titleMatch[1] ?? "").trim();
      continue;
    }
    const declaration = /^(Person(?:_Ext)?|System(?:_Ext)?|Container(?:Db|Queue)?|Component)\s*\((.*)\)\s*$/u.exec(line);
    if (declaration) {
      const args = splitMermaidArgs(declaration[2] ?? "");
      const [id, name] = args;
      const declarationType = declaration[1];
      if (!declarationType) return err(`Invalid C4 declaration: ${line}`);
      const hasTechnology = declarationType.startsWith("Container") || declarationType === "Component";
      const technology = hasTechnology ? (args[2] ?? "") : "";
      const description = hasTechnology ? (args[3] ?? "") : (args[2] ?? "");
      if (!id || !name) return err(`Invalid C4 declaration: ${line}`);
      if (nodes.some((node) => node.id === id)) return err(`Duplicate C4 id: ${id}`);
      nodes.push({ id, type: declarationType, name, technology, description });
      continue;
    }
    const relationship = /^Rel(?:_[RLUD])?\s*\((.*)\)\s*$/u.exec(line);
    if (relationship) {
      const [from, to, label = "", technology = ""] = splitMermaidArgs(relationship[1] ?? "");
      if (!from || !to) return err(`Invalid C4 relationship: ${line}`);
      relations.push({ from, to, label, technology });
      continue;
    }
    if (/^(?:System|Container|Enterprise)_Boundary\s*\(/u.test(line) || line === "}" || /^(?:Update|Lay_|SHOW_|HIDE_)/u.test(line)) continue;
    return err(`Unsupported Mermaid C4 line: ${line}`);
  }
  if (nodes.length === 0) return err("The Mermaid C4 diagram contains no supported elements");
  if (nodes.length > 20) return err("Prototype renderer supports at most 20 C4 elements");
  return { title, nodes, relations };
}

function requiredPosition(positions: ReadonlyMap<string, Position>, id: string): Position {
  const position = positions.get(id);
  if (!position) return err(`Missing layout position for ${id}`);
  return position;
}

function layoutC4(model: C4Model): JsonObject[] {
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  for (const relation of model.relations) {
    if (!byId.has(relation.from) || !byId.has(relation.to)) {
      return err(`Relationship references unknown id: ${relation.from} -> ${relation.to}`);
    }
  }

  const level = new Map<string, number>(model.nodes.map((node) => [node.id, 0]));
  for (let pass = 0; pass < model.nodes.length; pass++) {
    let changed = false;
    for (const relation of model.relations) {
      const next = Math.min(4, (level.get(relation.from) ?? 0) + 1);
      if (next > (level.get(relation.to) ?? 0)) {
        level.set(relation.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const columns = new Map<number, C4Node[]>();
  for (const node of model.nodes) {
    const column = level.get(node.id) ?? 0;
    const columnNodes = columns.get(column) ?? [];
    columnNodes.push(node);
    columns.set(column, columnNodes);
  }
  const sortedColumns = [...columns.keys()].sort((a, b) => a - b);
  const positions = new Map<string, Position>();
  const nodeWidth = 250;
  const nodeHeight = 120;
  for (let columnIndex = 0; columnIndex < sortedColumns.length; columnIndex++) {
    const columnKey = sortedColumns[columnIndex];
    if (columnKey === undefined) continue;
    const columnNodes = columns.get(columnKey) ?? [];
    for (let row = 0; row < columnNodes.length; row++) {
      const node = columnNodes[row];
      if (!node) continue;
      positions.set(node.id, {
        x: 70 + columnIndex * 340,
        y: 130 + row * 170,
        width: nodeWidth,
        height: nodeHeight,
      });
    }
  }

  const maxX = Math.max(...[...positions.values()].map((position) => position.x + position.width)) + 70;
  const maxY = Math.max(...[...positions.values()].map((position) => position.y + position.height)) + 70;
  const camera = maxX <= 800 && maxY <= 600
    ? { width: 800, height: 600 }
    : maxX <= 1200 && maxY <= 900
      ? { width: 1200, height: 900 }
      : { width: 1600, height: 1200 };
  const elements: JsonObject[] = [
    { type: "cameraUpdate", x: 0, y: 0, width: camera.width, height: camera.height },
    { type: "text", id: "c4_title", x: 70, y: 40, text: model.title, fontSize: 28, strokeColor: "#1e1e1e" },
  ];

  for (const node of model.nodes) {
    const position = requiredPosition(positions, node.id);
    const style = c4Style(node.type);
    const details = [node.name, `[${node.type.replace("_Ext", " (External)")}]`];
    if (node.technology) details.push(node.technology);
    if (node.description) details.push(node.description);
    elements.push({
      type: style.shape,
      id: safeElementId(node.id),
      ...position,
      roundness: style.shape === "rectangle" ? { type: 3 } : undefined,
      backgroundColor: style.backgroundColor,
      fillStyle: "solid",
      strokeColor: style.strokeColor,
      strokeWidth: 2,
      label: { text: details.join("\n"), fontSize: 16 },
    });
  }

  for (let index = 0; index < model.relations.length; index++) {
    const relation = model.relations[index];
    if (!relation) continue;
    const from = requiredPosition(positions, relation.from);
    const to = requiredPosition(positions, relation.to);
    const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
    const horizontal = Math.abs(toCenter.x - fromCenter.x) >= Math.abs(toCenter.y - fromCenter.y);
    const start = horizontal
      ? { x: toCenter.x >= fromCenter.x ? from.x + from.width : from.x, y: fromCenter.y }
      : { x: fromCenter.x, y: toCenter.y >= fromCenter.y ? from.y + from.height : from.y };
    const end = horizontal
      ? { x: toCenter.x >= fromCenter.x ? to.x : to.x + to.width, y: toCenter.y }
      : { x: toCenter.x, y: toCenter.y >= fromCenter.y ? to.y : to.y + to.height };
    const label = [relation.label, relation.technology].filter(Boolean).join(" · ");
    elements.push({
      type: "arrow",
      id: `c4_rel_${index + 1}`,
      x: start.x,
      y: start.y,
      width: end.x - start.x,
      height: end.y - start.y,
      points: [[0, 0], [end.x - start.x, end.y - start.y]],
      strokeColor: "#495057",
      strokeWidth: 2,
      endArrowhead: "arrow",
      startBinding: { elementId: safeElementId(relation.from), fixedPoint: [0.5, 0.5] },
      endBinding: { elementId: safeElementId(relation.to), fixedPoint: [0.5, 0.5] },
      label: label ? { text: label, fontSize: 14 } : undefined,
    });
  }
  return elements;
}

function mermaidToElements(mermaid: string): string {
  try {
    return ok(JSON.stringify(layoutC4(parseC4Mermaid(mermaid))));
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

export const diagrams: Diagrams = { readMe, createView, saveCheckpoint, mermaidToElements };
