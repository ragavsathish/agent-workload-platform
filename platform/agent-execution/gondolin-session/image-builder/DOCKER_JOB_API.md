# Host Docker job API

The `gondolin-oci serve` command runs the Go service for host-side Docker jobs
from Gitea workflows. `gondolin-oci compose pull` prepares a Compose image
handoff; `gondolin-oci image build` builds the runtime image, and
`gondolin-oci image export` names the VM handoff operation explicitly. Compose
cache jobs inspect, pull, tag, and export images through the Docker Engine HTTP API
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
may use `Content-Encoding: gzip` to cross the VM's 64 MiB request limit; the
service verifies the uncompressed tar against `contextBytes` and
`contextSha256`. Context tar content is capped at 1 GiB. Invalid uploads are rejected and their temporary file is
removed.

### `GET /v1/jobs/{id}`

Read job status and metadata. Status values are `awaiting-context`, `queued`,
`running`, `succeeded`, and `failed`. Image-build status includes a bounded
`buildLog` tail and `buildLogOffset`; the VM CLI prints only new Buildx output
into the Gitea workflow log while polling.

## Compose cache jobs

The Gitea workflow runs `gondolin-oci compose pull --via-api` to submit the
rendered Compose config to `POST /v1/jobs` as a `compose-cache` job and poll
`GET /v1/jobs/{id}` through the manager HTTP hook. The host worker pulls and
exports registry images. Services with Compose
`build:` are skipped because the request has no `builtImageIds`. The handoff
contains `index.json`, `compose.override.json`, `cache-id`, and `agent/images`.
The older `POST /v1/prepare` and `GET /v1/status?runId=…` routes remain for
existing clients.

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

The image workflow calls `gondolin-oci image build --via-api`. The CLI checks
the requested artifact version against the checked-out Git inputs, packages
only `build.context`, then submits it to the host API through the authenticated
`compose-cache.local:18080` HTTP hook. The image
tar is written to the shared image handoff folder as
`/image-handoff/<artifact-version>.tar`; the build workflow does not push the
image or upload a result package to Gitea. Set
`GONDOLIN_IMAGE_BUILDER_HANDOFF` to the same host directory used by the
builder manager's `/image-handoff` mount. The current worker rejects local
named build contexts; `build.dockerfile` must be inside `build.context`.

The local host CLI accepts a JSON-rendered Compose configuration:
`gondolin-oci compose pull <compose-config.json> <revision> <arch> <run-id>`.
The builder VM pipes `docker compose config --format json --no-env-resolution
--no-interpolate` into `gondolin-oci compose pull --via-api - <run-id>`. The
CLI resolves the checked-out Git revision and its architecture, then uses
`DOCKER_JOB_API_VM_TOKEN` to reach the host API without a Docker socket. The host pulls
missing service images on the host, exports them into the Compose handoff, and
prints the cache metadata. Import a completed Gitea handoff into the shared VM
store with `gondolin-oci compose import <handoff> <preload-root> <shared-store>`.
`gondolin-oci image build <manifest.json> <context.tar> <revision> <arch>` and
`gondolin-oci image export <image-ref> <archive.tar>` are the direct host
operations; the VM loads its archives with `docker load`.

The Docker daemon performs the build on the host. The workflow rewrites private
registry `ARG` defaults from the VM-only `gitea.local` name to the host's
loopback registry endpoint, `127.0.0.1:3001`, for base-image pulls. The
workflow supplies a read-only token for private base images. The Dockerfile's
optional Gondolin MITM CA secret is not sent to the host build; host builds use
the Docker daemon's network directly.

For a small end-to-end Gitea check, dispatch `build-execution-image.yml` with
`image_config` set to
`platform/agent-execution/gondolin-session/image-builder/testdata/workflow-smoke/config.json`
and the matching `artifact_version` from the checked-out revision. This fixture
builds a single-file `scratch` image and exercises the same host job and handoff.

Run tests with `make gondolin-docker-job-api-test` (requires Docker to run the
Go toolchain container) or `go test ./...` from this directory.
