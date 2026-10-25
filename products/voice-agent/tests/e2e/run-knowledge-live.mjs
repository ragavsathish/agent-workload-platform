#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const entryId = `${randomUUID().replaceAll('-', '')}:entry:1`;
const sourceIri = `urn:awp:digital-twin:journal:${entryId}:source`;
const entryIri = `urn:awp:digital-twin:journal:${entryId}`;
const journal = 'urn:awp:digital-twin:graph:journal';
const feedback = 'urn:awp:digital-twin:graph:journal-feedback';
const endpoint = process.env.KNOWLEDGE_E2E_OXIGRAPH || 'http://127.0.0.1:7878';
const now = new Date().toISOString();

async function update(sparql) {
  const response = await fetch(`${endpoint}/update`, {
    method: 'POST', headers: { 'Content-Type': 'application/sparql-update' }, body: sparql,
  });
  if (!response.ok) throw new Error(`Oxigraph update failed: ${response.status} ${await response.text()}`);
}

async function cleanup() {
  await update(`PREFIX schema: <https://schema.org/>
DELETE { GRAPH <${feedback}> { ?event ?predicate ?object } }
WHERE { GRAPH <${feedback}> { ?event schema:isBasedOn <${entryIri}> ; ?predicate ?object } }`);
  await update(`DELETE WHERE { GRAPH <${journal}> { <${entryIri}> ?predicate ?object } }`);
  await update(`DELETE WHERE { GRAPH <${journal}> { <${sourceIri}> ?predicate ?object } }`);
  const response = await fetch(`${endpoint}/query`, {
    method: 'POST', headers: { 'Content-Type': 'application/sparql-query',
      Accept: 'application/sparql-results+json' },
    body: `PREFIX schema: <https://schema.org/>
ASK { { GRAPH <${journal}> { <${entryIri}> ?p ?o } }
  UNION { GRAPH <${journal}> { <${sourceIri}> ?p ?o } }
  UNION { GRAPH <${feedback}> { ?event schema:isBasedOn <${entryIri}> } } }`,
  });
  if (!response.ok || (await response.json()).boolean) {
    throw new Error('Test-owned knowledge fixture was not fully removed');
  }
}

let inserted = false;
try {
  inserted = true;
  await update(`PREFIX schema: <https://schema.org/>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
INSERT DATA { GRAPH <${journal}> {
  <${sourceIri}> a schema:Message ; schema:identifier "Test-owned source turn" ;
    schema:text "Original owner turn for isolated knowledge review." .
  <${entryIri}> a schema:CreativeWork ; schema:additionalType "idea" ;
    schema:text "Review test-owned note ${entryId.slice(0, 8)}." ;
    schema:dateCreated "${now}"^^xsd:dateTime ;
    schema:isBasedOn <${sourceIri}> ; schema:keywords "Testing" .
} }`);
  const runner = fileURLToPath(new URL('./run-playwright-local', import.meta.url));
  const result = spawnSync(runner, ['knowledge-live'], {
    stdio: 'inherit', env: { ...process.env, KNOWLEDGE_E2E_ENTRY_ID: entryId },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  if (inserted) await cleanup();
}
