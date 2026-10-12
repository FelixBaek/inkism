// Package appupdate checks a signed update feed and swaps the portable
// Windows app files (Inkism.exe, inkism-engine.exe and text files) in place.
// The profile/DB folder is never touched: only the names in packageFiles are.
package appupdate

import (
	"archive/zip"
	"cmp"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed pubkey.txt
var embeddedPublicKey string

const (
	maxManifest  = 64 << 10
	maxSignature = 1 << 10
	maxZip       = 300 << 20
	exeName      = "Inkism.exe"
	engineName   = "inkism-engine.exe"
	workDirName  = ".update"
)

// Allowed package entries (inside the zip's "Inkism/" folder) and their size caps.
var packageFiles = []struct {
	name  string
	limit int64
}{
	{exeName, 256 << 20}, {engineName, 256 << 20},
	{"README.md", 1 << 20}, {"BUILD.txt", 1 << 20},
}

var (
	errNotSupported = errors.New("이 환경에서는 업데이트를 설치할 수 없습니다")
	shaPattern      = regexp.MustCompile(`^[0-9a-f]{64}$`)
)

type Manifest struct {
	Version     string `json:"version"`
	Commit      string `json:"commit"`
	Zip         string `json:"zip"`
	SHA256      string `json:"sha256"`
	Notes       string `json:"notes"`
	PublishedAt string `json:"published_at"`
}

type Status struct {
	Current   string     `json:"current"`
	Commit    string     `json:"commit"`
	Latest    *Manifest  `json:"latest,omitempty"`
	Available bool       `json:"available"`
	CheckedAt *time.Time `json:"checked_at,omitempty"`
	Error     string     `json:"error,omitempty"`
	Phase     string     `json:"phase,omitempty"` // downloading | verifying | restarting
}

type Updater struct {
	current, commit string
	feed            *url.URL
	feedErr         error
	publicKey       ed25519.PublicKey
	client          *http.Client
	appDir          string
	args            []string

	mu     sync.Mutex
	status Status
}

// New builds an updater. INKISM_UPDATE_FEED overrides the built-in feed for
// tests and may only point at http://127.0.0.1 when it is not HTTPS.
func New(current, commit, feed, appDir string, relaunchArgs []string) *Updater {
	u := &Updater{current: current, commit: commit, appDir: appDir, args: relaunchArgs,
		client: &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("redirect refused") }}}
	u.feed, u.feedErr = feedBase(feed, os.Getenv("INKISM_UPDATE_FEED"))
	key, err := ParsePublicKey(embeddedPublicKey)
	if err != nil && u.feedErr == nil {
		u.feedErr = err
	}
	u.publicKey = key
	u.status = Status{Current: current, Commit: commit}
	return u
}

func (u *Updater) Current() string { return u.current }

func feedBase(built, override string) (*url.URL, error) {
	raw := built
	if override != "" {
		raw = override
	}
	if raw == "" {
		return nil, errors.New("업데이트 주소가 설정되지 않았습니다")
	}
	base, err := url.Parse(raw)
	if err != nil || base.Host == "" || base.User != nil {
		return nil, errors.New("업데이트 주소가 올바르지 않습니다")
	}
	local := override != "" && base.Scheme == "http" && base.Hostname() == "127.0.0.1"
	if base.Scheme != "https" && !local {
		return nil, errors.New("업데이트 주소는 HTTPS여야 합니다")
	}
	if !strings.HasSuffix(base.Path, "/") {
		base.Path += "/"
	}
	return base, nil
}

func ParsePublicKey(text string) (ed25519.PublicKey, error) {
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(text))
	if err != nil || len(raw) != ed25519.PublicKeySize {
		return nil, errors.New("업데이트 공개키가 올바르지 않습니다")
	}
	return ed25519.PublicKey(raw), nil
}

// VerifyManifest checks the base64 ed25519 signature over the exact bytes.
func VerifyManifest(key ed25519.PublicKey, data, signature []byte) error {
	sig, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(signature)))
	if err != nil || len(sig) != ed25519.SignatureSize || !ed25519.Verify(key, data, sig) {
		return errors.New("업데이트 정보의 서명이 올바르지 않습니다")
	}
	return nil
}

func parseManifest(data []byte) (*Manifest, error) {
	var m Manifest
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, errors.New("업데이트 정보를 읽을 수 없습니다")
	}
	if _, ok := parseSemver(m.Version); !ok || m.Zip != "Inkism-"+m.Version+"-windows-x64.zip" || !shaPattern.MatchString(m.SHA256) {
		return nil, errors.New("업데이트 정보 형식이 올바르지 않습니다")
	}
	return &m, nil
}

