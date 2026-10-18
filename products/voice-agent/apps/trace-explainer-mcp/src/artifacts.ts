import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync, writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { unzipSync } from "fflate";

const RENDER_ID = /^[a-f0-9]{32}$/u;
const MAX_RECORDINGS = 500;
const MAX_TRACE_BYTES = 256 * 1024 * 1024;
export const MAX_NARRATION_BRIEF_CHARS = 2_000;
const RENDER_TIMEOUT_MS = 10 * 60 * 1_000;

export type TraceRecording = {
  id: string;
  name: string;
  project: string;
  run: string;
  modifiedAt: string;
  sizeBytes: number;
};

export type TraceActionSummary = {
  label: string;
  durationMs: number;
  status: "completed" | "error";
};

export type PlaywrightTraceSummary = {
  durationMs: number;
  actionCount: number;
  requestCount: number;
  errorCount: number;
  actions: TraceActionSummary[];
  preview?: { bytes: Uint8Array; mimeType: "image/jpeg" | "image/png" };
};

export type TraceScene = {
  id: string;
  title: string;
  spoken: string;
  durationSeconds: number;
  evidence: { pageId?: string; eventIds: string[] };
};

export type TraceExplainerManifest = {
  kind: "trace-explainer";
  renderId: string;
  traceId: string;
  title: string;
  status: "completed";
  summary: string;
  durationSeconds: number;
  videoUri: string;
  videoResourceUri: string;
  scenes: TraceScene[];
};

export type TraceRenderJob = {
  renderId: string;
  traceId: string;
  narrationBriefSha256: string;
  status: "pending" | "running" | "completed" | "failed";
  createdAt: string;
  updatedAt: string;
  error?: string;
};

export type RenderCommand = (
  tracePath: string,
  outputDirectory: string,
  narrationBrief: string,
) => Promise<void>;

type StoredTraceRenderJob = TraceRenderJob & { narrationBrief: string };

type RemoteRenderResponse = TraceRenderJob & { manifest?: Record<string, unknown> };

function validatedJob(value: unknown, expectedRenderId: string): TraceRenderJob {
  const job = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const status = boundedText(job.status, "", 20);
  if (
    job.renderId !== expectedRenderId
    || !RENDER_ID.test(boundedText(job.traceId, "", 32))
    || !/^[a-f0-9]{64}$/u.test(boundedText(job.narrationBriefSha256, "", 64))
    || !["pending", "running", "completed", "failed"].includes(status)
  ) throw new Error("Trace render worker returned an invalid job");
  return {
    renderId: expectedRenderId,
    traceId: String(job.traceId),
    narrationBriefSha256: String(job.narrationBriefSha256),
    status: status as TraceRenderJob["status"],
    createdAt: boundedText(job.createdAt, new Date().toISOString(), 64),
    updatedAt: boundedText(job.updatedAt, new Date().toISOString(), 64),
    ...(typeof job.error === "string" ? { error: job.error.slice(0, 1_000) } : {}),
  };
}

export class HttpTraceRenderBackend {
  readonly baseUrl: string;

  constructor(baseUrl: string) {
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error("Invalid trace render worker URL");
    this.baseUrl = parsed.toString().replace(/\/$/u, "");
  }

  private async response(renderId: string): Promise<RemoteRenderResponse> {
    const response = await fetch(`${this.baseUrl}/v1/renders/${renderId}`);
    if (!response.ok) throw new Error(`Trace render worker status failed: HTTP ${response.status}`);
    const value = await response.json() as unknown;
    const job = validatedJob(value, renderId);
    const manifest = value && typeof value === "object"
      && (value as Record<string, unknown>).manifest
      && typeof (value as Record<string, unknown>).manifest === "object"
      ? (value as { manifest: Record<string, unknown> }).manifest
      : undefined;
    return { ...job, ...(manifest ? { manifest } : {}) };
  }

