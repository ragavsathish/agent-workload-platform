package main

import (
	"archive/tar"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func dockerArchiveFixture(t *testing.T, tag string, includeLayer bool) []byte {
	t.Helper()
	var output bytes.Buffer
	writer := tar.NewWriter(&output)
	manifest, _ := json.Marshal([]map[string]any{{
		"Config": "config.json", "Layers": []string{"layer.tar"}, "RepoTags": []string{tag},
	}})
	files := map[string][]byte{"config.json": []byte("{}"), "manifest.json": manifest}
	if includeLayer {
		files["layer.tar"] = []byte("layer")
	}
	for name, content := range files {
		if err := writer.WriteHeader(&tar.Header{Name: name, Mode: 0o600, Size: int64(len(content))}); err != nil {
			t.Fatal(err)
		}
		if _, err := writer.Write(content); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}

func TestValidateDockerArchiveRejectsMissingBlob(t *testing.T) {
	tag := "gondolin-preload:test"
	filename := filepath.Join(t.TempDir(), "image.tar")
	if err := os.WriteFile(filename, dockerArchiveFixture(t, tag, true), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := validateDockerArchive(filename, tag); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filename, dockerArchiveFixture(t, tag, false), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := validateDockerArchive(filename, tag); err == nil || !strings.Contains(err.Error(), "missing layer.tar") {
		t.Fatalf("expected missing layer error, got %v", err)
	}
}
