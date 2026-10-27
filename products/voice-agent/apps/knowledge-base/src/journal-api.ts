import personalKnowledgeWasmUrl from './assets/personal-knowledge-browser.wasm?url';

export type JournalEntry = {
  id: string;
  text: string;
  type: 'thought' | 'idea' | 'question' | 'decision' | 'goal' | 'learning' | 'unclassified';
  recordKind?: 'journal_note' | 'codex_daily_journal';
  createdAt: string;
  sourceId: string;
  sourceLabel: string;
  transcript: string;
  topics: string[];
};

export type KnowledgeGraphNode = { id: string; label: string; kind: string; text?: string; entryId?: string };
export type KnowledgeGraphEdge = { id: string; source: string; target: string; label: string };
export type KnowledgeGraphData = { nodes: KnowledgeGraphNode[]; edges: KnowledgeGraphEdge[] };

type JournalWasm = {
  memory: WebAssembly.Memory;
  journal_query_ptr(): number;
  journal_query_len(): number;
  knowledge_graph_query_ptr(): number;
  knowledge_graph_query_len(): number;
  alloc_input(length: number): number;
  free_input(pointer: number, length: number): void;
  decode_journal_json(pointer: number, length: number): bigint;
  encode_journal_feedback_json(pointer: number, length: number): bigint;
  encode_assertion_review_json(pointer: number, length: number): bigint;
  free_output(pointer: number, length: number): void;
};

let wasmPromise: Promise<JournalWasm> | undefined;

async function instantiateJournalWasm(): Promise<JournalWasm> {
  const response = await fetch(personalKnowledgeWasmUrl);
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
        ok?: Array<Omit<JournalEntry, 'type' | 'recordKind'> & { kind: JournalEntry['type']; recordKind?: JournalEntry['recordKind'] }>;
        error?: string;
      };
      if (decoded.error) throw new Error(decoded.error);
      if (!Array.isArray(decoded.ok)) throw new Error('Journal WebAssembly returned an invalid response.');
      return decoded.ok.map(({ kind, recordKind = 'journal_note', ...entry }) => ({ ...entry, type: kind, recordKind }));
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

export async function fetchKnowledgeGraph(endpoint: string, signal?: AbortSignal): Promise<KnowledgeGraphData> {
  const wasm = await loadJournalWasm();
  const query = readWasmString(wasm, wasm.knowledge_graph_query_ptr(), wasm.knowledge_graph_query_len());
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Accept: 'application/sparql-results+json', 'Content-Type': 'application/sparql-query' },
    body: query,
    signal,
  });
  if (!response.ok) throw new Error(`Oxigraph graph request failed (${response.status}).`);
  const payload = await response.json() as { results?: { bindings?: Array<Record<string, { value: string }>> } };
  const rows = payload.results?.bindings;
  if (!Array.isArray(rows) || rows.length > 4000) throw new Error('Oxigraph returned an invalid knowledge graph.');
  const nodes = new Map<string, KnowledgeGraphNode>();
  const edges: KnowledgeGraphEdge[] = [];
  const nodeFrom = (row: Record<string, { value: string }>, side: 'from' | 'to') => {
    const id = row[side]?.value;
    if (!id) return undefined;
    const kind = row[`${side}Kind`]?.value ?? 'record';
    const label = row[`${side}Label`]?.value ?? id;
    const text = row[`${side}Text`]?.value;
    const dailyId = row[`${side}EntryId`]?.value
      ?? (kind === 'daily_journal' ? id.match(/codex-daily-journal:\d{4}-\d{2}-\d{2}$/u)?.[0] : undefined);
    const node = { id, label, kind, ...(text ? { text } : {}), ...(dailyId ? { entryId: dailyId } : {}) };
    nodes.set(id, node);
    return node;
  };
  for (const row of rows) {
    const from = nodeFrom(row, 'from');
    const to = nodeFrom(row, 'to');
    if (from && to) edges.push({ id: `${from.id}|${row.relation?.value}|${to.id}`, source: from.id, target: to.id, label: row.relation?.value ?? 'related' });
  }
  return { nodes: [...nodes.values()], edges };
}

export function configuredOxigraphEndpoint(): string | undefined {
  const endpoint = import.meta.env.VITE_OXIGRAPH_QUERY_URL?.trim();
  return endpoint || undefined;
}
