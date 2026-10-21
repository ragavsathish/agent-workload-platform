package main

import (
	"compress/gzip"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	maxJSONBytes     = 4 << 20
	maxContextBytes  = 1 << 30
	maxProgressBytes = 128 << 10
)

var (
	jobIDPattern    = regexp.MustCompile(`^[0-9a-fA-F-]{36}$`)
	imagePattern    = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,511}$`)
	runIDPattern    = regexp.MustCompile(`^[A-Za-z0-9._-]{1,80}$`)
	revisionPattern = regexp.MustCompile(`^(?:[a-f0-9]{40}|[a-f0-9]{64})$`)
	pathPattern     = regexp.MustCompile(`^[^\\]+$`)
)

type BuildManifest struct {
	Context            string            `json:"context"`
	Dockerfile         string            `json:"dockerfile"`
	AssetConfig        string            `json:"assetConfig"`
	ArtifactVersion    string            `json:"artifactVersion"`
	ImageRef           string            `json:"imageRef"`
	Contexts           map[string]string `json:"contexts,omitempty"`
	BuildArgs          map[string]string `json:"buildArgs,omitempty"`
	Target             string            `json:"target,omitempty"`
	BaseImagePullToken string            `json:"baseImagePullToken,omitempty"`
	ContextSHA256      string            `json:"contextSha256"`
	ContextBytes       int64             `json:"contextBytes"`
	SkipHandoff        bool              `json:"skipHandoff,omitempty"`
}

type BuildResult struct {
	ArtifactVersion string `json:"artifactVersion"`
	CacheReference  string `json:"cacheReference"`
	Digest          string `json:"digest"`
	ImageRef        string `json:"imageRef"`
	Handoff         string `json:"handoff"`
}

type JobRequest struct {
	Type          string            `json:"type"`
	RunID         string            `json:"runId"`
	Revision      string            `json:"revision"`
	Arch          string            `json:"arch"`
	ComposeConfig json.RawMessage   `json:"composeConfig,omitempty"`
	BuiltImageIDs map[string]string `json:"builtImageIds,omitempty"`
	BuildManifest *BuildManifest    `json:"buildManifest,omitempty"`
}

type ContextInfo struct {
	Bytes  int64  `json:"bytes"`
	SHA256 string `json:"sha256"`
	path   string
}

type Job struct {
	ID             string       `json:"id"`
	Type           string       `json:"type"`
	RunID          string       `json:"runId"`
	Revision       string       `json:"revision"`
	Arch           string       `json:"arch"`
	Status         string       `json:"status"`
	CreatedAt      time.Time    `json:"createdAt"`
	UpdatedAt      *time.Time   `json:"updatedAt,omitempty"`
	Context        *ContextInfo `json:"context,omitempty"`
	Error          string       `json:"error,omitempty"`
	Handoff        string       `json:"handoff,omitempty"`
	CacheID        string       `json:"cacheId,omitempty"`
	Images         int          `json:"images,omitempty"`
	Services       int          `json:"services,omitempty"`
	Result         *BuildResult `json:"result,omitempty"`
	ProgressLog    string       `json:"progressLog,omitempty"`
	ProgressOffset int64        `json:"progressOffset,omitempty"`
	request        JobRequest
}

// Keep a bounded tail in job status so VM clients can display ongoing work.
// Buildx writes from stdout and stderr on separate goroutines.
type jobProgressWriter struct {
	mu     sync.Mutex
	owner  *Handler
	jobID  string
	tail   string
	offset int64
}

func (w *jobProgressWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.offset += int64(len(p))
	w.tail += string(p)
	if len(w.tail) > maxProgressBytes {
		w.tail = w.tail[len(w.tail)-maxProgressBytes:]
	}
	if w.jobID != "" {
		w.owner.jobs.mu.Lock()
		job := w.owner.jobs.byID[w.jobID]
		job.ProgressLog, job.ProgressOffset = w.tail, w.offset
		w.owner.jobs.byID[w.jobID] = job
		w.owner.jobs.mu.Unlock()
	}
	return len(p), nil
}

type jobStore struct {
	mu      sync.RWMutex
	byID    map[string]Job
	byRunID map[string]string
}

// DockerEngine is the host Docker Engine API transport. Jobs can receive this
// dependency without shelling out to the Docker CLI or exposing a socket to a VM.
type DockerEngine interface {
	Do(*http.Request) (*http.Response, error)
}

type Handler struct {
	token           string
	contextDir      string
	jobs            *jobStore
	engine          DockerEngine
	maxContextLen   int64
	handoffDir      string
	queue           chan string
	handoffDisplay  string
	imageHandoffDir string
}

func NewHandler(token, contextDir string, engine DockerEngine) (*Handler, error) {
	if strings.TrimSpace(token) == "" {
		return nil, errors.New("a non-empty API token is required")
	}
	if strings.TrimSpace(contextDir) == "" {
		return nil, errors.New("a context directory is required")
	}
	root, err := filepath.Abs(filepath.Clean(contextDir))
	if err != nil {
		return nil, fmt.Errorf("resolve context directory: %w", err)
	}
	handoffDir := os.Getenv("GONDOLIN_COMPOSE_CACHE_HANDOFF")
	if handoffDir == "" {
		handoffDir = filepath.Join(filepath.Dir(root), "gondolin-compose-cache-handoff")
	}
	handoffDir, err = filepath.Abs(filepath.Clean(handoffDir))
	if err != nil {
		return nil, fmt.Errorf("resolve handoff directory: %w", err)
	}
	handoffDisplay := os.Getenv("GONDOLIN_COMPOSE_CACHE_HOST_HANDOFF")
	if handoffDisplay == "" {
		handoffDisplay = handoffDir
	}
	imageHandoffDir := os.Getenv("GONDOLIN_IMAGE_BUILDER_HANDOFF")
	if imageHandoffDir == "" {
		imageHandoffDir = filepath.Join(filepath.Dir(root), "gondolin-image-handoff")
	}
	imageHandoffDir, err = filepath.Abs(filepath.Clean(imageHandoffDir))
	if err != nil {
		return nil, fmt.Errorf("resolve image handoff directory: %w", err)
	}
	h := &Handler{token: token, contextDir: root, engine: engine, maxContextLen: maxContextBytes, handoffDir: handoffDir, handoffDisplay: handoffDisplay, imageHandoffDir: imageHandoffDir,
		jobs: &jobStore{byID: map[string]Job{}, byRunID: map[string]string{}}, queue: make(chan string, 64)}
	if engine != nil {
		go h.runJobs()
	}
	return h, nil
}

type dockerEngineTransport struct {
	socket        string
	dial          func(context.Context) (net.Conn, error)
	versionMu     sync.Mutex
	version       string
	transportOnce sync.Once
	transport     *http.Transport
}

func NewDockerEngine(socket string) DockerEngine {
	return &http.Client{Transport: &dockerEngineTransport{socket: socket}}
}

func (t *dockerEngineTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	t.versionMu.Lock()
	if t.version == "" {
		probe := req.Clone(req.Context())
		probe.Method, probe.URL.Path, probe.URL.RawPath = http.MethodGet, "/version", ""
		probe.Body = nil
		probe.GetBody = nil
		probe.ContentLength = 0
		probe.TransferEncoding = nil
		probe.Header.Del("Content-Length")
		probe.Header.Del("Transfer-Encoding")
		resp, err := t.roundTrip(probe)
		if err != nil {
			t.versionMu.Unlock()
			return nil, err
		}
		defer resp.Body.Close()
		var version struct {
			APIVersion string `json:"ApiVersion"`
		}
		decodeErr := json.NewDecoder(resp.Body).Decode(&version)
		if resp.StatusCode != http.StatusOK || decodeErr != nil || version.APIVersion == "" {
			resp.Body.Close()
			t.versionMu.Unlock()
			return nil, errors.New("Docker Engine /version did not provide ApiVersion")
		}
		t.version = "/v" + version.APIVersion
	}
	versionPrefix := t.version
	t.versionMu.Unlock()
	clone := req.Clone(req.Context())
	if !strings.HasPrefix(clone.URL.Path, "/version") {
		clone.URL.Path = versionPrefix + clone.URL.Path
	}
	return t.roundTrip(clone)
}

func (t *dockerEngineTransport) roundTrip(req *http.Request) (*http.Response, error) {
	t.transportOnce.Do(func() {
		t.transport = &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			if t.dial != nil {
				return t.dial(ctx)
			}
			return (&net.Dialer{}).DialContext(ctx, "unix", t.socket)
		}}
	})
	clone := req.Clone(req.Context())
	clone.URL.Scheme, clone.URL.Host = "http", "docker"
	return t.transport.RoundTrip(clone)
}

func newUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	s := hex.EncodeToString(b[:])
	return s[:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:]
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet && r.URL.Path == "/healthz" {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		return
	}
	if !h.authorized(r) {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if r.Method == http.MethodPost && r.URL.Path == "/v1/jobs" {
		h.createJob(w, r)
		return
	}
	if r.Method == http.MethodPost && r.URL.Path == "/v1/prepare" {
		h.prepareCompat(w, r)
		return
	}
	if r.Method == http.MethodGet && r.URL.Path == "/v1/status" {
		h.statusCompat(w, r)
		return
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 3 || len(parts) > 4 || parts[0] != "v1" || parts[1] != "jobs" || !jobIDPattern.MatchString(parts[2]) {
		writeError(w, http.StatusNotFound, "route not found")
		return
	}
	job, ok := h.getJob(parts[2])
	if !ok {
		writeError(w, http.StatusNotFound, "job not found")
		return
	}
	if len(parts) == 3 && r.Method == http.MethodGet {
		writeJSON(w, http.StatusOK, job)
		return
	}
	if len(parts) == 4 && parts[3] == "context" && r.Method == http.MethodPut && job.Type == "image-build" {
		h.uploadContext(w, r, job)
		return
	}
	writeError(w, http.StatusMethodNotAllowed, "method not allowed")
}

func (h *Handler) authorized(r *http.Request) bool {
	scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
	return ok && scheme == "Bearer" && len(token) == len(h.token) && subtle.ConstantTimeCompare([]byte(token), []byte(h.token)) == 1
}

func (h *Handler) createJob(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxJSONBytes))
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "request body exceeds 4 MiB")
		return
	}
	var req JobRequest
	if err := json.Unmarshal(body, &req); err != nil {
		writeError(w, http.StatusBadRequest, "request body must be valid JSON")
		return
	}
	if err := validateJob(req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	h.jobs.mu.Lock()
	defer h.jobs.mu.Unlock()
	if id, found := h.jobs.byRunID[req.RunID]; found {
		old := h.jobs.byID[id]
		oldJSON, _ := json.Marshal(old.request)
		newJSON, _ := json.Marshal(req)
		if string(oldJSON) != string(newJSON) {
			writeError(w, http.StatusConflict, "runId is already associated with a different job")
			return
		}
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(old)
		return
	}
	status := "queued"
	if req.Type == "image-build" {
		status = "awaiting-context"
	}
	job := Job{ID: newUUID(), Type: req.Type, RunID: req.RunID, Revision: req.Revision, Arch: req.Arch, Status: status, CreatedAt: time.Now().UTC(), request: req}
	h.jobs.byID[job.ID] = job
	h.jobs.byRunID[job.RunID] = job.ID
	if req.Type == "compose-cache" && h.engine != nil {
		h.queue <- job.ID
	}
	w.Header().Set("Location", "/v1/jobs/"+job.ID)
	writeJSON(w, http.StatusAccepted, job)
}

func (h *Handler) prepareCompat(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxJSONBytes))
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "Compose config exceeds 4 MiB")
		return
	}
	var input struct {
		ComposeConfig json.RawMessage   `json:"composeConfig"`
		BuiltImageIDs map[string]string `json:"builtImageIds"`
		Revision      string            `json:"revision"`
		Arch          string            `json:"arch"`
		RunID         string            `json:"runId"`
	}
	if err := json.Unmarshal(body, &input); err != nil {
		writeError(w, http.StatusBadRequest, "request must contain JSON")
		return
	}
	req := JobRequest{Type: "compose-cache", RunID: input.RunID, Revision: input.Revision, Arch: input.Arch, ComposeConfig: input.ComposeConfig, BuiltImageIDs: input.BuiltImageIDs}
	if err := validateJob(req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if h.engine == nil {
		writeError(w, http.StatusServiceUnavailable, "Docker Engine API is unavailable")
		return
	}
	h.jobs.mu.Lock()
	if id, ok := h.jobs.byRunID[req.RunID]; ok {
		job := h.jobs.byID[id]
		h.jobs.mu.Unlock()
		writeJSON(w, http.StatusAccepted, map[string]string{"status": legacyStatus(job.Status)})
		return
	}
	job := Job{ID: newUUID(), Type: req.Type, RunID: req.RunID, Revision: req.Revision, Arch: req.Arch, Status: "queued", CreatedAt: time.Now().UTC(), request: req}
	h.jobs.byID[job.ID], h.jobs.byRunID[job.RunID] = job, job.ID
	h.jobs.mu.Unlock()
	h.queue <- job.ID
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "queued"})
}

func (h *Handler) statusCompat(w http.ResponseWriter, r *http.Request) {
	runID := r.URL.Query().Get("runId")
	h.jobs.mu.RLock()
	id, ok := h.jobs.byRunID[runID]
	job := h.jobs.byID[id]
	h.jobs.mu.RUnlock()
	if !ok {
		writeError(w, http.StatusNotFound, "unknown cache preparation run")
		return
	}
	state := map[string]any{"status": legacyStatus(job.Status)}
	if job.Status == "failed" {
		state["error"] = job.Error
	}
	if job.Status == "succeeded" {
		state["handoff"], state["cacheId"], state["images"], state["services"] = job.Handoff, job.CacheID, job.Images, job.Services
	}
	writeJSON(w, http.StatusOK, state)
}

func legacyStatus(status string) string {
	if status == "succeeded" {
		return "ready"
	}
	return status
}

func (h *Handler) runJobs() {
	for id := range h.queue {
		h.jobs.mu.Lock()
		job := h.jobs.byID[id]
		job.Status = "running"
		h.jobs.byID[id] = job
		h.jobs.mu.Unlock()
		var result cacheResult
		var buildResult *BuildResult
		var err error
		if job.Type == "image-build" {
			buildResult, err = h.buildImage(job)
		} else {
			result, err = h.prepareComposeCache(job)
		}
		if job.Context != nil && job.Context.path != "" {
			_ = os.Remove(job.Context.path)
		}
		h.jobs.mu.Lock()
		job = h.jobs.byID[id]
		if err != nil {
			job.Status, job.Error = "failed", err.Error()
		} else {
			job.Status, job.Handoff, job.CacheID, job.Images, job.Services = "succeeded", result.Handoff, result.CacheID, result.Images, result.Services
			job.Result = buildResult
		}
		now := time.Now().UTC()
		job.UpdatedAt = &now
		h.jobs.byID[id] = job
		h.jobs.mu.Unlock()
	}
}

type cacheResult struct {
	Handoff, CacheID string
	Images, Services int
}
type cacheImage struct{ Source, ImageID, Key, Tag, Archive, Checksum string }

func (h *Handler) prepareComposeCache(job Job) (cacheResult, error) {
	progress := &jobProgressWriter{owner: h, jobID: job.ID}
	logProgress := func(format string, args ...any) { _, _ = fmt.Fprintf(progress, format+"\n", args...) }
	var config struct {
		Services map[string]struct {
			Image string          `json:"image"`
			Build json.RawMessage `json:"build"`
		} `json:"services"`
	}
	if err := json.Unmarshal(job.request.ComposeConfig, &config); err != nil {
		return cacheResult{}, fmt.Errorf("invalid Compose config: %w", err)
	}
	logProgress("Compose cache: resolving %d services", len(config.Services))
	serviceImages := map[string]cacheImage{}
	serviceNames := make([]string, 0, len(config.Services))
	for name := range config.Services {
		serviceNames = append(serviceNames, name)
	}
	sort.Strings(serviceNames)
	for _, name := range serviceNames {
		service := config.Services[name]
		built := len(service.Build) != 0 && string(service.Build) != "null"
		if built && job.request.BuiltImageIDs[name] == "" {
			logProgress("Skipping build-only service %s (no host image)", name)
			continue
		}
		if service.Image == "" {
			logProgress("Skipping service %s (no image reference)", name)
			continue
		}
		imageID, err := h.inspectImage(service.Image)
		if err != nil {
			if built {
				return cacheResult{}, fmt.Errorf("built image %s is missing from host Docker: %w", name, err)
			}
			logProgress("Pulling %s for %s", service.Image, name)
			if err := h.pullImage(job.Arch, service.Image); err != nil {
				return cacheResult{}, fmt.Errorf("pull %s: %w", service.Image, err)
			}
			imageID, err = h.inspectImage(service.Image)
			if err == nil {
				logProgress("Pulled %s", service.Image)
			}
		} else {
			logProgress("Using host image %s for %s", service.Image, name)
		}
		if err != nil {
			return cacheResult{}, fmt.Errorf("host Docker could not resolve image %s: %w", service.Image, err)
		}
		if built && imageID != job.request.BuiltImageIDs[name] {
			return cacheResult{}, fmt.Errorf("built image %s changed: expected %s, found %s", name, job.request.BuiltImageIDs[name], imageID)
		}
		keyHash := sha256.Sum256([]byte(service.Image + "\n" + imageID))
		key := hex.EncodeToString(keyHash[:])[:24]
		serviceImages[name] = cacheImage{Source: service.Image, ImageID: imageID, Key: key, Tag: "gondolin-preload:" + key, Archive: key + ".tar"}
	}
	if len(serviceImages) == 0 {
		return cacheResult{}, errors.New("Compose configuration has no images to cache")
	}
	unique := map[string]cacheImage{}
	for _, image := range serviceImages {
		unique[image.Tag] = image
	}
	entries := make([][]string, 0, len(unique))
	for tag, image := range unique {
		entries = append(entries, []string{tag, image.Source, image.ImageID})
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i][0] < entries[j][0] })
	// Preserve the JS cache-id input shape: [[tag,{source,imageId}],...].
	cacheRows := make([][]any, 0, len(entries))
	for _, entry := range entries {
		cacheRows = append(cacheRows, []any{entry[0], struct {
			Source  string `json:"source"`
			ImageID string `json:"imageId"`
		}{entry[1], entry[2]}})
	}
	cacheInput, _ := json.Marshal(cacheRows)
	cacheSum := sha256.Sum256(cacheInput)
	cacheID := hex.EncodeToString(cacheSum[:])
	if err := os.MkdirAll(h.handoffDir, 0o700); err != nil {
		return cacheResult{}, err
	}
	staging := filepath.Join(h.handoffDir, fmt.Sprintf("%s-%s-%s.partial", job.Revision, job.Arch, job.RunID))
	handoff := filepath.Join(h.handoffDir, fmt.Sprintf("%s-%s-%s-%s", job.Revision, job.Arch, job.RunID, cacheID))
	_ = os.RemoveAll(staging)
	imageDir := filepath.Join(staging, "agent", "images")
	if err := os.MkdirAll(imageDir, 0o700); err != nil {
		return cacheResult{}, err
	}
	cleanup := true
	defer func() {
		if cleanup {
			_ = os.RemoveAll(staging)
		}
	}()
	for index, entry := range entries {
		tag := entry[0]
		image := unique[tag]
		logProgress("Exporting image %d/%d: %s", index+1, len(entries), image.Source)
		if err := h.tagImage(image.ImageID, image.Tag); err != nil {
			return cacheResult{}, fmt.Errorf("tag %s: %w", tag, err)
		}
		file := filepath.Join(imageDir, image.Archive)
		if err := h.exportImage(image.Tag, file); err != nil {
			return cacheResult{}, fmt.Errorf("export %s: %w", tag, err)
		}
		if err := validateDockerArchive(file, image.Tag); err != nil {
			// Docker's containerd image store can return a successful save with
			// missing layer blobs. Buildx fetches the pinned source and exports
			// a complete, single-platform archive in that case.
			_ = os.Remove(file)
			logProgress("Engine archive incomplete for %s; exporting through Buildx", image.Source)
			if buildErr := exportRemoteImage(image.Source, image.Tag, job.Arch, file); buildErr != nil {
				return cacheResult{}, fmt.Errorf("export %s: incomplete Engine archive (%v); Buildx fallback: %w", tag, err, buildErr)
			}
			if err := validateDockerArchive(file, image.Tag); err != nil {
				return cacheResult{}, fmt.Errorf("export %s: invalid Buildx archive: %w", tag, err)
			}
		}
		checksum, err := sha256File(file)
		if err != nil {
			return cacheResult{}, err
		}
		image.Checksum = checksum
		unique[tag] = image
		if info, err := os.Stat(file); err == nil {
			logProgress("Exported image %d/%d: %s (%d bytes)", index+1, len(entries), image.Source, info.Size())
		}
	}
	servicesOverride := map[string]any{}
	indexServices := map[string]any{}
	for name, image := range serviceImages {
		servicesOverride[name] = map[string]string{"image": image.Tag, "pull_policy": "never"}
		indexServices[name] = map[string]string{"image": image.Tag, "archive": image.Archive, "sha256": unique[image.Tag].Checksum}
	}
	if err := writeJSONFile(filepath.Join(staging, "compose.override.json"), map[string]any{"services": servicesOverride}); err != nil {
		return cacheResult{}, err
	}
	if err := writeJSONFile(filepath.Join(staging, "index.json"), map[string]any{"services": indexServices}); err != nil {
		return cacheResult{}, err
	}
	if err := os.WriteFile(filepath.Join(staging, "cache-id"), []byte(cacheID+"\n"), 0o600); err != nil {
		return cacheResult{}, err
	}
	if err := os.Rename(staging, handoff); err != nil {
		return cacheResult{}, err
	}
	cleanup = false
	logProgress("Compose cache handoff complete: %d images, %d services", len(unique), len(serviceImages))
	return cacheResult{Handoff: filepath.Join(h.handoffDisplay, filepath.Base(handoff)), CacheID: cacheID, Images: len(unique), Services: len(serviceImages)}, nil
}

func (h *Handler) engineRequest(method, endpoint string, body io.Reader) (*http.Response, error) {
	req, err := http.NewRequest(method, "http://docker"+endpoint, body)
	if err != nil {
		return nil, err
	}
	return h.engine.Do(req)
}

func (h *Handler) inspectImage(image string) (string, error) {
	resp, err := h.engineRequest(http.MethodGet, "/images/"+url.PathEscape(image)+"/json", nil)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Engine API inspect returned %s", resp.Status)
	}
	var result struct {
		ID string `json:"Id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", err
	}
	if !regexp.MustCompile(`^sha256:[a-f0-9]{64}$`).MatchString(result.ID) {
		return "", errors.New("Engine API returned invalid image ID")
	}
	return result.ID, nil
}

