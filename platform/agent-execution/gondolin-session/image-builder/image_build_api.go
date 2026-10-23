package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"time"
)

type imageWorkflowPlan struct {
	manifest BuildManifest
	context  string
	revision string
}

func workflowRelative(value any, field string) (string, error) {
	s, ok := value.(string)
	if !ok || s == "" || path.IsAbs(s) || filepath.IsAbs(s) {
		return "", fmt.Errorf("build.%s must be a non-empty relative path", field)
	}
	normalized := path.Clean(s)
	if normalized == ".." || strings.HasPrefix(normalized, "../") {
		return "", fmt.Errorf("build.%s escapes the checkout", field)
	}
	return normalized, nil
}

// canonicalJSON preserves the existing workflow.ts artifact-version contract.
// In particular, build is serialized once and then included as a JSON string.
func canonicalJSON(value any) (string, error) {
	switch v := value.(type) {
	case map[string]any:
		keys := make([]string, 0, len(v))
		for key := range v {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, key := range keys {
			encodedKey, _ := json.Marshal(key)
			encodedValue, err := canonicalJSON(v[key])
			if err != nil {
				return "", err
			}
			parts = append(parts, string(encodedKey)+":"+encodedValue)
		}
		return "{" + strings.Join(parts, ",") + "}", nil
	case []any:
		parts := make([]string, len(v))
		for i, item := range v {
			encoded, err := canonicalJSON(item)
			if err != nil {
				return "", err
			}
			parts[i] = encoded
		}
		return "[" + strings.Join(parts, ",") + "]", nil
	default:
		var b strings.Builder
		encoder := json.NewEncoder(&b)
		encoder.SetEscapeHTML(false)
		if err := encoder.Encode(value); err != nil {
			return "", err
		}
		return strings.TrimSuffix(b.String(), "\n"), nil
	}
}

func gitOutput(args ...string) (string, error) {
	output, err := exec.Command("git", args...).Output()
	if err != nil {
		return "", fmt.Errorf("git %s: %w", strings.Join(args, " "), err)
	}
	return strings.TrimSpace(string(output)), nil
}

func gitObject(revision, file string) (string, error) {
	spec := revision + ":" + file
	if file == "." {
		spec = revision + "^{tree}"
	}
	return gitOutput("rev-parse", spec)
}

func planImageWorkflow(requestedVersion, requestedConfig string) (imageWorkflowPlan, error) {
	var plan imageWorkflowPlan
	revision, err := gitOutput("rev-parse", "HEAD")
	if err != nil {
		return plan, err
	}
	configPath, err := workflowRelative(requestedConfig, "imageConfig")
	if err != nil {
		return plan, err
	}
	if !strings.HasSuffix(configPath, ".json") {
		return plan, errors.New("image config must be a JSON file")
	}
	data, err := os.ReadFile(configPath)
	if err != nil {
		return plan, err
	}
	var config map[string]any
	if err := json.Unmarshal(data, &config); err != nil {
		return plan, err
	}
	imageRef, imageOK := config["image"].(string)
	build, buildOK := config["build"].(map[string]any)
	if !imageOK || !buildOK {
		return plan, fmt.Errorf("%s must declare image and build", configPath)
	}
	context, err := workflowRelative(build["context"], "context")
	if err != nil {
		return plan, err
	}
	dockerfile, err := workflowRelative(build["dockerfile"], "dockerfile")
	if err != nil {
		return plan, err
	}
	assetConfig, err := workflowRelative(build["assetConfig"], "assetConfig")
	if err != nil {
		return plan, err
	}
	contexts := map[string]string{}
	if raw := build["contexts"]; raw != nil {
		values, ok := raw.(map[string]any)
		if !ok {
			return plan, errors.New("build.contexts must be an object")
		}
		for name, value := range values {
			contexts[name], err = workflowRelative(value, "contexts."+name)
			if err != nil {
				return plan, err
			}
		}
	}
	if len(contexts) > 0 {
		return plan, errors.New("build.contexts are not supported by the host Docker Engine build API yet")
	}
	dockerfileInContext, err := filepath.Rel(context, dockerfile)
	if err != nil || dockerfileInContext == "." || dockerfileInContext == ".." || strings.HasPrefix(dockerfileInContext, ".."+string(filepath.Separator)) || filepath.IsAbs(dockerfileInContext) {
		return plan, errors.New("build.dockerfile must be inside build.context for host builds")
	}
	dockerfileSource, err := os.ReadFile(dockerfile)
	if err != nil {
		return plan, err
	}
	if regexp.MustCompile(`(?mi)^\s*FROM\s+(?:--platform=\S+\s+)?gitea\.local:3001/`).Match(dockerfileSource) {
		return plan, errors.New("host image builds require private registry FROM references to use an overridable ARG")
	}
	buildArgs := map[string]string{}
	for _, match := range regexp.MustCompile(`(?m)^\s*ARG\s+([A-Za-z_][A-Za-z0-9_]*)=(\S+)\s*$`).FindAllStringSubmatch(string(dockerfileSource), -1) {
		if strings.Contains(match[2], "gitea.local:3001/") {
			buildArgs[match[1]] = strings.ReplaceAll(match[2], "gitea.local:3001", "127.0.0.1:3001")
		}
	}
	inputPaths := map[string]string{"context": context, "dockerfile": dockerfile, "assetConfig": assetConfig}
	inputs := map[string]any{"contexts": map[string]any{}}
	for name, file := range inputPaths {
		inputs[name], err = gitObject(revision, file)
		if err != nil {
			return plan, err
		}
	}
	normalizedBuild, err := canonicalJSON(build)
	if err != nil {
		return plan, err
	}
	contract, err := canonicalJSON(map[string]any{"image": imageRef, "build": normalizedBuild, "inputs": inputs})
	if err != nil {
		return plan, err
	}
	sum := sha256.Sum256([]byte(contract))
	version := "v2-" + hex.EncodeToString(sum[:])[:32]
	if version != requestedVersion {
		return plan, fmt.Errorf("artifact version mismatch: requested %s, source produced %s", requestedVersion, version)
	}
	target, _ := build["target"].(string)
	plan = imageWorkflowPlan{context: context, revision: revision, manifest: BuildManifest{
		Context: ".", Dockerfile: filepath.ToSlash(dockerfileInContext), AssetConfig: assetConfig,
		ArtifactVersion: version, ImageRef: imageRef, Contexts: contexts, BuildArgs: buildArgs, Target: target,
	}}
	return plan, nil
}

func runImageBuildViaAPI(args []string, output io.Writer) error {
	if len(args) != 0 {
		return errors.New("usage: gondolin-oci image build --via-api")
	}
	requestedVersion := os.Getenv("ARTIFACT_VERSION")
	if requestedVersion == "" {
		return errors.New("ARTIFACT_VERSION is required")
	}
	config := os.Getenv("IMAGE_CONFIG")
	if config == "" {
		config = ".pi/gondolin.json"
	}
	plan, err := planImageWorkflow(requestedVersion, config)
	if err != nil {
		return err
	}
	token := os.Getenv("DOCKER_JOB_API_VM_TOKEN")
	if token == "" {
		return errors.New("DOCKER_JOB_API_VM_TOKEN is required for --via-api")
	}
	arch := map[string]string{"arm64": "aarch64", "amd64": "x86_64"}[runtime.GOARCH]
	if arch == "" {
		return fmt.Errorf("unsupported builder architecture: %s", runtime.GOARCH)
	}
	workflowRun, workflowAttempt := os.Getenv("GITHUB_RUN_ID"), os.Getenv("GITHUB_RUN_ATTEMPT")
	if workflowAttempt == "" {
		workflowAttempt = "1"
	}
	if !regexp.MustCompile(`^\d+$`).MatchString(workflowRun) || !regexp.MustCompile(`^\d+$`).MatchString(workflowAttempt) {
		return errors.New("GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT must identify the workflow run")
	}
	if err := os.RemoveAll("/output"); err != nil {
		return err
	}
	if err := os.Mkdir("/output", 0700); err != nil {
		return err
	}
	contextPath := "/output/context.tar"
	command := exec.Command("tar", "--exclude=./.git", "-C", plan.context, "-cf", contextPath, ".")
	command.Stderr = os.Stderr
	if err := command.Run(); err != nil {
		return fmt.Errorf("package image build context: %w", err)
	}
	info, err := os.Stat(contextPath)
	if err != nil {
		return err
	}
	checksum, err := sha256File(contextPath)
	if err != nil {
		return err
	}
	plan.manifest.ContextBytes, plan.manifest.ContextSHA256 = info.Size(), checksum
	plan.manifest.BaseImagePullToken = os.Getenv("IMAGE_BASE_PULL_TOKEN")
	request := JobRequest{Type: "image-build", RunID: "image-" + workflowRun + "-" + workflowAttempt,
		Revision: plan.revision, Arch: arch, BuildManifest: &plan.manifest}
	if err := validateJob(request); err != nil {
		return err
	}
	client := &http.Client{Timeout: time.Minute}
	var job Job
	if err := composePullAPIRequest(client, composePullAPI, token, http.MethodPost, "/jobs", request, &job); err != nil {
		return fmt.Errorf("submit host image build: %w", err)
	}
	if !jobIDPattern.MatchString(job.ID) {
		return errors.New("host image-build response did not contain a valid job id")
	}
	if job.Status == "awaiting-context" {
		if err := uploadImageBuildContext(composePullAPI, token, job.ID, contextPath, info.Size()); err != nil {
			return err
		}
	}
	result, err := pollImageBuildJob(client, composePullAPI, token, job.ID, output, time.Sleep)
	if err != nil {
		return err
	}
	data, err := json.Marshal(result)
	if err != nil {
		return err
	}
	if err := os.WriteFile("/output/result.json", append(data, '\n'), 0600); err != nil {
		return err
	}
	fmt.Fprintf(output, "Image build handoff ready: %s\n", result.Handoff)
	return nil
}

func pollImageBuildJob(client *http.Client, endpoint, token, jobID string, output io.Writer, sleep func(time.Duration)) (*BuildResult, error) {
	var seen int64
	statusFailures := 0
	for attempt := 0; attempt < 1440; attempt++ {
		var job Job
		if err := composePullAPIRequest(client, endpoint, token, http.MethodGet, "/jobs/"+jobID, nil, &job); err != nil {
			statusFailures++
			if statusFailures >= 12 {
				return nil, fmt.Errorf("read host image-build status after %d attempts: %w", statusFailures, err)
			}
			if statusFailures == 1 {
				fmt.Fprintln(output, "Host image-build status temporarily unavailable; retrying")
			}
			sleep(5 * time.Second)
			continue
		}
		statusFailures = 0
		seen = printNewProgress(job, seen, output)
		switch job.Status {
		case "succeeded":
			if job.Result == nil {
				return nil, errors.New("host build completed without a result manifest")
			}
			return job.Result, nil
		case "failed":
			return nil, fmt.Errorf("host image build failed: %s", job.Error)
		case "awaiting-context", "queued", "running":
			sleep(5 * time.Second)
		default:
			return nil, fmt.Errorf("unexpected host image-build status: %s", job.Status)
		}
	}
	return nil, errors.New("timed out waiting for host image build (120 minutes)")
}

func printNewProgress(job Job, seen int64, output io.Writer) int64 {
	start := job.ProgressOffset - int64(len(job.ProgressLog))
	if job.ProgressOffset <= seen || start < 0 {
		return seen
	}
	if seen < start {
		fmt.Fprintf(output, "[Job progress truncated by %d bytes]\n", start-seen)
		seen = start
	}
	_, _ = io.WriteString(output, job.ProgressLog[seen-start:])
	return job.ProgressOffset
}

func uploadImageBuildContext(endpoint, token, jobID, filePath string, size int64) error {
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()
	request, err := http.NewRequest(http.MethodPut, endpoint+"/jobs/"+jobID+"/context", file)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/x-tar")
	request.ContentLength = size
	response, err := (&http.Client{Timeout: 20 * time.Minute}).Do(request)
	if err != nil {
		return fmt.Errorf("upload host image build context: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
		return fmt.Errorf("upload host image build context returned %d: %s", response.StatusCode, body)
	}
	return nil
}
