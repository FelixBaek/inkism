package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// Unsplash proxies photo search for notebook covers (same rules as the
// Arkism workflow cover picker). The access key never reaches the renderer:
// it comes from INKISM_UNSPLASH_ACCESS_KEY or a user-private file beside the
// library (<db>.unsplash-key, 0600, like <db>.sync.json), and the renderer
// only ever learns {configured: bool}.
// ponytail: plain 0600 file; Windows relies on the user-profile ACL, add DPAPI
// (googlehost.WindowsStore pattern) if the key must be encrypted at rest.
type Unsplash struct {
	KeyPath string
	Base    string // default https://api.unsplash.com (tests use httptest)
	HTTP    *http.Client
	mu      sync.Mutex
}

type UnsplashPhoto struct {
	ID        string `json:"id"`
	URL       string `json:"url"`
	Thumb     string `json:"thumb"`
	Alt       string `json:"alt,omitempty"`
	Author    string `json:"author"`
	AuthorURL string `json:"author_url"`
}

type UnsplashPage struct {
	Items      []UnsplashPhoto `json:"items"`
	TotalPages int             `json:"total_pages"`
}

const unsplashEnv = "INKISM_UNSPLASH_ACCESS_KEY"

// The referral tag Unsplash asks for on every author and Unsplash link.
const UnsplashRef = "utm_source=inkism&utm_medium=referral"

