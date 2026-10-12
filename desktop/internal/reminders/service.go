package reminders

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"sync"
	"sync/atomic"
	"time"
)

type Caller interface {
	Call(context.Context, json.RawMessage) (json.RawMessage, error)
}
type State struct {
	Enabled    bool             `json:"enabled"`
	Background bool             `json:"background"`
	CacheID    string           `json:"cache_id,omitempty"`
	Delivered  map[string]int64 `json:"delivered"`
}
type Service struct {
	mu             sync.Mutex
	pollMu         sync.Mutex
	path           string
	state          State
	engine         Caller
	send           func() error
	lastError      string
	wake           chan struct{}
	bg             atomic.Pointer[Background]
	scheduleEpoch  atomic.Uint64
	backgroundRoot string
	scheduler      Scheduler
}

func New(path string, engine Caller, send func() error) (*Service, error) {
	s := &Service{path: path, engine: engine, send: send, wake: make(chan struct{}, 1)}
	raw, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if err == nil {
		if err = json.Unmarshal(raw, &s.state); err != nil {
			return nil, err
		}
	}
	if s.state.CacheID != "" && !cacheIDPattern.MatchString(s.state.CacheID) {
		return nil, errors.New("invalid reminder cache ID")
	}
	if s.state.Delivered == nil {
		s.state.Delivered = map[string]int64{}
	}
	return s, nil
}
func (s *Service) AttachBackground(root string, scheduler Scheduler) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.backgroundRoot = root
	s.scheduler = scheduler
	if s.state.CacheID != "" {
		s.bg.Store(&Background{Root: root, ID: s.state.CacheID, Scheduler: scheduler})
	}
}
func (s *Service) LastError() string { s.mu.Lock(); defer s.mu.Unlock(); return s.lastError }
func (s *Service) Enabled() bool     { s.mu.Lock(); defer s.mu.Unlock(); return s.state.Enabled }
func (s *Service) BackgroundEnabled() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state.Background
}
func (s *Service) BackgroundAvailable() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.scheduler != nil
}
func (s *Service) save() error { return writePrivateJSON(s.path, s.state) }
func (s *Service) Wake() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}
func (s *Service) SetEnabled(enabled bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	var cleanupErr error
	if !enabled {
		if bg := s.bg.Load(); bg != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			delivered, err := bg.Disable(ctx)
			cancel()
			if errors.Is(err, ErrCacheStillActive) {
				return err
			}
			cleanupErr = err
			if delivered != nil {
				s.state.Delivered = delivered
			}
			s.state.Background = false
		}
	}
	old := s.state.Enabled
	s.state.Enabled = enabled
	if err := s.save(); err != nil {
		s.state.Enabled = old
		return err
	}
	s.Wake()
	return cleanupErr
}
func (s *Service) SetBackground(ctx context.Context, enabled bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.scheduler == nil {
		return errors.New("종료 중 알림은 Windows 앱에서 사용할 수 있습니다")
	}
	if enabled && !s.state.Enabled {
		return errors.New("먼저 시스템 알림을 켜 주세요")
	}
	if s.state.CacheID == "" {
		if !enabled {
			return nil
		}
		if err := s.createBackgroundCache(); err != nil {
			return err
		}
	}
	bg := s.bg.Load()
	if enabled {
		if err := s.enableBackground(ctx, bg); err != nil {
			return err
		}
	} else if err := s.disableBackground(ctx, bg); err != nil {
		return err
	}
	s.Wake()
	return nil
}

// createBackgroundCache assigns and persists a new cache ID. The caller holds s.mu.
func (s *Service) createBackgroundCache() error {
	id, err := NewCacheID()
	if err != nil {
		return err
	}
	s.state.CacheID = id
	if err = s.save(); err != nil {
		s.state.CacheID = ""
		return err
	}
	s.bg.Store(&Background{Root: s.backgroundRoot, ID: id, Scheduler: s.scheduler})
	return nil
}

// enableBackground turns on the background cache. The caller holds s.mu.
func (s *Service) enableBackground(ctx context.Context, bg *Background) error {
	if s.state.Background {
		return nil
	}
	if err := bg.Enable(ctx); err != nil {
		return err
	}
	s.state.Background = true
	if err := s.save(); err != nil {
		s.state.Background = false
		_, _ = bg.Disable(ctx)
		return err
	}
	return nil
}

// disableBackground turns off the background cache, keeping what it already
// delivered. The caller holds s.mu.
func (s *Service) disableBackground(ctx context.Context, bg *Background) error {
	delivered, err := bg.Disable(ctx)
	if errors.Is(err, ErrCacheStillActive) {
		return err
	}
	if delivered != nil {
		s.state.Delivered = delivered
	}
	s.state.Background = false
	if saveErr := s.save(); saveErr != nil {
		return saveErr
	}
	return err
}

// Called before a schedule-changing mutation, never for source/body keystrokes.
// It does not acquire the service mutex or enter the engine/session gate.
func (s *Service) InvalidateCache(ctx context.Context) error {
	s.scheduleEpoch.Add(1)
	if bg := s.bg.Load(); bg != nil {
		return bg.Invalidate(ctx)
	}
	return nil
}

type reminderItem struct {
	ID     string `json:"id"`
	At     int64  `json:"reminder_at"`
	Repeat int64  `json:"reminder_repeat_hours"`
}

