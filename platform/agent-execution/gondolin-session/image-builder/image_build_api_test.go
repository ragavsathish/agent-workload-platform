package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type roundTripperFunc func(*http.Request) (*http.Response, error)

func (transport roundTripperFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return transport(request)
}

func TestBuildLogStreamsNewOutputWithoutRepeatingIt(t *testing.T) {
	h := newTestHandler(t)
	const jobID = "123e4567-e89b-12d3-a456-426614174000"
	h.jobs.byID[jobID] = Job{ID: jobID, Type: "image-build", Status: "running"}
	writer := &jobProgressWriter{owner: h, jobID: jobID}
	var output bytes.Buffer
	seen := int64(0)
	for _, chunk := range []string{"#1 FROM base\n", "#2 RUN install\n"} {
		if _, err := writer.Write([]byte(chunk)); err != nil {
			t.Fatal(err)
		}
		response := callJSON(t, h, http.MethodGet, "/v1/jobs/"+jobID, nil, "Bearer "+testToken)
		var job Job
		if err := json.Unmarshal(response.Body.Bytes(), &job); err != nil {
			t.Fatal(err)
		}
		seen = printNewProgress(job, seen, &output)
	}
	if got := output.String(); got != "#1 FROM base\n#2 RUN install\n" {
		t.Fatalf("unexpected streamed output: %q", got)
	}
	if seen != int64(output.Len()) {
		t.Fatalf("wrong log offset: %d", seen)
	}
	if _, err := writer.Write(bytes.Repeat([]byte("x"), maxProgressBytes+1)); err != nil {
		t.Fatal(err)
	}
	if len(h.jobs.byID[jobID].ProgressLog) != maxProgressBytes {
		t.Fatal("build log exceeded its bound")
	}
	var truncated bytes.Buffer
	if got := printNewProgress(h.jobs.byID[jobID], 0, &truncated); got != h.jobs.byID[jobID].ProgressOffset || !strings.HasPrefix(truncated.String(), "[Job progress truncated") {
		t.Fatal("truncated build output was not reported to the client")
	}
}

func TestImageWorkflowPlanPreservesTypeScriptArtifactVersion(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "ctx"), 0700); err != nil {
		t.Fatal(err)
	}
	for file, contents := range map[string]string{
		"ctx/Dockerfile": "ARG BASE=gitea.local:3001/base:tag\nFROM alpine\n",
		"asset.json":     "{}\n",
		"config.json":    "{\"image\":\"example:dev\",\"build\":{\"context\":\"ctx\",\"dockerfile\":\"ctx/Dockerfile\",\"assetConfig\":\"asset.json\"}}\n",
	} {
		if err := os.WriteFile(filepath.Join(root, file), []byte(contents), 0600); err != nil {
			t.Fatal(err)
		}
	}
	for _, args := range [][]string{{"init", "-q"}, {"config", "user.name", "Test"}, {"config", "user.email", "test@example.com"}, {"add", "."}, {"commit", "-qm", "fixture"}} {
		command := exec.Command("git", args...)
		command.Dir = root
		if output, err := command.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %s: %v", args, output, err)
		}
	}
	t.Chdir(root)
	const expected = "v2-2e2d7112a50a84c26c6c424779ad88d9"
	plan, err := planImageWorkflow(expected, "config.json")
	if err != nil {
		t.Fatal(err)
	}
	if plan.manifest.ArtifactVersion != expected || plan.manifest.Dockerfile != "Dockerfile" || plan.manifest.BuildArgs["BASE"] != "127.0.0.1:3001/base:tag" {
		t.Fatalf("unexpected image workflow plan: %+v", plan)
	}
	if _, err := planImageWorkflow("v2-"+strings.Repeat("0", 32), "config.json"); err == nil || !strings.Contains(err.Error(), "artifact version mismatch") {
		t.Fatalf("expected artifact version mismatch, got %v", err)
	}
}

func TestImageBuildContextUploadUsesAuthenticatedStream(t *testing.T) {
	const jobID = "123e4567-e89b-12d3-a456-426614174000"
	contents := []byte("context archive")
	file := filepath.Join(t.TempDir(), "context.tar")
	if err := os.WriteFile(file, contents, 0600); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut || r.URL.Path != "/v1/jobs/"+jobID+"/context" ||
			r.Header.Get("Authorization") != "Bearer test-token" ||
			r.Header.Get("Content-Type") != "application/x-tar" || r.ContentLength != int64(len(contents)) {
			t.Errorf("unexpected upload request: %s %s headers=%v length=%d", r.Method, r.URL.Path, r.Header, r.ContentLength)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil || string(body) != string(contents) {
			t.Errorf("unexpected context body: %q, %v", body, err)
		}
		w.WriteHeader(http.StatusAccepted)
	}))
	defer server.Close()
	if err := uploadImageBuildContext(server.URL+"/v1", "test-token", jobID, file, int64(len(contents))); err != nil {
		t.Fatal(err)
	}
}

func TestImageBuildStatusRetriesTemporaryAPIError(t *testing.T) {
	const jobID = "123e4567-e89b-12d3-a456-426614174000"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/jobs/"+jobID || r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("unexpected status request: %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"`+jobID+`","status":"succeeded","result":{"handoff":"/image-handoff/test.tar"}}`)
	}))
	defer server.Close()
	client := server.Client()
	upstream := client.Transport
	requests := 0
	client.Transport = roundTripperFunc(func(request *http.Request) (*http.Response, error) {
		requests++
		if requests == 1 {
			return nil, &net.DNSError{Err: "i/o timeout", Name: "compose-cache.local", IsTimeout: true}
		}
		return upstream.RoundTrip(request)
	})
	var output bytes.Buffer
	sleeps := 0
	result, err := pollImageBuildJob(client, server.URL+"/v1", "test-token", jobID, &output, func(duration time.Duration) {
		if duration != 5*time.Second {
			t.Errorf("unexpected retry interval: %s", duration)
		}
		sleeps++
	})
	if err != nil {
		t.Fatal(err)
	}
	if requests != 2 || sleeps != 1 || result.Handoff != "/image-handoff/test.tar" || !strings.Contains(output.String(), "temporarily unavailable") {
		t.Fatalf("unexpected polling result: requests=%d sleeps=%d output=%q", requests, sleeps, output.String())
	}
}
