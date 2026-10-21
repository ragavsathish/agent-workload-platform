package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestComposePullViaAPIRequestsRegistryImagesWithoutBuildJobs(t *testing.T) {
	config := `{"services":{"db":{"image":"postgres:17"},"app":{"image":"local/app:compose","build":{"context":"."}}}}`
	const jobID = "123e4567-e89b-12d3-a456-426614174000"
	var submitted bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-token" {
			t.Errorf("missing API token on %s", r.URL.Path)
		}
		switch r.URL.Path {
		case "/v1/jobs":
			submitted = true
			var request JobRequest
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Error(err)
			}
			if request.Type != "compose-cache" || len(request.BuiltImageIDs) != 0 || request.BuildManifest != nil {
				t.Errorf("unexpected build submission: %+v", request)
			}
			fmt.Fprintf(w, `{"id":%q,"status":"queued"}`, jobID)
		case "/v1/jobs/" + jobID:
			fmt.Fprint(w, `{"status":"succeeded","handoff":"/handoff/test","images":1,"services":1,"cacheId":"test"}`)
		default:
			t.Errorf("unexpected API route %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	var output bytes.Buffer
	err := composePullViaAPI([]string{"-", strings.Repeat("a", 40), "aarch64", "run-1"}, strings.NewReader(config),
		"test-token", server.URL+"/v1", server.Client(), func(time.Duration) { t.Fatal("unexpected poll delay") }, &output)
	if err != nil {
		t.Fatal(err)
	}
	if !submitted || !strings.Contains(output.String(), "make gondolin-dev-cache-import") {
		t.Fatalf("Compose pull was not submitted and reported: %s", output.String())
	}
}

func TestComposePullViaAPIStreamsProgressOnceIncludingFinalUpdate(t *testing.T) {
	config := `{"services":{"db":{"image":"postgres:17"}}}`
	const jobID = "123e4567-e89b-12d3-a456-426614174000"
	statusCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/jobs":
			fmt.Fprintf(w, `{"id":%q,"status":"queued"}`, jobID)
		case "/v1/jobs/" + jobID:
			statusCalls++
			switch statusCalls {
			case 1:
				fmt.Fprint(w, `{"status":"running","progressLog":"Pulling postgres:17\n","progressOffset":20}`)
			case 2:
				fmt.Fprint(w, `{"status":"running","progressLog":"Pulling postgres:17\n","progressOffset":20}`)
			default:
				fmt.Fprint(w, `{"status":"succeeded","handoff":"/handoff/test","images":1,"services":1,"cacheId":"test","progressLog":"Pulling postgres:17\nExported postgres:17\n","progressOffset":41}`)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	var output bytes.Buffer
	err := composePullViaAPI([]string{"-", strings.Repeat("a", 40), "aarch64", "run-1"}, strings.NewReader(config),
		"test-token", server.URL+"/v1", server.Client(), func(time.Duration) {}, &output)
	if err != nil {
		t.Fatal(err)
	}
	if statusCalls != 3 || strings.Count(output.String(), "Pulling postgres:17") != 1 || strings.Count(output.String(), "Exported postgres:17") != 1 {
		t.Fatalf("progress was duplicated or lost: %q", output.String())
	}
}
