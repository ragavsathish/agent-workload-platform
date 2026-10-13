import { describe, expect, it } from "vitest";

import { compilerCore } from "../src/c4-compiler.js";

describe("C4 compiler interface", () => {
  it("prepares a typed graph for layout without delegating C4 parsing", () => {
    const prepared = compilerCore.prepare({
      source: `C4Context
title Payment context
Person(customer, "Customer", "Pays for an order")
System(checkout, "Checkout", "Accepts the payment")
Rel(customer, checkout, "Pays", "HTTPS")`,
      options: {
        direction: "left-to-right",
        theme: "light",
        maximumSourceBytes: 16_384,
        maximumElements: 20,
      },
    }) as unknown as {
      layoutRequest: {
        title?: string;
        direction: string;
        nodes: Array<{ id: string; parentId: string; kind: string; label: string }>;
        edges: Array<{ sourceId: string; targetId: string; label: string }>;
      };
    };

    expect(prepared.layoutRequest).toMatchObject({
      title: "Payment context",
      direction: "left-to-right",
      nodes: [
        { id: "customer", parentId: "", kind: "person", label: "Customer\nPays for an order" },
        { id: "checkout", parentId: "", kind: "software-system", label: "Checkout\nAccepts the payment" },
      ],
      edges: [
        { sourceId: "customer", targetId: "checkout", label: "Pays\nHTTPS" },
      ],
    });
  });

  it("parses nested deployment boundaries into parent references", () => {
    const prepared = compilerCore.prepare({
      source: `C4Deployment
title Production
Deployment_Node(cloud, "Cloud") {
  Deployment_Node(cluster, "Cluster") {
    Container(api, "API", "TypeScript", "Serves requests")
  }
}
Person(user, "User")
Rel(user, api, "Calls")`,
      options: {
        direction: "automatic",
        theme: "dark",
        maximumSourceBytes: 16_384,
        maximumElements: 20,
      },
    });

    expect(prepared.layoutRequest.direction).toBe("top-to-bottom");
    expect(prepared.layoutRequest.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "cloud", parentId: "", kind: "boundary" }),
      expect.objectContaining({ id: "cluster", parentId: "cloud", kind: "boundary" }),
      expect.objectContaining({ id: "api", parentId: "cluster", kind: "container" }),
    ]));
  });

  it("rejects a boundary declaration without an opening brace", () => {
    expect(() => compilerCore.prepare({
      source: `C4Container
System_Boundary(platform, "Platform")
Container(api, "API", "TypeScript", "Serves requests")`,
      options: { direction: "automatic", theme: "light", maximumSourceBytes: 16_384, maximumElements: 20 },
    })).toThrow();
  });

  it("counts generated labels when enforcing the output element limit", () => {
    expect(() => compilerCore.prepare({
      source: `C4Context
Person(user, "User")
System(api, "API")
Rel(user, api, "Calls")`,
      options: { direction: "automatic", theme: "light", maximumSourceBytes: 16_384, maximumElements: 5 },
    })).toThrow();
  });
});
