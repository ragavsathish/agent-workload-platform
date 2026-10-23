import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { configureTelemetry } from "@agent-workload-platform/otel";

import { VoiceAgent } from "./voice-agent/voice-agent.js";
import { loadSettings } from "./voice-agent/voice-config.js";
import { TaskNarrator } from "./voice-agent/task-narrator.js";
import {
  closeVoiceHttpServer,
  createVoiceHttpServer,
  listenVoiceHttpServer,
} from "./voice-agent/voice-http-server.js";

export async function main(): Promise<void> {
  const settings = await loadSettings();
  const agent = await VoiceAgent.create(settings);
  const narrator = await TaskNarrator.create(settings);
  const telemetry = configureTelemetry("pipecat-pi-voice");
  const server = createVoiceHttpServer({
    agent,
    narrator,
    serviceToken: settings.serviceToken,
    telemetry,
  });
  await listenVoiceHttpServer(server, settings.listenPort, settings.listenHost);

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    const serverClosed = closeVoiceHttpServer(server);
    await agent.close();
    await serverClosed;
    await telemetry.shutdown();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
