package relay

import (
	"bytes"
	"encoding/json"
	"fmt"
	bolt "go.etcd.io/bbolt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
)

const blobTestID = "3d8f6a2e-1b7c-4e5f-9a0b-8c7d6e5f4a3b"

func newBlobRelay(t *testing.T) (*Relay, string, string) {
	t.Helper()
	token := strings.Repeat("b", 32)
	path := filepath.Join(t.TempDir(), "relay.db")
	r, err := Open(path, token)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { r.Close() })
	return r, token, path
}

func callBlob(t *testing.T, r *Relay, token, method, path string, body []byte) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	out := httptest.NewRecorder()
	r.ServeHTTP(out, req)
	return out
}

// blobID builds a distinct canonical lowercase UUID per test case.
func blobID(n int) string {
	return fmt.Sprintf("%08x-0000-0000-0000-%012x", n, n)
}

// patternBytes produces deterministic payloads; distinct seeds give distinct bytes.
func patternBytes(t *testing.T, size, seed int) []byte {
	t.Helper()
	body := make([]byte, size)
	for i := range body {
		body[i] = byte(seed*31 + i*7 + i>>8)
	}
	return body
}

func TestBlobEndpointsRequireBearer(t *testing.T) {
	r, token, _ := newBlobRelay(t)
	target := "/v1/blobs/" + blobTestID
	if out := callBlob(t, r, "", "PUT", target, patternBytes(t, 64, 1)); out.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated PUT: %d", out.Code)
	}
	if out := callBlob(t, r, "", "GET", target, nil); out.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated GET: %d", out.Code)
	}
	if out := callBlob(t, r, strings.Repeat("x", 32), "PUT", target, patternBytes(t, 64, 1)); out.Code != http.StatusUnauthorized {
		t.Fatalf("wrong token PUT: %d", out.Code)
	}
	// Rejected requests must not have stored anything.
	if out := callBlob(t, r, token, "GET", target, nil); out.Code != http.StatusNotFound {
		t.Fatalf("blob stored despite auth failures: %d", out.Code)
	}
}

func TestBlobSizeBoundaries(t *testing.T) {
	r, token, _ := newBlobRelay(t)
	cases := []struct {
		name string
		size int
		want int
	}{
		{"empty body", 0, http.StatusBadRequest},
		{"below minimum", 39, http.StatusBadRequest},
		{"minimum nonce+tag", minBlobBytes, http.StatusCreated},
		{"maximum 256KiB+overhead", maxBlobBytes, http.StatusCreated},
		{"one over maximum", maxBlobBytes + 1, http.StatusRequestEntityTooLarge},
		{"far over maximum", 1 << 20, http.StatusRequestEntityTooLarge},
	}
	for i, tc := range cases {
		out := callBlob(t, r, token, "PUT", "/v1/blobs/"+blobID(i+1), patternBytes(t, tc.size, i+1))
		if out.Code != tc.want {
			t.Fatalf("%s (size %d): got %d want %d", tc.name, tc.size, out.Code, tc.want)
		}
	}
	// Boundary blobs must come back byte-exact.
	for _, i := range []int{2, 3} {
		payload := patternBytes(t, cases[i].size, i+1)
		out := callBlob(t, r, token, "GET", "/v1/blobs/"+blobID(i+1), nil)
		if out.Code != http.StatusOK || !bytes.Equal(out.Body.Bytes(), payload) {
			t.Fatalf("%s: fetch got %d, exact=%v", cases[i].name, out.Code, bytes.Equal(out.Body.Bytes(), payload))
		}
	}
}

