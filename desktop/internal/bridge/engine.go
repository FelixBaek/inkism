package bridge

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"time"
)

const MaxMessage = 64 << 20

// Engine serializes the ordered JSONL stream. Cancellation kills a wedged child:
// a timed-out response must never be mistaken for the next request's response.
type Engine struct {
	binary             string
	database           string
	mu                 sync.Mutex
	cmd                *exec.Cmd
	input              io.WriteCloser
	output             *bufio.Scanner
	stopped            bool
	waited             bool
	initializeOnResume bool
}

func Start(binary, database string) (*Engine, error) {
	return start(binary, database, false)
}

// StartNewEncrypted provisions only a new library; keys never cross this bridge.
func StartNewEncrypted(binary, database string) (*Engine, error) {
	return start(binary, database, true)
}

func start(binary, database string, initializeEncrypted bool) (*Engine, error) {
	args := []string{"--db", database}
	if initializeEncrypted {
		args = append(args, "--initialize-encrypted")
	}
	cmd := exec.Command(binary, args...)
	hideWindow(cmd)
	cmd.Stderr = os.Stderr
	input, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	output, err := cmd.StdoutPipe()
	if err != nil {
		input.Close()
		return nil, err
	}
	if err = cmd.Start(); err != nil {
		input.Close()
		return nil, err
	}
	scan := bufio.NewScanner(output)
	scan.Buffer(make([]byte, 65536), MaxMessage)
	e := &Engine{binary: binary, database: database, cmd: cmd, input: input, output: scan}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	response, err := e.Call(ctx, json.RawMessage(`{"op":"health"}`))
	if err != nil {
		e.Close()
		return nil, err
	}
	var health struct {
		OK bool `json:"ok"`
	}
	if json.Unmarshal(response, &health) != nil || !health.OK {
		e.Close()
		return nil, fmt.Errorf("engine initialization failed: %s", response)
	}
	return e, nil
}

func (e *Engine) Call(ctx context.Context, request json.RawMessage) (json.RawMessage, error) {
	if len(request) > MaxMessage-1 || !json.Valid(request) {
		return nil, errors.New("invalid or oversized request")
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.stopped {
		return nil, errors.New("저장 엔진이 종료되었습니다. 앱을 다시 실행해 주세요")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	type result struct {
		data []byte
		err  error
	}
	done := make(chan result, 1)
	go func() {
		compact := newBuffer(request)
		if _, err := e.input.Write(append(compact, '\n')); err != nil {
			done <- result{err: err}
			return
		}
		if !e.output.Scan() {
			err := e.output.Err()
			if err == nil {
				err = io.EOF
			}
			done <- result{err: err}
			return
		}
		data := append([]byte(nil), e.output.Bytes()...)
		if !json.Valid(data) {
			done <- result{err: errors.New("invalid engine response")}
			return
		}
		done <- result{data: data}
	}()
	select {
	case out := <-done:
		if out.err != nil {
			e.stopped = true
			_ = e.cmd.Process.Kill()
		}
		return out.data, out.err
	case <-ctx.Done():
		e.stopped = true
		_ = e.cmd.Process.Kill()
		<-done
		return nil, ctx.Err()
	}
}
func newBuffer(raw []byte) []byte {
	// Call validates JSON first. Compact removes formatting newlines without
	// expanding HTML punctuation or changing numeric/string representations.
	var b bytes.Buffer
	_ = json.Compact(&b, raw)
	return b.Bytes()
}
func (e *Engine) Close() error {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.closeLocked()
}

// Caller owns mu; every child must be reaped exactly once.
func (e *Engine) closeLocked() error {
	if e.waited {
		return nil
	}
	e.waited = true
	_ = e.input.Close()
	done := make(chan error, 1)
	go func() { done <- e.cmd.Wait() }()
	select {
	case err := <-done:
		e.stopped = true
		return err
	case <-time.After(3 * time.Second):
		_ = e.cmd.Process.Kill()
		e.stopped = true
		return <-done
	}
}
