const encoder = new TextEncoder();
const ALLOWED_TYPES = new Set(["rectangle", "ellipse", "diamond", "arrow", "line", "text", "image", "freedraw"]);
const MAX_COORDINATE = 1_000_000;

function fail(code, message, details) {
  throw { code, message, details };
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function sceneBytes(scene) {
  return encoder.encode(scene.elementsJson).length + encoder.encode(scene.filesJson).length;
}

function containsExternalUrl(value, seen = new Set()) {
  if (typeof value === "string") return /(?:https?|ftp):\/\//iu.test(value);
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((child) => containsExternalUrl(child, seen));
}

function validateBinding(binding, ids, owner) {
  if (binding == null) return;
  if (typeof binding !== "object" || typeof binding.elementId !== "string" || !ids.has(binding.elementId)) {
    fail("policy-rejected", `${owner} contains a dangling binding`);
  }
}

function approve(scene, policy) {
  if (scene.format !== "excalidraw" || scene.formatVersion !== 2) {
    fail("invalid-scene", "Expected Excalidraw scene envelope version 2");
  }
  if (!Number.isInteger(policy.maximumSceneBytes) || policy.maximumSceneBytes <= 0 || !Number.isInteger(policy.maximumElements) || policy.maximumElements <= 0) {
    fail("policy-rejected", "Policy limits must be positive integers");
  }
  if (sceneBytes(scene) > policy.maximumSceneBytes) {
    fail("policy-rejected", `Scene exceeds ${policy.maximumSceneBytes} bytes`);
  }
  let elements;
  let files;
  try {
    elements = JSON.parse(scene.elementsJson);
    files = JSON.parse(scene.filesJson);
  } catch {
    fail("invalid-scene", "Scene envelope contains invalid JSON");
  }
  if (!Array.isArray(elements) || !files || Array.isArray(files) || typeof files !== "object") {
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
  const ids = new Set();
  for (const element of elements) {
    if (!element || typeof element !== "object" || !ALLOWED_TYPES.has(element.type)) {
      fail("policy-rejected", `Element type is not permitted: ${String(element?.type)}`);
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
  }
  for (const element of elements) {
    validateBinding(element.startBinding, ids, element.id);
    validateBinding(element.endBinding, ids, element.id);
    if (element.containerId != null && !ids.has(element.containerId)) {
      fail("policy-rejected", `Element ${element.id} has a dangling container`);
    }
    if (Array.isArray(element.boundElements)) {
      for (const binding of element.boundElements) validateBinding({ elementId: binding?.id }, ids, element.id);
    }
  }
  const normalized = elements.map((element) => ({
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

export const excalidrawPolicy = { approve };
