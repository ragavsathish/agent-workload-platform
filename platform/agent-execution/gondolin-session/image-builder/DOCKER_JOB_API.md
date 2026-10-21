# Host Docker job API

The Go service handles host-side Docker jobs for Gitea workflows. Compose cache
jobs inspect, pull, tag, and export images through the Docker Engine HTTP API
over the host Unix socket. Image builds use the host Docker Buildx CLI over that
same socket so BuildKit can establish the build session. No Docker socket is
exposed to the VM. Its container publishes the API on host
loopback at `127.0.0.1:18081`; the Gondolin manager's HTTP hook is the bridge.

## Endpoints

All endpoints except `GET /healthz` require `Authorization: Bearer <token>`.

### `POST /v1/jobs`

Create a job. `runId` is idempotent: an identical retry returns the existing
job, while reusing the ID for a different request returns `409`.

Compose cache request:

```json
{
  "type": "compose-cache",
  "runId": "gitea-101-1",
  "revision": "0123456789abcdef0123456789abcdef01234567",
  "arch": "aarch64",
  "composeConfig": {"services": {"grafana": {"image": "grafana/grafana:12.0"}}}
}
```

Image build request:

```json
{
  "type": "image-build",
  "runId": "gitea-102-1",
  "revision": "0123456789abcdef0123456789abcdef01234567",
  "arch": "aarch64",
  "buildManifest": {
    "context": ".", "dockerfile": "Dockerfile",
    "assetConfig": ".pi/gondolin.json", "imageRef": "voice-agent:local",
    "artifactVersion": "v2-…", "target": "runtime",
    "contexts": {}, "contextSha256": "<64 lowercase hex characters>",
    "contextBytes": 123456
  }
}
```

The API returns `202 Accepted` and `Location: /v1/jobs/{id}`. Compose jobs
enter `queued`. Image-build jobs enter `awaiting-context` until their source
archive is uploaded. An optional read-only registry token is used only to pull private
base images. It stays in the in-memory job request and is never included in
the job response.

### `PUT /v1/jobs/{id}/context`

The service streams the image-build context into a job-specific temporary
file, checks its declared byte count and SHA-256, then atomically installs it
and queues the job. The Go worker sends the verified context tar to host Docker
Buildx, applies the requested platform and target, tags the result,
and saves a tar into the shared `gondolin-image-handoff` folder. Context uploads
are capped at 1 GiB. Invalid uploads are rejected and their temporary file is
removed.

### `GET /v1/jobs/{id}`

Read job status and metadata. Status values are `awaiting-context`, `queued`,
`running`, `succeeded`, and `failed`.

## Compose cache compatibility endpoints

The builder VM uses the existing `POST /v1/prepare` and `GET /v1/status?runId=…`
routes through the manager HTTP hook. Compose services with `build:` are
skipped. Pulled image archives and the `index.json`, `compose.override.json`,
and `cache-id` files retain the existing handoff layout.

Start the host API with a shared internal API token:

```sh
export GONDOLIN_DOCKER_JOB_API_TOKEN="$(openssl rand -hex 32)"
make gondolin-docker-job-api-up
```

Run the Gondolin builder manager with the same token in
`GONDOLIN_DOCKER_JOB_API_TOKEN`. It generates a separate per-VM token and
forwards authenticated requests to the Go service. The handoff directory
defaults to `~/.cache/gondolin/compose-cache-handoff`; override it with
`GONDOLIN_COMPOSE_CACHE_HANDOFF`. Import a workflow result with
`make gondolin-dev-cache-import GONDOLIN_DEV_CACHE_HANDOFF=<reported-path>`.

The image workflow packages only `build.context`, then submits it to the host
API through the authenticated `compose-cache.local:18080` HTTP hook. The image
tar is written to the shared image handoff folder as
`/image-handoff/<artifact-version>.tar`; the build workflow does not push the
image or upload a result package to Gitea. Set
`GONDOLIN_IMAGE_BUILDER_HANDOFF` to the same host directory used by the
builder manager's `/image-handoff` mount. The current worker rejects local
named build contexts; `build.dockerfile` must be inside `build.context`.

The Docker daemon performs the build on the host. The workflow rewrites private
registry `ARG` defaults from the VM-only `gitea.local` name to the host's
loopback registry endpoint, `127.0.0.1:3001`, for base-image pulls. The
workflow supplies a read-only token for private base images. The Dockerfile's
optional Gondolin MITM CA secret is not sent to the host build; host builds use
the Docker daemon's network directly.

Run tests with `make gondolin-docker-job-api-test` (requires Docker to run the
Go toolchain container) or `go test ./...` from this directory.