func (h *Handler) pullImage(arch, image string) error {
	platform := "linux/amd64"
	if arch == "aarch64" {
		platform = "linux/arm64"
	}
	endpoint := "/images/create?fromImage=" + url.QueryEscape(image) + "&platform=" + url.QueryEscape(platform)
	resp, err := h.engineRequest(http.MethodPost, endpoint, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("Engine API pull returned %s: %s", resp.Status, strings.TrimSpace(string(data)))
	}
	decoder := json.NewDecoder(resp.Body)
	for {
		var event struct {
			Error       string `json:"error"`
			ErrorDetail struct {
				Message string `json:"message"`
			} `json:"errorDetail"`
			Status string `json:"status"`
		}
		err := decoder.Decode(&event)
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("read Engine API pull stream: %w", err)
		}
		if event.Error != "" {
			return errors.New(event.Error)
		}
		if event.ErrorDetail.Message != "" {
			return errors.New(event.ErrorDetail.Message)
		}
	}
}

func (h *Handler) tagImage(imageID, tag string) error {
	separator := strings.LastIndex(tag, ":")
	if separator <= strings.LastIndex(tag, "/") {
		return fmt.Errorf("image reference %q must contain a tag", tag)
	}
	name, value := tag[:separator], tag[separator+1:]
	resp, err := h.engineRequest(http.MethodPost, "/images/"+url.PathEscape(imageID)+"/tag?repo="+url.QueryEscape(name)+"&tag="+url.QueryEscape(value), nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("Engine API tag returned %s: %s", resp.Status, strings.TrimSpace(string(data)))
	}
	return nil
}

