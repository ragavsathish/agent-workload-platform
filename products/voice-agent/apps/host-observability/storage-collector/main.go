package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/moby/moby/client"
)

type record struct {
	Metric string `json:"metric"`
	Area   string `json:"area,omitempty"`
	Kind   string `json:"kind,omitempty"`
	Bytes  int64  `json:"bytes"`
}

type directory struct {
	area string
	path string
}

func directoryBytes(ctx context.Context, path string) (int64, error) {
	output, err := exec.CommandContext(ctx, "/usr/bin/du", "-sk", path).Output()
	if err != nil {
		return 0, err
	}
	fields := bytes.Fields(output)
	if len(fields) == 0 {
		return 0, fmt.Errorf("empty du output")
	}
	kib, err := strconv.ParseInt(string(fields[0]), 10, 64)
	return kib * 1024, err
}

func collectDirectories(ctx context.Context, paths []directory) []record {
	results := make([]record, len(paths))
	valid := make([]bool, len(paths))
	var group sync.WaitGroup
	for index, entry := range paths {
		group.Add(1)
		go func() {
			defer group.Done()
			bytes, err := directoryBytes(ctx, entry.path)
			if err == nil {
				results[index] = record{Metric: "directory", Area: entry.area, Bytes: bytes}
				valid[index] = true
			}
		}()
	}
	group.Wait()
	var records []record
	for index, ok := range valid {
		if ok {
			records = append(records, results[index])
		}
	}
	return records
}

func dockerRecords(usage client.DiskUsageResult) []record {
	kinds := []struct {
		name        string
		size        int64
		reclaimable int64
	}{
		{"images", usage.Images.TotalSize, usage.Images.Reclaimable},
		{"containers", usage.Containers.TotalSize, usage.Containers.Reclaimable},
		{"volumes", usage.Volumes.TotalSize, usage.Volumes.Reclaimable},
		{"build_cache", usage.BuildCache.TotalSize, usage.BuildCache.Reclaimable},
	}
	records := make([]record, 0, len(kinds)*2)
	for _, kind := range kinds {
		records = append(records,
			record{Metric: "docker_size", Kind: kind.name, Bytes: kind.size},
			record{Metric: "docker_reclaimable", Kind: kind.name, Bytes: kind.reclaimable},
		)
	}
	return records
}

func collect(ctx context.Context) ([]record, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	runtimeRoot := filepath.Join(home, "Library", "Application Support", "PipecatEdge")
	paths := []directory{
		{"gondolin_images", filepath.Join(home, ".cache", "gondolin", "images")},
		{"image_handoff", filepath.Join(runtimeRoot, "gondolin-image-handoff")},
		{"builder_assets", filepath.Join(runtimeRoot, "gondolin-builder-assets")},
	}
	if artifacts := strings.TrimSpace(os.Getenv("STORAGE_ARTIFACTS_DIR")); artifacts != "" {
		paths = append(paths, directory{"repository_artifacts", artifacts})
	}
	records := collectDirectories(ctx, paths)
	dockerClient, err := client.New(client.FromEnv)
	if err != nil {
		return records, err
	}
	defer dockerClient.Close()
	usage, err := dockerClient.DiskUsage(ctx, client.DiskUsageOptions{
		Images: true, Containers: true, Volumes: true, BuildCache: true,
	})
	if err != nil {
		return records, err
	}
	return append(records, dockerRecords(usage)...), nil
}

func main() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	records, err := collect(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Docker storage sample unavailable:", err)
	}
	encoder := json.NewEncoder(os.Stdout)
	for _, entry := range records {
		if encodeErr := encoder.Encode(entry); encodeErr != nil {
			fmt.Fprintln(os.Stderr, encodeErr)
			os.Exit(1)
		}
	}
}
