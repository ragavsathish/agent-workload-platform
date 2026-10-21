package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"
)

func runComposePull(args []string, input io.Reader, output io.Writer) error {
	if len(args) != 4 && len(args) != 6 {
		return errors.New("usage: gondolin-oci compose pull <compose-config.json> <revision> <arch> <run-id> [<preload-root> <shared-store-root>]")
	}
	var config []byte
	var err error
	if args[0] == "-" {
		config, err = io.ReadAll(input)
		if err != nil {
			return fmt.Errorf("read Compose config from stdin: %w", err)
		}
	} else {
		config, err = os.ReadFile(args[0])
		if err != nil {
			return fmt.Errorf("read Compose config: %w", err)
		}
	}
	request := JobRequest{Type: "compose-cache", ComposeConfig: config, Revision: args[1], Arch: args[2], RunID: args[3]}
	if err := validateJob(request); err != nil {
		return err
	}
	cacheRoot, err := os.UserCacheDir()
	if err != nil {
		return err
	}
	contextDir := filepath.Join(cacheRoot, "gondolin-oci", "contexts")
	if err := os.MkdirAll(contextDir, 0700); err != nil {
		return err
	}
	handler, err := newLocalHandler(contextDir)
	if err != nil {
		return err
	}
	result, err := handler.prepareComposeCache(Job{Type: request.Type, RunID: request.RunID, Revision: request.Revision, Arch: request.Arch, request: request})
	if err != nil {
		return err
	}
	if len(args) == 6 {
		handoffRoot := filepath.Join(handler.handoffDir, filepath.Base(result.Handoff))
		if err := importComposeCache([]string{handoffRoot, args[4], args[5]}); err != nil {
			return fmt.Errorf("promote pulled Compose images: %w", err)
		}
	}
	return encodeCLIResult(output, result)
}

func runImageBuild(args []string, output io.Writer) error {
	if len(args) != 4 {
		return errors.New("usage: gondolin-oci image build <build-manifest.json> <context.tar> <revision> <arch>")
	}
	manifestData, err := os.ReadFile(args[0])
	if err != nil {
		return fmt.Errorf("read build manifest: %w", err)
	}
	var manifest BuildManifest
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		return fmt.Errorf("parse build manifest: %w", err)
	}
	contextPath, err := filepath.Abs(args[1])
	if err != nil {
		return err
	}
	info, err := os.Stat(contextPath)
	if err != nil {
		return fmt.Errorf("stat build context: %w", err)
	}
	checksum, err := sha256File(contextPath)
	if err != nil {
		return err
	}
	if info.Size() != manifest.ContextBytes || checksum != manifest.ContextSHA256 {
		return errors.New("build context size or SHA-256 does not match the manifest")
	}
	request := JobRequest{Type: "image-build", RunID: fmt.Sprintf("cli-%d", time.Now().UnixNano()), Revision: args[2], Arch: args[3], BuildManifest: &manifest}
	if err := validateJob(request); err != nil {
		return err
	}
	cacheRoot, err := os.UserCacheDir()
	if err != nil {
		return err
	}
	handler, err := newLocalHandler(filepath.Join(cacheRoot, "gondolin-oci", "contexts"))
	if err != nil {
		return err
	}
	result, err := handler.buildImage(Job{Type: request.Type, RunID: request.RunID, Revision: request.Revision, Arch: request.Arch, request: request, Context: &ContextInfo{Bytes: info.Size(), SHA256: checksum, path: contextPath}})
	if err != nil {
		return err
	}
	return encodeCLIResult(output, result)
}

func runImageExport(args []string, output io.Writer) error {
	if len(args) != 2 {
		return errors.New("usage: gondolin-oci image export <image-reference> <archive.tar>")
	}
	cacheRoot, err := os.UserCacheDir()
	if err != nil {
		return err
	}
	handler, err := newLocalHandler(filepath.Join(cacheRoot, "gondolin-oci", "contexts"))
	if err != nil {
		return err
	}
	if err := handler.exportImage(args[0], args[1]); err != nil {
		return err
	}
	return encodeCLIResult(output, map[string]string{"image": args[0], "archive": args[1], "purpose": "Gondolin VM handoff"})
}

func newLocalHandler(contextDir string) (*Handler, error) {
	if err := os.MkdirAll(contextDir, 0700); err != nil {
		return nil, err
	}
	handler, err := NewHandler("local-cli", contextDir, nil)
	if err != nil {
		return nil, err
	}
	handler.engine = NewDockerEngine(dockerSocket())
	return handler, nil
}

func dockerSocket() string {
	if socket := os.Getenv("DOCKER_HOST_SOCKET"); socket != "" {
		return socket
	}
	return "/var/run/docker.sock"
}

func encodeCLIResult(output io.Writer, value any) error {
	encoder := json.NewEncoder(output)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}
