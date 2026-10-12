package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// A selected library must already exist. Missing/malformed preferences must not
// silently create an empty library that looks like data loss.
func existingLibrary(path string) (string, error) {
	if !filepath.IsAbs(path) {
		return "", fmt.Errorf("저장소 경로는 절대 경로여야 합니다")
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", fmt.Errorf("선택한 저장소를 찾을 수 없습니다: %w", err)
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("저장소 파일을 선택해 주세요")
	}
	if _, err := os.Stat(path + ".migration-incomplete"); err == nil {
		return "", fmt.Errorf("완료되지 않은 암호화 사본은 열 수 없습니다")
	} else if !os.IsNotExist(err) {
		return "", err
	}
	return filepath.Clean(path), nil
}
func loadLibraryPreference(path, fallback string) (string, error) {
	bytes, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return fallback, nil
	}
	if err != nil {
		return "", err
	}
	var value struct {
		Path string `json:"path"`
	}
	if err := json.Unmarshal(bytes, &value); err != nil {
		return "", fmt.Errorf("최근 저장소 설정을 읽지 못했습니다: %w", err)
	}
	return existingLibrary(value.Path)
}
func saveLibraryPreference(path, library string) error {
	library, err := existingLibrary(library)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	bytes, err := json.Marshal(struct {
		Path string `json:"path"`
	}{library})
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".library-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(bytes); err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(file.Name(), path)
}
