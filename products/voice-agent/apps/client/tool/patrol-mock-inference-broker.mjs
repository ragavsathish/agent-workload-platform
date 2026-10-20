#!/usr/bin/env node

// Deterministic, local-only broker substitute for full Compose Patrol runs.
import http from "node:http";

const token = process.env.PATROL_BROKER_TOKEN;
if (!token || token.length < 32) throw new Error("PATROL_BROKER_TOKEN must contain at least 32 characters");

const json = (response, status, body) => {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
};

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1:9443");
  if (url.pathname === "/health") return json(response, 200, { status: "ok", mode: "deterministic-mock" });
  if (!url.pathname.startsWith("/v1/")) return json(response, 404, { error: "not found" });
  if (request.headers.authorization !== `Bearer ${token}`) return json(response, 401, { error: "unauthorized" });

  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  let payload = {};
  try {
    if (chunks.length) payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return json(response, 400, { error: "invalid JSON" });
  }

  if (request.method === "GET" && url.pathname === "/v1/models") {
    return json(response, 200, { object: "list", data: [{ id: "patrol-mock", object: "model", owned_by: "local" }] });
  }
  if (request.method === "POST" && url.pathname.endsWith("/chat/completions")) {
    const body = {
      id: "chatcmpl-patrol-mock",
      object: "chat.completion",
      created: 0,
      model: payload.model ?? "patrol-mock",
      choices: [{ index: 0, message: { role: "assistant", content: "Deterministic Patrol mock response." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    };
    return json(response, 200, body);
  }
  if (request.method === "POST" && url.pathname === "/v1/audio/transcriptions") {
    return json(response, 200, { text: "Deterministic Patrol mock transcript." });
  }
  if (request.method === "GET" && url.pathname === "/v1/pi/transcript") {
    return json(response, 200, { entries: [], transcript: [] });
  }
  if (request.method === "GET" && url.pathname.startsWith("/v1/pi/sessions")) {
    return json(response, 200, { sessions: [] });
  }
  if (request.method === "POST" && url.pathname.startsWith("/v1/pi/")) {
    return json(response, 200, { status: "ok", mock: true });
  }
  return json(response, 501, { error: "endpoint is not implemented by the Patrol mock", path: url.pathname });
});

server.listen(9443, "0.0.0.0", () => console.log("Patrol inference mock listening on 9443"));
