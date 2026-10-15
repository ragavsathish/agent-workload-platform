import assert from 'node:assert/strict';
import test from 'node:test';

import { parseTranscriptResponse } from '../src/transcript-response.ts';

test('parses a completed spoken and Mermaid response', () => {
  assert.deepEqual(
    parseTranscriptResponse(
      JSON.stringify({
        spoken: 'The service is ready.',
        mermaid: 'flowchart TD\n  Voice --> Pi',
      })
    ),
    {
      spoken: 'The service is ready.',
      mermaid: 'flowchart TD\n  Voice --> Pi',
    }
  );
});

test('accepts an outer JSON code fence and strips a Mermaid code fence', () => {
  const raw = `\`\`\`json
{"spoken":"Done.","mermaid":"\`\`\`mermaid\\nflowchart TD\\n  A --> B\\n\`\`\`"}
\`\`\``;
  assert.deepEqual(parseTranscriptResponse(raw), {
    spoken: 'Done.',
    mermaid: 'flowchart TD\n  A --> B',
  });
});

test('does not expose partial JSON while a response is running', () => {
  assert.equal(parseTranscriptResponse('{"spoken":"Still'), undefined);
});

test('rejects unsupported diagrams and oversized spoken output', () => {
  assert.equal(
    parseTranscriptResponse(JSON.stringify({ spoken: 'Done.', mermaid: 'not a diagram' })),
    undefined
  );
  assert.equal(
    parseTranscriptResponse(
      JSON.stringify({ spoken: 'x'.repeat(2_001), mermaid: 'flowchart TD\n  A --> B' })
    ),
    undefined
  );
});
