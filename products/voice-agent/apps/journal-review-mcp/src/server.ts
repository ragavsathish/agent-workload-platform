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

interface JournalReviewItem {
  id: string;
  source: string;
  transcript: string;
  suggestion: JournalReviewPresentation["suggestion"];
  outcome: ReviewOutcome;
}

interface ReviewQueue {
  title: string;
  items: JournalReviewItem[];
  currentIndex: number;
}

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
    confidence?: number;
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
  progress: { current: 1, total: 1, reviewed: 0 },
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
  const reviews = new Map<string, ReviewQueue>();
  const initial = fixtureReview();
  reviews.set(initial.reviewId, {
    title: initial.title,
    currentIndex: 0,
    items: [{
      id: initial.suggestion.id,
      source: initial.source,
      transcript: initial.transcript,
      suggestion: initial.suggestion,
      outcome: initial.outcome,
    }],
  });

  const presentationAt = (reviewId: string, queue: ReviewQueue): JournalReviewPresentation => {
    const item = queue.items[queue.currentIndex];
    return {
      kind: "journal-review",
      reviewId,
      title: queue.title,
      source: item.source,
      transcript: item.transcript,
      suggestion: item.suggestion,
      progress: {
        current: queue.currentIndex + 1,
        total: queue.items.length,
        reviewed: queue.items.filter(({ outcome }) => outcome !== "pending").length,
      },
      outcome: item.outcome,
    };
  };

  const itemSchema = z.object({
    id: z.string().min(1).max(200),
    source: z.string().max(200).default("Voice session"),
    transcript: z.string().min(1).max(12_000),
    type: z.string().min(1).max(80),
    statement: z.string().min(1).max(2_000),
    topics: z.array(z.string().max(100)).max(16).default([]),
    confidence: z.number().min(0).max(1).optional(),
    evidence: z.object({
      quote: z.string().min(1).max(4_000),
      start: z.number().int().nonnegative(),
      end: z.number().int().positive(),
    }).optional(),
  });

  registerAppTool(
    server,
    "render_journal_review",
    {
      title: "Render journal review",
      description: "Open a review queue. Pass ordered items to create or replace a queue; omit items to reopen its current item.",
      inputSchema: z.object({
        reviewId: z.string().max(200).default(initial.reviewId),
        title: z.string().max(200).default(initial.title),
        items: z.array(itemSchema).min(1).max(200).optional(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      _meta: { ui: { resourceUri: APP_RESOURCE_URI } },
    },
    async ({ reviewId, title, items }): Promise<CallToolResult> => {
      if (items) {
        const queueItems: JournalReviewItem[] = items.map((item) => ({
          id: item.id,
          source: item.source,
          transcript: item.transcript,
          suggestion: {
            id: item.id,
            type: item.type,
            statement: item.statement,
            topics: item.topics,
            ...(item.confidence !== undefined ? { confidence: item.confidence } : {}),
            ...(item.evidence ? { evidence: item.evidence } : {}),
          },
          outcome: "pending",
        }));
        const invalidEvidence = queueItems.find(({ transcript, suggestion }) => {
          const evidence = suggestion.evidence;
          return evidence && transcript.slice(evidence.start, evidence.end) !== evidence.quote;
        });
        if (invalidEvidence) return {
          content: [{ type: "text", text: `Evidence for ${invalidEvidence.id} must be an exact quote from its transcript.` }],
          isError: true,
        };
        reviews.set(reviewId, { title, items: queueItems, currentIndex: 0 });
      }
      const queue = reviews.get(reviewId);
      if (!queue) return {
        content: [{ type: "text", text: "The requested journal review is unavailable." }],
        isError: true,
      };
      const presentation = presentationAt(reviewId, queue);
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
      const queue = reviews.get(reviewId);
      const active = queue?.items[queue.currentIndex];
      if (!queue || !active || active.id !== suggestionId) return {
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
      const updated: JournalReviewItem = {
        ...active,
        outcome,
        suggestion: {
          ...active.suggestion,
          ...(changes?.type ? { type: changes.type } : {}),
          ...(changes?.statement ? { statement: changes.statement } : {}),
          ...(changes?.topics ? { topics: changes.topics } : {}),
          ...(changes?.evidence ? { evidence: changes.evidence } : {}),
        },
      };
      queue.items[queue.currentIndex] = updated;
      const nextPendingIndex = queue.items.findIndex(
        (item, index) => index > queue.currentIndex && item.outcome === "pending",
      );
      if (nextPendingIndex >= 0) queue.currentIndex = nextPendingIndex;
      else {
        const wrappedPendingIndex = queue.items.findIndex(
          (item, index) => index < queue.currentIndex && item.outcome === "pending",
        );
        if (wrappedPendingIndex >= 0) queue.currentIndex = wrappedPendingIndex;
      }
      const presentation = presentationAt(reviewId, queue);
      return resultFor(presentation, `Journal suggestion ${suggestionId} marked ${outcome}.`);
    },
  );

  registerAppTool(
    server,
    "navigate_review",
    {
      title: "Navigate journal review",
      description: "Move to the previous or next item in an open journal review queue without changing its outcome.",
      inputSchema: z.object({
        reviewId: z.string().max(200),
        suggestionId: z.string().max(200),
        direction: z.enum(["previous", "next"]),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      _meta: { ui: { resourceUri: APP_RESOURCE_URI } },
    },
    async ({ reviewId, suggestionId, direction }): Promise<CallToolResult> => {
      const queue = reviews.get(reviewId);
      const active = queue?.items[queue.currentIndex];
      if (!queue || !active || active.id !== suggestionId) return {
        content: [{ type: "text", text: "The active journal suggestion changed; reload before navigating." }],
        isError: true,
      };
      const offset = direction === "next" ? 1 : -1;
      const nextIndex = queue.currentIndex + offset;
      if (nextIndex >= 0 && nextIndex < queue.items.length) queue.currentIndex = nextIndex;
      const presentation = presentationAt(reviewId, queue);
      const message = nextIndex < 0 || nextIndex >= queue.items.length
        ? `Already at the ${direction === "next" ? "last" : "first"} journal note.`
        : `Moved to journal suggestion ${presentation.suggestion.id}.`;
      return resultFor(presentation, message);
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
      const queue = reviews.get(reviewId);
      if (!queue) return { content: [{ type: "text", text: "Review unavailable." }], isError: true };
      const review = presentationAt(reviewId, queue);
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
