package main

import (
	"archive/tar"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"strings"
)

// validateDockerArchive checks the references docker load needs. A successful
// Engine save is not enough: a containerd image store can omit lazy-pulled blobs.
func validateDockerArchive(filename, tag string) error {
	file, err := os.Open(filename)
	if err != nil {
		return err
	}
	defer file.Close()

	type imageManifest struct {
		Config   string   `json:"Config"`
		Layers   []string `json:"Layers"`
		RepoTags []string `json:"RepoTags"`
	}
	var manifests []imageManifest
	present := map[string]bool{}
	reader := tar.NewReader(file)
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return fmt.Errorf("read image archive: %w", err)
		}
		if header.Typeflag != tar.TypeReg && header.Typeflag != tar.TypeRegA {
			continue
		}
		name := path.Clean(header.Name)
		present[name] = true
		if name == "manifest.json" {
			data, err := io.ReadAll(io.LimitReader(reader, maxJSONBytes+1))
			if err != nil {
				return fmt.Errorf("read image manifest: %w", err)
			}
			if len(data) > maxJSONBytes || json.Unmarshal(data, &manifests) != nil {
				return errors.New("image archive has an invalid manifest.json")
			}
		}
	}
	if len(manifests) == 0 {
		return errors.New("image archive has no Docker manifest")
	}
	for _, manifest := range manifests {
		matchingTag := false
		for _, repoTag := range manifest.RepoTags {
			if repoTag == tag {
				matchingTag = true
				break
			}
		}
		if !matchingTag {
			continue
		}
		if manifest.Config == "" {
			return errors.New("image archive has no config reference")
		}
		for _, referenced := range append([]string{manifest.Config}, manifest.Layers...) {
			if !present[path.Clean(referenced)] {
				return fmt.Errorf("image archive is missing %s", referenced)
			}
		}
		return nil
	}
	return fmt.Errorf("image archive has no %s tag", tag)
}

func exportRemoteImage(source, tag, arch, destination string) error {
	platform := "linux/amd64"
	if arch == "aarch64" {
		platform = "linux/arm64"
	}
	command := exec.CommandContext(context.Background(), "docker", "buildx", "build",
		"--pull", "--progress=plain", "--platform", platform, "--tag", tag,
		"--output", "type=docker,dest="+destination, "-")
	command.Stdin = strings.NewReader("FROM " + source + "\n")
	command.Env = append(os.Environ(), "DOCKER_HOST=unix:///var/run/docker.sock")
	output, err := command.CombinedOutput()
	if err != nil {
		_ = os.Remove(destination)
		return fmt.Errorf("Buildx export failed: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return nil
}