// exportImage writes an image archive for transfer into a Gondolin VM. Docker
// exposes this operation as GET /images/get; the name here makes the VM
// handoff purpose explicit.
func (h *Handler) exportImage(tag, destination string) error {
	resp, err := h.engineRequest(http.MethodGet, "/images/get?names="+url.QueryEscape(tag), nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("Engine API save returned %s: %s", resp.Status, strings.TrimSpace(string(data)))
	}
	file, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(file, resp.Body)
	closeErr := file.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

func (h *Handler) buildImage(job Job) (*BuildResult, error) {
	manifest := job.request.BuildManifest
	if manifest == nil || job.Context == nil {
		return nil, errors.New("image build is missing its verified context")
	}
	if len(manifest.Contexts) != 0 {
		return nil, errors.New("local named build contexts are not supported by the host Engine build API yet")
	}
	artifactVersion := manifest.ArtifactVersion
	if !regexp.MustCompile(`^v2-[a-f0-9]{32}$`).MatchString(artifactVersion) {
		return nil, errors.New("build manifest has an invalid artifact version")
	}
	localTag := "local/task-image:" + hex.EncodeToString(sha256Sum([]byte(artifactVersion)))[:20]
	platform := "linux/amd64"
	if job.Arch == "aarch64" {
		platform = "linux/arm64"
	}
	dockerfile := manifest.Dockerfile
	contextFile, err := os.Open(job.Context.path)
	if err != nil {
		return nil, fmt.Errorf("open verified build context: %w", err)
	}
	args := []string{"buildx", "build", "--load", "--progress=plain", "--platform", platform, "--network", "host", "--tag", localTag, "--file", dockerfile}
	if manifest.Target != "" {
		args = append(args, "--target", manifest.Target)
	}
	buildArgNames := make([]string, 0, len(manifest.BuildArgs))
	for name := range manifest.BuildArgs {
		buildArgNames = append(buildArgNames, name)
	}
	sort.Strings(buildArgNames)
	for _, name := range buildArgNames {
		args = append(args, "--build-arg", name+"="+manifest.BuildArgs[name])
	}
	args = append(args, "-")
	command := exec.CommandContext(context.Background(), "docker", args...)
	command.Stdin = contextFile
	command.Env = append(os.Environ(), "DOCKER_HOST=unix:///var/run/docker.sock")
	buildOutput := &jobProgressWriter{owner: h, jobID: job.ID}
	command.Stdout = buildOutput
	command.Stderr = buildOutput
	if manifest.BaseImagePullToken != "" {
		registry := "127.0.0.1:3001"
		configDir, err := os.MkdirTemp("", "gondolin-docker-config-")
		if err != nil {
			contextFile.Close()
			return nil, fmt.Errorf("create temporary Docker auth config: %w", err)
		}
		defer os.RemoveAll(configDir)
		config, _ := json.Marshal(map[string]any{"auths": map[string]any{registry: map[string]string{
			"auth": base64.StdEncoding.EncodeToString([]byte("image-builder:" + manifest.BaseImagePullToken)),
		}}})
		if err := os.WriteFile(filepath.Join(configDir, "config.json"), config, 0o600); err != nil {
			contextFile.Close()
			return nil, fmt.Errorf("write temporary Docker auth config: %w", err)
		}
		command.Env = append(command.Env, "DOCKER_CONFIG="+configDir)
	}
	err = command.Run()
	contextFile.Close()
	if err != nil {
		return nil, fmt.Errorf("Docker Buildx build failed: %w: %s", err, strings.TrimSpace(buildOutput.tail))
	}
	if err := h.tagImage(localTag, manifest.ImageRef); err != nil {
		return nil, fmt.Errorf("tag built image: %w", err)
	}
	imageID, err := h.inspectImage(localTag)
	if err != nil {
		return nil, fmt.Errorf("inspect built image: %w", err)
	}
	result := &BuildResult{ArtifactVersion: artifactVersion, CacheReference: localTag, Digest: imageID, ImageRef: manifest.ImageRef}
	if manifest.SkipHandoff {
		return result, nil
	}
	if err := os.MkdirAll(h.imageHandoffDir, 0o700); err != nil {
		return nil, fmt.Errorf("create image handoff directory: %w", err)
	}
	archive := filepath.Join(h.imageHandoffDir, artifactVersion+".tar")
	staging := archive + ".partial"
	_ = os.Remove(staging)
	defer os.Remove(staging)
	if err := h.exportImage(localTag, staging); err != nil {
		return nil, fmt.Errorf("export image handoff: %w", err)
	}
	if err := os.Rename(staging, archive); err != nil {
		_ = os.Remove(staging)
		return nil, fmt.Errorf("install image handoff: %w", err)
	}
	result.Handoff = "/image-handoff/" + artifactVersion + ".tar"
	return result, nil
}

func sha256Sum(value []byte) []byte {
	sum := sha256.Sum256(value)
	return sum[:]
}

func readBuildStream(reader io.Reader) error {
	decoder := json.NewDecoder(reader)
	var lastError string
	for {
		var event struct {
			Stream string `json:"stream"`
			Error  string `json:"error"`
			Detail struct {
				Message string `json:"message"`
			} `json:"errorDetail"`
		}
		if err := decoder.Decode(&event); errors.Is(err, io.EOF) {
			break
		} else if err != nil {
			return fmt.Errorf("read Docker Engine build stream: %w", err)
		}
		if event.Error != "" {
			lastError = event.Error
		}
		if event.Detail.Message != "" {
			lastError = event.Detail.Message
		}
	}
	if lastError != "" {
		return fmt.Errorf("Docker Engine build failed: %s", lastError)
	}
	return nil
}

func sha256File(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func writeJSONFile(path string, value any) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(file)
	encoder.SetIndent("", "  ")
	encodeErr := encoder.Encode(value)
	closeErr := file.Close()
	if encodeErr != nil {
		return encodeErr
	}
	return closeErr
}

func (h *Handler) uploadContext(w http.ResponseWriter, r *http.Request, job Job) {
	if job.Status != "awaiting-context" {
		writeError(w, http.StatusConflict, "build context has already been uploaded")
		return
	}
	manifest := job.request.BuildManifest
	if manifest == nil {
		writeError(w, http.StatusBadRequest, "missing build manifest")
		return
	}
	encoding := r.Header.Get("Content-Encoding")
	if encoding != "" && encoding != "gzip" {
		writeError(w, http.StatusUnsupportedMediaType, "unsupported context encoding")
		return
	}
	if r.ContentLength > h.maxContextLen || (encoding == "" && r.ContentLength > manifest.ContextBytes) {
		writeError(w, http.StatusRequestEntityTooLarge, "context upload exceeds declared byte count")
		return
	}
	if err := os.MkdirAll(h.contextDir, 0o700); err != nil {
		writeError(w, http.StatusInternalServerError, "cannot create context directory")
		return
	}
	staging := filepath.Join(h.contextDir, job.ID+".context.tar.partial")
	target := filepath.Join(h.contextDir, job.ID+".context.tar")
	file, err := os.OpenFile(staging, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "cannot create context staging file")
		return
	}
	hash := sha256.New()
	var source io.Reader = r.Body
	if encoding == "gzip" {
		compressed, err := gzip.NewReader(r.Body)
		if err != nil {
			_ = file.Close()
			_ = os.Remove(staging)
			writeError(w, http.StatusUnprocessableEntity, "invalid gzip build context")
			return
		}
		defer compressed.Close()
		source = compressed
	}
	written, copyErr := io.Copy(io.MultiWriter(file, hash), io.LimitReader(source, manifest.ContextBytes+1))
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil || written != manifest.ContextBytes {
		_ = os.Remove(staging)
		writeError(w, http.StatusUnprocessableEntity, "context upload byte count does not match manifest")
		return
	}
	digest := hex.EncodeToString(hash.Sum(nil))
	if digest != manifest.ContextSHA256 {
		_ = os.Remove(staging)
		writeError(w, http.StatusUnprocessableEntity, "context upload SHA-256 does not match manifest")
		return
	}
	if err := os.Rename(staging, target); err != nil {
		_ = os.Remove(staging)
		writeError(w, http.StatusInternalServerError, "cannot install verified context")
		return
	}
	h.jobs.mu.Lock()
	current := h.jobs.byID[job.ID]
	if current.Status != "awaiting-context" {
		h.jobs.mu.Unlock()
		writeError(w, http.StatusConflict, "build context has already been uploaded")
		return
	}
	now := time.Now().UTC()
	current.Status, current.UpdatedAt = "queued", &now
	current.Context = &ContextInfo{Bytes: written, SHA256: digest, path: target}
	h.jobs.byID[job.ID] = current
	h.jobs.mu.Unlock()
	h.queue <- job.ID
	writeJSON(w, http.StatusAccepted, current)
}

