import request from "request";
import type {
  Fact,
  QueryResponse,
  Scope,
} from "voice:personal-knowledge/types@0.1.0";

const MAX_QUERY_CHARS = 200;

function optionalQuery(value: string | undefined): string | undefined {
  const query = value?.trim();
  if (!query) return undefined;
  if (query.length > MAX_QUERY_CHARS) {
    throw new Error(`query exceeds ${MAX_QUERY_CHARS} characters`);
  }
  return query;
}

function isScope(value: unknown): value is Scope {
  return value === "profile" || value === "learning" || value === "journal" || value === "all";
}

function isFact(value: unknown): value is Fact {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fact = value as Record<string, unknown>;
  return typeof fact.kind === "string"
    && typeof fact.label === "string"
    && typeof fact.source === "string";
}

function validPayload(payload: string): QueryResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error("personal knowledge gateway returned invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("personal knowledge gateway returned an invalid response");
  }
  const response = parsed as Record<string, unknown>;
  if (!isScope(response.scope)
    || typeof response.query !== "string"
    || !Array.isArray(response.facts)
    || !response.facts.every(isFact)) {
    throw new Error("personal knowledge gateway returned an invalid response");
  }
  return {
    scope: response.scope,
    query: response.query,
    facts: response.facts,
  };
}

export function queryPersonalKnowledge(
  scope: Scope | undefined,
  query: string | undefined,
): QueryResponse {
  const parameters = [`scope=${encodeURIComponent(scope ?? "all")}`];
  const normalizedQuery = optionalQuery(query);
  if (normalizedQuery) {
    parameters.push(`query=${encodeURIComponent(normalizedQuery)}`);
  }
  return validPayload(request(`/digital-twin?${parameters.join("&")}`));
}
