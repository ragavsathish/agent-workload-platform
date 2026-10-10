import assert from 'node:assert/strict';
import test from 'node:test';

import { publicWebSocketUrl } from '../src/websocket-url.ts';

test('removes Pipecat internal port for production HTTPS', () => {
  assert.equal(
    publicWebSocketUrl('wss://127.0.0.1:7860/ws-client', 'signed.token', {
      protocol: 'https:',
      hostname: 'pipecat-edge.example.ts.net',
      port: '',
      href: 'https://pipecat-edge.example.ts.net/',
    }),
    'wss://pipecat-edge.example.ts.net/ws-client/signed.token'
  );
});

test('keeps an explicit browser development port', () => {
  assert.equal(
    publicWebSocketUrl('ws://127.0.0.1:7860/ws-client', undefined, {
      protocol: 'http:',
      hostname: 'localhost',
      port: '5173',
      href: 'http://localhost:5173/',
    }),
    'ws://localhost:5173/ws-client'
  );
});
