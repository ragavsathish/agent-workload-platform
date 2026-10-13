#!/usr/bin/env node

import { createReadStream, createWriteStream } from "node:fs";
import { readFile, rename, stat, unlink } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const adapterDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const browserDir = path.join(adapterDir, "dist", "browser");
const workDir = "/work";
const inputPath = path.join(workDir, "diagram.mmd");
const outputPath = path.join(workDir, "layout.json");
const temporaryOutputPath = path.join(workDir, "layout.json.tmp");
const maximumOutputBytes = Number(process.env.C4_MAXIMUM_OUTPUT_BYTES ?? 8_388_608);

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/input" && request.method === "GET") {
      response.setHeader("content-type", "text/plain; charset=utf-8");
      response.end(await readFile(inputPath));
      return;
    }
    if (url.pathname === "/result" && request.method === "POST") {
      await unlink(temporaryOutputPath).catch(() => undefined);
      let received = 0;
      const output = createWriteStream(temporaryOutputPath, { flags: "wx" });
      for await (const chunk of request) {
        received += chunk.length;
        if (received > maximumOutputBytes) {
          output.destroy();
          await unlink(temporaryOutputPath).catch(() => undefined);
          response.writeHead(413).end("Layout snapshot is too large");
          return;
        }
        if (!output.write(chunk)) await new Promise((resolve) => output.once("drain", resolve));
      }
      output.end();
      await new Promise((resolve, reject) => {
        output.once("finish", resolve);
        output.once("error", reject);
      });
      await rename(temporaryOutputPath, outputPath);
      response.writeHead(204).end();
      return;
    }

    const requested = url.pathname === "/" ? "converter.html" : url.pathname.slice(1);
    const resolved = path.resolve(browserDir, requested);
    if (!resolved.startsWith(`${browserDir}${path.sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const metadata = await stat(resolved);
    if (!metadata.isFile()) throw new Error("Not a file");
    response.setHeader("content-type", contentTypes.get(path.extname(resolved)) ?? "application/octet-stream");
    createReadStream(resolved).pipe(response);
  } catch (error) {
    response.writeHead(404).end(error instanceof Error ? error.message : String(error));
  }
});

server.listen(4173, "127.0.0.1", () => {
  process.stdout.write("C4_CONVERTER_READY\n");
});

process.stdin.resume();
process.stdin.on("end", () => server.close());
