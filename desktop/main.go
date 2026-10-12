package main

import (
	"context"
	"flag"
	"fmt"
	"github.com/FelixBaek/inkism/desktop/internal/applock"
	"github.com/FelixBaek/inkism/desktop/internal/appupdate"
	"github.com/FelixBaek/inkism/desktop/internal/bridge"
	"github.com/FelixBaek/inkism/desktop/internal/googlehost"
	"github.com/FelixBaek/inkism/frontend"
	"io/fs"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"time"
)

// Set at build time: -ldflags "-X main.appVersion=0.2.0 -X main.appCommit=<sha> -X main.updateFeed=<url>".
// An empty updateFeed leaves in-app updates unconfigured.
var (
	appVersion = "0.0.0-dev"
	appCommit  = ""
	updateFeed = ""
)

func newUpdater() *appupdate.Updater {
	commit := appCommit
	if info, ok := debug.ReadBuildInfo(); ok && commit == "" {
		for _, s := range info.Settings {
			if s.Key == "vcs.revision" {
				commit = s.Value
			}
		}
	}
	exe, _ := os.Executable()
	return appupdate.New(appVersion, commit, updateFeed, filepath.Dir(exe), os.Args[1:])
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "--apply-update" {
		if err := appupdate.RunHelper(os.Args[2:]); err != nil {
			log.Print(err)
			os.Exit(1)
		}
		return
	}
	if handled, err := reminderCommand(os.Args[1:]); handled {
		if err != nil {
			log.Print("종료 중 알림 작업 실패: ", err)
			os.Exit(1)
		}
		return
	}
	if err := run(); err != nil {
		log.Print(err)
		showStartupError(err)
		os.Exit(1)
	}
}

// launchOptions are the parsed command-line flags.
type launchOptions struct {
	copyEncryptedTo     string
	initializeEncrypted bool
	createPlaintext     bool
	useLibrary          string
	database            string
	enginePath          string
	listen              string
	windowed            bool
	lazy                bool
	explicitDB          bool
}

func parseLaunchOptions(defaultDB string) *launchOptions {
	copyEncryptedTo := flag.String("copy-encrypted-to", "", "copy a closed plaintext library into a new encrypted directory and exit")
	initializeEncrypted := flag.Bool("initialize-encrypted", false, "explicitly require a new encrypted library")
	createPlaintext := flag.Bool("create-plaintext", false, "opt out of encryption when creating a new Windows library")
	useLibrary := flag.String("use-library", "", "open an existing library and remember it after successful initialization")
	database := flag.String("db", defaultDB, "SQLite database path")
	enginePath := flag.String("engine", "", "Rust engine executable")
	listen := flag.String("listen", "127.0.0.1:47831", "development HTTP address")
	windowed := flag.Bool("experimental-windowed-editor", true, "use bounded rich editing for large documents")
	lazy := flag.Bool("experimental-lazy-editor", true, "read large rich documents in bounded parts")
	flag.Parse()
	explicitDB := false
	flag.Visit(func(f *flag.Flag) {
		if f.Name == "db" {
			explicitDB = true
		}
	})
	return &launchOptions{
		copyEncryptedTo:     *copyEncryptedTo,
		initializeEncrypted: *initializeEncrypted,
		createPlaintext:     *createPlaintext,
		useLibrary:          *useLibrary,
		database:            *database,
		enginePath:          *enginePath,
		listen:              *listen,
		windowed:            *windowed,
		lazy:                *lazy,
		explicitDB:          explicitDB,
	}
}

