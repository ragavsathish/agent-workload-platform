import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_LISTEN_HOST = "127.0.0.1";
const DEFAULT_LISTEN_PORT = 9465;

function metricLabel(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll('"', '\\"');
}

export function parseElapsed(value) {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)$/.exec(value.trim());
  if (!match) return 0;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  return (((days * 24) + hours) * 60 + minutes) * 60 + seconds;
}

export function parseProcessTable(output) {
  const processes = new Map();
  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    processes.set(Number(match[1]), {
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      cpuPercent: Number(match[3]),
      residentMemoryBytes: Number(match[4]) * 1024,
      uptimeSeconds: parseElapsed(match[5]),
      command: match[6],
    });
  }
  return processes;
}

export function readVmRegistrations(directory) {
  const registrations = [];
  let names;
  try {
    names = readdirSync(directory).filter((name) => name.endsWith(".json"));
  } catch (error) {
    if (error?.code === "ENOENT") return registrations;
    throw error;
  }
  for (const name of names) {
    try {
      const record = JSON.parse(readFileSync(`${directory}/${name}`, "utf8"));
      if (
        typeof record.id === "string"
        && typeof record.label === "string"
        && Number.isSafeInteger(record.pid)
        && record.pid > 0
        && Number.isSafeInteger(record.cpus)
        && record.cpus > 0
        && Number.isSafeInteger(record.memoryBytes)
        && record.memoryBytes > 0
      ) {
        registrations.push(record);
      }
    } catch {
      // A partially written or stale registration must not break the scrape.
    }
  }
  return registrations;
}

export function renderMetrics(registrations, processes) {
  const lines = [
    "# HELP gondolin_vm_count Number of registered Gondolin VM runners currently alive.",
    "# TYPE gondolin_vm_count gauge",
  ];
  const live = registrations.filter((registration) => processes.has(registration.pid));
  lines.push(`gondolin_vm_count ${live.length}`);
  const definitions = [
    ["gondolin_vm_up", "Whether the registered Gondolin VM runner is alive.", "gauge"],
    ["gondolin_vm_host_cpu_percent", "Host CPU used by the VM runner, where 100 is one physical CPU.", "gauge"],
    ["gondolin_vm_cpu_allocation_ratio", "VM runner CPU divided by its configured virtual CPU capacity.", "gauge"],
    ["gondolin_vm_resident_memory_bytes", "Resident host memory used by the VM runner.", "gauge"],
    ["gondolin_vm_uptime_seconds", "Elapsed lifetime of the VM runner process.", "gauge"],
    ["gondolin_vm_configured_cpus", "Configured virtual CPU count.", "gauge"],
    ["gondolin_vm_configured_memory_bytes", "Configured guest memory limit in bytes.", "gauge"],
  ];
  for (const [name, help, type] of definitions) {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
  }
  for (const registration of registrations) {
    const labels = `vm_id="${metricLabel(registration.id)}",vm_label="${metricLabel(registration.label)}"`;
    const current = processes.get(registration.pid);
    lines.push(`gondolin_vm_up{${labels}} ${current ? 1 : 0}`);
    lines.push(`gondolin_vm_configured_cpus{${labels}} ${registration.cpus}`);
    lines.push(`gondolin_vm_configured_memory_bytes{${labels}} ${registration.memoryBytes}`);
    if (!current) continue;
    lines.push(`gondolin_vm_host_cpu_percent{${labels}} ${current.cpuPercent}`);
    lines.push(
      `gondolin_vm_cpu_allocation_ratio{${labels}} ${current.cpuPercent / (registration.cpus * 100)}`,
    );
    lines.push(`gondolin_vm_resident_memory_bytes{${labels}} ${current.residentMemoryBytes}`);
    lines.push(`gondolin_vm_uptime_seconds{${labels}} ${current.uptimeSeconds}`);
  }
  return `${lines.join("\n")}\n`;
}

function scrapeVmMetrics(metricsDirectory) {
  const processTable = execFileSync(
    "/bin/ps",
    ["-axo", "pid=,ppid=,%cpu=,rss=,etime=,command="],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  return renderMetrics(readVmRegistrations(metricsDirectory), parseProcessTable(processTable));
}

function start() {
  const metricsDirectory = process.env.GONDOLIN_METRICS_DIR;
  const fluentBitConfig = process.env.FLUENT_BIT_CONFIG;
  if (!metricsDirectory || !fluentBitConfig) {
    throw new Error("GONDOLIN_METRICS_DIR and FLUENT_BIT_CONFIG are required");
  }
  const fluentBit = spawn(
    process.env.FLUENT_BIT_BIN ?? "/opt/homebrew/bin/fluent-bit",
    ["--config", fluentBitConfig],
    { stdio: "inherit" },
  );
  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/metrics") {
      response.writeHead(404).end();
      return;
    }
    try {
      const body = scrapeVmMetrics(metricsDirectory);
      response.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
      response.end(body);
    } catch (error) {
      console.error("Gondolin metrics scrape failed", error);
      response.writeHead(500).end();
    }
  });
  server.listen(
    Number(process.env.GONDOLIN_METRICS_PORT ?? DEFAULT_LISTEN_PORT),
    process.env.GONDOLIN_METRICS_HOST ?? DEFAULT_LISTEN_HOST,
  );

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close();
    fluentBit.kill("SIGTERM");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  fluentBit.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(`Fluent Bit exited unexpectedly: code=${code} signal=${signal}`);
      server.close(() => process.exit(code ?? 1));
    } else {
      process.exit(code ?? 0);
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) start();
