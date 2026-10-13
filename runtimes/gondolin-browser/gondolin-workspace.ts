import fs from "node:fs";
import path from "node:path";

import {
  createHttpHooks,
  RealFSProvider,
  ReadonlyProvider,
  VM,
  type ExecResult,
} from "@earendil-works/gondolin";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const MAX_OUTPUT_CHARS = 24_000;

type WorkspaceOptions = {
  imagePath: string;
  localCwd: string;
  skillsDir: string;
  sessionLabel: string;
};

function bounded(value: string): string {
  if (value.length <= MAX_OUTPUT_CHARS) return value;
  return `${value.slice(0, MAX_OUTPUT_CHARS)}\n[output truncated]`;
}

function resultText(result: ExecResult): string {
  const stdout = result.stdout.trimEnd();
  const stderr = result.stderr.trimEnd();
  const body = [stdout, stderr && `[stderr]\n${stderr}`].filter(Boolean).join("\n");
  return bounded(body || `(exit code ${result.exitCode})`);
}

export class GondolinWorkspace {
  private constructor(private readonly vm: VM) {}

  static async create(options: WorkspaceOptions): Promise<GondolinWorkspace> {
    if (!fs.existsSync(options.imagePath)) {
      throw new Error(`Missing Gondolin assets: ${options.imagePath}`);
    }
    if (!fs.existsSync(options.localCwd)) {
      throw new Error(`Missing voice workspace: ${options.localCwd}`);
    }
    if (!fs.existsSync(options.skillsDir)) {
      throw new Error(`Missing voice skills directory: ${options.skillsDir}`);
    }
    const { httpHooks } = createHttpHooks({ allowedHosts: [] });
    const vm = await VM.create({
      sandbox: { imagePath: path.resolve(options.imagePath) },
      httpHooks,
      vfs: {
        mounts: {
          "/workspace": new RealFSProvider(path.resolve(options.localCwd)),
          "/skills": new ReadonlyProvider(new RealFSProvider(path.resolve(options.skillsDir))),
        },
      },
      memory: "2G",
      cpus: 2,
      sessionLabel: options.sessionLabel,
    });
    return new GondolinWorkspace(vm);
  }

  tools() {
    return [
      defineTool({
        name: "gondolin_bash",
        label: "Gondolin bash",
        description: "Run a bounded shell command inside the Gondolin micro-VM workspace.",
        promptSnippet: "Use the isolated VM for repository inspection and changes.",
        parameters: Type.Object({
          command: Type.String({ description: "A shell command to run in /workspace." }),
        }, { additionalProperties: false }),
        execute: async (_toolCallId, params, signal) => {
          const result = await this.vm.exec(["/bin/sh", "-lc", params.command], {
            cwd: "/workspace",
            env: { HOME: "/tmp/pi-home", PI_SKILLS_DIR: "/skills" },
            signal,
          });
          return {
            content: [{ type: "text" as const, text: resultText(result) }],
            details: { exitCode: String(result.exitCode), sandbox: "gondolin" },
          };
        },
      }),
    ];
  }

  async close(): Promise<void> {
    await this.vm.close();
  }
}
