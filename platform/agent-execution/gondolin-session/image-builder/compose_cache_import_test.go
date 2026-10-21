package main

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestImportComposeCachePromotesVerifiedArchivesAndMetadata(t *testing.T) {
	root := t.TempDir()
	handoff := filepath.Join(root, "handoff")
	archiveDir := filepath.Join(handoff, "agent", "images")
	if err := os.MkdirAll(archiveDir, 0755); err != nil {
		t.Fatal(err)
	}
	archive := "0123456789abcdef01234567.tar"
	tag := "gondolin-preload:0123456789abcdef01234567"
	archivePath := filepath.Join(archiveDir, archive)
	if err := os.WriteFile(archivePath, dockerArchiveFixture(t, tag, true), 0o600); err != nil {
		t.Fatal(err)
	}
	archiveBytes, err := os.ReadFile(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(archiveBytes)
	checksum := hex.EncodeToString(sum[:])
	index := `{"services":{"db":{"archive":"` + archive + `","image":"` + tag + `","sha256":"` + checksum + `"},"api":{"archive":"` + archive + `","image":"` + tag + `","sha256":"` + checksum + `"}},"generatedAt":"kept"}`
	for name, data := range map[string]string{
		"index.json":            index,
		"compose.override.json": `{"services":{}}`,
		"cache-id":              strings.Repeat("a", 64),
	} {
		if err := os.WriteFile(filepath.Join(handoff, name), []byte(data), 0644); err != nil {
			t.Fatal(err)
		}
	}
	preload, shared := filepath.Join(root, "preload"), filepath.Join(root, "shared")
	sharedImages := filepath.Join(shared, "agent", "images")
	if err := os.MkdirAll(sharedImages, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sharedImages, archive), dockerArchiveFixture(t, tag, false), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := importComposeCache([]string{handoff, preload, shared}); err != nil {
		t.Fatal(err)
	}
	if err := verifyComposeArchive(filepath.Join(sharedImages, archive), checksum, tag); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(archivePath); !os.IsNotExist(err) {
		t.Fatalf("handoff archive was not consumed: %v", err)
	}
	got, err := os.ReadFile(filepath.Join(preload, "index.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != index {
		t.Fatalf("index fields were not preserved: %s", got)
	}
}

func TestImportComposeCacheRejectsBadArchiveChecksum(t *testing.T) {
	if err := verifyComposeArchive("/nonexistent", strings.Repeat("0", 64), "gondolin-preload:test"); err == nil {
		t.Fatal("expected missing archive to be rejected")
	}
}
