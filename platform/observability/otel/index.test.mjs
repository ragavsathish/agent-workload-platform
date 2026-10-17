import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import { configureTelemetry } from "./index.mjs";

test("exports payload-free metrics and traces over OTLP HTTP", async () => {
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({ url: request.url, body: Buffer.concat(chunks) });
    response.writeHead(200, { "content-type": "application/x-protobuf" });
    response.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = `http://127.0.0.1:${address.port}`;
  process.env.OTEL_METRIC_EXPORT_INTERVAL = "100";

  const telemetry = configureTelemetry("test-node-service");
  await telemetry.observe("fixed.operation", async () => undefined);
  await assert.rejects(
    telemetry.observe("fixed.error", async () => {
      throw new Error("private transcript text");
    }),
    /private transcript text/,
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  await telemetry.shutdown();
  await new Promise((resolve) => server.close(resolve));

  assert(requests.some((request) => request.url === "/v1/metrics"));
  assert(requests.some((request) => request.url === "/v1/traces"));
  assert(!Buffer.concat(requests.map((request) => request.body)).includes("private transcript text"));
});
