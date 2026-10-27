import assert from "node:assert/strict";
import test from "node:test";

import { digitalTwinVmConfig } from "../../dist/digital-twin/runtime/task-runner.js";

test("digital twin configuration maps model, classifier, and fixed journal writer routes", async () => {
  const config = digitalTwinVmConfig({
    DIGITAL_TWIN_IMAGE_REF: "digital-twin-ingest:test",
    DIGITAL_TWIN_MODEL_BASE_URL: "http://127.0.0.1:11434",
    DIGITAL_TWIN_MODEL: "qwen-test",
    DIGITAL_TWIN_CLASSIFIER_BASE_URL: "http://127.0.0.1:8010",
    DIGITAL_TWIN_CLASSIFIER_MODEL: "von-test",
    DIGITAL_TWIN_WRITER_BASE_URL: "http://127.0.0.1:9444",
    DIGITAL_TWIN_WRITER_TOKEN: "writer-secret",
  });

  assert.equal(config.imagePath, "digital-twin-ingest:test");
  assert.deepEqual(config.network.allowedHosts, []);
  assert.equal(config.environment.DIGITAL_TWIN_MODEL, "qwen-test");
  assert.equal(config.environment.DIGITAL_TWIN_CLASSIFIER_MODEL, "von-test");
  assert.equal(config.environment.DIGITAL_TWIN_WRITER_TOKEN, "writer-secret");

  const model = config.network.onRequest(new Request("http://model.local:11434/api/chat"));
  const writer = config.network.onRequest(
    new Request("http://writer.local:9444/v1/digital-twin/journal"),
  );
  const dailyWriter = config.network.onRequest(
    new Request("http://writer.local:9444/v1/digital-twin/daily-journal"),
  );
  const classifier = config.network.onRequest(
    new Request("http://classifier.local:8010/v1/systemone"),
  );
  const denied = config.network.onRequest(new Request("https://example.com/"));
  assert.equal(model.url, "http://127.0.0.1:11434/api/chat");
  assert.equal(writer.url, "http://127.0.0.1:9444/v1/digital-twin/journal");
  assert.equal(dailyWriter.url, "http://127.0.0.1:9444/v1/digital-twin/daily-journal");
  assert.equal(classifier.url, "http://127.0.0.1:8010/v1/systemone");
  assert.equal(denied.status, 403);
});