func (s *Service) fetch(ctx context.Context, now int64) ([]Schedule, error) {
	items := []Schedule{}
	var after *reminderItem
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		data, err := s.fetchPage(ctx, now, after)
		if err != nil {
			return nil, err
		}
		if items, err = appendSchedules(items, data); err != nil {
			return nil, err
		}
		if len(data) < 100 {
			return items, nil
		}
		last := data[len(data)-1]
		if after != nil && (last.At < after.At || (last.At == after.At && last.ID <= after.ID)) {
			return nil, errors.New("reminder cursor did not advance")
		}
		after = &last
	}
}

// fetchPage asks the engine for up to 100 due reminders after the cursor.
func (s *Service) fetchPage(ctx context.Context, now int64, after *reminderItem) ([]reminderItem, error) {
	args := map[string]any{"op": "due_reminders", "now": now, "limit": 100}
	if after != nil {
		args["after_at"] = after.At
		args["after_id"] = after.ID
	}
	req, _ := json.Marshal(args)
	raw, err := s.engine.Call(ctx, req)
	if err != nil {
		return nil, err
	}
	var response struct {
		OK    bool           `json:"ok"`
		Error string         `json:"error"`
		Data  []reminderItem `json:"data"`
	}
	if err = json.Unmarshal(raw, &response); err != nil {
		return nil, err
	}
	if !response.OK {
		return nil, errors.New(response.Error)
	}
	return response.Data, nil
}

// appendSchedules validates a page and adds it as opaque hashed schedules.
func appendSchedules(items []Schedule, data []reminderItem) ([]Schedule, error) {
	for _, entry := range data {
		if entry.At < 0 || entry.At > maxTimestamp || (entry.Repeat != 0 && entry.Repeat != 24 && entry.Repeat != 168) {
			return nil, errors.New("invalid reminder schedule")
		}
		hash := sha256.Sum256([]byte(entry.ID))
		items = append(items, Schedule{ID: hex.EncodeToString(hash[:]), At: entry.At, Hours: entry.Repeat})
	}
	if len(items) > 100000 {
		return nil, errors.New("알림 예약은 최대 100000개까지 지원합니다")
	}
	return items, nil
}

// lockPoll waits for pollMu until ctx ends.
func (s *Service) lockPoll(ctx context.Context) error {
	for !s.pollMu.TryLock() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(20 * time.Millisecond):
		}
	}
	return nil
}

func (s *Service) Poll(ctx context.Context, now time.Time) (result error) {
	if err := s.lockPoll(ctx); err != nil {
		return err
	}
	defer s.pollMu.Unlock()
	defer func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.lastError = ""
		if result != nil {
			s.lastError = result.Error()
		}
	}()
	s.mu.Lock()
	enabled, background := s.state.Enabled, s.state.Background
	bg := s.bg.Load()
	s.mu.Unlock()
	if !enabled {
		return nil
	}
	epoch := s.scheduleEpoch.Load()
	generation, err := backgroundGeneration(ctx, background, bg)
	if err != nil {
		return err
	}
	bound := now.UnixMilli()
	if background {
		bound = maxTimestamp
	}
	// No service mutex is held while entering SessionGate.Guard(engine).
	items, err := s.fetch(ctx, bound)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.state.Enabled {
		return nil
	}
	if background != s.state.Background || epoch != s.scheduleEpoch.Load() {
		s.Wake()
		return nil
	}
	if background {
		if err := bg.Refresh(ctx, items, s.state.Delivered, generation); err != nil {
			return err
		}
		return bg.Fire(ctx, now, s.send)
	}
	return s.deliverForeground(items, now)
}

func backgroundGeneration(ctx context.Context, background bool, bg *Background) (uint64, error) {
	if !background {
		return 0, nil
	}
	if bg == nil {
		return 0, errors.New("background reminder cache unavailable")
	}
	return bg.Generation(ctx)
}

// deliverForeground notifies once for due items and records them, dropping
// delivery marks for schedules that no longer exist. The caller holds s.mu.
func (s *Service) deliverForeground(items []Schedule, now time.Time) error {
	pending := map[string]int64{}
	seen := map[string]bool{}
	for _, entry := range items {
		if entry.At > now.UnixMilli() {
			continue
		}
		at := latestOccurrence(entry, now)
		seen[entry.ID] = true
		if delivered, ok := s.state.Delivered[entry.ID]; !ok || delivered < at {
			pending[entry.ID] = at
		}
	}
	if len(pending) == 0 {
		return nil
	}
	if err := s.send(); err != nil {
		return err
	}
	old := s.state.Delivered
	next := map[string]int64{}
	for key, at := range old {
		if seen[key] {
			next[key] = at
		}
	}
	for key, at := range pending {
		next[key] = at
	}
	s.state.Delivered = next
	if err := s.save(); err != nil {
		s.state.Delivered = old
		return err
	}
	return nil
}
func (s *Service) Run(ctx context.Context, report func(error)) {
	timer := time.NewTicker(15 * time.Second)
	defer timer.Stop()
	for {
		if err := s.Poll(ctx, time.Now()); err != nil {
			report(err)
		}
		select {
		case <-ctx.Done():
			return
		case <-s.wake:
		case <-timer.C:
		}
	}
}
