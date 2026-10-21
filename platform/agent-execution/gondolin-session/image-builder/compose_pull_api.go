package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

const composePullAPI = "http://compose-cache.local:18080/v1"

func runComposePullViaAPI(args []string, input io.Reader, output io.Writer) error {
	if len(args) != 2 {
		return errors.New("usage: gondolin-oci compose pull --via-api <compose-config.json|-> <run-id>")
	}
	token := os.Getenv("DOCKER_JOB_API_VM_TOKEN")
	if token == "" {
		return errors.New("DOCKER_JOB_API_VM_TOKEN is required for --via-api")
	}
	revision, err := exec.Command("git", "rev-parse", "HEAD").Output()
	if err != nil {
		return fmt.Errorf("resolve checked-out Git revision: %w", err)
	}
	arch := map[string]string{"arm64": "aarch64", "amd64": "x86_64"}[runtime.GOARCH]
	if arch == "" {
		return fmt.Errorf("unsupported builder architecture: %s", runtime.GOARCH)
	}
	args = []string{args[0], strings.TrimSpace(string(revision)), arch, args[1]}
	return composePullViaAPI(args, input, token, composePullAPI, &http.Client{Timeout: time.Minute}, time.Sleep, output)
}

func composePullViaAPI(args []string, input io.Reader, token, endpoint string, client *http.Client, sleep func(time.Duration), output io.Writer) error {
	var config []byte
	var err error
	if args[0] == "-" {
		config, err = io.ReadAll(io.LimitReader(input, maxJSONBytes+1))
	} else {
		config, err = os.ReadFile(args[0])
	}
	if err != nil {
		return fmt.Errorf("read Compose config: %w", err)
	}
	if len(config) > maxJSONBytes {
		return errors.New("Compose config exceeds 4 MiB")
	}
	request := JobRequest{Type: "compose-cache", ComposeConfig: config, Revision: args[1], Arch: args[2], RunID: args[3]}
	if err := validateJob(request); err != nil {
		return err
	}
	var job Job
	if err := composePullAPIRequest(client, endpoint, token, http.MethodPost, "/jobs", request, &job); err != nil {
		return fmt.Errorf("submit Compose image pull: %w", err)
	}
	if !jobIDPattern.MatchString(job.ID) {
		return errors.New("host API returned an invalid job ID")
	}
	for attempt := 0; attempt < 510; attempt++ {
		if err := composePullAPIRequest(client, endpoint, token, http.MethodGet, "/jobs/"+job.ID, nil, &job); err != nil {
			return fmt.Errorf("read Compose image pull status: %w", err)
		}
		switch job.Status {
		case "succeeded":
			if job.Handoff == "" {
				return errors.New("host API completed without a Compose handoff")
			}
			fmt.Fprintf(output, "Compose cache handoff ready: %s (%d images, %d services; cache %s)\n", job.Handoff, job.Images, job.Services, job.CacheID)
			fmt.Fprintf(output, "Import on the host: make gondolin-dev-cache-import GONDOLIN_DEV_CACHE_HANDOFF=%q\n", job.Handoff)
			return nil
		case "failed":
			return fmt.Errorf("host Compose image pull failed: %s", job.Error)
		case "queued", "running":
			sleep(10 * time.Second)
		default:
			return fmt.Errorf("unexpected host Compose image pull state: %s", job.Status)
		}
	}
	return errors.New("timed out waiting for host Compose image pull")
}

func composePullAPIRequest(client *http.Client, endpoint, token, method, route string, body any, result any) error {
	var input io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return err
		}
		input = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, endpoint+route, input)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	response, err := client.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
		return fmt.Errorf("%s %s returned %d: %s", method, route, response.StatusCode, message)
	}
	return json.NewDecoder(io.LimitReader(response.Body, maxJSONBytes)).Decode(result)
}