  async submit(
    renderId: string,
    traceId: string,
    tracePath: string,
    narrationBrief: string,
  ): Promise<TraceRenderJob> {
    const form = new FormData();
    form.set("trace", new Blob([new Uint8Array(await readFile(tracePath))], {
      type: "application/zip",
    }), "trace.zip");
    form.set("metadata", JSON.stringify({ traceId, narrationBrief }));
    const response = await fetch(`${this.baseUrl}/v1/renders/${renderId}`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Trace render worker submission failed: HTTP ${response.status}`);
    return validatedJob(await response.json(), renderId);
  }

  async status(renderId: string): Promise<TraceRenderJob> {
    const { manifest: _manifest, ...job } = await this.response(renderId);
    return job;
  }

  async manifest(renderId: string): Promise<Record<string, unknown>> {
    const response = await this.response(renderId);
    if (response.status !== "completed" || !response.manifest) {
      throw new Error(`Trace render is ${response.status}`);
    }
    return response.manifest;
  }

  async video(renderId: string): Promise<Uint8Array> {
    const response = await fetch(`${this.baseUrl}/v1/renders/${renderId}/video`);
    if (!response.ok) throw new Error(`Trace render worker video failed: HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
}

function opaqueId(path: string): string {
  return createHash("sha256").update(path).digest("hex").slice(0, 32);
}

function below(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path !== ".." && !path.startsWith(`..${sep}`) && !path.startsWith(sep);
}

function boundedText(value: unknown, fallback = "", limit = 4_000): string {
  return typeof value === "string" ? value.slice(0, limit) : fallback;
}

export function validatedNarrationBrief(value: unknown): string {
  if (typeof value !== "string") throw new Error("narration brief is required");
  const brief = value.trim();
  if (!brief) throw new Error("narration brief is required");
  if (brief.length > MAX_NARRATION_BRIEF_CHARS) {
    throw new Error(`narration brief exceeds ${MAX_NARRATION_BRIEF_CHARS} characters`);
  }
  return brief;
}

function publicJob(job: StoredTraceRenderJob): TraceRenderJob {
  const { narrationBrief: _narrationBrief, ...visible } = job;
  return visible;
}

function boundedSeconds(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 3_600)) : 0;
}

function displayName(directory: string): string {
  return directory
    .replace(/^tests-test-/u, "")
    .replace(/--[a-f0-9]{5,}--/gu, " — ")
    .replace(/[-_]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim() || directory;
}

function recordingContext(relativePath: string): Pick<TraceRecording, "name" | "project" | "run"> {
  const segments = relativePath.split(sep).slice(0, -1);
  const directory = segments.at(-1) ?? "trace";
  const resultsIndex = segments.lastIndexOf("results");
  const project = resultsIndex >= 0
    ? segments[resultsIndex + 1] ?? "unknown"
    : segments.at(-2) ?? "unknown";
  const run = [...segments].reverse().find((segment) => /^\d{8}T\d{6}Z(?:-\d+)?$/u.test(segment))
    ?? segments.at(-2)
    ?? "unknown";
  return { name: displayName(directory), project, run };
}

function searchTokens(value: string): string[] {
  return value.toLocaleLowerCase("en-US").match(/[a-z0-9]+/gu) ?? [];
}

const traceDecoder = new TextDecoder();

function traceLines(bytes: Uint8Array | undefined): Record<string, unknown>[] {
  if (!bytes) return [];
  return traceDecoder.decode(bytes)
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        return parsed && typeof parsed === "object" ? [parsed as Record<string, unknown>] : [];
      } catch {
        return [];
      }
    });
}

