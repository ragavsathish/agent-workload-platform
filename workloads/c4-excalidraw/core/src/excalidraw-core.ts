import type { ViewResult } from "prototype:excalidraw-core/diagrams";

type JsonObject = Record<string, unknown>;
type Diagrams = {
  readMe(): string;
  createView(input: string, baseInput: string): ViewResult;
  saveCheckpoint(id: string, input: string): string;
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


export const diagrams: Diagrams = { readMe, createView, saveCheckpoint };
