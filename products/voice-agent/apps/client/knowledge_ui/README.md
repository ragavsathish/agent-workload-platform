# Shared knowledge UI

`KnowledgeGraph` and `KnowledgeNoteCard` are React modules used by the knowledge page and the
Journal Review MCP App. `KnowledgeGraph` accepts note/source/topic data and selection callbacks;
it owns Cytoscape setup, keyboard-accessible note navigation, zoom controls, and teardown.
`KnowledgeNoteCard` renders the same note summary in either host.

`SourceCapture` shows the source transcript and highlights an exact evidence span when available;
`SourceCaptureHeader` is used by the MCP app beside its Recogito transcript. `JournalCorrectionForm`
owns the same text, type, and topic inputs in both hosts. Each host supplies its own save adapter.

The MCP App's DOM bridge calls `mountKnowledgeWidgets` after its host panel is attached and calls
the returned cleanup function before replacing or tearing down that panel. The bridge keeps
Recogito evidence selection and voice actions outside these shared modules.
