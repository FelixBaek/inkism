package appupdate

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestEmbeddedPublicKey(t *testing.T) {
	if _, err := ParsePublicKey(embeddedPublicKey); err != nil {
		t.Fatal(err)
	}
}

func TestVerifyManifest(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	data := []byte(`{"version":"0.2.0"}`)
	sig := []byte(base64.StdEncoding.EncodeToString(ed25519.Sign(priv, data)) + "\n")
	if err := VerifyManifest(pub, data, sig); err != nil {
		t.Fatal(err)
	}
	otherPub, _, _ := ed25519.GenerateKey(rand.Reader)
	for name, c := range map[string]struct {
		key       ed25519.PublicKey
		data, sig []byte
	}{
		"tampered": {pub, []byte(`{"version":"9.9.9"}`), sig},
		"wrongKey": {otherPub, data, sig},
		"empty":    {pub, data, nil},
		"garbage":  {pub, data, []byte("!!")},
	} {
		if VerifyManifest(c.key, c.data, c.sig) == nil {
			t.Errorf("%s accepted", name)
		}
	}
}

func TestSemver(t *testing.T) {
	order := []string{"0.0.0-dev", "0.1.0", "0.2.0-alpha", "0.2.0-alpha.1", "0.2.0-alpha.beta", "0.2.0-beta.2", "0.2.0-beta.11", "0.2.0-rc.1", "0.2.0", "0.10.0", "1.0.0"}
	for i := 1; i < len(order); i++ {
		if !newer(order[i], order[i-1]) || newer(order[i-1], order[i]) {
			t.Errorf("%s should be newer than %s", order[i], order[i-1])
		}
	}
	if newer("0.2.0", "0.2.0") || newer("0.2.0+build", "0.2.0") {
		t.Error("equal versions reported newer")
	}
	for _, bad := range []string{"1.2", "1.2.3.4", "a.b.c", "1.-2.3", "+1.2.3", "1.2.3-", "1.2.3-a..b"} {
		if _, ok := parseSemver(bad); ok {
			t.Errorf("%q parsed", bad)
		}
	}
}

func TestFeedBase(t *testing.T) {
	if _, err := feedBase("", ""); err == nil {
		t.Error("empty feed accepted")
	}
	if _, err := feedBase("http://example.com/", ""); err == nil {
		t.Error("plain http feed accepted")
	}
	if _, err := feedBase("https://x/", "http://localhost:8000/"); err == nil {
		t.Error("http override to non-127.0.0.1 accepted")
	}
	if u, err := feedBase("https://x/", "http://127.0.0.1:8000/feed"); err != nil || u.String() != "http://127.0.0.1:8000/feed/" {
		t.Error(u, err)
	}
}

type entry struct {
	name string
	body []byte
}

func makeZip(t *testing.T, entries ...entry) []byte {
	var buf bytes.Buffer
	w := zip.NewWriter(&buf)
	for _, e := range entries {
		f, err := w.Create(e.name)
		if err != nil {
			t.Fatal(err)
		}
		f.Write(e.body)
	}
	w.Close()
	return buf.Bytes()
}

func goodEntries() []entry {
	return []entry{{"Inkism/Inkism.exe", []byte("new-shell")}, {"Inkism/inkism-engine.exe", []byte("new-engine")}, {"Inkism/README.md", []byte("readme")}}
}