type semver struct {
	n   [3]int
	pre []string
}

func digits(s string) bool {
	return s != "" && strings.Trim(s, "0123456789") == ""
}

func parseSemver(s string) (semver, bool) {
	var v semver
	s, _, _ = strings.Cut(strings.TrimPrefix(s, "v"), "+")
	core, pre, hasPre := strings.Cut(s, "-")
	parts := strings.Split(core, ".")
	if len(parts) != 3 {
		return v, false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if !digits(p) || err != nil {
			return v, false
		}
		v.n[i] = n
	}
	if hasPre {
		v.pre = strings.Split(pre, ".")
		for _, id := range v.pre {
			if id == "" {
				return v, false
			}
		}
	}
	return v, true
}

func compareSemver(a, b semver) int {
	for i := range a.n {
		if c := cmp.Compare(a.n[i], b.n[i]); c != 0 {
			return c
		}
	}
	if len(a.pre) == 0 || len(b.pre) == 0 { // a release sorts after its pre-releases
		return cmp.Compare(len(b.pre), len(a.pre))
	}
	for i := 0; i < len(a.pre) && i < len(b.pre); i++ {
		if c := comparePrerelease(a.pre[i], b.pre[i]); c != 0 {
			return c
		}
	}
	return cmp.Compare(len(a.pre), len(b.pre))
}

// comparePrerelease orders two pre-release identifiers; numeric identifiers
// sort before alphanumeric ones.
func comparePrerelease(x, y string) int {
	switch {
	case digits(x) && digits(y):
		nx, _ := strconv.Atoi(x)
		ny, _ := strconv.Atoi(y)
		return cmp.Compare(nx, ny)
	case digits(x):
		return -1
	case digits(y):
		return 1
	default:
		return strings.Compare(x, y)
	}
}

// newer reports whether candidate is a valid version above current. An
// unparsable current version (local builds) treats every valid release as newer.
func newer(candidate, current string) bool {
	c, ok := parseSemver(candidate)
	if !ok {
		return false
	}
	cur, ok := parseSemver(current)
	return !ok || compareSemver(c, cur) > 0
}

func (u *Updater) get(ctx context.Context, name string, limit int64, w io.Writer) error {
	target := u.feed.ResolveReference(&url.URL{Path: name})
	req, err := http.NewRequestWithContext(ctx, "GET", target.String(), nil)
	if err != nil {
		return err
	}
	resp, err := u.client.Do(req)
	if err != nil {
		return errors.New("업데이트 서버에 연결하지 못했습니다")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("업데이트 서버 응답 오류 (HTTP %d)", resp.StatusCode)
	}
	if resp.ContentLength > limit {
		return errors.New("업데이트 파일이 너무 큽니다")
	}
	n, err := io.Copy(w, io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return errors.New("업데이트 파일을 내려받지 못했습니다")
	}
	if n > limit {
		return errors.New("업데이트 파일이 너무 큽니다")
	}
	return nil
}

