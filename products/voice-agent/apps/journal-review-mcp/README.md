# Journal Review MCP App

The app shares the note card, graph, source header, and correction form with the knowledge page.
The transcript remains selectable with Recogito. Corrections to real journal entry IDs use the
`submit_journal_correction` MCP command, which calls the authenticated knowledge gateway and
returns a feedback receipt before the UI marks the item edited. The local fixture and review
queue outcomes are in-memory; they do not create Oxigraph feedback records.

For saved corrections, configure `AGENT_GATEWAY_BASE_URL` (with or without `/v1`),
`AGENT_GATEWAY_TOKEN` or `AGENT_GATEWAY_TOKEN_FILE`, and one owner identity in
`JOURNAL_REVIEW_OWNER_IDENTITY` or `ORCHESTRATOR_ALLOWED_USERS`. These stay in the MCP server
process; the app HTML has no direct network permission. The command only accepts the active
entry, a valid journal entry ID, bounded correction fields, and an exact transcript quote.
