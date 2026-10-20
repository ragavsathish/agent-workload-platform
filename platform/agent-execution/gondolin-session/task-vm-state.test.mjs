import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  disposeTaskVmCheckpoint,
  taskVmCheckpointPath,
  TaskVmLease,
} from './dist/task-vm-state.js';

test('a saved task VM cannot be disposed or resumed by a second owner', () => {
  const root = mkdtempSync(join(tmpdir(), 'gondolin-task-state-'));
  try {
    const session = join(root, 'task.jsonl');
    const checkpoint = taskVmCheckpointPath(session);
    writeFileSync(checkpoint, 'saved disk');
    const lease = TaskVmLease.acquire(checkpoint);
    assert.throws(() => TaskVmLease.acquire(checkpoint), /already active/u);
    assert.throws(() => disposeTaskVmCheckpoint(session), /is active/u);
    assert.equal(readFileSync(checkpoint, 'utf8'), 'saved disk');
    lease.release();
    assert.equal(disposeTaskVmCheckpoint(session), true);
    assert.equal(disposeTaskVmCheckpoint(session), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a stale owner record does not strand a saved task VM', () => {
  const root = mkdtempSync(join(tmpdir(), 'gondolin-task-stale-'));
  try {
    const checkpoint = taskVmCheckpointPath(join(root, 'task.jsonl'));
    writeFileSync(`${checkpoint}.lock`, '99999999\n');
    const lease = TaskVmLease.acquire(checkpoint);
    lease.release();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