func run() (resultErr error) {
	root, err := os.UserConfigDir()
	if err != nil {
		return fmt.Errorf("사용자 저장 폴더 확인 실패: %w", err)
	}
	if err := migrateLegacyAppData(root); err != nil {
		return err
	}
	defaultDB := filepath.Join(root, "Inkism", "notes.db")
	opts := parseLaunchOptions(defaultDB)
	security := newGoogleSecurity(root)
	if security != nil {
		defer security.Cancel()
	}
	locked := security != nil && security.InitiallyLocked()
	preference := filepath.Join(root, "Inkism", "library.json")
	if proceed, err := opts.resolveLibrary(preference, defaultDB); err != nil || !proceed {
		return err
	}
	if err := validateProtectedLibrary(opts.database, locked, opts.initializeEncrypted); err != nil {
		return err
	}
	var nextLibrary string
	// Registered before engine/lock cleanup: launch only after both release.
	defer func() {
		if resultErr == nil {
			resultErr = opts.relaunch(nextLibrary)
		}
	}()
	release, err := lockLibrary(opts.database)
	if err != nil {
		return err
	}
	defer release()
	opts.resolveEngine()
	if opts.copyEncryptedTo != "" {
		return opts.copyEncrypted(locked)
	}
	engine, err := opts.startEngine(locked)
	if err != nil {
		return err
	}
	defer engine.Close()
	if err := opts.attachSecurity(security, engine, preference); err != nil {
		return err
	}
	if err := opts.rememberLibrary(preference, locked); err != nil {
		return err
	}
	assets, _ := fs.Sub(frontend.Dist, "dist")
	nextLibrary, resultErr = runApp(engine, assets, opts.listen, opts.boundedEditor(), opts.lazy, security)
	return resultErr
}

// resolveLibrary picks the library to open. It reports false when the user
// cancelled the recovery selection and the app should exit quietly.
func (o *launchOptions) resolveLibrary(preference, defaultDB string) (bool, error) {
	var err error
	if o.useLibrary != "" {
		if o.explicitDB || o.initializeEncrypted || o.createPlaintext || o.copyEncryptedTo != "" {
			return false, fmt.Errorf("저장소 열기와 생성·복사 옵션은 함께 사용할 수 없습니다")
		}
		o.database, err = existingLibrary(o.useLibrary)
		return err == nil, err
	}
	if runtime.GOOS != "windows" || o.explicitDB {
		return true, nil
	}
	o.database, err = loadLibraryPreference(preference, defaultDB)
	if err == nil {
		return true, nil
	}
	selected, selectionErr := recoverLibrarySelection(err)
	if selectionErr != nil {
		return false, selectionErr
	}
	if selected == "" {
		return false, nil
	}
	o.database, err = existingLibrary(selected)
	o.useLibrary = selected
	return err == nil, err
}

// relaunch starts this executable on the library chosen in the app, if any.
func (o *launchOptions) relaunch(nextLibrary string) error {
	if nextLibrary == "" {
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	args := []string{"--use-library", nextLibrary, "--engine", o.enginePath}
	// Preserve explicit opt-outs when changing libraries as well as defaults.
	args = append(args, fmt.Sprintf("--experimental-windowed-editor=%t", o.windowed),
		fmt.Sprintf("--experimental-lazy-editor=%t", o.lazy))
	child := exec.Command(exe, args...)
	if err := child.Start(); err != nil {
		return fmt.Errorf("선택한 저장소를 열지 못했습니다: %w", err)
	}
	_ = child.Process.Release()
	return nil
}

func (o *launchOptions) boundedEditor() bool { return o.windowed || o.lazy }

func lockLibrary(database string) (func(), error) {
	if err := os.MkdirAll(filepath.Dir(database), 0700); err != nil {
		return nil, err
	}
	return applock.Acquire(database)
}

func (o *launchOptions) resolveEngine() {
	if o.enginePath == "" {
		o.enginePath = defaultEnginePath()
	}
}

// rememberLibrary saves an unlocked library opened by choice as the default.
func (o *launchOptions) rememberLibrary(preference string, locked bool) error {
	if o.useLibrary == "" || locked {
		return nil
	}
	if err := saveLibraryPreference(preference, o.database); err != nil {
		return fmt.Errorf("최근 저장소 설정 저장 실패: %w", err)
	}
	return nil
}

func defaultEnginePath() string {
	exe, _ := os.Executable()
	name := "inkism-engine"
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	enginePath := filepath.Join(filepath.Dir(exe), name)
	if _, err := os.Stat(enginePath); err != nil {
		enginePath = filepath.Join("core", "runtime-core", "target", "release", name)
	}
	return enginePath
}

func (o *launchOptions) copyEncrypted(locked bool) error {
	if locked {
		return fmt.Errorf("Google 잠금이 설정된 저장소는 앱에서 인증한 뒤 복사해 주세요")
	}
	if o.initializeEncrypted || o.createPlaintext {
		return fmt.Errorf("암호화 복사와 새 저장소 초기화 옵션은 함께 사용할 수 없습니다")
	}
	command := exec.Command(o.enginePath, "--db", o.database, "--copy-encrypted-to", o.copyEncryptedTo)
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("암호화 복사 실패: %w\n%s", err, output)
	}
	fmt.Print(string(output))
	return nil
}

