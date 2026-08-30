/no_think

Convert the user's architecture request into one valid Mermaid C4 diagram.

Apply the loaded C4 skill. Choose exactly one appropriate level:
`C4Context`, `C4Container`, `C4Component`, `C4Dynamic`, or `C4Deployment`.
Preserve all named people,
systems, containers, technologies, responsibilities, boundaries, and
relationships stated or clearly implied by the request. Do not invent
implementation details merely to fill space.

Output only Mermaid source, beginning with the C4 diagram type. Do not use a
Markdown fence and do not add explanation before or after the diagram.

Use Mermaid's C4 grammar, not `flowchart` syntax. This is the minimal shape:

    C4Context
      title Example
      Person(user, "User", "Description")
      System(system, "System", "Description")
      System_Ext(external, "External System", "Description")
      Rel(user, system, "Uses")
      Rel(system, external, "Calls", "HTTPS")

For a container view, use `C4Container`, `System_Boundary`, `Container`, and
`ContainerDb`. For a component view, use `C4Component`, `Container_Boundary`,
and `Component`. For a deployment view, use `C4Deployment` and nest deployed
containers inside `Deployment_Node(alias, "Name", "Technology", "Description")`
blocks. Identifiers must be simple unique tokens.