func TestExtractPackage(t *testing.T) {
	dir := t.TempDir()
	write := func(data []byte) string {
		p := filepath.Join(dir, "p.zip")
		os.WriteFile(p, data, 0600)
		return p
	}
	if err := extractPackage(write(makeZip(t, goodEntries()...)), filepath.Join(dir, "ok")); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "ok", "Inkism.exe")); string(b) != "new-shell" {
		t.Fatal("not extracted")
	}
	cases := map[string][]entry{
		"traversal":  append(goodEntries(), entry{"Inkism/../evil.exe", nil}),
		"absolute":   append(goodEntries(), entry{"/etc/evil", nil}),
		"unexpected": append(goodEntries(), entry{"Inkism/profile/notes.db", nil}),
		"noPrefix":   {{"Inkism.exe", nil}, {"inkism-engine.exe", nil}},
		"duplicate":  append(goodEntries(), entry{"Inkism/Inkism.exe", nil}),
		"missingExe": {{"Inkism/Inkism.exe", nil}},
		"oversize":   append(goodEntries()[:2], entry{"Inkism/BUILD.txt", bytes.Repeat([]byte("x"), 1<<20+1)}),
	}
	for name, entries := range cases {
		if err := extractPackage(write(makeZip(t, entries...)), filepath.Join(dir, name)); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
}

// feed serves a signed manifest for the given zip; mutate tweaks it before signing.
func feed(t *testing.T, priv ed25519.PrivateKey, version string, zipData []byte, mutate func(*Manifest)) *httptest.Server {
	sum := sha256.Sum256(zipData)
	m := Manifest{Version: version, Commit: "abc", Zip: "Inkism-" + version + "-windows-x64.zip", SHA256: hex.EncodeToString(sum[:]), Notes: "새 기능"}
	if mutate != nil {
		mutate(&m)
	}
	manifest, _ := json.Marshal(m)
	sig := base64.StdEncoding.EncodeToString(ed25519.Sign(priv, manifest))
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/feed/latest.json":
			w.Write(manifest)
		case "/feed/latest.json.sig":
			w.Write([]byte(sig))
		case "/feed/" + m.Zip:
			w.Write(zipData)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func testUpdater(t *testing.T, srv *httptest.Server, pub ed25519.PublicKey, current string) *Updater {
	t.Setenv("INKISM_UPDATE_FEED", srv.URL+"/feed")
	u := New(current, "deadbeef", "https://unused.invalid/", t.TempDir(), []string{"--db", `C:\x\profile\notes.db`})
	u.publicKey = pub
	return u
}

func TestCheckAndPrepare(t *testing.T) {
	pub, priv, _ := ed25519.GenerateKey(rand.Reader)
	zipData := makeZip(t, goodEntries()...)
	ctx := context.Background()

	u := testUpdater(t, feed(t, priv, "0.2.0", zipData, nil), pub, "0.1.0")
	if s := u.Check(ctx); !s.Available || s.Latest.Version != "0.2.0" || s.Error != "" {
		t.Fatalf("%+v", s)
	}
	staging, err := u.prepare(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(staging, "inkism-engine.exe")); string(b) != "new-engine" {
		t.Fatal("staging missing engine")
	}

	if s := testUpdater(t, feed(t, priv, "0.1.0", zipData, nil), pub, "0.1.0").Check(ctx); s.Available || s.Error != "" {
		t.Fatalf("same version: %+v", s)
	}
	if _, err := testUpdater(t, feed(t, priv, "0.1.0", zipData, nil), pub, "0.1.0").prepare(ctx); err == nil {
		t.Fatal("prepared a version that is not newer")
	}
	_, otherPriv, _ := ed25519.GenerateKey(rand.Reader)
	if s := testUpdater(t, feed(t, otherPriv, "0.2.0", zipData, nil), pub, "0.1.0").Check(ctx); s.Available || !strings.Contains(s.Error, "서명") {
		t.Fatalf("bad signature: %+v", s)
	}
	badSum := func(m *Manifest) { m.SHA256 = strings.Repeat("0", 64) }
	if _, err := testUpdater(t, feed(t, priv, "0.2.0", zipData, badSum), pub, "0.1.0").prepare(ctx); err == nil || !strings.Contains(err.Error(), "SHA-256") {
		t.Fatalf("sha mismatch: %v", err)
	}
	badName := func(m *Manifest) { m.Zip = "../x.zip" }
	if s := testUpdater(t, feed(t, priv, "0.2.0", zipData, badName), pub, "0.1.0").Check(ctx); s.Error == "" {
		t.Fatal("bad zip name accepted")
	}
}

func TestApplyNotSupportedOffWindows(t *testing.T) {
	if err := New("0.1.0", "", "https://x/", t.TempDir(), nil).Apply(context.Background()); runtime.GOOS != "windows" && !errors.Is(err, errNotSupported) {
		t.Fatal(err)
	}
}

func setupSwap(t *testing.T) (staging, target string) {
	target = t.TempDir()
	staging = filepath.Join(target, workDirName, "staging")
	os.MkdirAll(staging, 0700)
	os.MkdirAll(filepath.Join(target, "profile"), 0700)
	for name, body := range map[string]string{"Inkism.exe": "old-shell", "inkism-engine.exe": "old-engine", "profile/notes.db": "data"} {
		os.WriteFile(filepath.Join(target, name), []byte(body), 0600)
	}
	for name, body := range map[string]string{"Inkism.exe": "new-shell", "inkism-engine.exe": "new-engine", "README.md": "new-readme"} {
		os.WriteFile(filepath.Join(staging, name), []byte(body), 0600)
	}
	return
}

func read(t *testing.T, path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return "<missing>"
	}
	return string(b)
}