func TestBlobPutGetExactBytesReopenReplayConflict(t *testing.T) {
	r, token, path := newBlobRelay(t)
	target := "/v1/blobs/" + blobTestID
	payload := patternBytes(t, 4096, 5)

	if out := callBlob(t, r, token, "PUT", target, payload); out.Code != http.StatusCreated {
		t.Fatalf("first PUT: %d", out.Code)
	}
	out := callBlob(t, r, token, "GET", target, nil)
	if out.Code != http.StatusOK {
		t.Fatalf("GET: %d", out.Code)
	}
	if got := out.Header().Get("Content-Type"); got != "application/octet-stream" {
		t.Fatalf("Content-Type: %q", got)
	}
	if got := out.Header().Get("Content-Length"); got != strconv.Itoa(len(payload)) {
		t.Fatalf("Content-Length: %q want %d", got, len(payload))
	}
	if !bytes.Equal(out.Body.Bytes(), payload) {
		t.Fatal("GET returned different bytes")
	}

	// Identical replay is accepted idempotently, not 201 and not 409.
	if out := callBlob(t, r, token, "PUT", target, payload); out.Code != http.StatusOK {
		t.Fatalf("replay PUT: %d", out.Code)
	}
	// Different bytes conflict and the original stays intact.
	if out := callBlob(t, r, token, "PUT", target, patternBytes(t, 4096, 6)); out.Code != http.StatusConflict {
		t.Fatalf("conflicting PUT: %d", out.Code)
	}
	if out := callBlob(t, r, token, "GET", target, nil); out.Code != http.StatusOK || !bytes.Equal(out.Body.Bytes(), payload) {
		t.Fatalf("original not preserved: %d", out.Code)
	}
	// Unknown but well-formed ID is a plain 404.
	if out := callBlob(t, r, token, "GET", "/v1/blobs/"+blobID(99), nil); out.Code != http.StatusNotFound {
		t.Fatalf("missing blob GET: %d", out.Code)
	}

	// Reopen from disk: the blob survives, replay/conflict semantics too.
	if err := r.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := Open(path, token)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	out = callBlob(t, reopened, token, "GET", target, nil)
	if out.Code != http.StatusOK || !bytes.Equal(out.Body.Bytes(), payload) {
		t.Fatalf("blob lost after reopen: %d", out.Code)
	}
	if out := callBlob(t, reopened, token, "PUT", target, payload); out.Code != http.StatusOK {
		t.Fatalf("replay after reopen: %d", out.Code)
	}
	if out := callBlob(t, reopened, token, "PUT", target, patternBytes(t, 4096, 6)); out.Code != http.StatusConflict {
		t.Fatalf("conflict after reopen: %d", out.Code)
	}
}

