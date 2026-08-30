type C4Node = {
  id: string;
  type: string;
  name: string;
  technology: string;
  description: string;
};

type C4Boundary = C4Node & {
  kind: "boundary";
  depth: number;
};

type C4Relation = {
  from: string;
  to: string;
  label: string;
  technology: string;
};

type C4Token =
  | C4Boundary
  | { kind: "node"; node: C4Node; depth: number }
  | { kind: "end-boundary"; depth: number };

const C4_HEADER = /^C4(?:Context|Container|Component|Dynamic|Deployment)$/;
const NODE_DECLARATION =
  /^(Person(?:_Ext)?|System(?:_Ext)?|Container(?:Db|Queue)?|Component)\s*\((.*)\)\s*$/u;
const BOUNDARY_DECLARATION =
  /^(Deployment_Node|Node(?:_[LR])?|(?:System|Container|Enterprise)_Boundary)\s*\((.*)\)\s*\{?\s*$/u;
const RELATION_DECLARATION = /^Rel(?:_[RLUD])?\s*\((.*)\)\s*$/u;

const splitArguments = (source: string): string[] => {
  const arguments_: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;

  for (const character of source) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      arguments_.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }

  if (quoted) {
    throw new Error("Unterminated quoted C4 argument");
  }

  arguments_.push(current.trim());
  return arguments_.map((value) => value.replace(/^"|"$/gu, "").trim());
};

const safeId = (id: string): string => {
  const normalized = id.replace(/[^a-zA-Z0-9_-]/gu, "_");
  return /^[a-zA-Z_]/u.test(normalized) ? normalized : `c4_${normalized}`;
};

const escapeLabel = (value: string): string =>
  value
    .replace(/`/gu, "'")
    .replace(/"/gu, "#quot;")
    .replace(/[<>]/gu, "")
    .trim();

const nodeLabel = (node: C4Node): string => {
  const type = node.type
    .replace(/_Ext$/u, " (External)")
    .replace(/^ContainerDb$/u, "Container / Database")
    .replace(/^ContainerQueue$/u, "Container / Queue");
  return [node.name, `[${node.technology || type}]`, node.description]
    .filter(Boolean)
    .map(escapeLabel)
    .join("\n");
};

const boundaryLabel = (boundary: C4Boundary): string =>
  [
    boundary.name,
    boundary.technology && `[${boundary.technology}]`,
    boundary.description,
  ]
    .filter(Boolean)
    .map(escapeLabel)
    .join(" — ");

const classFor = (type: string): string => {
  if (type.startsWith("Person")) {
    return "c4_person";
  }
  if (type === "ContainerDb") {
    return "c4_database";
  }
  if (type === "ContainerQueue") {
    return "c4_queue";
  }
  if (type.startsWith("System_Ext")) {
    return "c4_external";
  }
  if (type.startsWith("System")) {
    return "c4_system";
  }
  if (type === "Component") {
    return "c4_component";
  }
  return "c4_container";
};

const nodeDefinition = (node: C4Node): string => {
  const id = safeId(node.id);
  const label = `\`${nodeLabel(node)}\``;
  if (node.type.startsWith("Person")) {
    return `${id}(["${label}"])`;
  }
  return `${id}["${label}"]`;
};

const relationLabel = (relation: C4Relation): string =>
  [relation.label, relation.technology && `[${relation.technology}]`]
    .filter(Boolean)
    .map(escapeLabel)
    .join(" ");

export const isC4Diagram = (definition: string): boolean => {
  const source = definition
    .replace(/^\s*```(?:mermaid)?\s*/iu, "")
    .replace(/```\s*$/u, "")
    .trim();
  return C4_HEADER.test(source.split(/\r?\n/u)[0]?.trim() ?? "");
};

export const extractC4Title = (definition: string): string | undefined =>
  definition
    .replace(/^\s*```(?:mermaid)?\s*/iu, "")
    .replace(/```\s*$/u, "")
    .split(/\r?\n/u)
    .map((line) => /^\s*title\s+(.+)$/iu.exec(line)?.[1]?.trim())
    .find(Boolean);

