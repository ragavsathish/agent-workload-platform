package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestComposePullValidatesComposeConfigBeforeAccessingDocker(t *testing.T) {
	config := filepath.Join(t.TempDir(), "compose.json")
	if err := os.WriteFile(config, []byte(`{"services":{"worker":{}}}`), 0600); err != nil {
		t.Fatal(err)
	}
	err := runComposePull([]string{config, strings.Repeat("a", 40), "aarch64", "cli-test"}, bytes.NewReader(nil), &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), "no image services") {
		t.Fatalf("expected Compose image validation error, got %v", err)
	}
}

func TestImageBuildRejectsContextThatDoesNotMatchManifest(t *testing.T) {
	root := t.TempDir()
	manifest := filepath.Join(root, "manifest.json")
	context := filepath.Join(root, "context.tar")
	if err := os.WriteFile(context, []byte("context"), 0600); err != nil {
		t.Fatal(err)
	}
	data := `{"context":".","dockerfile":"Dockerfile","assetConfig":".pi/gondolin.json","artifactVersion":"v2-` + strings.Repeat("b", 32) + `","imageRef":"runtime:test","contextSha256":"` + strings.Repeat("0", 64) + `","contextBytes":7}`
	if err := os.WriteFile(manifest, []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
	err := runImageBuild([]string{manifest, context, strings.Repeat("c", 40), "aarch64"}, &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), "does not match the manifest") {
		t.Fatalf("expected context digest error, got %v", err)
	}
}
