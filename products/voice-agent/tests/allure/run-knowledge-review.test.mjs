import assert from 'node:assert/strict';
import test from 'node:test';

import { nodeTapResults, playwrightResults, pytestJunitResults, rustTestResults, vitestResults } from './run-knowledge-review.mjs';

test('converts Playwright cases with stable identities and failed status', () => {
  const data = { suites: [{ specs: [{ file: 'knowledge-base.spec.ts', title: 'saves correction', tests: [{
    projectName: 'knowledge-base', results: [{ status: 'failed', startTime: '2026-10-25T00:00:00Z', duration: 140,
      error: { message: 'Correction missing' } }],
  }] }] }] };
  const [result] = playwrightResults(data, 'playwright.log');
  assert.equal(result.status, 'failed');
  assert.equal(result.name, 'saves correction');
  assert.equal(result.statusDetails.message, 'Correction missing');
  assert.equal(result.attachments[0].source, 'playwright.log');
  assert.equal(result.historyId, playwrightResults(data, 'other.log')[0].historyId);
});

test('converts pytest JUnit and Cargo cases with failures intact', () => {
  const junit = '<?xml version="1.0"?><testsuites><testsuite>'
    + '<testcase classname="tests.test_gateway" name="test_ok" time="0.01" />'
    + '<testcase classname="tests.test_gateway" name="test_failure" time="0.02"><failure message="Expected &lt;value&gt;" /></testcase>'
    + '</testsuite></testsuites>';
  const py = pytestJunitResults(junit, 1000, 'gateway.log');
  assert.deepEqual(py.map((result) => result.status), ['passed', 'failed']);
  assert.equal(py[1].statusDetails.message, 'Expected <value>');
  const rust = rustTestResults('test tests::one ... ok\ntest tests::two ... FAILED\n', 1000, 'rust.log');
  assert.deepEqual(rust.map((result) => result.status), ['passed', 'failed']);
  assert.equal(rust[1].attachments[0].source, 'rust.log');
});

test('converts Vitest cases and Node TAP subtests without counting TAP totals', () => {
  const vitest = vitestResults({ testResults: [{ name: 'review.test.js', assertionResults: [
    { fullName: 'review opens form', title: 'opens form', status: 'passed', duration: 20 },
    { fullName: 'review saves form', title: 'saves form', status: 'failed', duration: 30,
      failureMessages: ['Save failed'] },
  ] }] }, 1000, 'vitest.log');
  assert.deepEqual(vitest.map((result) => result.status), ['passed', 'failed']);
  assert.equal(vitest[1].statusDetails.message, 'Save failed');
  const tap = nodeTapResults('TAP version 13\n# Subtest: save correction\nok 1 - save correction\n# Subtest: reject bad evidence\nnot ok 2 - reject bad evidence\n1..2\n# tests 2\n', 1000, 'node.log');
  assert.deepEqual(tap.map((result) => result.status), ['passed', 'failed']);
  assert.equal(tap.length, 2);
});