func (u *Updater) fetchManifest(ctx context.Context) (*Manifest, error) {
	if u.feedErr != nil {
		return nil, u.feedErr
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	var data, sig strings.Builder
	if err := u.get(ctx, "latest.json", maxManifest, &data); err != nil {
		return nil, err
	}
	if err := u.get(ctx, "latest.json.sig", maxSignature, &sig); err != nil {
		return nil, err
	}
	if err := VerifyManifest(u.publicKey, []byte(data.String()), []byte(sig.String())); err != nil {
		return nil, err
	}
	return parseManifest([]byte(data.String()))
}

func (u *Updater) Status() Status {
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.status
}

func (u *Updater) Check(ctx context.Context) Status {
	m, err := u.fetchManifest(ctx)
	now := time.Now().UTC()
	u.mu.Lock()
	defer u.mu.Unlock()
	if u.status.Phase == "" { // leftover helper copy from a finished update
		_ = os.RemoveAll(filepath.Join(u.appDir, workDirName))
	}
	u.status.CheckedAt, u.status.Latest, u.status.Available, u.status.Error = &now, m, false, ""
	if err != nil {
		u.status.Error = err.Error()
	} else {
		u.status.Available = newer(m.Version, u.current)
	}
	return u.status
}

func (u *Updater) setPhase(phase string) {
	u.mu.Lock()
	u.status.Phase = phase
	u.mu.Unlock()
}

// Apply downloads and verifies the new package, then starts a detached copy of
// the current executable that swaps files once this process has exited. The
// caller must then close the app through its normal save-and-close path.
func (u *Updater) Apply(ctx context.Context) error {
	if runtime.GOOS != "windows" {
		return errNotSupported
	}
	u.mu.Lock()
	if u.status.Phase != "" {
		u.mu.Unlock()
		return errors.New("업데이트가 이미 진행 중입니다")
	}
	u.status.Phase = "downloading"
	u.mu.Unlock()
	err := u.apply(ctx)
	if err != nil {
		u.setPhase("")
	}
	return err
}

func (u *Updater) apply(ctx context.Context) error {
	staging, err := u.prepare(ctx)
	if err != nil {
		return err
	}
	self, err := os.Executable()
	if err != nil {
		return err
	}
	helper := filepath.Join(u.appDir, workDirName, "inkism-updater.exe")
	if err := copyFile(self, helper); err != nil {
		return err
	}
	args := append([]string{"--apply-update", staging, "--target", u.appDir, "--wait-pid", strconv.Itoa(os.Getpid()), "--"}, u.args...)
	child := exec.Command(helper, args...)
	child.Dir = u.appDir
	if err := child.Start(); err != nil {
		return fmt.Errorf("업데이트 도우미를 시작하지 못했습니다: %w", err)
	}
	_ = child.Process.Release()
	u.setPhase("restarting")
	return nil
}

// prepare downloads the manifest's zip into <appDir>/.update, checks its
// SHA-256 and extracts the allowed files into <appDir>/.update/staging.
func (u *Updater) prepare(ctx context.Context) (string, error) {
	m, err := u.fetchManifest(ctx)
	if err != nil {
		return "", err
	}
	if !newer(m.Version, u.current) {
		return "", errors.New("설치할 새 버전이 없습니다")
	}
	work := filepath.Join(u.appDir, workDirName)
	if err := os.RemoveAll(work); err != nil {
		return "", err
	}
	if err := os.MkdirAll(work, 0700); err != nil {
		return "", err
	}
	archive := filepath.Join(work, m.Zip)
	file, err := os.OpenFile(archive, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	hash := sha256.New()
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	err = u.get(ctx, m.Zip, maxZip, io.MultiWriter(file, hash))
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return "", err
	}
	u.setPhase("verifying")
	if hex.EncodeToString(hash.Sum(nil)) != m.SHA256 {
		return "", errors.New("내려받은 파일이 손상되었습니다 (SHA-256 불일치)")
	}
	staging := filepath.Join(work, "staging")
	if err := extractPackage(archive, staging); err != nil {
		return "", err
	}
	return staging, nil
}

// extractPackage accepts only "Inkism/<allowed name>" regular files within
// their size caps; both executables are required.
func extractPackage(archive, dest string) error {
	r, err := zip.OpenReader(archive)
	if err != nil {
		return errors.New("업데이트 파일을 열 수 없습니다")
	}
	defer r.Close()
	if err := os.MkdirAll(dest, 0700); err != nil {
		return err
	}
	seen := map[string]bool{}
	for _, f := range r.File {
		if f.Name == "Inkism/" && f.FileInfo().IsDir() {
			continue
		}
		base, ok := strings.CutPrefix(f.Name, "Inkism/")
		limit := packageLimit(base)
		if !ok || limit < 0 || seen[base] || !f.Mode().IsRegular() {
			return fmt.Errorf("업데이트 파일에 예상하지 못한 항목이 있습니다: %q", f.Name)
		}
		if f.UncompressedSize64 > uint64(limit) {
			return fmt.Errorf("업데이트 파일 항목이 너무 큽니다: %s", base)
		}
		seen[base] = true
		if err := extractEntry(f, filepath.Join(dest, base), limit); err != nil {
			return err
		}
	}
	if !seen[exeName] || !seen[engineName] {
		return errors.New("업데이트 파일에 실행 파일이 빠져 있습니다")
	}
	return nil
}

// packageLimit returns the size cap for an allowed package file, or -1.
func packageLimit(base string) int64 {
	limit := int64(-1)
	for _, p := range packageFiles {
		if p.name == base {
			limit = p.limit
		}
	}
	return limit
}

func extractEntry(f *zip.File, path string, limit int64) error {
	src, err := f.Open()
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0755)
	if err != nil {
		return err
	}
	n, err := io.Copy(dst, io.LimitReader(src, limit+1))
	if closeErr := dst.Close(); err == nil {
		err = closeErr
	}
	if err == nil && n > limit {
		err = fmt.Errorf("업데이트 파일 항목이 너무 큽니다: %s", f.Name)
	}
	return err
}

