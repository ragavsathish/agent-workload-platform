import type {
  AdmissionPolicy,
  ApprovedScene,
  ErrorCode,
  PipelineError,
  SceneEnvelope,
} from "diagram:c4-pipeline/types@0.1.0";

type ExcalidrawPolicy = {
  approve(scene: SceneEnvelope, policy: AdmissionPolicy): ApprovedScene;
};

type JsonObject = Record<string, unknown>;

const encoder = new TextEncoder();
const ALLOWED_TYPES = new Set(["rectangle", "ellipse", "diamond", "arrow", "line", "text", "image", "freedraw"]);
const MAX_COORDINATE = 1_000_000;

function fail(code: ErrorCode, message: string, details?: string): never {
  const error: PipelineError = details === undefined ? { code, message } : { code, message, details };
  throw error;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sceneBytes(scene: SceneEnvelope): number {
  return encoder.encode(scene.elementsJson).length + encoder.encode(scene.filesJson).length;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsExternalUrl(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value === "string") return /(?:https?|ftp):\/\//iu.test(value);
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((child) => containsExternalUrl(child, seen));
}

function validateBinding(binding: unknown, ids: ReadonlySet<string>, owner: string): void {
  if (binding == null) return;
  if (!isObject(binding) || typeof binding.elementId !== "string" || !ids.has(binding.elementId)) {
    fail("policy-rejected", `${owner} contains a dangling binding`);
  }
}

function approve(scene: SceneEnvelope, policy: AdmissionPolicy): ApprovedScene {
  if (scene.format !== "excalidraw" || scene.formatVersion !== 2) {
    fail("invalid-scene", "Expected Excalidraw scene envelope version 2");
  }
  if (!Number.isInteger(policy.maximumSceneBytes) || policy.maximumSceneBytes <= 0 || !Number.isInteger(policy.maximumElements) || policy.maximumElements <= 0) {
    fail("policy-rejected", "Policy limits must be positive integers");
  }
  if (sceneBytes(scene) > policy.maximumSceneBytes) {
    fail("policy-rejected", `Scene exceeds ${policy.maximumSceneBytes} bytes`);
  }
  let elements: unknown;
  let files: unknown;
  try {
    elements = JSON.parse(scene.elementsJson);
    files = JSON.parse(scene.filesJson);
  } catch {
    fail("invalid-scene", "Scene envelope contains invalid JSON");
  }
  if (!Array.isArray(elements) || !isObject(files)) {
    fail("invalid-scene", "Elements must be an array and files must be an object");
  }
  if (elements.length > policy.maximumElements) {
    fail("policy-rejected", `Scene contains ${elements.length} elements; limit is ${policy.maximumElements}`);
  }
  if (!policy.allowEmbeddedFiles && Object.keys(files).length > 0) {
    fail("policy-rejected", "Embedded files are not permitted");
  }
  if (!policy.allowExternalUrls && (containsExternalUrl(elements) || containsExternalUrl(files))) {
    fail("policy-rejected", "External URLs are not permitted");
  }
  const ids = new Set<string>();
  const validatedElements: JsonObject[] = [];
  for (const element of elements) {
    if (!isObject(element) || typeof element.type !== "string" || !ALLOWED_TYPES.has(element.type)) {
      fail("policy-rejected", `Element type is not permitted: ${String(isObject(element) ? element.type : undefined)}`);
    }
    if (typeof element.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/u.test(element.id) || ids.has(element.id)) {
      fail("policy-rejected", `Element id is invalid or duplicated: ${String(element.id)}`);
    }
    ids.add(element.id);
    for (const field of ["x", "y", "width", "height"]) {
      if (!finite(element[field]) || Math.abs(element[field]) > MAX_COORDINATE || ((field === "width" || field === "height") && element[field] < 0)) {
        fail("policy-rejected", `Element ${element.id} has invalid ${field}`);
      }
    }
    if ((element.type === "arrow" || element.type === "line") && (!Array.isArray(element.points) || element.points.length < 2 || element.points.some((point) => !Array.isArray(point) || point.length !== 2 || !point.every(finite)))) {
      fail("policy-rejected", `Linear element ${element.id} has invalid points`);
    }
    validatedElements.push(element);
  }
  for (const element of validatedElements) {
    if (typeof element.id !== "string") fail("invalid-scene", "Validated element changed shape");
    validateBinding(element.startBinding, ids, element.id);
    validateBinding(element.endBinding, ids, element.id);
    if (element.containerId != null && (typeof element.containerId !== "string" || !ids.has(element.containerId))) {
      fail("policy-rejected", `Element ${element.id} has a dangling container`);
    }
    if (Array.isArray(element.boundElements)) {
      for (const binding of element.boundElements) {
        validateBinding({ elementId: isObject(binding) ? binding.id : undefined }, ids, element.id);
      }
    }
  }
  const normalized = validatedElements.map((element) => ({
    ...element,
    link: policy.allowExternalUrls ? (element.link ?? null) : null,
    locked: Boolean(element.locked),
    isDeleted: false,
  }));
  return {
    scene: {
      format: "excalidraw",
      formatVersion: 2,
      elementsJson: JSON.stringify(normalized),
      filesJson: JSON.stringify(files),
    },
    warnings: [],
  };
}

export const excalidrawPolicy: ExcalidrawPolicy = { approve };
