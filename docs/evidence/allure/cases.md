---
type: measurement
title: Allure case inventory
---

# Allure case inventory

Run `2026-10-28T17-47-20-707Z-36590`. `Result` is a filename under that run's `allure-results/` directory.
A zero in `Steps` means no Gherkin-prefixed top-level steps were recorded; it does
not mean the test had no assertions.

| Epic / feature | Case | Layer | Status | Steps | Result |
| --- | --- | --- | --- | ---: | --- |
| Digital twin / Process a completed owner turn | test_journal_and_classification_are_independent_native_tasks | integration | passed | 3 | `b472a31b-200e-430f-8ec6-65bcb711dcec-result.json` |
| Digital twin / Process a completed owner turn | test_product_failures_remain_queryable_in_pi_durable | integration | passed | 3 | `8e2c9cab-5f6d-4819-b315-9f10ea7133f3-result.json` |
| Digital twin / Record a completed conversation | test_completed_turn_is_enqueued_as_an_idempotent_digital_twin_task | contract | passed | 0 | `b3d76abb-4382-48b4-a84d-99668b6cc75e-result.json` |
| Digital twin / Use personal context | retrieves sourced personal knowledge through deployed Wassette | deployedIntegration | passed | 0 | `7c315c47-7b84-45f0-a19d-1883b0a4eec8-result.json` |
| Digital twin / Use personal context | test_digital_twin_query_exposes_lightweight_journal_scope | contract | passed | 0 | `1f8c3d9e-375f-4026-9e9f-477a5924d45e-result.json` |
| Digital twin / Use personal context | test_digital_twin_query_is_authenticated_identity_bound_and_read_only | contract | passed | 0 | `e8d8ea17-ceae-4c16-a1e6-dbe157441803-result.json` |
| Durable work / Continue durable work | A completed Pi Durable task accepts a follow-up through its session socket | integration | passed | 3 | `26d8a55d-4259-40e7-bc82-8d7925ab2e83-result.json` |
| Durable work / Continue durable work | I submit a task from a voice session and follow it in Flutter | journey | passed | 7 | `1b2f2d8b-0c38-4fb3-b69c-10176122134e-result.json` |
| Durable work / Continue durable work | Pi Durable session selects host or Gondolin tools without changing the answer | integration | passed | 6 | `d925d7d9-bb67-46b3-bbcf-0cd99cec8aa3-result.json` |
| Durable work / Continue durable work | Pi Durable writes through a real Gondolin task VM | integration | passed | 3 | `c7b7e83c-fd30-4a03-801b-d88f12b6cf3a-result.json` |
| Durable work / Continue durable work | Pi agent calls an allowlisted product MCP tool | integration | passed | 3 | `2fed530a-5d45-4f7a-b2fa-75be377d1f0b-result.json` |
| Durable work / Continue durable work | Repository task VM receives only its repository writer | integration | passed | 5 | `7398b205-b367-4fd5-bb04-4d4a67d8837f-result.json` |
| Durable work / Continue durable work | Workspace and durable work | integration | passed | 0 | `7e79aacb-eaa5-488b-924e-21baa61fa80d-result.json` |
| Durable work / Continue durable work | completed work with a missing artifact returns an explicit lookup failure | integration | passed | 3 | `cdf001a5-8326-4871-a6c9-928ab8a9bc8e-result.json` |
| Durable work / Continue durable work | directly submitted scratch task completes through the Flutter board and returns its workspace | integration | passed | 5 | `cde75cb5-0de9-48d3-ac8a-b429761c070d-result.json` |
| Durable work / Continue durable work | durable task board stays usable across mobile, tablet, and desktop | integration | passed | 4 | `1b70173b-fa0c-4bb4-8566-d4b1eeabc9c0-result.json` |
| Durable work / Continue durable work | invalid work never reaches Pi Durable or exposes a workspace artifact | integration | passed | 2 | `b36d24f2-a590-450f-98ea-3c7f3f955c4f-result.json` |
| Durable work / Continue durable work | owner-unavailable is visible at the task contract | integration | passed | 3 | `8ef24bca-7878-401d-9325-788664c73bad-result.json` |
| Durable work / Continue durable work | renders persisted task diagrams | integration | passed | 4 | `74dd040e-8cf1-492c-97ec-da455a0fb87f-result.json` |
| Durable work / Continue durable work | repository-unavailable is visible at the task contract | integration | passed | 3 | `87314ac9-254a-4ef6-9247-fce05a13411e-result.json` |
| Durable work / Continue durable work | test_owner_client_failure_abort_and_retry | integration | passed | 5 | `59d27097-e487-48e5-942b-205a111b8e70-result.json` |
| Durable work / Continue durable work | test_owner_client_lifecycle_and_idempotency | integration | passed | 5 | `ab89bfc5-f265-4e1a-a74b-f1c4dcfad0cb-result.json` |
| Durable work / Continue durable work | test_task_artifact_download_requires_owner_and_returns_attachment | contract | passed | 0 | `33f043e8-9f60-41e9-a822-065e7996297a-result.json` |
| Durable work / Continue durable work | test_task_progress_requires_owner_identity_and_forwards_cursor | contract | passed | 0 | `7b313350-f2f5-4b85-a96b-790a5fecbdc5-result.json` |
| Durable work / Continue durable work | test_tasks_can_be_queried_by_exact_session_name | contract | passed | 0 | `1fc08477-2735-4bf5-92ca-f4908760f006-result.json` |
| Durable work / Continue durable work | voice session submits directly to Pi Durable and I follow the task in Flutter | integration | passed | 5 | `619e0f79-576c-4165-bab1-50f0d53cdde7-result.json` |
| Durable work / Continue durable work | worker-failed is visible at the task contract | integration | passed | 3 | `cb79bc29-27de-45e2-9551-9fd9d08f3a6c-result.json` |
| Embedded apps / Inspect a trace in Pi | mounts the selected Playwright recording with conversational actions | observability | passed | 0 | `e6f7dcdc-e279-444a-bb59-9f6e2f6c5ab9-result.json` |
| Embedded apps / Inspect a trace in Pi | queries the live C4 dashboard and a fresh Tempo trace through Grafana MCP | observability | passed | 0 | `3c21fcdc-d950-42c6-9826-1561ace8aa7d-result.json` |
| Embedded apps / Inspect a trace in Pi | renders Playwright trace viewer inside the least-privilege sandbox | observability | passed | 0 | `9c403e8f-47fa-4270-9673-d04da93a1713-result.json` |
| Embedded apps / Inspect a trace in Pi | renders the official Grafana trace MCP App inside voice chat | journey | skipped | 0 | `8928ec97-06ec-4c80-a2ca-7086c47fbfae-result.json` |
| Embedded apps / Use MCP apps in Pi | first-party View receives the saved light theme without a theme URL parameter | integration | passed | 0 | `0b672228-fbdf-4eaa-bd1c-7fba9d2b12dd-result.json` |
| Embedded apps / Use MCP apps in Pi | journal review uses readable design tokens in light mode | integration | passed | 0 | `2a2edf68-71f7-4c27-a681-91ee3bcf11cb-result.json` |
| Embedded apps / Use MCP apps in Pi | rejects resources outside the explicit MCP App allowlist | integration | passed | 0 | `50611fd8-ab6f-402a-9b81-2702ad91546e-result.json` |
| Embedded apps / Use MCP apps in Pi | renders Excalidraw inside the least-privilege sandbox | integration | passed | 0 | `dcd3344a-7b37-4d83-a5ea-d324352950db-result.json` |
| Embedded apps / Use MCP apps in Pi | renders Excalidraw malformed camera recovery inside the least-privilege sandbox | integration | passed | 0 | `669f2c34-eaeb-4e9c-a5ca-f9932af84c5a-result.json` |
| Embedded apps / Use MCP apps in Pi | renders Marp inside the least-privilege sandbox | integration | passed | 0 | `c64d6aef-662e-4c54-8387-228f95c26fba-result.json` |
| Embedded apps / Use MCP apps in Pi | renders Marp math inside the least-privilege sandbox | integration | passed | 0 | `3097b6a9-5d89-4208-a9ba-42bd6fe15d67-result.json` |
| Embedded apps / Use MCP apps in Pi | renders Mermaid inside the least-privilege sandbox | integration | passed | 0 | `8b54e664-8034-4d82-9554-dd3cb34feb30-result.json` |
| Embedded apps / Use MCP apps in Pi | serializes concurrent mounts and keeps the latest visual | integration | passed | 0 | `db7c3e82-77b0-42d8-bf35-ceb1998325e5-result.json` |
| Embedded apps / Use MCP apps in Pi | theme changes reach mounted first-party and Excalidraw apps | integration | passed | 0 | `2e9cdb89-3bc0-434b-bcdb-9ed7508c46a9-result.json` |
| Embedded apps / Use MCP apps in Pi | waits for a host element created after rendering starts | integration | passed | 0 | `01bca347-4729-4484-b004-84d6099c84a6-result.json` |
| Gateway access / Access the protected gateway | Tailscale owner reaches Gitea admin and direct header forgery fails | deployedIntegration | passed | 3 | `fa33c61b-f9c1-48b0-840f-b17586d9600f-result.json` |
| Gateway access / Access the protected gateway | tailnet routes reject another user before reaching Grafana or Oxigraph | deployedIntegration | passed | 4 | `365d9f6a-3063-43fa-bcbf-ccef031f037d-result.json` |
| Gateway access / Access the protected gateway | test_gateway_capability_is_bound_to_one_configured_identity | contract | passed | 0 | `cb7e983b-0c37-4cbc-a362-f8551ae42781-result.json` |
| Gateway access / Access the protected gateway | test_health_requires_the_separate_gateway_capability | observability | passed | 0 | `e722798f-d3b2-41a7-8b74-f6c798affc96-result.json` |
| Gateway access / Access the protected gateway | test_voice_view_never_returns_legacy_capability_or_raw_events | contract | passed | 0 | `35031988-3bb0-4e4c-9e4a-4141e90ebf7c-result.json` |
| Knowledge and review / Correct and review journal knowledge | corrects one test-owned journal entry through the deployed knowledge browser | deployedIntegration | passed | 4 | `1d28d46c-0f67-41cc-85a6-cd78f6e176cc-result.json` |
| Knowledge and review / Correct and review journal knowledge | deployed MCP correction reaches the gateway and Oxigraph, then removes its fixture | deployedIntegration | passed | 0 | `2fbca876-e539-4837-a70d-6182163de142-result.json` |
| Knowledge and review / Correct and review journal knowledge | gateway adapter sends an authenticated, bounded correction to the existing v1 route | integration | passed | 0 | `2fd3cc0f-f88c-440b-90b8-8fcf8e8275c1-result.json` |
| Knowledge and review / Correct and review journal knowledge | journal and graph stay usable across mobile, tablet, and desktop | integration | passed | 7 | `686a231c-23c8-4b27-a6c9-40e3e9a4d1b8-result.json` |
| Knowledge and review / Correct and review journal knowledge | mounts the dark Recogito reviewer without claiming unconfirmed acceptance | integration | passed | 0 | `1c3cfd35-e8f6-4fcd-9f3b-af0b7aef1040-result.json` |
| Knowledge and review / Correct and review journal knowledge | renders Journal review inside the least-privilege sandbox | integration | passed | 0 | `e3bbe20c-324d-441c-9c1f-d1e73780f175-result.json` |
| Knowledge and review / Correct and review journal knowledge | renders and reviews a journal suggestion through the MCP contract | integration | passed | 0 | `1e663962-90ba-49cc-a622-caf41db21195-result.json` |
| Knowledge and review / Correct and review journal knowledge | reviewed journal entry stays linked across the C2 mock boundaries | integration | passed | 4 | `4e0e0257-b679-442a-af97-db63360d7aee-result.json` |
| Knowledge and review / Correct and review journal knowledge | saves a note correction, assertion review, and removal through the owner route | integration | passed | 8 | `b2cfa387-a4b3-4af9-aef0-1d72850510bb-result.json` |
| Knowledge and review / Correct and review journal knowledge | saves an exact-evidence correction through the gateway before marking it reviewed | integration | passed | 0 | `d5bc9d1f-c01e-4b74-acde-44cd4787b024-result.json` |
| Knowledge and review / Correct and review journal knowledge | shows journal queue navigation and omits confidence when unknown | integration | passed | 0 | `7b257592-b26f-4ca7-8ca7-b6dc48a164a7-result.json` |
| Knowledge and review / Correct and review journal knowledge | shows the shared source and correction form for a saveable journal entry | integration | passed | 0 | `d22837fc-5964-4d7e-933f-69a3438d3865-result.json` |
| Knowledge and review / Correct and review journal knowledge | test_daily_journal_writer_writes_one_story_page_with_provenance | contract | passed | 0 | `c1b6f009-b7c3-4a0f-aa54-7258f0f32016-result.json` |
| Knowledge and review / Correct and review journal knowledge | test_journal_edit_replaces_topics_and_escapes_slash_as_sparql_literal | contract | passed | 0 | `1790c00a-4e60-40a0-a843-92d214d51c16-result.json` |
| Knowledge and review / Correct and review journal knowledge | test_journal_feedback_export_uses_reader_capability | contract | passed | 0 | `d07269e8-38f4-414b-afde-f9593dcfe57e-result.json` |
| Knowledge and review / Correct and review journal knowledge | test_journal_feedback_updates_private_review_state | contract | passed | 0 | `31c7b1cf-91dc-4e33-9647-eb933574ef14-result.json` |
| Knowledge and review / Correct and review journal knowledge | test_journal_feedback_validates_corrections_and_records_misses | contract | passed | 0 | `87610676-9b2e-4079-84e0-1b0ef6c14a65-result.json` |
| Knowledge and review / Correct and review journal knowledge | test_journal_writer_has_a_separate_capability_and_fixed_graph | contract | passed | 0 | `6c6243de-ff22-4cbd-8ad3-a5bd68eb4a33-result.json` |
| Knowledge and review / Correct and review journal knowledge | test_journal_writer_rejects_timestamp_without_timezone | contract | passed | 0 | `403d6c09-1993-48b8-b265-d07cb768cbb0-result.json` |
| Knowledge and review / Correct and review journal knowledge | tests::encodes_only_bounded_journal_edits | unit | passed | 0 | `56c0725c-999c-4c3f-a3dc-00adee7d23dc-result.json` |
| Knowledge and review / Correct and review journal knowledge | tests::groups_topic_rows_into_one_journal_entry | unit | passed | 0 | `4f6100a3-2fac-4884-a61b-5a22ca14c972-result.json` |
| Knowledge and review / Explore journal knowledge | browses, filters, and maps journal notes with synchronized details | integration | passed | 10 | `ef2b3ee3-b237-4c80-a523-ff8c8c67d595-result.json` |
| Knowledge and review / Explore journal knowledge | combines type and date filters and removes them independently | integration | passed | 6 | `22e29864-5626-44ab-b0a0-ad1d04704efc-result.json` |
| Knowledge and review / Explore journal knowledge | maps Cytoscape node events to journal state | integration | passed | 8 | `6555e1a3-ece9-40db-9fb4-c4ac373a3812-result.json` |
| Knowledge and review / Review personal assertions | test_assertion_review_stays_in_separate_graph_and_requires_owner_authorship | contract | passed | 0 | `e335836f-a0ce-4c10-8177-ec53609c62c0-result.json` |
| Knowledge and review / Review personal assertions | test_classifier_candidates_are_written_only_to_the_review_graph | contract | passed | 0 | `0dac8ff9-a087-40a9-9a00-3175c9171ac6-result.json` |
| Knowledge and review / Review personal assertions | test_owner_can_accept_a_pending_candidate_into_the_accepted_graph | contract | passed | 0 | `72951041-cf7a-4b3b-aa98-df324948e70a-result.json` |
| Knowledge and review / Review personal assertions | test_reader_can_list_pending_candidates_but_cannot_decide_them | contract | passed | 0 | `8076c755-4f47-4ff7-8c3e-19ad10945861-result.json` |
| Knowledge and review / Review personal assertions | tests::assertion_review_requires_authorship_and_consistent_profile_field | unit | passed | 0 | `30a87f85-b9ba-4fbd-a9a2-401b2559310c-result.json` |
| Knowledge and review / Review personal assertions | tests::rejects_invalid_and_oversized_responses | unit | passed | 0 | `a592f41f-a0ad-4218-8570-0072c21ed796-result.json` |
| Media creation / Create and review a song | test_failed_song_lyrics_remain_in_pi_durable_and_cannot_render | integration | passed | 3 | `171b1485-001c-4d70-b749-242c241c7d9c-result.json` |
| Media creation / Create and review a song | test_song_creation_is_authenticated_and_enqueues_lyrics_before_render | contract | passed | 0 | `f4f14bd9-74da-4986-a9af-a810739fb5bf-result.json` |
| Media creation / Create and review a song | test_song_lyrics_and_render_use_native_pi_durable_tasks | integration | passed | 3 | `ee439e3f-9302-45f2-b1b1-cd54dd5febfb-result.json` |
| Media creation / Create and review a song | test_song_render_requires_a_separate_review_command | contract | passed | 0 | `f2449765-633d-4ac4-8d77-a08ec4838c8a-result.json` |
| Operations / Inspect system health | compiles the source-backed C4 operational dashboard | contract | passed | 0 | `b2a80425-185f-4c26-9622-dd8a5edec293-result.json` |
| Operations / Inspect system health | renders every operational C4 panel with accessible color semantics | journey | passed | 3 | `ac7a1029-39d2-4076-94ae-cf98854d2b0a-result.json` |
| Voice Agent / test_approval_route_is_retired | test_approval_route_is_retired | contract | passed | 0 | `edee7699-96d7-4b52-9123-9ceb5600fc13-result.json` |
| Voice Agent / test_daily_journal_submission_uses_pi_durable_and_validates_local_day | test_daily_journal_submission_uses_pi_durable_and_validates_local_day | contract | passed | 0 | `865016ed-0571-4420-93a6-0d42956802b3-result.json` |
| Voice Agent / test_task_list_reports_owner_outage_as_service_unavailable | test_task_list_reports_owner_outage_as_service_unavailable | contract | passed | 0 | `a2a11ad3-a650-4b29-84cf-3ef72d4392d5-result.json` |
| Voice Agent / test_task_submission_creates_native_work_without_proposal_or_approval | test_task_submission_creates_native_work_without_proposal_or_approval | contract | passed | 0 | `955b2e41-148a-47f4-b2ae-cdddd6f4df54-result.json` |
| Voice Agent / tests::decodes_daily_journal_records_without_reclassifying_them | tests::decodes_daily_journal_records_without_reclassifying_them | unit | passed | 0 | `4148486e-e176-4025-ac9f-1fa2ccc2b191-result.json` |
| Voice Agent / tests::fixed_graph_query_reads_rdf_provenance_and_unreviewed_classifier_nodes | tests::fixed_graph_query_reads_rdf_provenance_and_unreviewed_classifier_nodes | unit | passed | 0 | `604dcbee-e39d-4188-b79f-39e427996c68-result.json` |
| Voice Agent / tests::fixed_query_includes_daily_journal_pages_as_a_separate_record_kind | tests::fixed_query_includes_daily_journal_pages_as_a_separate_record_kind | unit | passed | 0 | `fa234fe6-88f1-4951-8a07-62df5f59d7c2-result.json` |
| Voice conversation / Explore journal knowledge from Pi | opens journal knowledge from Pi home and returns through the Pi logo | journey | passed | 5 | `42dc1387-a4d4-4264-9318-bccfeb62ecb8-result.json` |
| Voice conversation / Inspect conversation diagnostics | explains a truncated replay while keeping its available evidence | integration | passed | 4 | `acd136af-4f59-43ab-88d9-dd9a7459fc20-result.json` |
| Voice conversation / Inspect conversation diagnostics | keeps replay controls visible when metrics fail | integration | passed | 3 | `76096751-7801-4030-918b-f53c2e736914-result.json` |
| Voice conversation / Inspect conversation diagnostics | renders lightweight conversation diagnostics | journey | passed | 4 | `9f406119-d225-4a72-a0dc-ce30e31f9fa1-result.json` |
| Voice conversation / Inspect conversation diagnostics | replay dashboard stays usable across mobile, tablet, and desktop | integration | passed | 4 | `4caca435-cdcc-42e1-9ea4-6cea118ba607-result.json` |
| Voice conversation / Inspect conversation diagnostics | replays a recorded conversation through the C2 Voice Edge mock | integration | passed | 4 | `9d10f171-e9a4-492b-bc05-9d358ba5d459-result.json` |
| Voice conversation / Inspect conversation diagnostics | reports an unavailable replay list without showing stale sessions | integration | passed | 2 | `e910bfb1-1f36-4369-a7ba-c90c5e7a053a-result.json` |
| Voice conversation / Inspect conversation diagnostics | shows the empty replay state without inventing a session | integration | passed | 2 | `abeb4c2d-0fc3-4673-a7e2-70761e25711c-result.json` |
| Voice conversation / Talk with Pi | Flutter voice home, conversation, and task dialog fit mobile, tablet, and desktop | integration | passed | 10 | `97b32206-c43c-4b25-9065-136dc038acc4-result.json` |
| Voice conversation / Talk with Pi | Voice shell and navigation | journey | passed | 0 | `1e46b4ff-1d70-4a76-956d-397630231e22-result.json` |
| Voice conversation / Talk with Pi | completes a deployed voice session and retains its diagnostics | journey | passed | 8 | `5d61f1b7-d1b5-488e-8761-327c6f5b07d0-result.json` |
| Voice conversation / Talk with Pi | completes a deployed voice session and retains its diagnostics | journey | passed | 7 | `613bd9ba-8313-4817-a461-f7e7b8bcb3cb-result.json` |
| Voice conversation / Talk with Pi | keeps the primary voice controls usable on a phone viewport | journey | passed | 4 | `6907ea95-74f4-4881-97e9-d6d1de0458ef-result.json` |
| Voice conversation / Talk with Pi | normalizes typed Pi responses and failures through the C2 broker mock | integration | passed | 0 | `109f7c44-5548-4035-937e-ffbc09fce164-result.json` |
| Voice conversation / Talk with Pi | translates Pi deltas and failures through the C2 stream mock | integration | passed | 0 | `06b30775-927d-48de-91df-9c2a90f31124-result.json` |
