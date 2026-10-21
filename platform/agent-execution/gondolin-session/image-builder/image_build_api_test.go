package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

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
