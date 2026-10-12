//go:build windows

package reminders

import (
	"context"
	"errors"
	"os"
	"testing"
)

// Read-only native COM probe. It never calls Create/Delete or pushes a toast.
func TestNativeTaskMissingReadOnly(t *testing.T) {
	if os.Getenv("INKISM_TEST_TASK_READ") != "1" {
		t.Skip("explicit read-only Task Scheduler COM check")
	}
	id, _ := NewCacheID()
	_, err := (nativeTaskStore{}).Get(context.Background(), TaskPrefix+id)
	if !errors.Is(err, ErrTaskNotFound) {
		t.Fatalf("missing task lookup: %v", err)
	}
}
