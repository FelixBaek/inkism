package bridge

import (
	"testing"
)

func TestRecoveryOperationsNeverReachRendererEngine(t *testing.T) {
	engine := &fakeEngine{}
	handler := &Handler{Engine: engine}
	for _, op := range []string{"sync_recovery_export", "sync_recovery_import"} {
		out := securityHTTPCall(handler, "POST", "/api/rpc", `{"op":"`+op+`","confirmed_server_recovery":true}`)
		if out.Code != 400 || engine.last != nil {
			t.Fatal("renderer reached host recovery", op, out.Code)
		}
	}
}