func TestBlobRejectsMalformedIDs(t *testing.T) {
	r, token, _ := newBlobRelay(t)
	body := patternBytes(t, 64, 1)
	bad := []string{
		strings.ToUpper(blobTestID),            // non-normalized uppercase form
		"3d8f6a2e1b7c4e5f9a0b8c7d6e5f4a3b",     // 32 hex without hyphens
		"{" + blobTestID + "}",                 // braced form
		"urn:uuid:" + blobTestID,               // urn-prefixed form
		blobTestID + "/payload.bin",            // extra path element
		blobTestID + "/",                       // trailing slash
		blobTestID[:35] + "g",                  // invalid hex character
		"3d8f6a2e-1b7c-4e5f-9a0b+8c7d6e5f4a3b", // wrong separator
		"3d8f6a2e-1b7c-4e5f-9a0b-8c7d6e5f4a3",  // 35 characters
	}
	for _, id := range bad {
		target := "/v1/blobs/" + id
		if out := callBlob(t, r, token, "PUT", target, body); out.Code != http.StatusNotFound {
			t.Fatalf("malformed PUT %q: %d", id, out.Code)
		}
		if out := callBlob(t, r, token, "GET", target, nil); out.Code != http.StatusNotFound {
			t.Fatalf("malformed GET %q: %d", id, out.Code)
		}
	}
	// None of the malformed uploads may have written a single key.
	stored := 0
	if err := r.db.View(func(tx *bolt.Tx) error {
		stored = tx.Bucket(blobsBucket).Stats().KeyN
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if stored != 0 {
		t.Fatalf("malformed IDs stored %d blobs", stored)
	}
}

func TestBlobMethodNotAllowed(t *testing.T) {
	r, token, _ := newBlobRelay(t)
	target := "/v1/blobs/" + blobTestID
	for _, method := range []string{"DELETE", "POST", "HEAD", "PATCH"} {
		out := callBlob(t, r, token, method, target, nil)
		if out.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s: %d", method, out.Code)
		}
		if allow := out.Header().Get("Allow"); allow != "GET, PUT" {
			t.Fatalf("%s Allow header: %q", method, allow)
		}
	}
}

func TestBlobTrafficLeavesChangesCursorUntouched(t *testing.T) {
	r, token, _ := newBlobRelay(t)
	post := func(id, blob string) *httptest.ResponseRecorder {
		return callBlob(t, r, token, "POST", "/v1/changes", []byte(fmt.Sprintf(`{"id":%q,"blob":%q}`, id, blob)))
	}
	// Existing contract: change IDs are 16..128 characters.
	if out := post("change-a-00000001", "enc-a"); out.Code != http.StatusOK {
		t.Fatal(out.Body.String())
	}
	if out := post("change-b-00000001", "enc-b"); out.Code != http.StatusOK {
		t.Fatal(out.Body.String())
	}
	snapshot := func() (uint64, []string, []uint64) {
		out := callBlob(t, r, token, "GET", "/v1/changes?limit=100", nil)
		if out.Code != http.StatusOK {
			t.Fatal(out.Body.String())
		}
		var page struct {
			Items  []Record
			Cursor uint64
		}
		if err := json.Unmarshal(out.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		ids := make([]string, 0, len(page.Items))
		seqs := make([]uint64, 0, len(page.Items))
		for _, it := range page.Items {
			ids = append(ids, it.ID)
			seqs = append(seqs, it.Seq)
		}
		return page.Cursor, ids, seqs
	}
	beforeCursor, beforeIDs, beforeSeqs := snapshot()

	payload := patternBytes(t, 512, 3)
	if out := callBlob(t, r, token, "PUT", "/v1/blobs/"+blobTestID, payload); out.Code != http.StatusCreated {
		t.Fatalf("blob PUT: %d", out.Code)
	}
	if out := callBlob(t, r, token, "GET", "/v1/blobs/"+blobTestID, nil); out.Code != http.StatusOK {
		t.Fatalf("blob GET: %d", out.Code)
	}
	callBlob(t, r, token, "PUT", "/v1/blobs/"+blobTestID, payload) // replay
	callBlob(t, r, token, "DELETE", "/v1/blobs/"+blobTestID, nil)  // 405

	afterCursor, afterIDs, afterSeqs := snapshot()
	if afterCursor != beforeCursor || !slicesEqual(beforeIDs, afterIDs) || !seqsEqual(beforeSeqs, afterSeqs) {
		t.Fatalf("changes stream moved: cursor %d->%d ids %v->%v seqs %v->%v",
			beforeCursor, afterCursor, beforeIDs, afterIDs, beforeSeqs, afterSeqs)
	}
	// The records sequence still advances to exactly 3: blob writes never
	// consumed a sequence number.
	out := post("change-c-00000001", "enc-c")
	if out.Code != http.StatusOK || !strings.Contains(out.Body.String(), `"seq":3`) {
		t.Fatalf("next change seq: %d %s", out.Code, out.Body.String())
	}
}

func slicesEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func seqsEqual(a, b []uint64) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestBlobConcurrentDistinctPutsSingleWinner(t *testing.T) {
	r, token, _ := newBlobRelay(t)
	target := "/v1/blobs/" + blobTestID
	const writers = 8
	payloads := make([][]byte, writers)
	for i := range payloads {
		payloads[i] = patternBytes(t, 200, i+1)
	}
	codes := make([]int, writers)
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			codes[i] = callBlob(t, r, token, "PUT", target, payloads[i]).Code
		}(i)
	}
	close(start)
	wg.Wait()
	created, conflicts := 0, 0
	for _, c := range codes {
		switch c {
		case http.StatusCreated:
			created++
		case http.StatusConflict:
			conflicts++
		default:
			t.Fatalf("unexpected statuses %v", codes)
		}
	}
	if created != 1 || conflicts != writers-1 {
		t.Fatalf("created=%d conflicts=%d codes=%v", created, conflicts, codes)
	}
	winner := -1
	for i, c := range codes {
		if c == http.StatusCreated {
			winner = i
		}
	}
	out := callBlob(t, r, token, "GET", target, nil)
	if out.Code != http.StatusOK || !bytes.Equal(out.Body.Bytes(), payloads[winner]) {
		t.Fatalf("stored bytes are not the single winner payload: %d", out.Code)
	}
}
