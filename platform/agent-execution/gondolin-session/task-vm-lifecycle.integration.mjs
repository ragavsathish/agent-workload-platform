import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import gondolinExtension from './dist/pi-extension.js';
import { disposeTaskVmCheckpoint, taskVmCheckpointPath } from './dist/task-vm-state.js';

const root = mkdtempSync(join(tmpdir(), 'gondolin-task-lifecycle-'));
const previousCwd = process.cwd();
const sessionFile = join(root, 'session.jsonl');

const runtime = (getSessionFile = () => sessionFile) => {
  const events = new Map();
  const commands = new Map();
  gondolinExtension({
    on: (name, handler) => events.set(name, handler),
    registerTool: () => {},
    registerCommand: (name, options) => commands.set(name, options),
  });
  const context = {
    sessionManager: { getSessionFile },
    ui: { notify: () => {} },
    shutdown: () => {},
  };
  return { events, commands, context };
};

try {
  mkdirSync(join(root, '.pi'));
  writeFileSync(join(root, '.pi', 'gondolin.json'), JSON.stringify({
    image: resolve(previousCwd, 'artifacts/gondolin-browser/aarch64'),
    memory: '1G',
    cpus: 1,
  }));
  writeFileSync(sessionFile, '{}\n');
  process.chdir(root);

  const first = runtime();
  await first.events.get('session_start')({ reason: 'startup' }, first.context);
  const firstOps = (await first.events.get('user_bash')()).operations;
  let writeOutput = '';
  const write = await firstOps.exec('printf checkpoint-verified >/opt/probe.txt', process.cwd(), { onData: (chunk) => { writeOutput += chunk; } });
  assert.equal(write.exitCode, 0, writeOutput);
  await first.events.get('session_shutdown')();
  assert.equal(existsSync(taskVmCheckpointPath(sessionFile)), true);

  const second = runtime();
  await second.events.get('session_start')({ reason: 'resume' }, second.context);
  const secondOps = (await second.events.get('user_bash')()).operations;
  let output = '';
  const read = await secondOps.exec('cat /opt/probe.txt', process.cwd(), { onData: (chunk) => { output += chunk; } });
  assert.equal(read.exitCode, 0);
  assert.equal(output.trim(), 'checkpoint-verified');
  const update = await secondOps.exec('printf second-session >/opt/probe.txt', process.cwd(), { onData: () => {} });
  assert.equal(update.exitCode, 0);
  await second.events.get('session_shutdown')();

  const third = runtime();
  await third.events.get('session_start')({ reason: 'resume' }, third.context);
  const thirdOps = (await third.events.get('user_bash')()).operations;
  let updatedOutput = '';
  const updatedRead = await thirdOps.exec('cat /opt/probe.txt', process.cwd(), { onData: (chunk) => { updatedOutput += chunk; } });
  assert.equal(updatedRead.exitCode, 0);
  assert.equal(updatedOutput.trim(), 'second-session');
  let shutdown = false;
  await third.commands.get('gondolin-dispose').handler('', {
    ui: { notify: () => {} },
    shutdown: () => { shutdown = true; },
  });
  assert.equal(shutdown, true);
  assert.equal(existsSync(taskVmCheckpointPath(sessionFile)), false);
  assert.equal(existsSync(`${taskVmCheckpointPath(sessionFile)}.lock`), false);
  await third.events.get('session_shutdown')();

  writeFileSync(taskVmCheckpointPath(sessionFile), 'invalid checkpoint');
  const failed = runtime();
  await assert.rejects(failed.events.get('session_start')({ reason: 'resume' }, failed.context));
  assert.equal(existsSync(taskVmCheckpointPath(sessionFile)), true);
  assert.equal(existsSync(`${taskVmCheckpointPath(sessionFile)}.lock`), false);
  rmSync(taskVmCheckpointPath(sessionFile));

  const otherSessionFile = join(root, 'other-session.jsonl');
  writeFileSync(otherSessionFile, '{}\n');
  let selectedSessionFile = sessionFile;
  const switching = runtime(() => selectedSessionFile);
  await switching.events.get('session_start')({ reason: 'startup' }, switching.context);
  const initialOps = (await switching.events.get('user_bash')()).operations;
  assert.equal((await initialOps.exec('printf original >/opt/probe.txt', process.cwd(), { onData: () => {} })).exitCode, 0);
  selectedSessionFile = otherSessionFile;
  await switching.events.get('session_start')({ reason: 'new', previousSessionFile: sessionFile }, switching.context);
  assert.equal(existsSync(taskVmCheckpointPath(sessionFile)), true);
  selectedSessionFile = sessionFile;
  await switching.events.get('session_start')({ reason: 'resume', previousSessionFile: otherSessionFile }, switching.context);
  const resumedOps = (await switching.events.get('user_bash')()).operations;
  let switchedOutput = '';
  assert.equal((await resumedOps.exec('cat /opt/probe.txt', process.cwd(), { onData: (chunk) => { switchedOutput += chunk; } })).exitCode, 0);
  assert.equal(switchedOutput.trim(), 'original');
  await switching.events.get('session_shutdown')();
  assert.equal(disposeTaskVmCheckpoint(sessionFile), true);
  assert.equal(disposeTaskVmCheckpoint(otherSessionFile), true);
  console.log('task VM checkpoint, resume, and explicit dispose verified');
} finally {
  process.chdir(previousCwd);
  rmSync(root, { recursive: true, force: true });
}
