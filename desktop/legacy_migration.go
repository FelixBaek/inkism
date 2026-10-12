package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// Before the rename the app kept its data in "<UserConfigDir>/Mindbox" and its
// WebView2 profile in "<UserConfigDir>/Mindbox.exe". migrateLegacyAppData moves
// both to the Inkism names once and rewrites the remembered library path so an
// existing library opens without any user action. It never overwrites a folder
// that already exists under the new name.
func migrateLegacyAppData(root string) error {
	oldDir := filepath.Join(root, "Mindbox")
	newDir := filepath.Join(root, "Inkism")
	moved, err := moveIfOnlyOld(oldDir, newDir)
	if err != nil {
		return fmt.Errorf("이전 Mindbox 저장 폴더를 Inkism으로 옮기지 못했습니다: %w", err)
	}
	if moved {
		if err := rewriteLibraryPreference(filepath.Join(newDir, "library.json"), oldDir, newDir); err != nil {
			return fmt.Errorf("저장소 위치 기록을 고치지 못했습니다: %w", err)
		}
		log.Printf("이전 저장 폴더를 옮겼습니다: %s -> %s", oldDir, newDir)
	}
	if _, err := moveIfOnlyOld(filepath.Join(root, "Mindbox.exe"), filepath.Join(root, "Inkism.exe")); err != nil {
		// The WebView2 profile only holds UI preferences; losing it is not fatal.
		log.Print("이전 화면 설정 폴더를 옮기지 못했습니다: ", err)
	}
	return nil
}

func moveIfOnlyOld(oldPath, newPath string) (bool, error) {
	if _, err := os.Stat(newPath); err == nil {
		return false, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return false, err
	}
	info, err := os.Stat(oldPath)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	} else if err != nil {
		return false, err
	}
	if !info.IsDir() {
		return false, nil
	}
	if err := os.Rename(oldPath, newPath); err != nil {
		return false, err
	}
	return true, nil
}

func rewriteLibraryPreference(path, oldDir, newDir string) error {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return err
	}
	var preference map[string]any
	if err := json.Unmarshal(data, &preference); err != nil {
		return nil // leave an unreadable preference to the normal recovery flow
	}
	current, _ := preference["path"].(string)
	prefix := oldDir + string(filepath.Separator)
	if current == "" || !(current == oldDir || strings.HasPrefix(current, prefix)) {
		return nil
	}
	preference["path"] = newDir + strings.TrimPrefix(current, oldDir)
	updated, err := json.MarshalIndent(preference, "", "  ")
	if err != nil {
		return err
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(updated, '\n'), info.Mode().Perm()); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