func TestApplyStagedSwaps(t *testing.T) {
	staging, target := setupSwap(t)
	var launched []string
	if err := ApplyStaged(staging, target, func(exe string) error { launched = append(launched, read(t, exe)); return nil }); err != nil {
		t.Fatal(err)
	}
	for name, want := range map[string]string{"Inkism.exe": "new-shell", "inkism-engine.exe": "new-engine", "README.md": "new-readme",
		"Inkism.exe.old": "old-shell", "inkism-engine.exe.old": "old-engine", "profile/notes.db": "data"} {
		if got := read(t, filepath.Join(target, name)); got != want {
			t.Errorf("%s = %q, want %q", name, got, want)
		}
	}
	if len(launched) != 1 || launched[0] != "new-shell" {
		t.Fatal(launched)
	}
}

func TestApplyStagedRollsBackWhenLaunchFails(t *testing.T) {
	staging, target := setupSwap(t)
	var launched []string
	err := ApplyStaged(staging, target, func(exe string) error {
		launched = append(launched, read(t, exe))
		if len(launched) == 1 {
			return errors.New("bad exe")
		}
		return nil
	})
	if err == nil {
		t.Fatal("expected error")
	}
	for name, want := range map[string]string{"Inkism.exe": "old-shell", "inkism-engine.exe": "old-engine", "README.md": "<missing>", "profile/notes.db": "data"} {
		if got := read(t, filepath.Join(target, name)); got != want {
			t.Errorf("%s = %q, want %q", name, got, want)
		}
	}
	if len(launched) != 2 || launched[1] != "old-shell" {
		t.Fatalf("old app not relaunched: %v", launched)
	}
}

func TestApplyStagedRollsBackMidSwap(t *testing.T) {
	old := renameRetry
	renameRetry = 0
	t.Cleanup(func() { renameRetry = old })
	staging, target := setupSwap(t)
	// A non-empty directory at the engine backup path makes the engine backup rename fail
	// after Inkism.exe has already been swapped.
	os.MkdirAll(filepath.Join(target, "inkism-engine.exe.old", "x"), 0700)
	err := ApplyStaged(staging, target, func(string) error { t.Fatal("launched after failed swap"); return nil })
	if err == nil {
		t.Fatal("expected error")
	}
	for name, want := range map[string]string{"Inkism.exe": "old-shell", "inkism-engine.exe": "old-engine"} {
		if got := read(t, filepath.Join(target, name)); got != want {
			t.Errorf("%s = %q, want %q", name, got, want)
		}
	}
}

func TestRunHelperRejectsForeignStaging(t *testing.T) {
	target := t.TempDir()
	if RunHelper([]string{"/tmp/elsewhere", "--target", target, "--wait-pid", "1", "--"}) == nil {
		t.Fatal("staging outside target accepted")
	}
}