var (
	unsplashIDPattern  = regexp.MustCompile(`^[A-Za-z0-9_-]{1,32}$`)
	unsplashKeyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{16,128}$`)
	errUnsplashNoKey   = errors.New("unsplash_key_missing")
	errUnsplashFailed  = errors.New("사진 검색에 실패했습니다")
)

func unsafeURL(u string) bool {
	return strings.ContainsAny(u, "\"'<> \\") || strings.IndexFunc(u, func(r rune) bool { return r < 0x20 || r == 0x7f }) >= 0
}
func unsplashImage(u string) bool {
	return len(u) <= 600 && !unsafeURL(u) && strings.HasPrefix(u, "https://images.unsplash.com/")
}

// ValidUnsplashPhoto mirrors the engine's notebook cover check.
func ValidUnsplashPhoto(p UnsplashPhoto) bool {
	author := strings.TrimSpace(p.Author)
	return unsplashIDPattern.MatchString(p.ID) && unsplashImage(p.URL) && unsplashImage(p.Thumb) && author != "" &&
		utf8.RuneCountInString(author) <= 80 && len(p.AuthorURL) <= 300 && !unsafeURL(p.AuthorURL) && strings.HasPrefix(p.AuthorURL, "https://unsplash.com/")
}

func (u *Unsplash) key() string {
	if k := strings.TrimSpace(os.Getenv(unsplashEnv)); k != "" {
		return k
	}
	if u.KeyPath == "" {
		return ""
	}
	u.mu.Lock()
	defer u.mu.Unlock()
	raw, err := os.ReadFile(u.KeyPath)
	if err != nil || len(raw) > 256 {
		return ""
	}
	return strings.TrimSpace(string(raw))
}

func (u *Unsplash) Configured() bool { return u.key() != "" }

// SetKey stores (or, when empty, removes) the private key file.
func (u *Unsplash) SetKey(key string) error {
	key = strings.TrimSpace(key)
	if u.KeyPath == "" {
		return errors.New("키를 저장할 위치가 없습니다")
	}
	u.mu.Lock()
	defer u.mu.Unlock()
	if key == "" {
		if err := os.Remove(u.KeyPath); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	if !unsplashKeyPattern.MatchString(key) {
		return errors.New("Unsplash Access Key 형식이 아닙니다")
	}
	f, err := os.CreateTemp(filepath.Dir(u.KeyPath), ".unsplash-key-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if err = f.Chmod(0600); err == nil {
		_, err = f.WriteString(key)
	}
	if err == nil {
		err = f.Sync()
	}
	if closeErr := f.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(name, u.KeyPath)
}

func (u *Unsplash) get(ctx context.Context, path string, q url.Values, out any) error {
	key := u.key()
	if key == "" {
		return errUnsplashNoKey
	}
	base := u.Base
	if base == "" {
		base = "https://api.unsplash.com"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+path+"?"+q.Encode(), nil)
	if err != nil {
		return errUnsplashFailed
	}
	req.Header.Set("Authorization", "Client-ID "+key)
	req.Header.Set("Accept-Version", "v1")
	client := u.HTTP
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	res, err := client.Do(req)
	if err != nil {
		return errUnsplashFailed // never echo transport details
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return errUnsplashFailed
	}
	if out == nil {
		return nil
	}
	if json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(out) != nil {
		return errUnsplashFailed
	}
	return nil
}

// Search returns one page (24) of landscape, safe-search photos.
func (u *Unsplash) Search(ctx context.Context, query string, page int) (UnsplashPage, error) {
	query = strings.TrimSpace(query)
	if query == "" || utf8.RuneCountInString(query) > 100 || page < 1 || page > 50 {
		return UnsplashPage{}, errors.New("검색어를 확인해 주세요")
	}
	var raw struct {
		TotalPages int `json:"total_pages"`
		Results    []struct {
			ID   string `json:"id"`
			Alt  string `json:"alt_description"`
			URLs struct {
				Regular string `json:"regular"`
				Small   string `json:"small"`
			} `json:"urls"`
			User struct {
				Name  string `json:"name"`
				Links struct {
					HTML string `json:"html"`
				} `json:"links"`
			} `json:"user"`
		} `json:"results"`
	}
	q := url.Values{"query": {query}, "page": {strconv.Itoa(page)}, "per_page": {"24"}, "orientation": {"landscape"}, "content_filter": {"high"}}
	if err := u.get(ctx, "/search/photos", q, &raw); err != nil {
		return UnsplashPage{}, err
	}
	out := UnsplashPage{Items: []UnsplashPhoto{}, TotalPages: raw.TotalPages}
	for _, r := range raw.Results {
		sep := "?"
		if strings.Contains(r.User.Links.HTML, "?") {
			sep = "&"
		}
		p := UnsplashPhoto{ID: r.ID, URL: r.URLs.Regular, Thumb: r.URLs.Small, Alt: r.Alt, Author: strings.TrimSpace(r.User.Name), AuthorURL: r.User.Links.HTML + sep + UnsplashRef}
		if utf8.RuneCountInString(p.Alt) > 200 {
			p.Alt = string([]rune(p.Alt)[:200])
		}
		if ValidUnsplashPhoto(p) {
			out.Items = append(out.Items, p)
		}
	}
	return out, nil
}

// Use pings the photo's download_location (/photos/{id}/download), which the
// Unsplash API guidelines require when a photo is picked.
func (u *Unsplash) Use(ctx context.Context, id string) error {
	if !unsplashIDPattern.MatchString(id) {
		return errors.New("잘못된 사진 id")
	}
	return u.get(ctx, "/photos/"+id+"/download", url.Values{}, nil)
}

func (h *Handler) unsplashService() *Unsplash {
	h.unsplashOnce.Do(func() {
		if h.Unsplash != nil {
			return
		}
		h.Unsplash = &Unsplash{}
		if e, ok := h.Engine.(interface{ UnsplashKeyPath() string }); ok {
			h.Unsplash.KeyPath = e.UnsplashKeyPath()
		}
	})
	return h.Unsplash
}

func (e *Engine) UnsplashKeyPath() string { return e.database + ".unsplash-key" }

func (h *Handler) unsplash(w http.ResponseWriter, r *http.Request, ctx context.Context) {
	u := h.unsplashService()
	post := r.Method == http.MethodPost
	if post && !strings.HasPrefix(r.Header.Get(headerContentType), mediaTypeJSON) {
		fail(w, 415, fmt.Errorf("JSON required"))
		return
	}
	switch {
	case r.URL.Path == "/api/unsplash/key" && r.Method == http.MethodGet:
		unsplashReply(w, map[string]bool{"configured": u.Configured()}, nil)
	case r.URL.Path == "/api/unsplash/key" && post:
		unsplashSetKey(w, r, u)
	case r.URL.Path == "/api/unsplash/search" && r.Method == http.MethodGet:
		page, _ := strconv.Atoi(r.URL.Query().Get("page"))
		if page == 0 {
			page = 1
		}
		out, err := u.Search(ctx, r.URL.Query().Get("q"), page)
		unsplashReply(w, out, err)
	case r.URL.Path == "/api/unsplash/use" && post:
		var in struct {
			ID string `json:"id"`
		}
		if !unsplashDecode(w, r, &in) {
			return
		}
		unsplashReply(w, map[string]bool{"used": true}, u.Use(ctx, in.ID))
	default:
		fail(w, 404, fmt.Errorf("not found"))
	}
}

func unsplashSetKey(w http.ResponseWriter, r *http.Request, u *Unsplash) {
	var in struct {
		Key *string `json:"key"`
	}
	if !unsplashDecode(w, r, &in) {
		return
	}
	key := ""
	if in.Key != nil {
		key = *in.Key
	}
	if err := u.SetKey(key); err != nil {
		unsplashReply(w, nil, err)
		return
	}
	unsplashReply(w, map[string]bool{"configured": u.Configured()}, nil)
}

func unsplashDecode(w http.ResponseWriter, r *http.Request, v any) bool {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024))
	decoder.DisallowUnknownFields()
	if decoder.Decode(v) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		fail(w, 400, fmt.Errorf("invalid request"))
		return false
	}
	return true
}

func unsplashReply(w http.ResponseWriter, data any, err error) {
	switch {
	case errors.Is(err, errUnsplashNoKey):
		fail(w, 409, err)
	case errors.Is(err, errUnsplashFailed):
		fail(w, 502, err)
	case err != nil:
		fail(w, 400, err)
	default:
		writeJSON(w, 200, map[string]any{"ok": true, "data": data})
	}
}
