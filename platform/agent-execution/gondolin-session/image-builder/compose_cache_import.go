package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var (
	composeArchiveName = regexp.MustCompile(`^[a-f0-9]{24}\.tar$`)
	composeDigest      = regexp.MustCompile(`^[a-f0-9]{64}$`)
)

type composeCacheIndex struct {
	Services map[string]struct {
		Archive string `json:"archive"`
		Image   string `json:"image"`
		SHA256  string `json:"sha256"`
	} `json:"services"`
}

func importComposeCache(args []string) error {
	if len(args) != 3 {
		return errors.New("usage: gondolin-oci compose import <handoff-root> <preload-root> <shared-store-root>")
	}
	handoff, err := filepath.Abs(filepath.Clean(args[0]))
	if err != nil {
		return err
	}
	preload, err := filepath.Abs(filepath.Clean(args[1]))
	if err != nil {
		return err
	}
	shared, err := filepath.Abs(filepath.Clean(args[2]))
	if err != nil {
		return err
	}
	indexPath := filepath.Join(handoff, "index.json")
	overridePath := filepath.Join(handoff, "compose.override.json")
	cacheIDPath := filepath.Join(handoff, "cache-id")
	for path, label := range map[string]string{indexPath: "cache index", overridePath: "Compose override", cacheIDPath: "cache id"} {
		if err := requireRegularFile(path, label); err != nil {
			return err
		}
	}
	indexData, err := os.ReadFile(indexPath)
	if err != nil {
		return fmt.Errorf("read cache index: %w", err)
	}
	var index composeCacheIndex
	if err := json.Unmarshal(indexData, &index); err != nil {
		return fmt.Errorf("read cache index: %w", err)
	}
	var override any
	if err := readJSON(overridePath, &override); err != nil {
		return fmt.Errorf("read Compose override: %w", err)
	}
	cacheIDBytes, err := os.ReadFile(cacheIDPath)
	if err != nil {
		return err
	}
	cacheID := strings.TrimSpace(string(cacheIDBytes))
	if len(index.Services) == 0 || !composeDigest.MatchString(cacheID) {
		return errors.New("handoff index or cache id is invalid")
	}

	handoffImages := filepath.Join(handoff, "agent", "images")
	sharedImages := filepath.Join(shared, "agent", "images")
	preloadImages := filepath.Join(preload, "agent", "images")
	type archiveEntry struct{ checksum, tag string }
	archives := map[string]archiveEntry{}
	for service, entry := range index.Services {
		if service == "" || !composeArchiveName.MatchString(entry.Archive) || !composeDigest.MatchString(entry.SHA256) ||
			entry.Image != "gondolin-preload:"+strings.TrimSuffix(entry.Archive, ".tar") {
			return fmt.Errorf("invalid cache entry for service %q", service)
		}
		if prior, ok := archives[entry.Archive]; ok && prior.checksum != entry.SHA256 {
			return fmt.Errorf("conflicting checksums for archive %s", entry.Archive)
		}
		archives[entry.Archive] = archiveEntry{entry.SHA256, entry.Image}
	}
	if err := os.MkdirAll(sharedImages, 0755); err != nil {
		return err
	}
	for archive, entry := range archives {
		source, destination := filepath.Join(handoffImages, archive), filepath.Join(sharedImages, archive)
		if err := verifyComposeArchive(source, entry.checksum, entry.tag); err != nil {
			return err
		}
		if err := verifyComposeArchive(destination, entry.checksum, entry.tag); err == nil {
			continue
		}
		temp := filepath.Join(sharedImages, fmt.Sprintf("%s.%d.partial", archive, time.Now().UnixNano()))
		if err := copyFileExclusive(source, temp); err != nil {
			return err
		}
		if err := verifyComposeArchive(temp, entry.checksum, entry.tag); err != nil {
			_ = os.Remove(temp)
			return err
		}
		if err := os.Rename(temp, destination); err != nil {
			_ = os.Remove(temp)
			return err
		}
	}
	if err := os.MkdirAll(preloadImages, 0755); err != nil {
		return err
	}
	if err := writeJSONAtomic(filepath.Join(preload, "compose.override.json"), override); err != nil {
		return err
	}
	if err := writeAtomic(filepath.Join(preload, "index.json"), indexData); err != nil {
		return err
	}
	if err := writeTextAtomic(filepath.Join(preload, "cache-id"), cacheID); err != nil {
		return err
	}
	if err := pruneLocalComposeArchives(preloadImages); err != nil {
		return err
	}
	for archive := range archives {
		_ = os.Remove(filepath.Join(handoffImages, archive))
	}
	fmt.Printf("Imported %d shared image archives for %d Compose services from %s\n", len(archives), len(index.Services), handoff)
	return nil
}

func requireRegularFile(path, label string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("%s: %w", label, err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("%s is not a regular file: %s", label, path)
	}
	return nil
}

func readJSON(path string, out any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}

func verifyComposeArchive(path, checksum, tag string) error {
	if err := requireRegularFile(path, "image archive"); err != nil {
		return err
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		_ = f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if hex.EncodeToString(h.Sum(nil)) != checksum {
		return fmt.Errorf("image archive checksum mismatch: %s", path)
	}
	return validateDockerArchive(path, tag)
}

func copyFileExclusive(source, destination string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil {
		_ = os.Remove(destination)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(destination)
		return closeErr
	}
	return nil
}

func writeJSONAtomic(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return writeAtomic(path, append(data, '\n'))
}
func writeTextAtomic(path, value string) error { return writeAtomic(path, []byte(value+"\n")) }
func writeAtomic(path string, data []byte) error {
	temp := fmt.Sprintf("%s.%d.tmp", path, time.Now().UnixNano())
	f, err := os.OpenFile(temp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		return err
	}
	_, writeErr := f.Write(data)
	closeErr := f.Close()
	if writeErr != nil {
		_ = os.Remove(temp)
		return writeErr
	}
	if closeErr != nil {
		_ = os.Remove(temp)
		return closeErr
	}
	if err := os.Rename(temp, path); err != nil {
		_ = os.Remove(temp)
		return err
	}
	return nil
}
func pruneLocalComposeArchives(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	pattern := regexp.MustCompile(`^[a-f0-9]{24}\.tar(?:\.zst)?$`)
	for _, entry := range entries {
		if pattern.MatchString(entry.Name()) {
			if err := os.Remove(filepath.Join(dir, entry.Name())); err != nil {
				return err
			}
		}
	}
	return nil
}
