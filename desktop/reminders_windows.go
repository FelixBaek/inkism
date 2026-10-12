//go:build windows

package main

import (
	"context"
	"github.com/FelixBaek/inkism/desktop/internal/bridge"
	"github.com/FelixBaek/inkism/desktop/internal/reminders"
	"log"
	"os"
	"time"
)

func startReminders(engine *bridge.Engine, handler *bridge.Handler) func() {
	service, err := reminders.New(engine.ReminderStatePath(), handler.Gate.Guard(engine), reminders.Notify)
	if err != nil {
		log.Printf("알림 설정을 읽지 못했습니다: %v", err)
		return func() {
			// Nothing to stop: the reminder service never started.
		}
	}
	root, rootErr := reminders.CacheRoot()
	executable, exeErr := os.Executable()
	if rootErr == nil && exeErr == nil {
		if scheduler, err := reminders.NativeScheduler(executable); err == nil {
			service.AttachBackground(root, scheduler)
		}
	}
	handler.Reminders = service
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		defer close(done)
		service.Run(ctx, func(err error) { log.Printf("알림 확인 실패: %v", err) })
	}()
	return func() {
		flushCtx, flushCancel := context.WithTimeout(context.Background(), 3*time.Second)
		if err := service.Poll(flushCtx, time.Now()); err != nil {
			log.Printf("종료 전 알림 캐시 갱신 실패: %v", err)
		}
		flushCancel()
		cancel()
		<-done
	}
}
