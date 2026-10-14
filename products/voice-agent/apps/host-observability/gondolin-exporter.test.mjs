import assert from "node:assert/strict";
import test from "node:test";

import { parseElapsed, parseProcessTable, renderMetrics } from "./gondolin-exporter.mjs";

test("parses macOS elapsed process times", () => {
  assert.equal(parseElapsed("04:05"), 245);
  assert.equal(parseElapsed("02:04:05"), 7445);
  assert.equal(parseElapsed("3-02:04:05"), 266645);
});

test("renders one labeled Gondolin VM without exposing command text", () => {
  const processes = parseProcessTable(
    " 321  100  75.5  524288  01:02:03 qemu-system-aarch64 --secret argument\n",
  );
  const output = renderMetrics([
    { id: "vm-1", label: "pi-voice", pid: 321, cpus: 2, memoryBytes: 2147483648 },
  ], processes);
  assert.match(output, /gondolin_vm_count 1/);
  assert.match(output, /gondolin_vm_cpu_allocation_ratio\{[^}]+\} 0\.3775/);
  assert.match(output, /gondolin_vm_resident_memory_bytes\{[^}]+\} 536870912/);
  assert.doesNotMatch(output, /secret|argument/);
});

test("reports a stopped registration as down", () => {
  const output = renderMetrics([
    { id: "vm-2", label: "task", pid: 999, cpus: 2, memoryBytes: 2147483648 },
  ], new Map());
  assert.match(output, /gondolin_vm_count 0/);
  assert.match(output, /gondolin_vm_up\{[^}]+\} 0/);
  assert.doesNotMatch(output, /gondolin_vm_host_cpu_percent\{/);
});
