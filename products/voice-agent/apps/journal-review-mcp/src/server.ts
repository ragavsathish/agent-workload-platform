import { readFile } from "node:fs/promises";

import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

export const APP_RESOURCE_URI = "ui://journal-review/main.html";

export type ReviewOutcome = "pending" | "accepted" | "edited" | "rejected" | "missed" | "empty";

export interface JournalReviewPresentation {
  kind: "journal-review";
  reviewId: string;
  title: string;
  source: string;
  transcript: string;
  suggestion: {
    id: string;
    type: string;
    statement: string;
    topics: string[];
    confidence: number;
    evidence?: { quote: string; start: number; end: number };
  };
  progress: { current: number; total: number; reviewed: number };
  outcome: ReviewOutcome;
}

const fixtureTranscript = [
  "I want to improve the prompt and annotate examples first.",
  "Use reviewed labels before training a model.",
  "The voice session should query Oxigraph for knowledge and keep the review visible.",
].join(" ");
const fixtureQuote = "Use reviewed labels before training a model.";
const fixtureStart = fixtureTranscript.indexOf(fixtureQuote);

export const fixtureReview = (): JournalReviewPresentation => ({
  kind: "journal-review",
  reviewId: "review-local-001",
  title: "Review journal extraction",
  source: "Voice session · local fixture",
  transcript: fixtureTranscript,
  suggestion: {
    id: "suggestion-001",
    type: "decision",
    statement: fixtureQuote,
    topics: ["evaluation", "annotation", "training"],
    confidence: 0.91,
    evidence: { quote: fixtureQuote, start: fixtureStart, end: fixtureStart + fixtureQuote.length },
  },
  progress: { current: 1, total: 40, reviewed: 0 },
  outcome: "pending",
});

const resultFor = (presentation: JournalReviewPresentation, text: string): CallToolResult => ({
  content: [
    { type: "text", text },
    {
      type: "text",
      text: [
        "Use this exact object as the final response's presentation field and add a short spoken string:",
        JSON.stringify(presentation),
      ].join(" "),
    },
  ],
  structuredContent: { presentation },
});

export function createServer(appHtmlPath: string): McpServer {
  const server = new McpServer({ name: "Journal Review", version: "0.1.0" });
  const reviews = new Map<string, JournalReviewPresentation>();
  const initial = fixtureReview();
  reviews.set(initial.reviewId, initial);

  registerAppTool(
    server,
    "render_journal_review",
    {
      title: "Render journal review",
      description: "Open one journal extraction suggestion for human evidence review.",
      inputSchema: z.object({ reviewId: z.string().max(200).default(initial.reviewId) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      _meta: { ui: { resourceUri: APP_RESOURCE_URI } },
    },
    async ({ reviewId }): Promise<CallToolResult> => {
      const presentation = reviews.get(reviewId);
      if (!presentation) return {
        content: [{ type: "text", text: "The requested journal review is unavailable." }],
        isError: true,
      };
      return resultFor(presentation, `Reviewing journal suggestion ${presentation.suggestion.id}.`);
    },
  );

  registerAppTool(
    server,
    "review_active",
    {
      title: "Review active journal suggestion",
      description: [
        "Apply a human review decision to the active journal suggestion.",
        "Use natural conversation to infer the outcome and include only explicit corrections.",
      ].join(" "),
      inputSchema: z.object({
        reviewId: z.string().max(200),
        suggestionId: z.string().max(200),
        outcome: z.enum(["accepted", "edited", "rejected", "missed", "empty"]),
        changes: z.object({
          type: z.string().max(80).optional(),
          statement: z.string().max(2_000).optional(),
          topics: z.array(z.string().max(100)).max(16).optional(),
          evidence: z.object({
            quote: z.string().max(4_000),
            start: z.number().int().nonnegative(),
            end: z.number().int().positive(),
          }).optional(),
        }).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      _meta: { ui: { resourceUri: APP_RESOURCE_URI } },
    },
    async ({ reviewId, suggestionId, outcome, changes }): Promise<CallToolResult> => {
      const active = reviews.get(reviewId);
      if (!active || active.suggestion.id !== suggestionId) return {
        content: [{ type: "text", text: "The active journal suggestion changed; reload before reviewing." }],
        isError: true,
      };
      if (changes?.evidence) {
        const { start, end, quote } = changes.evidence;
        if (end <= start || active.transcript.slice(start, end) !== quote) return {
          content: [{ type: "text", text: "Evidence must be an exact quote from the transcript." }],
          isError: true,
        };
      }
      const updated: JournalReviewPresentation = {
        ...active,
        outcome,
        suggestion: {
          ...active.suggestion,
          ...(changes?.type ? { type: changes.type } : {}),
          ...(changes?.statement ? { statement: changes.statement } : {}),
          ...(changes?.topics ? { topics: changes.topics } : {}),
          ...(changes?.evidence ? { evidence: changes.evidence } : {}),
        },
        progress: {
          ...active.progress,
          reviewed: active.outcome === "pending" ? active.progress.reviewed + 1 : active.progress.reviewed,
        },
      };
      reviews.set(reviewId, updated);
      return resultFor(updated, `Journal suggestion ${suggestionId} marked ${outcome}.`);
    },
  );

  server.registerTool(
    "get_review_status",
    {
      title: "Get journal review status",
      description: "Return opaque review progress without exposing transcript text.",
      inputSchema: z.object({ reviewId: z.string().max(200) }),
      annotations: { readOnlyHint: true },
    },
    async ({ reviewId }): Promise<CallToolResult> => {
      const review = reviews.get(reviewId);
      if (!review) return { content: [{ type: "text", text: "Review unavailable." }], isError: true };
      return {
        content: [{ type: "text", text: `${review.progress.reviewed}/${review.progress.total} reviewed.` }],
        structuredContent: {
          reviewId,
          suggestionId: review.suggestion.id,
          outcome: review.outcome,
          progress: review.progress,
        },
      };
    },
  );

  registerAppResource(
    server,
    APP_RESOURCE_URI,
    APP_RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => ({
      contents: [{
        uri: APP_RESOURCE_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: await readFile(appHtmlPath, "utf8"),
        _meta: { ui: { prefersBorder: false } },
      }],
    }),
  );

  return server;
}
