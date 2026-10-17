export type KnowledgePayload = Record<string, unknown>;

export type KnowledgeScope = "profile" | "learning" | "journal" | "all";

export type KnowledgeQuery = {
  scope?: KnowledgeScope;
  query?: string;
};

export type PersonalKnowledge = {
  query(input: KnowledgeQuery): Promise<KnowledgePayload>;
};

type PersonalKnowledgeOptions = {
  baseUrl: string;
  token: string;
  identity: string;
  fetch?: typeof fetch;
};

function knowledgePath(identity: string, input: KnowledgeQuery): string {
  const parameters = new URLSearchParams({
    identity,
    scope: input.scope ?? "all",
  });
  const query = input.query?.trim();
  if (query) parameters.set("query", query);
  return `/digital-twin?${parameters.toString()}`;
}

export function createPersonalKnowledge(options: PersonalKnowledgeOptions): PersonalKnowledge {
  const requestFetch = options.fetch ?? fetch;
  const baseUrl = options.baseUrl.replace(/\/$/, "");

  const request = async (path: string): Promise<KnowledgePayload> => {
    const response = await requestFetch(`${baseUrl}${path}`, {
      method: "GET",
      headers: { authorization: `Bearer ${options.token}` },
      signal: AbortSignal.timeout(30_000),
    });
    const payload: unknown = await response.json().catch(() => ({ detail: "invalid response" }));
    if (!response.ok) {
      const detail = payload && typeof payload === "object" && "detail" in payload
        ? String(payload.detail)
        : "request failed";
      throw new Error(`agent gateway rejected the request: ${detail}`);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("agent gateway returned an invalid response");
    }
    return payload as KnowledgePayload;
  };

  return {
    query: (input) => request(knowledgePath(options.identity, input)),
  };
}
