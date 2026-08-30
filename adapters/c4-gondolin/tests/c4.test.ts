import { describe, expect, it } from "vitest";

import {
  c4ToFlowchart,
  extractC4Title,
  isC4Diagram,
  preprocessMermaid,
} from "../src/c4.js";

const deployment = `C4Deployment
  title Diagram pipeline

  Deployment_Node(host, "Client Machine", "macOS", "Coordinates the workflow") {
    Container(pi, "Coordinator Pi", "Process", "Coordinates the job")
    Container_Instance(wassette_instance, "Wassette instance", "WebAssembly runtime", "Runs the component")
    Container(wassette, "Wassette", "WebAssembly runtime", "Validates elements")
  }

  Deployment_Node(vm, "Gondolin VM", "Alpine Linux", "Build environment") {
    Container(builder, "Component Builder", "jco", "Builds the component")
    ContainerDb(bundle, "Result Bundle", "Artifact store", "Stores the component")
  }

  Rel(pi, builder, "Submits build", "Gondolin channel")
  Rel(builder, bundle, "Writes artifact", "Wasm component")
  Rel(bundle, wassette, "Loads component", "MCP")`;

describe("C4 preprocessor", () => {
  it("detects supported Mermaid C4 headers", () => {
    expect(isC4Diagram(deployment)).toBe(true);
    expect(isC4Diagram("flowchart LR\nA --> B")).toBe(false);
  });

  it("extracts the C4 title", () => {
    expect(extractC4Title(deployment)).toBe("Diagram pipeline");
    expect(extractC4Title('C4Context\nPerson(user, "User")')).toBeUndefined();
  });

  it("preserves non-C4 Mermaid source byte-for-byte", () => {
    const flowchart = "flowchart LR\nA --> B\n";
    expect(preprocessMermaid(flowchart)).toBe(flowchart);
  });

  it("translates deployment nodes into subgraphs and relationships", () => {
    const flowchart = c4ToFlowchart(deployment);

    expect(flowchart).toContain("flowchart TB");
    expect(flowchart).toContain(
      'subgraph host["Client Machine — [macOS] — Coordinates the workflow"]'
    );
    expect(flowchart).toContain(
      'pi["`Coordinator Pi\n[Process]\nCoordinates the job`"]'
    );
    expect(flowchart).toContain("class bundle c4_database");
    expect(flowchart).toContain("wassette_instance");
    expect(flowchart).toContain(
      'pi -->|"Submits build [Gondolin channel]"| builder'
    );
    expect(flowchart.match(/\bsubgraph\b/gu)).toHaveLength(2);
    expect(flowchart.match(/^\s*end$/gmu)).toHaveLength(2);
  });

  it("rejects relationships to unknown ids", () => {
    expect(() =>
      c4ToFlowchart(`C4Container
Container(api, "API", "HTTP", "Serves requests")
Rel(api, missing, "Calls")`)
    ).toThrow("Relationship references unknown C4 id: api -> missing");
  });
});
