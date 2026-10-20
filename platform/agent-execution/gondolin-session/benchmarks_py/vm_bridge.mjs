// The Gondolin SDK is JavaScript-only. Keep this adapter limited to VM operations.
import readline from "node:readline";
import { GondolinSession } from "../dist/session.js";

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let session;
const asText = (value) => {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  if (value?.type === "Buffer" && Array.isArray(value.data)) return Buffer.from(value.data).toString("utf8");
  return "";
};
process.on("SIGTERM", () => {
  void Promise.resolve(session?.close()).finally(() => process.exit(143));
});

for await (const line of input) {
  let request;
  try {
    request = JSON.parse(line);
    let result;
    if (request.operation === "start") {
      if (session) throw new Error("VM already started");
      session = new GondolinSession(request.options);
      await session.start();
      result = { ready: true };
    } else if (request.operation === "run") {
      if (!session) throw new Error("VM is not started");
      const execution = await session.run(request.command);
      result = {
        exitCode: execution.exitCode,
        stdout: asText(execution.stdout ?? execution._stdout),
        stderr: asText(execution.stderr ?? execution._stderr),
      };
    } else if (request.operation === "checkpoint") {
      if (!session) throw new Error("VM is not started");
      await session.checkpoint(request.path);
      session = undefined;
      result = { saved: true };
    } else if (request.operation === "close") {
      await session?.close();
      session = undefined;
      result = { closed: true };
    } else {
      throw new Error(`Unsupported VM operation: ${request.operation}`);
    }
    process.stdout.write(`${JSON.stringify({ id: request.id, ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      id: request?.id ?? null,
      ok: false,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    })}\n`);
  }
}
await session?.close();