export const c4ToFlowchart = (definition: string): string => {
  const source = definition
    .replace(/^\s*```(?:mermaid)?\s*/iu, "")
    .replace(/```\s*$/u, "");
  const lines = source.split(/\r?\n/u).map((line) => line.trim());
  const header = lines.find((line) => C4_HEADER.test(line));
  if (!header) {
    throw new Error("Expected a Mermaid C4 diagram");
  }

  let title = "";
  let depth = 0;
  const tokens: C4Token[] = [];
  const relations: C4Relation[] = [];
  const ids = new Set<string>();

  for (const line of lines) {
    if (!line || line === header || line === "{" || line.startsWith("%%")) {
      continue;
    }

    const titleMatch = /^title\s+(.+)$/iu.exec(line);
    if (titleMatch) {
      title = titleMatch[1].trim();
      continue;
    }

    if (line === "}") {
      if (depth === 0) {
        throw new Error("Unexpected closing C4 boundary");
      }
      depth -= 1;
      tokens.push({ kind: "end-boundary", depth });
      continue;
    }

    const boundaryMatch = BOUNDARY_DECLARATION.exec(line);
    if (boundaryMatch) {
      const [id, name, technology = "", description = ""] = splitArguments(
        boundaryMatch[2]
      );
      if (!id || !name) {
        throw new Error(`Invalid C4 boundary: ${line}`);
      }
      if (ids.has(id)) {
        throw new Error(`Duplicate C4 id: ${id}`);
      }
      ids.add(id);
      tokens.push({
        kind: "boundary",
        depth,
        id,
        type: boundaryMatch[1],
        name,
        technology,
        description,
      });
      depth += 1;
      continue;
    }

    const nodeMatch = NODE_DECLARATION.exec(line);
    if (nodeMatch) {
      const args = splitArguments(nodeMatch[2]);
      const [id, name] = args;
      const hasTechnology =
        nodeMatch[1].startsWith("Container") || nodeMatch[1] === "Component";
      const technology = hasTechnology ? args[2] ?? "" : "";
      const description = hasTechnology ? args[3] ?? "" : args[2] ?? "";
      if (!id || !name) {
        throw new Error(`Invalid C4 declaration: ${line}`);
      }
      if (ids.has(id)) {
        throw new Error(`Duplicate C4 id: ${id}`);
      }
      ids.add(id);
      tokens.push({
        kind: "node",
        depth,
        node: { id, type: nodeMatch[1], name, technology, description },
      });
      continue;
    }

    const relationMatch = RELATION_DECLARATION.exec(line);
    if (relationMatch) {
      const [from, to, label = "", technology = ""] = splitArguments(
        relationMatch[1]
      );
      if (!from || !to) {
        throw new Error(`Invalid C4 relationship: ${line}`);
      }
      relations.push({ from, to, label, technology });
      continue;
    }

    if (/^(?:Update|Lay_|SHOW_|HIDE_)/u.test(line)) {
      continue;
    }
    throw new Error(`Unsupported Mermaid C4 line: ${line}`);
  }

  if (depth !== 0) {
    throw new Error("Unclosed C4 boundary");
  }
  for (const relation of relations) {
    if (!ids.has(relation.from) || !ids.has(relation.to)) {
      throw new Error(
        `Relationship references unknown C4 id: ${relation.from} -> ${relation.to}`
      );
    }
  }

  const output = ["flowchart LR"];
  if (title) {
    output.push(`%% ${escapeLabel(title)}`);
  }

  for (const token of tokens) {
    const indent = "  ".repeat(token.depth + 1);
    if (token.kind === "boundary") {
      output.push(
        `${indent}subgraph ${safeId(token.id)}["${boundaryLabel(token)}"]`,
        `${indent}  direction TB`
      );
    } else if (token.kind === "end-boundary") {
      output.push(`${indent}end`);
    } else {
      output.push(
        `${indent}${nodeDefinition(token.node)}`,
        `${indent}class ${safeId(token.node.id)} ${classFor(token.node.type)}`
      );
    }
  }

  for (const relation of relations) {
    const label = relationLabel(relation);
    output.push(
      label
        ? `  ${safeId(relation.from)} -->|"${label}"| ${safeId(relation.to)}`
        : `  ${safeId(relation.from)} --> ${safeId(relation.to)}`
    );
  }

  output.push(
    "  classDef c4_person fill:#a5d8ff,stroke:#1971c2,color:#102a43,stroke-width:2px",
    "  classDef c4_system fill:#74c0fc,stroke:#1971c2,color:#102a43,stroke-width:2px",
    "  classDef c4_external fill:#e9ecef,stroke:#868e96,color:#343a40,stroke-width:2px,stroke-dasharray:5 5",
    "  classDef c4_container fill:#b2f2bb,stroke:#2f9e44,color:#102a43,stroke-width:2px",
    "  classDef c4_component fill:#c3fae8,stroke:#099268,color:#102a43,stroke-width:2px",
    "  classDef c4_database fill:#d0bfff,stroke:#7048e8,color:#102a43,stroke-width:2px",
    "  classDef c4_queue fill:#ffe8cc,stroke:#e67700,color:#102a43,stroke-width:2px"
  );

  return `${output.join("\n")}\n`;
};

export const preprocessMermaid = (definition: string): string =>
  isC4Diagram(definition) ? c4ToFlowchart(definition) : definition;