function traceActionLabel(event: Record<string, unknown>): string {
  const method = boundedText(event.method, "Action", 80);
  const params = event.params && typeof event.params === "object"
    ? event.params as Record<string, unknown>
    : {};
  const target = boundedText(params.selector, "element", 160)
    .replace(/^internal:/u, "")
    .replace(/\s*>>\s*nth=\d+$/u, "")
    .replace(/^text=/u, "text ");
  if (method === "newPage") return "Create page";
  if (method === "goto") return `Navigate to ${boundedText(params.url, "page", 180)}`;
  if (method === "click") return `Click ${target}`;
  if (method === "waitForSelector") return `Wait for ${target}`;
  if (method === "waitForLoadState") {
    return `Wait for ${boundedText(params.state, "page", 80)}`;
  }
  if (method === "waitForEventInfo") return "Wait for page event";
  if (method === "screenshot") return "Capture screenshot";
  return method.replaceAll(/([a-z])([A-Z])/gu, "$1 $2");
}

export function processRenderer(rendererScript: string): RenderCommand {
  return (tracePath, outputDirectory, narrationBrief) => new Promise((resolvePromise, reject) => {
    mkdirSync(outputDirectory, { recursive: true, mode: 0o700 });
    const narrationContextPath = join(outputDirectory, "narration-context.json");
    writeFileSync(narrationContextPath, `${JSON.stringify({ narrationBrief })}\n`, { mode: 0o600 });
    const log = createWriteStream(join(outputDirectory, "renderer.log"), {
      flags: "a",
      mode: 0o600,
    });
    log.write(`[${new Date().toISOString()}] starting trace renderer\n`);
    const child = spawn(
      process.execPath,
      [rendererScript, tracePath, outputDirectory, narrationContextPath],
      {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let errorOutput = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      log.end(`[${new Date().toISOString()}] renderer timed out\n`);
      reject(new Error("Trace renderer exceeded its ten-minute limit"));
    }, RENDER_TIMEOUT_MS);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (errorOutput.length < 16_384) errorOutput += chunk;
      log.write(chunk);
    });
    child.stdout.pipe(log, { end: false });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      log.end(`[${new Date().toISOString()}] renderer spawn failed: ${error.message}\n`);
      reject(error);
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      log.end(`[${new Date().toISOString()}] renderer exited ${String(code)}\n`);
      if (code === 0) resolvePromise();
      else reject(new Error(`Trace renderer exited ${code}: ${errorOutput.trim()}`));
    });
  });
}

export class TraceArtifactStore {
  readonly artifactRoot: string;
  readonly outputRoot: string;
  private renderQueue: Promise<void> = Promise.resolve();
  private readonly summaryCache = new Map<string, Promise<PlaywrightTraceSummary>>();

  constructor(
    artifactRoot: string,
    outputRoot: string,
    private readonly renderCommand: RenderCommand,
    private readonly remoteBackend?: HttpTraceRenderBackend,
  ) {
    this.artifactRoot = resolve(artifactRoot);
    this.outputRoot = resolve(outputRoot);
  }

  private async tracePaths(): Promise<string[]> {
    const found: string[] = [];
    const visit = async (directory: string, depth = 0): Promise<void> => {
      if (found.length >= MAX_RECORDINGS || depth > 10) return;
      let entries;
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (["EACCES", "ENOENT", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) {
          return;
        }
        throw error;
      }
      for (const entry of entries) {
        if (found.length >= MAX_RECORDINGS) break;
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await visit(path, depth + 1);
        else if (entry.isFile() && entry.name === "trace.zip") found.push(path);
      }
    };
    await visit(this.artifactRoot);
    return found;
  }

  async list(): Promise<TraceRecording[]> {
    const recordings = await Promise.all((await this.tracePaths()).map(async (path) => {
      const info = await stat(path);
      const relativePath = relative(this.artifactRoot, path);
      return {
        id: opaqueId(relativePath),
        ...recordingContext(relativePath),
        modifiedAt: info.mtime.toISOString(),
        sizeBytes: info.size,
      };
    }));
    return recordings.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
  }

