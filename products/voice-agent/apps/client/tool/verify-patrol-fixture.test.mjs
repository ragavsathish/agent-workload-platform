import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyPatrolFixture } from './verify-patrol-fixture.mjs';

const paths = [
  '/api/pi-sessions/fixture-history/resume',
  '/api/pi-context/compact',
  '/api/pi-turn/abort',
  '/api/tasks/fixture-task/approve',
  '/api/tasks',
  '/api/tasks/fixture-task-2/cancel',
  '/api/pi-sessions/new',
  ...Array(6).fill('/api/pi-message'),
];
const evidence = {
  fixture: 'voice-agent-patrol',
  nonce: 'run-1',
  activeTurn: null,
  activeSessionId: 'fixture-live-2',
  events: paths.map((path) => ({ method: 'POST', path, status: 200 })),
  tasks: [
    { id: 'fixture-task', status: 'approved' },
    { id: 'fixture-task-2', status: 'cancelled', instruction: 'Publish the fixture report' },
  ],
};

test('accepts a completed fixture journey', () => {
  assert.equal(verifyPatrolFixture(evidence, 'run-1').mutationCount, paths.length);
});

test('rejects a missing browser action or failed mutation', () => {
  assert.throws(() => verifyPatrolFixture({
    ...evidence,
    events: evidence.events.filter((event) => event.path !== '/api/tasks/fixture-task/approve'),
  }, 'run-1'), /did not call.*approve/);
  assert.throws(() => verifyPatrolFixture({
    ...evidence,
    events: [{ method: 'POST', path: '/api/tasks', status: 500 }, ...evidence.events],
  }, 'run-1'), /mutations must succeed/);
});

test('rejects stale or incomplete fixture evidence', () => {
  assert.throws(() => verifyPatrolFixture(evidence, 'another-run'));
  assert.throws(() => verifyPatrolFixture({ ...evidence, activeTurn: { id: 'running' } }, 'run-1'));
});
