import { disposeTaskVmCheckpoint } from "./task-vm-state.js";

const [command, sessionFile] = process.argv.slice(2);
if (command !== "dispose" || !sessionFile || process.argv.length !== 4) {
  console.error("Usage: task-vm-cli dispose <pi-session-file>");
  process.exitCode = 2;
} else {
  try {
    const removed = disposeTaskVmCheckpoint(sessionFile);
    console.log(removed ? "Disposed saved Gondolin task VM disk" : "No saved Gondolin task VM disk");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
