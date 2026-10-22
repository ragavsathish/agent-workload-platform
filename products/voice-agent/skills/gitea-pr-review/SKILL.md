---
name: gitea-pr-review
description: Review Gitea pull requests, including mirrors of GitHub PRs, from the voice VM using tea metadata and the Gitea diff before deciding whether a checkout is needed.
---

# Gitea PR review

Resolve the repository and PR index. For a GitHub PR, first identify its Gitea mirror and confirm that the mirror's base and head commit match the requested PR. If there is no matching mirror, report that limit instead of treating a different PR as equivalent.

1. Read metadata with `tea pulls <index> --repo <owner>/<repo> --login local --output json`. The login flag belongs after the subcommand. Confirm the base branch and head commit.
2. Read the patch from the VM-reachable Gitea endpoint: `curl --fail --silent --show-error "$GITEA_BASE_URL/api/v1/repos/<owner>/<repo>/pulls/<index>.diff"`. `tea` reports a diff URL in metadata; that URL may use a host name unavailable inside the VM and is not the patch body.
3. Review the patch and fetch specific surrounding files when needed. A checkout is useful when the review needs broad repository context or local tests. A patch review can finish without one.
4. Report actionable findings with severity and file/line references. If there are none, say so. State which evidence was inspected and whether tests ran. Post review comments only when the owner asks.
