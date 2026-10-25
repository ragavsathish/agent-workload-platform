# Knowledge review test report

From `products/voice-agent`, run `make allure-knowledge-review` after the local deployment is
ready. The command runs the deployed knowledge-page Playwright journey, MCP browser and contract
tests, gateway tests, and Rust knowledge-core tests. It writes an Allure report under the ignored
repository `artifacts/test-reports/<run-id>/report/` directory and records its path in
`artifacts/test-reports/latest.json`.

Playwright, Vitest, Node, gateway pytest, and Rust test cases appear individually. A failed
command or missing machine-readable result also produces a failed Allure gate with its log
attached. The report is local and can contain private test evidence; do not publish it.

The report shows one run of these suites. Gondolin Patrol Oracle has its own Allure history under
`artifacts/benchmarks/patrol-evidence/`; its earlier results are not counted as current knowledge
review results.