func copyFile(from, to string) error {
	src, err := os.Open(from)
	if err != nil {
		return err
	}
	defer src.Close()
	dst, err := os.OpenFile(to, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0755)
	if err != nil {
		return err
	}
	_, err = io.Copy(dst, src)
	if closeErr := dst.Close(); err == nil {
		err = closeErr
	}
	return err
}

// Windows can keep an exited image locked briefly (engine teardown, AV scan).
var renameRetry = 30 * time.Second

func retryRename(from, to string) error {
	deadline := time.Now().Add(renameRetry)
	for {
		err := os.Rename(from, to)
		if err == nil || time.Now().After(deadline) {
			return err
		}
		time.Sleep(250 * time.Millisecond)
	}
}

// ApplyStaged moves the staged files over target, keeping "<name>.old"
// backups, then launches the new Inkism.exe. Any failure restores the backups
// (and relaunches the restored app when the new one could not start).
func ApplyStaged(staging, target string, launch func(exe string) error) error {
	type step struct {
		name     string
		backedUp bool
	}
	var done []step
	rollback := func() {
		for i := len(done) - 1; i >= 0; i-- {
			dst := filepath.Join(target, done[i].name)
			_ = os.Remove(dst)
			if done[i].backedUp {
				if err := retryRename(dst+".old", dst); err != nil {
					log.Print("업데이트 되돌리기 실패: ", err)
				}
			}
		}
	}
	for _, p := range packageFiles {
		src := filepath.Join(staging, p.name)
		if _, err := os.Lstat(src); err != nil {
			if p.name == exeName || p.name == engineName {
				rollback()
				return fmt.Errorf("staged %s missing: %w", p.name, err)
			}
			continue
		}
		dst := filepath.Join(target, p.name)
		_ = os.Remove(dst + ".old")
		s := step{name: p.name}
		if _, err := os.Lstat(dst); err == nil {
			if err := retryRename(dst, dst+".old"); err != nil {
				rollback()
				return err
			}
			s.backedUp = true
		}
		done = append(done, s)
		if err := retryRename(src, dst); err != nil {
			rollback()
			return err
		}
	}
	exe := filepath.Join(target, exeName)
	if err := launch(exe); err != nil {
		rollback()
		if relaunchErr := launch(exe); relaunchErr != nil {
			log.Print("이전 버전 다시 시작 실패: ", relaunchErr)
		}
		return err
	}
	return nil
}

// RunHelper is the hidden "--apply-update <staging> --target <dir>
// --wait-pid <pid> -- <args>" mode run from a copy of the old executable.
func RunHelper(args []string) error {
	var staging, target string
	pid := -1
	var relaunch []string
	for i := 0; i < len(args); i++ {
		switch {
		case args[i] == "--":
			relaunch = args[i+1:]
			i = len(args)
		case i == 0:
			staging = args[0]
		case args[i] == "--target" && i+1 < len(args):
			i++
			target = args[i]
		case args[i] == "--wait-pid" && i+1 < len(args):
			i++
			pid, _ = strconv.Atoi(args[i])
		default:
			return fmt.Errorf("unexpected update argument %q", args[i])
		}
	}
	if target == "" || pid <= 0 || filepath.Clean(staging) != filepath.Join(filepath.Clean(target), workDirName, "staging") {
		return errors.New("invalid update helper arguments")
	}
	if logFile, err := os.OpenFile(filepath.Join(target, "update.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600); err == nil {
		defer logFile.Close()
		log.SetOutput(logFile)
	}
	if err := waitPID(pid, 10*time.Minute); err != nil {
		log.Print("업데이트 취소: 앱이 닫히지 않았습니다: ", err)
		return os.RemoveAll(staging)
	}
	err := ApplyStaged(staging, target, func(exe string) error {
		child := exec.Command(exe, relaunch...)
		child.Dir = target
		if err := child.Start(); err != nil {
			return err
		}
		return child.Process.Release()
	})
	if err != nil {
		log.Print("업데이트 실패, 이전 버전으로 되돌림: ", err)
	} else {
		log.Print("업데이트 완료")
	}
	_ = os.RemoveAll(staging)
	zips, _ := filepath.Glob(filepath.Join(target, workDirName, "*.zip"))
	for _, z := range zips {
		_ = os.Remove(z)
	}
	return err
}
