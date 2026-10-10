# Model provenance

No model is authorized for production use by this package yet. Before enabling an adapter, add its
source repository, immutable revision, artifact SHA-256 hashes, license, conversion tooling, and
local acceptance results to `Models.lock.json`.

Model downloads must be an explicit provisioning step. The HTTP service must never download or
select models in response to a request.

The speaker-model hash is calculated over the CAM++ embedding artifact. For a file, hash the UTF-8
bytes of `/<filename>`, one zero byte, then the file bytes. For a compiled-model directory, visit
regular files in lexicographic absolute-path order and hash each UTF-8 path relative to the parent of
the artifact root, one zero byte, then that file's bytes. SHA-256 output is lowercase hexadecimal.
Hidden files participate and symbolic links are forbidden.
