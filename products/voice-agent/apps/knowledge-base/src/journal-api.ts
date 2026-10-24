export type JournalEntry = {
  id: string;
  text: string;
  type: 'thought' | 'idea' | 'question' | 'decision' | 'goal' | 'learning';
  createdAt: string;
  sourceId: string;
  sourceLabel: string;
  transcript: string;
  topics: string[];
};

type JournalWasm = {
  memory: WebAssembly.Memory;
  journal_query_ptr(): number;
  journal_query_len(): number;
  alloc_input(length: number): number;
  free_input(pointer: number, length: number): void;
  decode_journal_json(pointer: number, length: number): bigint;
  encode_journal_feedback_json(pointer: number, length: number): bigint;
  encode_assertion_review_json(pointer: number, length: number): bigint;
  free_output(pointer: number, length: number): void;
};

let wasmPromise: Promise<JournalWasm> | undefined;

async function instantiateJournalWasm(): Promise<JournalWasm> {
  const wasmUrl = new URL(`${import.meta.env.BASE_URL}knowledge-wasm/personal-knowledge-browser.wasm`, window.location.origin);
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`Journal WebAssembly load failed (${response.status}).`);
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {});
  return instance.exports as unknown as JournalWasm;
}

function encodeCommand(wasm: JournalWasm, command: object, encoder: (pointer: number, length: number) => bigint): string {
  const payload = new TextEncoder().encode(JSON.stringify(command));
  const pointer = wasm.alloc_input(payload.length);
  try {
    new Uint8Array(wasm.memory.buffer, pointer, payload.length).set(payload);
    const packed = encoder(pointer, payload.length);
    const outputPointer = Number(packed >> 32n);
    const outputLength = Number(packed & 0xffff_ffffn);
    try {
      const result = JSON.parse(readWasmString(wasm, outputPointer, outputLength)) as { ok?: string; error?: string };
      if (result.error) throw new Error(result.error);
      if (typeof result.ok !== 'string') throw new Error('Journal WebAssembly returned an invalid command.');
      return result.ok;
    } finally {
      wasm.free_output(outputPointer, outputLength);
    }
  } finally {
    wasm.free_input(pointer, payload.length);
  }
}

async function postCommand(entryId: string, suffix: string, command: object, encoder: keyof Pick<JournalWasm, 'encode_journal_feedback_json' | 'encode_assertion_review_json'>): Promise<void> {
  const wasm = await loadJournalWasm();
  const body = encodeCommand(wasm, { entryId, ...command }, (pointer, length) => wasm[encoder](pointer, length));
  const response = await fetch(`/api/knowledge/journal/${encodeURIComponent(entryId)}/${suffix}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
  if (!response.ok) throw new Error(`Knowledge review could not be saved (${response.status}).`);
}

export async function saveJournalFeedback(entryId: string, command: object): Promise<void> {
  return postCommand(entryId, 'feedback', command, 'encode_journal_feedback_json');
}

export async function saveAssertionReview(entryId: string, command: object): Promise<void> {
  return postCommand(entryId, 'assertion-review', command, 'encode_assertion_review_json');
}

export async function fetchAssertionReview(entryId: string): Promise<{ ownerAuthored: boolean; expectedKind?: string; expectedProfileField?: string; reason: string } | null> {
  const response = await fetch(`/api/knowledge/journal/${encodeURIComponent(entryId)}/assertion-review`);
  if (!response.ok) throw new Error(`Assertion review could not be loaded (${response.status}).`);
  const result = await response.json() as { review?: Record<string, string> | null };
  if (!result.review) return null;
  return {
    ownerAuthored: result.review.ownerAuthored === 'true' || result.review.ownerAuthored === '1',
    expectedKind: result.review.expectedKind,
    expectedProfileField: result.review.expectedProfileField,
    reason: result.review.reason ?? '',
  };
}

function loadJournalWasm(): Promise<JournalWasm> {
  wasmPromise ??= instantiateJournalWasm();
  return wasmPromise;
}

function readWasmString(wasm: JournalWasm, pointer: number, length: number): string {
  return new TextDecoder().decode(new Uint8Array(wasm.memory.buffer, pointer, length));
}

function decodeJournal(wasm: JournalWasm, payload: Uint8Array): JournalEntry[] {
  const pointer = wasm.alloc_input(payload.length);
  try {
    new Uint8Array(wasm.memory.buffer, pointer, payload.length).set(payload);
    const packed = wasm.decode_journal_json(pointer, payload.length);
    const outputPointer = Number(packed >> 32n);
    const outputLength = Number(packed & 0xffff_ffffn);
    try {
      const decoded = JSON.parse(readWasmString(wasm, outputPointer, outputLength)) as {
        ok?: Array<Omit<JournalEntry, 'type'> & { kind: JournalEntry['type'] }>;
        error?: string;
      };
      if (decoded.error) throw new Error(decoded.error);
      if (!Array.isArray(decoded.ok)) throw new Error('Journal WebAssembly returned an invalid response.');
      return decoded.ok.map(({ kind, ...entry }) => ({ ...entry, type: kind }));
    } finally {
      wasm.free_output(outputPointer, outputLength);
    }
  } finally {
    wasm.free_input(pointer, payload.length);
  }
}

export async function fetchJournalEntries(
  endpoint: string,
  signal?: AbortSignal,
): Promise<JournalEntry[]> {
  const wasm = await loadJournalWasm();
  const query = readWasmString(wasm, wasm.journal_query_ptr(), wasm.journal_query_len());
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/sparql-results+json',
      'Content-Type': 'application/sparql-query',
    },
    body: query,
    signal,
  });
  if (!response.ok) throw new Error(`Oxigraph request failed (${response.status}).`);
  const payload = new Uint8Array(await response.arrayBuffer());
  if (payload.length > 2_000_000) throw new Error('Journal response is too large.');
  return decodeJournal(wasm, payload);
}

export function configuredOxigraphEndpoint(): string | undefined {
  const endpoint = import.meta.env.VITE_OXIGRAPH_QUERY_URL?.trim();
  return endpoint || undefined;
}