// startEngine checks a newly selected library, then starts the engine
// suspended while the Google lock is closed.
func (o *launchOptions) startEngine(locked bool) (*bridge.Engine, error) {
	if o.useLibrary != "" && !locked {
		checkCtx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		err := bridge.CheckLibrary(checkCtx, o.enginePath, o.database)
		cancel()
		if err != nil {
			return nil, err
		}
	}
	initialize, err := initializeEncryptedForPath(o.database, runtime.GOOS, o.initializeEncrypted, o.createPlaintext)
	if err != nil {
		return nil, err
	}
	var engine *bridge.Engine
	switch {
	case locked && initialize:
		engine = bridge.StartSuspendedEncrypted(o.enginePath, o.database)
	case locked:
		engine = bridge.StartSuspended(o.enginePath, o.database)
	case initialize:
		engine, err = bridge.StartNewEncrypted(o.enginePath, o.database)
	default:
		engine, err = bridge.Start(o.enginePath, o.database)
	}
	if err != nil {
		return nil, fmt.Errorf("저장 엔진 시작 실패: %w\nInkism.exe와 inkism-engine.exe가 같은 폴더에 있는지 확인해 주세요", err)
	}
	return engine, nil
}

func (o *launchOptions) attachSecurity(security *googlehost.Controller, engine *bridge.Engine, preference string) error {
	if security == nil {
		return nil
	}
	recovery, err := googlehost.ReadServerRecovery(o.database)
	if err != nil {
		return err
	}
	if recovery != nil {
		security.SetRecovery(func(ctx context.Context, token string) (string, error) {
			return recovery.Connect(ctx, token, engine)
		})
	}
	security.Attach(engine.Close, func(ctx context.Context) error {
		if err := engine.Resume(ctx); err != nil {
			return err
		}
		if o.useLibrary == "" {
			return nil
		}
		if err := saveLibraryPreference(preference, o.database); err != nil {
			_ = engine.Close()
			return err
		}
		return nil
	})
	return nil
}

// A missing previously protected library must never become an empty replacement
// merely because Google authentication succeeded. New creation is explicit.
func validateProtectedLibrary(path string, configured, explicitNewEncrypted bool) error {
	if !configured || explicitNewEncrypted {
		return nil
	}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return fmt.Errorf("Google 잠금이 설정된 저장소를 찾지 못했습니다. 기존 DB와 키 파일을 복구하거나 명시적으로 새 암호화 저장소를 선택해 주세요")
	}
	return nil
}

// Existing libraries retain their storage policy. For a new Windows library,
// use the Rust initializer's key creation and orphan-file checks, never fall
// back to an unencrypted Start if initialization fails.
func initializeEncryptedForPath(path, platform string, explicit, plaintext bool) (bool, error) {
	if explicit && plaintext {
		return false, fmt.Errorf("암호화 생성과 평문 생성은 함께 선택할 수 없습니다")
	}
	if explicit {
		return true, nil
	}
	if plaintext || platform != "windows" {
		return false, nil
	}
	_, err := os.Stat(path)
	if os.IsNotExist(err) {
		return true, nil
	}
	if err != nil {
		return false, fmt.Errorf("저장소 상태 확인 실패: %w", err)
	}
	return false, nil
}