func (h *Handler) getJob(id string) (Job, bool) {
	h.jobs.mu.RLock()
	defer h.jobs.mu.RUnlock()
	job, ok := h.jobs.byID[id]
	return job, ok
}

func validateJob(req JobRequest) error {
	if req.Type != "compose-cache" && req.Type != "image-build" {
		return errors.New("type must be compose-cache or image-build")
	}
	if !runIDPattern.MatchString(req.RunID) {
		return errors.New("runId is invalid")
	}
	if !revisionPattern.MatchString(req.Revision) {
		return errors.New("revision must be a 40- or 64-character lowercase Git object ID")
	}
	if req.Arch != "aarch64" && req.Arch != "x86_64" {
		return errors.New("arch must be aarch64 or x86_64")
	}
	if req.Type == "compose-cache" {
		if req.BuildManifest != nil {
			return errors.New("compose-cache jobs cannot contain buildManifest")
		}
		var config struct {
			Services map[string]struct {
				Image string          `json:"image"`
				Build json.RawMessage `json:"build"`
			} `json:"services"`
		}
		if len(req.ComposeConfig) == 0 || json.Unmarshal(req.ComposeConfig, &config) != nil || len(config.Services) == 0 || len(config.Services) > 128 {
			return errors.New("composeConfig must contain a non-empty services object with at most 128 services")
		}
		for name, service := range config.Services {
			if service.Image != "" && !imagePattern.MatchString(service.Image) {
				return fmt.Errorf("invalid image reference for service %s", name)
			}
		}
		for name, imageID := range req.BuiltImageIDs {
			service, ok := config.Services[name]
			if !ok || service.Image == "" || len(service.Build) == 0 || string(service.Build) == "null" ||
				!regexp.MustCompile(`^sha256:[a-f0-9]{64}$`).MatchString(imageID) {
				return fmt.Errorf("builtImageIds has an invalid entry for service %s", name)
			}
		}
		for _, service := range config.Services {
			if imagePattern.MatchString(service.Image) {
				return nil
			}
		}
		return errors.New("composeConfig has no image services to cache")
	}
	if len(req.ComposeConfig) != 0 {
		return errors.New("image-build jobs cannot contain composeConfig")
	}
	if len(req.BuiltImageIDs) != 0 {
		return errors.New("image-build jobs cannot contain builtImageIds")
	}
	m := req.BuildManifest
	if m == nil {
		return errors.New("buildManifest must be an object")
	}
	for _, p := range []string{m.Context, m.Dockerfile, m.AssetConfig} {
		if !validRelativePath(p) {
			return errors.New("buildManifest paths must be relative paths inside the source archive")
		}
	}
	if !imagePattern.MatchString(m.ImageRef) {
		return errors.New("buildManifest.imageRef is invalid")
	}
	if !regexp.MustCompile(`^v2-[a-f0-9]{32}$`).MatchString(m.ArtifactVersion) {
		return errors.New("buildManifest.artifactVersion is invalid")
	}
	for name, p := range m.Contexts {
		if name == "" || !validRelativePath(p) {
			return errors.New("buildManifest.contexts must map names to relative paths")
		}
	}
	if len(m.BuildArgs) > 128 {
		return errors.New("buildManifest.buildArgs cannot contain more than 128 values")
	}
	for name, value := range m.BuildArgs {
		if !regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`).MatchString(name) || len(value) > 8192 || strings.ContainsRune(value, '\x00') {
			return errors.New("buildManifest.buildArgs contains an invalid name or value")
		}
	}
	if m.Target != "" && !regexp.MustCompile(`^[A-Za-z0-9_.-]{1,128}$`).MatchString(m.Target) {
		return errors.New("buildManifest.target is invalid")
	}
	if !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(m.ContextSHA256) || m.ContextBytes < 1 || m.ContextBytes > maxContextBytes {
		return errors.New("buildManifest must declare a SHA-256 and a context size from 1 byte to 1 GiB")
	}
	return nil
}

func validRelativePath(p string) bool {
	clean := filepath.Clean(p)
	return p != "" && !filepath.IsAbs(p) && clean != ".." && !strings.HasPrefix(clean, ".."+string(filepath.Separator)) && pathPattern.MatchString(p) && !strings.Contains(p, ":")
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func main() {
	args := os.Args[1:]
	if len(args) >= 2 && args[0] == "compose" && args[1] == "pull" {
		if err := runComposePull(args[2:], os.Stdin, os.Stdout); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	if len(args) >= 2 && args[0] == "compose" && args[1] == "import" {
		if err := importComposeCache(args[2:]); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	if len(args) >= 2 && args[0] == "image" {
		var err error
		switch args[1] {
		case "build":
			if len(args) > 2 && args[2] == "--via-api" {
				err = runImageBuildViaAPI(args[3:], os.Stdout)
			} else {
				err = runImageBuild(args[2:], os.Stdout)
			}
		case "export":
			err = runImageExport(args[2:], os.Stdout)
		default:
			err = errors.New("image command must be build or export")
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}
	if len(args) > 0 && args[0] == "serve" {
		args = args[1:]
	}
	if len(args) != 0 {
		fmt.Fprintln(os.Stderr, "usage: gondolin-oci [serve | image build --via-api | image build <manifest.json> <context.tar> <revision> <arch> | image export <image-ref> <archive.tar> | compose pull <compose-config.json> <revision> <arch> <run-id> [<preload-root> <shared-store-root>] | compose pull --via-api <compose-config.json|-> <run-id> | compose import <handoff-root> <preload-root> <shared-store-root>]")
		os.Exit(2)
	}
	serveDockerJobAPI()
}

func serveDockerJobAPI() {
	token := os.Getenv("GONDOLIN_DOCKER_JOB_API_TOKEN")
	if token == "" {
		fmt.Fprintln(os.Stderr, "GONDOLIN_DOCKER_JOB_API_TOKEN is required")
		os.Exit(1)
	}
	dir := os.Getenv("GONDOLIN_DOCKER_JOB_CONTEXTS")
	if dir == "" {
		cache, err := os.UserCacheDir()
		if err != nil {
			panic(err)
		}
		dir = filepath.Join(cache, "gondolin", "docker-job-contexts")
	}
	engineSocket := os.Getenv("DOCKER_HOST_SOCKET")
	if engineSocket == "" {
		engineSocket = "/var/run/docker.sock"
	}
	handler, err := NewHandler(token, dir, NewDockerEngine(engineSocket))
	if err != nil {
		panic(err)
	}
	addr := os.Getenv("GONDOLIN_DOCKER_JOB_API_ADDR")
	if addr == "" {
		addr = "0.0.0.0:18081"
	}
	server := &http.Server{Addr: addr, Handler: handler, ReadHeaderTimeout: 5 * time.Second, MaxHeaderBytes: 1 << 20}
	fmt.Printf("Docker job API listening on %s (Docker Engine API socket %s)\n", addr, engineSocket)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		panic(err)
	}
}
