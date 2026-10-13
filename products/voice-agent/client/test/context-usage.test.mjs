import assert from 'node:assert/strict';
import test from 'node:test';

import { formatTokens } from '../src/context-usage.ts';

test('context token formatting exposes sub-thousand refreshes', () => {
  assert.equal(formatTokens(55_564), '55.6k');
  assert.equal(formatTokens(55_782), '55.8k');
  assert.notEqual(formatTokens(55_564), formatTokens(55_782));
});
