import { describe, expect, it } from "vitest";

import { graphLayout } from "../src/c4-layout.js";

describe("graph layout interface", () => {
  it("lays out a typed C4 graph without a browser", async () => {
    const snapshot = await graphLayout.layout({
      title: "Payment context",
      direction: "left-to-right",
      theme: "light",
      maximumElements: 20,
      nodes: [
        { id: "customer", parentId: "", kind: "person", label: "Customer" },
        { id: "checkout", parentId: "", kind: "software-system", label: "Checkout" },
      ],
      edges: [
        { id: "relation-1", sourceId: "customer", targetId: "checkout", label: "Pays" },
      ],
    });

    expect(snapshot.renderer).toBe("c4-layout-wasm/dagre");
    expect(snapshot.nodes).toHaveLength(2);
    expect(snapshot.edges).toHaveLength(1);
    expect(snapshot.texts.map((text) => text.text)).toEqual(expect.arrayContaining(["Payment context", "Customer", "Checkout", "Pays"]));

    const [customer, checkout] = snapshot.nodes;
    expect(customer).toBeDefined();
    expect(checkout).toBeDefined();
    expect(customer!.bounds.x + customer!.bounds.width).toBeLessThan(checkout!.bounds.x);
    expect(snapshot.edges[0]?.points.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects cyclic boundary parents before calling Dagre", () => {
    expect(() => graphLayout.layout({
      direction: "top-to-bottom",
      theme: "light",
      maximumElements: 20,
      nodes: [
        { id: "outer", parentId: "inner", kind: "boundary", label: "Outer" },
        { id: "inner", parentId: "outer", kind: "boundary", label: "Inner" },
      ],
      edges: [],
    })).toThrow();
  });

  it("lays out nested nodes inside their boundary deterministically", () => {
    const request = {
      direction: "top-to-bottom" as const,
      theme: "dark" as const,
      maximumElements: 20,
      nodes: [
        { id: "platform", parentId: "", kind: "boundary" as const, label: "Platform" },
        { id: "api", parentId: "platform", kind: "container" as const, label: "API" },
      ],
      edges: [],
    };
    const first = graphLayout.layout(request);
    const second = graphLayout.layout(request);
    expect(second).toEqual(first);
    const boundary = first.nodes.find((node) => node.id === "platform")!;
    const child = first.nodes.find((node) => node.id === "api")!;
    expect(child.bounds.x).toBeGreaterThan(boundary.bounds.x);
    expect(child.bounds.y).toBeGreaterThan(boundary.bounds.y);
    expect(child.bounds.x + child.bounds.width).toBeLessThan(boundary.bounds.x + boundary.bounds.width);
    expect(child.bounds.y + child.bounds.height).toBeLessThan(boundary.bounds.y + boundary.bounds.height);
  });

  it("rejects duplicate edge IDs and oversized generated output", () => {
    const request = {
      direction: "left-to-right" as const,
      theme: "light" as const,
      maximumElements: 20,
      nodes: [
        { id: "a", parentId: "", kind: "person" as const, label: "A" },
        { id: "b", parentId: "", kind: "software-system" as const, label: "B" },
      ],
      edges: [
        { id: "same", sourceId: "a", targetId: "b", label: "One" },
        { id: "same", sourceId: "b", targetId: "a", label: "Two" },
      ],
    };
    expect(() => graphLayout.layout(request)).toThrow();
    expect(() => graphLayout.layout({ ...request, edges: request.edges.slice(0, 1), maximumElements: 5 })).toThrow();
  });

  it("allocates generated text IDs without colliding with graph IDs", () => {
    const snapshot = graphLayout.layout({
      title: "Collision test",
      direction: "left-to-right",
      theme: "light",
      maximumElements: 20,
      nodes: [
        { id: "c4-title", parentId: "", kind: "person", label: "Title ID" },
        { id: "c4-title-label", parentId: "", kind: "software-system", label: "Label ID" },
      ],
      edges: [{ id: "edge", sourceId: "c4-title", targetId: "c4-title-label", label: "Calls" }],
    });
    const ids = [...snapshot.nodes, ...snapshot.edges, ...snapshot.texts].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rejects an excessive aggregate label payload", () => {
    expect(() => graphLayout.layout({
      direction: "left-to-right",
      theme: "light",
      maximumElements: 100,
      nodes: Array.from({ length: 18 }, (_, index) => ({
        id: `node-${index}`,
        parentId: "",
        kind: "software-system" as const,
        label: "x".repeat(60_000),
      })),
      edges: [],
    })).toThrow();
  });
});
