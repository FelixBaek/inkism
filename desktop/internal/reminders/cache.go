package reminders

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"github.com/FelixBaek/inkism/desktop/internal/applock"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

var ErrCacheStillActive = errors.New("알림 캐시 중지를 완료하지 못했습니다")

const maxTimestamp int64 = 8640000000000000
const maxCacheBytes = 16 << 20

var cacheIDPattern = regexp.MustCompile(`^[0-9a-f]{32}$`)
var opaquePattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

type Schedule struct {
	ID    string `json:"id"`
	At    int64  `json:"at"`
	Hours int64  `json:"hours"`
}
type Cache struct {
	Version    int              `json:"version"`
	Generation uint64           `json:"generation"`
	Enabled    bool             `json:"enabled"`
	UpdatedAt  int64            `json:"updated_at"`
	Schedules  []Schedule       `json:"schedules"`
	Delivered  map[string]int64 `json:"delivered"`
}
type Scheduler interface {
	Enable(context.Context, string) error
	Disable(context.Context, string) error
}
type Background struct {
	Root, ID  string
	Scheduler Scheduler
}

func NewCacheID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(b[:]), nil
}
func CacheRoot() (string, error) {
	root, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(root, "Inkism", "ReminderCache"), nil
}
func (b *Background) path() (string, error) {
	if !cacheIDPattern.MatchString(b.ID) || !filepath.IsAbs(b.Root) {
		return "", errors.New("invalid reminder cache identifier")
	}
	return filepath.Join(b.Root, b.ID+".json"), nil
}
func writePrivateJSON(path string, value any) error {
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if len(raw) > maxCacheBytes {
		return errors.New("reminder cache exceeds limit")
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".reminder-cache-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(raw)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(name, path)
}
func readCache(path string) (Cache, error) {
	var value Cache
	f, err := os.Open(path)
	if err != nil {
		return value, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.Size() > maxCacheBytes {
		return value, errors.New("invalid reminder cache size")
	}
	decoder := json.NewDecoder(f)
	decoder.DisallowUnknownFields()
	if err = decoder.Decode(&value); err != nil {
		return value, err
	}
	if decoder.Decode(&struct{}{}) != io.EOF {
		return value, errors.New("trailing cache data")
	}
	if value.Version != 1 || len(value.Schedules) > 100000 {
		return value, errors.New("invalid reminder cache")
	}
	if value.Delivered == nil {
		value.Delivered = map[string]int64{}
	}
	for _, entry := range value.Schedules {
		if !opaquePattern.MatchString(entry.ID) || entry.At < 0 || entry.At > maxTimestamp || (entry.Hours != 0 && entry.Hours != 24 && entry.Hours != 168) {
			return value, errors.New("invalid cached schedule")
		}
	}
	for id, at := range value.Delivered {
		if !opaquePattern.MatchString(id) || at < 0 || at > maxTimestamp {
			return value, errors.New("invalid delivery receipt")
		}
	}
	return value, nil
}
func (b *Background) locked(ctx context.Context, fn func(string) error) error {
	path, err := b.path()
	if err != nil {
		return err
	}
	if err = os.MkdirAll(b.Root, 0700); err != nil {
		return err
	}
	for {
		release, err := applock.Acquire(path)
		if err == nil {
			defer release()
			return fn(path)
		}
		if !errors.Is(err, applock.ErrBusy) {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(20 * time.Millisecond):
		}
	}
}
func (b *Background) Enable(ctx context.Context) error {
	if b.Scheduler == nil {
		return errors.New("background scheduling unavailable")
	}
	// No active schedule exists until the unlocked worker refreshes it.
	if err := b.locked(ctx, func(path string) error {
		value, err := readCache(path)
		if err != nil && !os.IsNotExist(err) {
			return err
		}
		value.Version = 1
		value.Enabled = false
		value.Generation++
		return writePrivateJSON(path, value)
	}); err != nil {
		return err
	}
	if err := writePrivateJSON(filepath.Join(b.Root, b.ID+".task"), taskReceipt{Owner: receiptOwner(b.Scheduler)}); err != nil {
		return err
	}
	if err := b.Scheduler.Enable(ctx, b.ID); err != nil {
		_ = b.Invalidate(ctx)
		return err
	}
	return nil
}
func (b *Background) Invalidate(ctx context.Context) error {
	return b.locked(ctx, func(path string) error {
		value, err := readCache(path)
		if os.IsNotExist(err) {
			return nil
		}
		if err != nil {
			return err
		}
		value.Enabled = false
		value.Generation++
		return writePrivateJSON(path, value)
	})
}
func (b *Background) Disable(ctx context.Context) (map[string]int64, error) {
	var delivered map[string]int64
	err := b.locked(ctx, func(path string) error {
		value, err := readCache(path)
		if err == nil {
			delivered = value.Delivered
		} else if !os.IsNotExist(err) {
			// Corrupt cache cannot authorize notifications; remove only this strict ID.
			delivered = map[string]int64{}
		}
		if err = os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, errors.Join(ErrCacheStillActive, err)
	}
	if b.Scheduler != nil {
		err = b.Scheduler.Disable(ctx, b.ID)
	}
	if err == nil {
		_ = os.Remove(filepath.Join(b.Root, b.ID+".task"))
	}
	return delivered, err
}
func (b *Background) Refresh(ctx context.Context, schedules []Schedule, seed map[string]int64, generation uint64) error {
	return b.locked(ctx, func(path string) error {
		value, err := readCache(path)
		if err != nil {
			return err
		}
		if value.Generation != generation {
			return errors.New("reminder schedule changed during refresh")
		}
		next := Cache{Version: 1, Generation: generation, Enabled: true, UpdatedAt: time.Now().UnixMilli(), Schedules: schedules, Delivered: map[string]int64{}}
		for _, entry := range schedules {
			if at, ok := value.Delivered[entry.ID]; ok {
				next.Delivered[entry.ID] = at
			}
			if at, ok := seed[entry.ID]; ok {
				prior, exists := next.Delivered[entry.ID]
				if !exists || at > prior {
					next.Delivered[entry.ID] = at
				}
			}
		}
		return writePrivateJSON(path, next)
	})
}

// Fire opens only the strict opaque cache path. There is no Engine, DB path,
// token, title, or body available to this function or its helper command.
func (b *Background) Fire(ctx context.Context, now time.Time, send func() error) error {
	return b.locked(ctx, func(path string) error {
		value, err := readCache(path)
		if os.IsNotExist(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if !value.Enabled {
			return nil
		}
		pending := duePending(value, now)
		if len(pending) == 0 {
			return nil
		}
		if err = ctx.Err(); err != nil {
			return err
		}
		if err = send(); err != nil {
			return err
		}
		for id, at := range pending {
			value.Delivered[id] = at
		}
		return writePrivateJSON(path, value)
	})
}

// latestOccurrence returns the most recent repeat of a due schedule.
func latestOccurrence(entry Schedule, now time.Time) int64 {
	at := entry.At
	if entry.Hours > 0 {
		step := entry.Hours * int64(time.Hour/time.Millisecond)
		at += ((now.UnixMilli() - at) / step) * step
	}
	return at
}

// duePending returns the latest due occurrence of each schedule that has not
// been delivered yet.
func duePending(value Cache, now time.Time) map[string]int64 {
	pending := map[string]int64{}
	for _, entry := range value.Schedules {
		if entry.At > now.UnixMilli() {
			continue
		}
		at := latestOccurrence(entry, now)
		if old, ok := value.Delivered[entry.ID]; !ok || old < at {
			pending[entry.ID] = at
		}
	}
	return pending
}

func (b *Background) Generation(ctx context.Context) (uint64, error) {
	var generation uint64
	err := b.locked(ctx, func(path string) error {
		value, err := readCache(path)
		if err != nil {
			return err
		}
		generation = value.Generation
		return nil
	})
	return generation, err
}
