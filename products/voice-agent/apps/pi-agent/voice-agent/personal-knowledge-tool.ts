import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import type { KnowledgePayload, PersonalKnowledge } from "./personal-knowledge.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details: { service: string; tool: string };
};

const digitalTwinQueryParameters = Type.Object(
  {
    query: Type.Optional(Type.String({
      description: "Plain-language topic filter, such as DDD or medical device risk.",
      maxLength: 200,
    })),
    scope: Type.Optional(Type.Union([
      Type.Literal("profile"),
      Type.Literal("learning"),
      Type.Literal("journal"),
      Type.Literal("all"),
    ])),
  },
  { additionalProperties: false },
);

function toolResult(payload: KnowledgePayload): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    details: { service: "agent-gateway", tool: "query_personal_knowledge" },
  };
}

export function createPersonalKnowledgeTool(knowledge: PersonalKnowledge) {
  return defineTool({
    name: "query_personal_knowledge",
    label: "Query personal knowledge",
    description:
      "Read profile facts, learning evidence, and lightweight thoughts or ideas from the owner's private digital twin. This cannot write RDF or run arbitrary SPARQL.",
    promptSnippet: "Query the owner's private profile, learning evidence, and cognitive journal.",
    parameters: digitalTwinQueryParameters,
    execute: async (_toolCallId, params) => toolResult(await knowledge.query(params)),
  });
}
