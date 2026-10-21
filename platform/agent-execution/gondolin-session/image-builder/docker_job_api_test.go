package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const testToken = "test-token"

func newTestHandler(t *testing.T) *Handler {
	t.Helper()
	h, err := NewHandler(testToken, t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func callJSON(t *testing.T, h http.Handler, method, path string, body any, auth string) *httptest.ResponseRecorder {
	t.Helper()
	var encoded []byte
	if body != nil {
		encoded, _ = json.Marshal(body)
	}
	r := httptest.NewRequest(method, path, bytes.NewReader(encoded))
	if auth != "" {
		r.Header.Set("Authorization", auth)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func decode(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var result map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestHealthAndAuthentication(t *testing.T) {
	h := newTestHandler(t)
	if got := callJSON(t, h, http.MethodGet, "/healthz", nil, "").Code; got != 200 {
		t.Fatalf("health: %d", got)
	}
	if got := callJSON(t, h, http.MethodPost, "/v1/jobs", map[string]any{}, "Bearer wrong").Code; got != 401 {
		t.Fatalf("unauthorized: %d", got)
	}
}

func TestComposeJobsAreIdempotentAndConflictOnChangedRequest(t *testing.T) {
	h := newTestHandler(t)
	job := JobRequest{Type: "compose-cache", RunID: "run-101", Revision: strings.Repeat("a", 40), Arch: "aarch64", ComposeConfig: json.RawMessage(`{"services":{"grafana":{"image":"grafana/grafana:12.0"},"built":{"build":{"context":"."}}}}`)}
	first := callJSON(t, h, "POST", "/v1/jobs", job, "Bearer "+testToken)
	created := decode(t, first)
	if first.Code != 202 || created["status"] != "queued" {
		t.Fatalf("created: %d %v", first.Code, created)
	}
	second := callJSON(t, h, "POST", "/v1/jobs", job, "Bearer "+testToken)
	if second.Code != 202 || decode(t, second)["id"] != created["id"] {
		t.Fatalf("retry: %d %s", second.Code, second.Body)
	}
	job.Arch = "x86_64"
	if got := callJSON(t, h, "POST", "/v1/jobs", job, "Bearer "+testToken).Code; got != 409 {
		t.Fatalf("conflict: %d", got)
	}
}

func TestImageBuildContextMustMatchDigestAndSize(t *testing.T) {
	h := newTestHandler(t)
	data := []byte("verified build context")
	sum := sha256.Sum256(data)
	manifest := &BuildManifest{Context: ".", Dockerfile: "Dockerfile", AssetConfig: ".pi/gondolin.json", ArtifactVersion: "v2-" + strings.Repeat("d", 32), ImageRef: "voice-agent:test", BaseImagePullToken: "top-secret-pull-token", ContextSHA256: hex.EncodeToString(sum[:]), ContextBytes: int64(len(data))}
	job := JobRequest{Type: "image-build", RunID: "build-1", Revision: strings.Repeat("b", 40), Arch: "aarch64", BuildManifest: manifest}
	created := callJSON(t, h, "POST", "/v1/jobs", job, "Bearer "+testToken)
	if strings.Contains(created.Body.String(), manifest.BaseImagePullToken) {
		t.Fatal("base-image pull token leaked in job response")
	}
	id := decode(t, created)["id"].(string)
	request := httptest.NewRequest("PUT", "/v1/jobs/"+id+"/context", bytes.NewReader(data))
	request.Header.Set("Authorization", "Bearer "+testToken)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, request)
	if w.Code != 202 {
		t.Fatalf("upload: %d %s", w.Code, w.Body)
	}
	result := decode(t, w)
	if result["status"] != "queued" {
		t.Fatalf("status: %v", result)
	}
	if _, exists := result["context"].(map[string]any)["path"]; exists {
		t.Fatal("internal context path leaked")
	}
	stored, err := os.ReadFile(filepath.Join(h.contextDir, id+".context.tar"))
	if err != nil || !bytes.Equal(stored, data) {
		t.Fatalf("stored context mismatch: %v", err)
	}
}

func TestInvalidManifestPathAndWrongContextAreRejected(t *testing.T) {
	h := newTestHandler(t)
	m := &BuildManifest{Context: "../../outside", Dockerfile: "Dockerfile", AssetConfig: ".pi/gondolin.json", ArtifactVersion: "v2-" + strings.Repeat("d", 32), ImageRef: "voice-agent:test", ContextSHA256: strings.Repeat("0", 64), ContextBytes: 1}
	bad := JobRequest{Type: "image-build", RunID: "build-2", Revision: strings.Repeat("c", 40), Arch: "aarch64", BuildManifest: m}
	if got := callJSON(t, h, "POST", "/v1/jobs", bad, "Bearer "+testToken).Code; got != 400 {
		t.Fatalf("traversal: %d", got)
	}
	data := []byte("x")
	sum := sha256.Sum256(data)
	m.Context = "."
	m.ContextSHA256 = hex.EncodeToString(sum[:])
	m.ContextBytes = 2
	bad.RunID = "build-3"
	created := callJSON(t, h, "POST", "/v1/jobs", bad, "Bearer "+testToken)
	id := decode(t, created)["id"].(string)
	r := httptest.NewRequest("PUT", "/v1/jobs/"+id+"/context", bytes.NewReader(data))
	r.Header.Set("Authorization", "Bearer "+testToken)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 422 {
		t.Fatalf("wrong byte count: %d", w.Code)
	}
}

func TestDockerEngineTransportNegotiatesVersionAndUsesUnixSocket(t *testing.T) {
	var buildBody string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/version":
			if r.ContentLength != 0 {
				t.Errorf("version probe unexpectedly carried request body length %d", r.ContentLength)
			}
			io.WriteString(w, `{"ApiVersion":"1.47"}`)
		case "/v1.47/build":
			data, _ := io.ReadAll(r.Body)
			buildBody = string(data)
			w.WriteHeader(200)
			io.WriteString(w, `{"stream":"ok"}`)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	tr := &dockerEngineTransport{dial: func(context.Context) (net.Conn, error) {
		return net.Dial("tcp", strings.TrimPrefix(server.URL, "http://"))
	}}
	request, _ := http.NewRequest("POST", "http://docker/build", strings.NewReader("context tar"))
	resp, err := tr.RoundTrip(request)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 || string(body) != `{"stream":"ok"}` || buildBody != "context tar" {
		t.Fatalf("engine response: %d %s", resp.StatusCode, body)
	}
}

func TestComposeValidationRequiresImage(t *testing.T) {
	req := JobRequest{Type: "compose-cache", RunID: "x", Revision: strings.Repeat("a", 40), Arch: "aarch64", ComposeConfig: json.RawMessage(`{"services":{"built":{"build":{"context":"."}}}}`)}
	if err := validateJob(req); err == nil {
		t.Fatal("expected missing image validation error")
	}
}

type fakeDockerEngine struct {
	calls        []string
	imageID      string
	inspectCalls int
	saved        []byte
}

type fakeBuildEngine struct {
	calls        []string
	context      []byte
	buildURL     string
	imageID      string
	imageArchive []byte
}

func (f *fakeBuildEngine) Do(req *http.Request) (*http.Response, error) {
	f.calls = append(f.calls, req.Method+" "+req.URL.RequestURI())
	status, body := http.StatusOK, "{}"
	switch {
	case req.Method == http.MethodPost && req.URL.Path == "/build":
		f.buildURL = req.URL.RequestURI()
		f.context, _ = io.ReadAll(req.Body)
		body = `{"stream":"Successfully built image"}`
	case req.Method == http.MethodPost && strings.HasSuffix(req.URL.Path, "/tag"):
		body = ""
	case req.Method == http.MethodGet && strings.HasPrefix(req.URL.Path, "/images/") && strings.HasSuffix(req.URL.Path, "/json"):
		body = `{"Id":"` + f.imageID + `"}`
	case req.Method == http.MethodGet && req.URL.Path == "/images/get":
		return &http.Response{StatusCode: status, Status: "200 OK", Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(f.imageArchive))}, nil
	default:
		status, body = http.StatusNotFound, `{"message":"unexpected Docker API request"}`
	}
	return &http.Response{StatusCode: status, Status: http.StatusText(status), Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
}

func TestImageBuildWorkerBuildsAndSavesViaDockerEngineAPI(t *testing.T) {
	engine := &fakeBuildEngine{imageID: "sha256:" + strings.Repeat("a", 64), imageArchive: []byte("saved-image")}
	h, err := NewHandler(testToken, t.TempDir(), engine)
	if err != nil {
		t.Fatal(err)
	}
	h.imageHandoffDir = filepath.Join(t.TempDir(), "image-handoff")
	contextPath := filepath.Join(t.TempDir(), "context.tar")
	context := []byte("tar-context")
	if err := os.WriteFile(contextPath, context, 0o600); err != nil {
		t.Fatal(err)
	}
	version := "v2-" + strings.Repeat("b", 32)
	manifest := &BuildManifest{
		Context: ".", Dockerfile: "Dockerfile", AssetConfig: ".pi/gondolin.json", ImageRef: "voice-agent:local",
		ArtifactVersion: version,
		BuildArgs:       map[string]string{"VOICE_RUNTIME_IMAGE": "127.0.0.1:3001/image-builder/base:latest"},
		ContextSHA256:   "unused", ContextBytes: int64(len(context)),
	}
	job := Job{ID: newUUID(), Arch: "aarch64", request: JobRequest{BuildManifest: manifest}, Context: &ContextInfo{path: contextPath}}
	result, err := h.buildImage(job)
	if err != nil {
		t.Fatal(err)
	}
	if result.Digest != engine.imageID || result.Handoff != "/image-handoff/"+version+".tar" || result.ImageRef != manifest.ImageRef {
		t.Fatalf("unexpected build result: %+v", result)
	}
	if !bytes.Equal(engine.context, context) {
		t.Fatalf("Engine received wrong build context: %q", engine.context)
	}
	if !strings.Contains(engine.calls[0], "platform=linux%2Farm64") || !strings.Contains(engine.calls[0], "networkmode=host") {
		t.Fatalf("build options missing from Engine API request: %v", engine.calls)
	}
	query, err := url.ParseQuery(strings.TrimPrefix(engine.buildURL, "/build?"))
	if err != nil {
		t.Fatal(err)
	}
	if got := query.Get("buildargs"); !strings.Contains(got, "127.0.0.1:3001") {
		t.Fatalf("host registry build argument missing: %s", got)
	}
	if got := query.Get("version"); got != "2" {
		t.Fatalf("build must select BuildKit (version=2), got %q", got)
	}
	archive, err := os.ReadFile(filepath.Join(h.imageHandoffDir, version+".tar"))
	if err != nil || !bytes.Equal(archive, engine.imageArchive) {
		t.Fatalf("image handoff archive mismatch: %v", err)
	}
}

func (f *fakeDockerEngine) Do(req *http.Request) (*http.Response, error) {
	f.calls = append(f.calls, req.Method+" "+req.URL.RequestURI())
	status, body := http.StatusOK, "{}"
	switch {
	case req.Method == http.MethodGet && strings.HasPrefix(req.URL.Path, "/images/") && strings.HasSuffix(req.URL.Path, "/json"):
		f.inspectCalls++
		if f.inspectCalls == 1 {
			status, body = http.StatusNotFound, `{"message":"not found"}`
		} else {
			body = `{"Id":"` + f.imageID + `"}`
		}
	case req.Method == http.MethodPost && req.URL.Path == "/images/create":
		body = `{"status":"Downloaded"}`
	case req.Method == http.MethodPost && strings.Contains(req.URL.Path, "/tag"):
		body = ""
	case req.Method == http.MethodGet && req.URL.Path == "/images/get":
		return &http.Response{StatusCode: status, Status: "200 OK", Header: make(http.Header), Body: io.NopCloser(bytes.NewReader(f.saved))}, nil
	default:
		status, body = http.StatusNotFound, `{"message":"unexpected Docker API request"}`
	}
	return &http.Response{StatusCode: status, Status: http.StatusText(status), Header: make(http.Header), Body: io.NopCloser(strings.NewReader(body))}, nil
}

func TestComposeCacheWorkerUsesDockerEngineAPIAndWritesHandoff(t *testing.T) {
	engine := &fakeDockerEngine{imageID: "sha256:" + strings.Repeat("d", 64), saved: []byte("docker image archive")}
	h, err := NewHandler(testToken, t.TempDir(), engine)
	if err != nil {
		t.Fatal(err)
	}
	body := map[string]any{
		"runId": "cache-1", "revision": strings.Repeat("e", 40), "arch": "aarch64",
		"composeConfig": map[string]any{"services": map[string]any{
			"grafana": map[string]any{"image": "grafana/grafana:12.0"},
			"metrics": map[string]any{"image": "grafana/grafana:12.0"},
			"built":   map[string]any{"build": map[string]any{"context": "."}, "image": "example/built:local"},
		}},
	}
	request := httptest.NewRequest("POST", "/v1/prepare", strings.NewReader(mustJSON(t, body)))
	request.Header.Set("Authorization", "Bearer "+testToken)
	response := httptest.NewRecorder()
	h.ServeHTTP(response, request)
	if response.Code != http.StatusAccepted {
		t.Fatalf("prepare response: %d %s", response.Code, response.Body)
	}
	for attempt := 0; attempt < 100; attempt++ {
		h.jobs.mu.RLock()
		id := h.jobs.byRunID["cache-1"]
		h.jobs.mu.RUnlock()
		job, ok := h.getJob(id)
		if ok && (job.Status == "succeeded" || job.Status == "failed") {
			if job.Status != "succeeded" {
				t.Fatalf("job failed: %s", job.Error)
			}
			if job.Images != 1 || job.Services != 2 {
				t.Fatalf("counts: images=%d services=%d", job.Images, job.Services)
			}
			if _, err := os.Stat(filepath.Join(job.Handoff, "agent", "images")); err != nil {
				t.Fatal(err)
			}
			index, err := os.ReadFile(filepath.Join(job.Handoff, "index.json"))
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(index), `"grafana"`) || !strings.Contains(string(index), `"metrics"`) {
				t.Fatalf("bad handoff index: %s", index)
			}
			calls := strings.Join(engine.calls, "\n")
			if !strings.Contains(calls, "POST /images/create?fromImage=grafana%2Fgrafana%3A12.0&platform=linux%2Farm64") {
				t.Fatalf("pull did not use Engine API with requested platform: %s", calls)
			}
			if strings.Count(calls, "/images/get?names=") != 1 {
				t.Fatalf("expected one unique image export: %s", calls)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("compose cache worker did not finish")
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}
