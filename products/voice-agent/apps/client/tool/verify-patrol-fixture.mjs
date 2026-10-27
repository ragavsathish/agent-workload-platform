import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function verifyPatrolFixture(evidence, nonce) {
  assert.equal(evidence.fixture, 'voice-agent-patrol');
  assert.equal(evidence.nonce, nonce);
  assert.equal(evidence.activeTurn, null, 'the test must leave no running turn');
  assert.match(evidence.activeSessionId, /^fixture-live-\d+$/,
    'the browser must create a fresh session');

  const events = evidence.events;
  assert.ok(Array.isArray(events) && events.length > 0, 'no browser mutations reached the fixture');
  assert.ok(events.every((event) => event.method === 'POST' && event.status < 400),
    'all fixture mutations must succeed');
  const paths = events.map((event) => event.path);
  for (const path of [
    '/api/pi-sessions/fixture-history/resume',
    '/api/pi-context/compact',
    '/api/pi-turn/abort',
    '/api/tasks',
    '/api/tasks/fixture-task-2/cancel',
    '/api/pi-sessions/new',
  ]) {
    assert.ok(paths.includes(path), `browser did not call ${path}`);
  }
  assert.ok(paths.filter((path) => path === '/api/pi-message').length >= 6,
    'the browser did not exercise all typed and MCP App turns');

  const tasks = new Map(evidence.tasks.map((task) => [task.id, task]));
  assert.equal(tasks.get('fixture-task')?.status, 'submitted');
  assert.equal(tasks.get('fixture-task-2')?.status, 'cancelled');
  assert.equal(tasks.get('fixture-task-2')?.instruction, 'Publish the fixture report');
  return { mutationCount: events.length, taskCount: tasks.size, activeSessionId: evidence.activeSessionId };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [path, nonce] = process.argv.slice(2);
  if (!path || !nonce) throw new Error('Usage: verify-patrol-fixture.mjs EVIDENCE_JSON NONCE');
  console.log(JSON.stringify(verifyPatrolFixture(JSON.parse(readFileSync(path, 'utf8')), nonce)));
}