  async search(query = "", limit = 10): Promise<TraceRecording[]> {
    const recordings = await this.list();
    const terms = searchTokens(query);
    if (terms.length === 0) return recordings.slice(0, limit);
    return recordings
      .map((recording) => {
        const haystack = searchTokens(`${recording.name} ${recording.project} ${recording.run}`);
        const matched = terms.filter((term) => haystack.some((token) => token.includes(term)));
        return { recording, score: matched.length / terms.length };
      })
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score
        || right.recording.modifiedAt.localeCompare(left.recording.modifiedAt))
      .slice(0, limit)
      .map(({ recording }) => recording);
  }

  async tracePath(traceId: string): Promise<string> {
    if (!RENDER_ID.test(traceId)) throw new Error("Invalid trace ID");
    for (const path of await this.tracePaths()) {
      if (opaqueId(relative(this.artifactRoot, path)) !== traceId) continue;
      const info = await stat(path);
      if (!info.isFile()) throw new Error("Trace recording is not a file");
      if (info.size > MAX_TRACE_BYTES) throw new Error("Trace recording exceeds 256 MiB");
      return path;
    }
    throw new Error("Trace recording was not found");
  }

  async recording(traceId: string): Promise<TraceRecording> {
    const recording = (await this.list()).find(({ id }) => id === traceId);
    if (!recording) throw new Error("Trace recording was not found");
    return recording;
  }

  private async inspectTrace(traceId: string): Promise<PlaywrightTraceSummary> {
    const archive = new Uint8Array(await readFile(await this.tracePath(traceId)));
    const metadata = unzipSync(archive, {
      filter: ({ name }) => name === "trace.trace" || name === "trace.network",
    });
    const events = traceLines(metadata["trace.trace"]);
    const calls = new Map<string, { label: string; startTime: number }>();
    const actions: TraceActionSummary[] = [];
    let startTime = Number.POSITIVE_INFINITY;
    let endTime = 0;
    let errorCount = 0;
    let previewName = "";
    for (const event of events) {
      const type = boundedText(event.type, "", 40);
      if (type === "screencast-frame") {
        const sha1 = boundedText(event.sha1, "", 300);
        if (/^[A-Za-z0-9@._-]+\.(?:jpeg|png)$/u.test(sha1)) previewName = `resources/${sha1}`;
        continue;
      }
      if (type === "console" && event.messageType === "error") errorCount += 1;
      if (type === "pageError" || type === "error") errorCount += 1;
      const callId = boundedText(event.callId, "", 160);
      if (!callId) continue;
      if (type === "before") {
        if (event.class === "Route") continue;
        const callStart = Number(event.startTime);
        if (!Number.isFinite(callStart)) continue;
        calls.set(callId, { label: traceActionLabel(event), startTime: callStart });
        startTime = Math.min(startTime, callStart);
      } else if (type === "after") {
        const call = calls.get(callId);
        if (!call) continue;
        const callEnd = Number(event.endTime);
        const failed = Boolean(event.error);
        if (failed) errorCount += 1;
        const safeEnd = Number.isFinite(callEnd) ? callEnd : call.startTime;
        endTime = Math.max(endTime, safeEnd);
        actions.push({
          label: call.label.slice(0, 240),
          durationMs: Math.max(0, Math.round(safeEnd - call.startTime)),
          status: failed ? "error" : "completed",
        });
      }
    }
    const requestCount = traceLines(metadata["trace.network"])
      .filter(({ type }) => type === "resource-snapshot").length;
    let preview: PlaywrightTraceSummary["preview"];
    if (previewName) {
      const extracted = unzipSync(archive, { filter: ({ name }) => name === previewName });
      const bytes = extracted[previewName];
      if (bytes) {
        preview = {
          bytes,
          mimeType: previewName.endsWith(".png") ? "image/png" : "image/jpeg",
        };
      }
    }
    return {
      durationMs: Number.isFinite(startTime) ? Math.max(0, Math.round(endTime - startTime)) : 0,
      actionCount: actions.length,
      requestCount,
      errorCount,
      actions: actions.slice(0, 12),
      ...(preview ? { preview } : {}),
    };
  }

  traceSummary(traceId: string): Promise<PlaywrightTraceSummary> {
    const cached = this.summaryCache.get(traceId);
    if (cached) return cached;
    const summary = this.inspectTrace(traceId);
    this.summaryCache.set(traceId, summary);
    summary.catch(() => this.summaryCache.delete(traceId));
    return summary;
  }

  async tracePreview(traceId: string): Promise<NonNullable<PlaywrightTraceSummary["preview"]>> {
    const preview = (await this.traceSummary(traceId)).preview;
    if (!preview) throw new Error("Trace preview is unavailable");
    return preview;
  }

  renderDirectory(renderId: string): string {
    if (!RENDER_ID.test(renderId)) throw new Error("Invalid render ID");
    const directory = resolve(this.outputRoot, renderId);
    if (!below(this.outputRoot, directory)) throw new Error("Invalid render path");
    return directory;
  }

  videoPath(renderId: string): string {
    return join(this.renderDirectory(renderId), "trace-explainer.mp4");
  }

  private jobPath(renderId: string): string {
    return join(this.renderDirectory(renderId), "job.json");
  }

  private async writeJob(job: StoredTraceRenderJob): Promise<void> {
    const directory = this.renderDirectory(job.renderId);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `job.${process.pid}.tmp`);
    await writeFile(temporary, `${JSON.stringify(job, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.jobPath(job.renderId));
  }

  private async readStoredJob(renderId: string): Promise<StoredTraceRenderJob> {
    const raw = JSON.parse(await readFile(this.jobPath(renderId), "utf8")) as StoredTraceRenderJob;
    if (
      raw.renderId !== renderId
      || !RENDER_ID.test(raw.traceId)
      || !/^[a-f0-9]{64}$/u.test(raw.narrationBriefSha256)
      || validatedNarrationBrief(raw.narrationBrief) !== raw.narrationBrief
      || !["pending", "running", "completed", "failed"].includes(raw.status)
    ) throw new Error("Invalid trace render job");
    return raw;
  }

  async readJob(renderId: string): Promise<TraceRenderJob> {
    if (this.remoteBackend) return this.remoteBackend.status(renderId);
    return publicJob(await this.readStoredJob(renderId));
  }

  private schedule(job: StoredTraceRenderJob): void {
    const operation = this.renderQueue.then(async () => {
      const running: StoredTraceRenderJob = {
        ...job,
        status: "running",
        updatedAt: new Date().toISOString(),
      };
      await this.writeJob(running);
      try {
        await this.renderNow(job.traceId, job.narrationBrief, job.renderId);
        await this.writeJob({
          ...running,
          status: "completed",
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        await this.writeJob({
          ...running,
          status: "failed",
          updatedAt: new Date().toISOString(),
          error: (error instanceof Error ? error.message : String(error)).slice(0, 1_000),
        });
      }
    });
    this.renderQueue = operation.then(() => undefined, () => undefined);
  }

  async enqueue(traceId: string, narrationBriefValue: unknown): Promise<TraceRenderJob> {
    const narrationBrief = validatedNarrationBrief(narrationBriefValue);
    const tracePath = await this.tracePath(traceId);
    const now = new Date().toISOString();
    const job: StoredTraceRenderJob = {
      renderId: randomUUID().replaceAll("-", ""),
      traceId,
      narrationBrief,
      narrationBriefSha256: createHash("sha256").update(narrationBrief).digest("hex"),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };
    if (this.remoteBackend) {
      return this.remoteBackend.submit(job.renderId, traceId, tracePath, narrationBrief);
    }
    await this.writeJob(job);
    this.schedule(job);
    return publicJob(job);
  }

  async recover(): Promise<void> {
    if (this.remoteBackend) return;
    await mkdir(this.outputRoot, { recursive: true, mode: 0o700 });
    for (const entry of await readdir(this.outputRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !RENDER_ID.test(entry.name)) continue;
      try {
        const job = await this.readStoredJob(entry.name);
        if (job.status === "pending" || job.status === "running") {
          this.schedule({ ...job, status: "pending", updatedAt: new Date().toISOString() });
        }
      } catch {
        // Render directories created before durable jobs have no job.json.
      }
    }
  }

  private async renderNow(
    traceId: string,
    narrationBrief: string,
    renderId = randomUUID().replaceAll("-", ""),
  ): Promise<TraceExplainerManifest> {
    if (!RENDER_ID.test(traceId)) throw new Error("Invalid trace ID");
    const tracePath = await this.tracePath(traceId);
    const traceInfo = await stat(tracePath);
    if (traceInfo.size > MAX_TRACE_BYTES) throw new Error("Trace recording exceeds 256 MiB");
    const outputDirectory = this.renderDirectory(renderId);
    await this.renderCommand(tracePath, outputDirectory, narrationBrief);
    return this.readManifest(renderId, traceId);
  }

  render(traceId: string, narrationBrief: string): Promise<TraceExplainerManifest> {
    if (this.remoteBackend) {
      return Promise.reject(new Error("Direct host rendering is disabled for the remote backend"));
    }
    const validatedBrief = validatedNarrationBrief(narrationBrief);
    const operation = this.renderQueue.then(() => this.renderNow(traceId, validatedBrief));
    this.renderQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async readManifest(renderId: string, traceId = ""): Promise<TraceExplainerManifest> {
    const raw = this.remoteBackend
      ? await this.remoteBackend.manifest(renderId)
      : JSON.parse(await readFile(
        join(this.renderDirectory(renderId), "manifest.json"),
        "utf8",
      )) as Record<string, unknown>;
    const rawScenes = Array.isArray(raw.scenes) ? raw.scenes.slice(0, 50) : [];
    const scenes = rawScenes.map((value, index): TraceScene => {
      const scene = value && typeof value === "object" ? value as Record<string, unknown> : {};
      const evidence = scene.evidence && typeof scene.evidence === "object"
        ? scene.evidence as Record<string, unknown>
        : {};
      return {
        id: boundedText(scene.id, `scene-${index + 1}`, 120),
        title: boundedText(scene.title, boundedText(scene.id, `Scene ${index + 1}`, 120), 200),
        spoken: boundedText(scene.spoken),
        durationSeconds: boundedSeconds(scene.durationSeconds),
        evidence: {
          ...(typeof evidence.pageId === "string"
            ? { pageId: evidence.pageId.slice(0, 200) }
            : {}),
          eventIds: Array.isArray(evidence.eventIds)
            ? evidence.eventIds.slice(0, 20).map((id) => String(id).slice(0, 120))
            : [],
        },
      };
    });
    if (!this.remoteBackend) {
      const video = this.videoPath(renderId);
      const videoInfo = await stat(video);
      if (!videoInfo.isFile()) throw new Error("Rendered video is missing");
    }
    return {
      kind: "trace-explainer",
      renderId,
      traceId,
      title: boundedText(raw.title, basename(traceId) || "Playwright trace explainer", 200),
      status: "completed",
      summary: boundedText(raw.summary, `${scenes.length} narrated scenes`, 500),
      durationSeconds: boundedSeconds(raw.durationSeconds ?? raw.outputDurationSeconds),
      videoUri: `/api/trace-explainers/${renderId}/video`,
      videoResourceUri: `trace-explainer://renders/${renderId}/video`,
      scenes,
    };
  }

  async readVideo(renderId: string): Promise<Uint8Array> {
    if (!RENDER_ID.test(renderId)) throw new Error("Invalid render ID");
    if (this.remoteBackend) return this.remoteBackend.video(renderId);
    return new Uint8Array(await readFile(this.videoPath(renderId)));
  }
}
