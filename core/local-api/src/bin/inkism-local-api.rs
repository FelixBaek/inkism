//! Development preview server (replaces the non-Windows Go `main_other.go`):
//! `/api/*` goes through `Handler::handle`, everything else is a static file
//! from `frontend/dist`.
//!
//! inkism-local-api --listen 127.0.0.1:PORT --db PATH --engine PATH
//!   [--experimental-windowed-editor[=bool]] [--experimental-lazy-editor[=bool]]
//!   [--initialize-encrypted] [--assets DIR]

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper::body::Incoming;
use hyper::service::service_fn;
use hyper_util::rt::TokioIo;
use local_api::engine::Process;
use local_api::{Handler, Request, Response};
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use tokio::net::TcpListener;

const APP_VERSION: &str = "0.0.0-dev";

struct Options {
    listen: String,
    database: PathBuf,
    engine: PathBuf,
    assets: PathBuf,
    windowed: bool,
    lazy: bool,
    initialize_encrypted: bool,
}

/// Go `flag` syntax: `-name value`, `--name=value`; booleans take only `=value`.
fn parse(args: impl IntoIterator<Item = String>) -> Result<Options, String> {
    let mut o = Options {
        listen: "127.0.0.1:47831".into(),
        database: default_database(),
        engine: PathBuf::new(),
        assets: Path::new(env!("CARGO_MANIFEST_DIR")).join("../../frontend/dist"),
        windowed: true,
        lazy: true,
        initialize_encrypted: false,
    };
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        let Some(flag) = arg.strip_prefix("--").or_else(|| arg.strip_prefix('-')) else {
            return Err(format!("unexpected argument {arg:?}"));
        };
        let (name, inline) = match flag.split_once('=') {
            Some((n, v)) => (n, Some(v.to_string())),
            None => (flag, None),
        };
        let boolean = |v: Option<String>| match v.as_deref() {
            None | Some("true" | "1" | "t" | "T" | "TRUE" | "True") => Ok(true),
            Some("false" | "0" | "f" | "F" | "FALSE" | "False") => Ok(false),
            Some(v) => Err(format!("invalid boolean value {v:?} for -{name}")),
        };
        match name {
            "experimental-windowed-editor" => o.windowed = boolean(inline)?,
            "experimental-lazy-editor" => o.lazy = boolean(inline)?,
            "initialize-encrypted" => o.initialize_encrypted = boolean(inline)?,
            "listen" | "db" | "engine" | "assets" => {
                let value = match inline {
                    Some(v) => v,
                    None => args
                        .next()
                        .ok_or_else(|| format!("flag needs an argument: -{name}"))?,
                };
                match name {
                    "listen" => o.listen = value,
                    "db" => o.database = value.into(),
                    "engine" => o.engine = value.into(),
                    _ => o.assets = value.into(),
                }
            }
            _ => return Err(format!("flag provided but not defined: -{name}")),
        }
    }
    if o.engine.as_os_str().is_empty() {
        o.engine = default_engine();
    }
    Ok(o)
}

fn default_database() -> PathBuf {
    let config = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        .unwrap_or_default();
    config.join("Inkism").join("notes.db")
}

/// Beside this executable, else the repository's release build.
fn default_engine() -> PathBuf {
    let name = if cfg!(windows) {
        "inkism-engine.exe"
    } else {
        "inkism-engine"
    };
    let beside = std::env::current_exe()
        .ok()
        .and_then(|e| Some(e.parent()?.join(name)));
    match beside {
        Some(path) if path.exists() => path,
        _ => Path::new("core/runtime-core/target/release").join(name),
    }
}

fn main() {
    let options = match parse(std::env::args().skip(1)) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(2);
        }
    };
    if let Err(e) = run(options) {
        eprintln!("{e}");
        std::process::exit(1);
    }
}

fn run(o: Options) -> local_api::Result<()> {
    if let Some(parent) = o.database.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let _library = inkism_reminders::applock::acquire(&o.database)?;
    let start = if o.initialize_encrypted {
        Process::start_new_encrypted
    } else {
        Process::start
    };
    let engine = start(o.engine.clone(), o.database.clone())
        .map_err(|e| format!("저장 엔진 시작 실패: {e}\nInkism.exe와 inkism-engine.exe가 같은 폴더에 있는지 확인해 주세요"))?;
    let engine = Arc::new(engine);
    let exe_dir = std::env::current_exe()?
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default();
    // The updater constructs a blocking HTTP client outside Tokio's async context.
    let update = Arc::new(app_update::Updater::new(
        APP_VERSION,
        "",
        "",
        exe_dir,
        std::env::args().skip(1).collect(),
    ));
    let runtime = tokio::runtime::Runtime::new()?;
    runtime.block_on(async {
        let listener = TcpListener::bind(&o.listen).await?;
        let address = listener.local_addr()?.to_string();
        // Handler has crate-private fields, so no struct literal here.
        let mut handler = Handler::default();
        handler.engine = Some(engine.clone());
        handler.windowed_editor = o.windowed || o.lazy;
        handler.lazy_editor = o.lazy;
        handler.host = address.clone();
        handler.update = Some(Arc::clone(&update));
        eprintln!("Development preview: http://{address}");
        serve(listener, Arc::new(handler), Arc::new(o.assets)).await
    })?;
    engine.close()
}

/// Accepts connections until the listener fails.
async fn serve(
    listener: TcpListener,
    handler: Arc<Handler>,
    assets: Arc<PathBuf>,
) -> local_api::Result<()> {
    loop {
        let (stream, _) = listener.accept().await?;
        let (handler, assets) = (handler.clone(), assets.clone());
        tokio::spawn(async move {
            let service =
                service_fn(move |request| respond(request, handler.clone(), assets.clone()));
            let _ = hyper::server::conn::http1::Builder::new()
                .serve_connection(TokioIo::new(stream), service)
                .await;
        });
    }
}

async fn respond(
    request: hyper::Request<Incoming>,
    handler: Arc<Handler>,
    assets: Arc<PathBuf>,
) -> Result<hyper::Response<Full<Bytes>>, std::convert::Infallible> {
    let (parts, body) = request.into_parts();
    let path = parts.uri.path().to_string();
    let method = parts.method.as_str().to_string();
    if !path.starts_with("/api/") {
        return Ok(build(static_file(&assets, &method, &path)));
    }
    let body = match body.collect().await {
        Ok(b) => b.to_bytes().to_vec(),
        Err(e) => return Ok(build(Response::fail(400, e))),
    };
    let headers = parts
        .headers
        .iter()
        .map(|(k, v)| {
            (
                k.as_str().to_string(),
                String::from_utf8_lossy(v.as_bytes()).into_owned(),
            )
        })
        .collect();
    let host = parts
        .headers
        .get(hyper::header::HOST)
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .to_string();
    let r = Request {
        method: method.clone(),
        path: path.clone(),
        query: parts.uri.query().map(String::from),
        headers,
        host,
        body,
    };
    let response = match tokio::task::spawn_blocking(move || handler.handle(&r)).await {
        Ok(response) => response,
        Err(_) => {
            eprintln!("PANIC {method} {path}");
            Response::fail(500, "internal error")
        }
    };
    Ok(build(response))
}

fn build(r: Response) -> hyper::Response<Full<Bytes>> {
    let mut out = hyper::Response::builder().status(r.status);
    for (name, value) in &r.headers {
        out = out.header(name, value);
    }
    out.body(Full::new(Bytes::from(r.body)))
        .unwrap_or_else(|_| hyper::Response::new(Full::new(Bytes::new())))
}

/// A minimal `http.FileServer`: GET/HEAD, `index.html` for directories, no
/// path may leave the assets root.
fn static_file(root: &Path, method: &str, path: &str) -> Response {
    if method != "GET" && method != "HEAD" {
        return Response {
            status: 405,
            headers: vec![],
            body: b"405 method not allowed\n".to_vec(),
        };
    }
    let decoded = percent_encoding::percent_decode_str(path).decode_utf8_lossy();
    let relative = Path::new(decoded.trim_start_matches('/'));
    if relative
        .components()
        .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Response::not_found();
    }
    let mut file = root.join(relative);
    if file.is_dir() {
        file = file.join("index.html");
    }
    match std::fs::read(&file) {
        Ok(body) => Response {
            status: 200,
            headers: vec![("content-type".into(), media_type(&file).into())],
            body,
        },
        Err(_) => Response::not_found(),
    }
}

fn media_type(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" | "htm" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "wasm" => "application/wasm",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use local_api::Engine;
    use serde_json::{json, Value};
    use std::process::Command;
    use std::time::{Duration, Instant};

    #[test]
    fn parses_go_preview_flags() {
        let args = [
            "--listen",
            "127.0.0.1:47881",
            "-db=/x/notes.db",
            "--engine",
            "/e",
            "--experimental-lazy-editor=false",
        ];
        let o = parse(args.map(String::from)).unwrap();
        assert_eq!(
            (o.listen.as_str(), o.database.as_path(), o.engine.as_path()),
            ("127.0.0.1:47881", Path::new("/x/notes.db"), Path::new("/e"))
        );
        assert!(o.windowed && !o.lazy && !o.initialize_encrypted);
        assert!(parse(["--unknown".to_string()]).is_err());
        assert!(parse(["--db".to_string()]).is_err());
        assert!(parse(["--experimental-windowed-editor=maybe".to_string()]).is_err());
    }

    #[test]
    fn static_files_stay_inside_assets() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("index.html"), "<p>").unwrap();
        std::fs::create_dir(dir.path().join("assets")).unwrap();
        std::fs::write(dir.path().join("assets/a b.js"), "1").unwrap();
        let root = dir.path().join("assets").join("..");
        let get = |p: &str| static_file(&root, "GET", p);
        assert_eq!(get("/").body, b"<p>");
        let js = get("/assets/a%20b.js");
        assert!(js.status == 200 && js.headers[0].1.starts_with("text/javascript"));
        assert_eq!(get("/../index.html").status, 404);
        assert_eq!(get("/assets/%2e%2e/index.html").status, 404);
        assert_eq!(static_file(&root, "POST", "/").status, 405);
    }

    fn repository() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap()
    }

    /// The opt-in Chromium fixtures need the runtime (`variable`) and `CHROMIUM_PATH`.
    fn application_engine(variable: &str) -> Option<PathBuf> {
        let binary = std::env::var_os(variable)?;
        std::env::var_os("CHROMIUM_PATH")?;
        assert!(
            repository().join("frontend/dist/index.html").exists(),
            "build the frontend first"
        );
        Some(binary.into())
    }

    /// The shipped renderer plus the real handler on a loopback port.
    struct App {
        url: String,
        runtime: Option<tokio::runtime::Runtime>,
    }

    impl App {
        fn start(engine: Arc<Process>, bounded: bool) -> App {
            let runtime = tokio::runtime::Runtime::new().unwrap();
            let listener = runtime.block_on(TcpListener::bind("127.0.0.1:0")).unwrap();
            let url = format!("http://{}", listener.local_addr().unwrap());
            let mut handler = Handler::default();
            handler.engine = Some(engine);
            handler.windowed_editor = bounded;
            handler.lazy_editor = bounded;
            runtime.spawn(serve(
                listener,
                Arc::new(handler),
                Arc::new(repository().join("frontend/dist")),
            ));
            App {
                url,
                runtime: Some(runtime),
            }
        }

        fn node(&self, script: &str, env: &[(&str, &str)]) {
            let root = repository();
            let output = Command::new("node")
                .arg(root.join("frontend/scripts").join(script))
                .current_dir(&root)
                .env("INKISM_URL", &self.url)
                .envs(env.iter().copied())
                .output()
                .unwrap();
            let log = format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(
                output.status.success(),
                "{script} {env:?}: {}\n{log}",
                output.status
            );
            eprintln!("{log}");
        }

        fn stop(&mut self) {
            if let Some(runtime) = self.runtime.take() {
                runtime.shutdown_background();
            }
        }
    }

    impl Drop for App {
        fn drop(&mut self) {
            self.stop();
        }
    }

    fn rpc(engine: &Process, request: Value) -> Value {
        let raw = engine
            .call(
                Instant::now() + Duration::from_secs(120),
                request.to_string().as_bytes(),
            )
            .unwrap();
        let reply: Value = serde_json::from_slice(&raw).unwrap();
        assert_eq!(reply["ok"], true, "RPC {request}: {reply}");
        reply["data"].clone()
    }

    fn encryption_modes() -> Vec<bool> {
        let mut modes = vec![false];
        if std::env::var("INKISM_RECOVERY_ENCRYPTED").as_deref() == Ok("1") {
            modes.push(true);
        }
        modes
    }

    fn start_engine(binary: &Path, path: &Path, encrypted: bool) -> Process {
        if encrypted {
            Process::start_new_encrypted(binary, path)
        } else {
            Process::start(binary, path)
        }
        .unwrap()
    }

    /// Notes by id, after checking the storage mode (Go `inspect`/`check`).
    fn notes(engine: &Process, encrypted: bool) -> serde_json::Map<String, Value> {
        assert_eq!(
            rpc(engine, json!({"op": "storage_status"}))["encrypted"],
            encrypted,
            "encryption mode changed"
        );
        let list = rpc(engine, json!({"op": "list", "view": "all"}));
        let ids = list["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["id"].as_str().unwrap().to_string());
        ids.map(|id| (id.clone(), rpc(engine, json!({"op": "get", "id": id}))))
            .collect()
    }

    /// Checks the notes after one reopen and returns them.
    fn inspect_crash(
        engine: &Process,
        encrypted: bool,
        manifest: &Value,
        scenario: &str,
    ) -> serde_json::Map<String, Value> {
        assert_eq!(
            rpc(engine, json!({"op": "draft_journal_status"}))["pending"],
            0,
            "journal not atomically consumed"
        );
        let notes = notes(engine, encrypted);
        let original = manifest.get("original").filter(|o| !o.is_null());
        let expect_recovered = manifest["expectRecovered"] == true;
        let want = if expect_recovered && original.is_some() {
            2
        } else {
            1
        };
        assert_eq!(
            notes.len(),
            want,
            "{scenario}: unexpected notes or duplicate recovery"
        );
        let title = format!(
            "{}{}",
            manifest["title"].as_str().unwrap_or(""),
            manifest["recoverySuffix"].as_str().unwrap_or("")
        );
        let recovered = notes.values().find(|n| n["title"] == title.as_str());
        if let Some(original) = original {
            assert_eq!(
                notes.get(original["id"].as_str().unwrap()),
                Some(original),
                "{scenario}: original body or metadata changed"
            );
        }
        if expect_recovered {
            let r = recovered.expect("recovered note");
            assert!(
                r["id"] != manifest["source_id"]
                    && r["content"].as_str().map(strip_block_ids) == manifest["expectedContent"].as_str().map(strip_block_ids)
                    && r["content_format"] == manifest["format"]
                    && r["notebook_id"] == manifest["notebook_id"]
                    && r["tags"] == manifest["tags"],
                "{scenario}: recovered body, format or metadata mismatch"
            );
        } else {
            assert!(
                recovered.is_none(),
                "{scenario}: already saved draft created a duplicate"
            );
        }
        notes
    }

    /// Editing a block gives it a random `ink-block-` id, so the paged scenario
    /// compares recovered bodies without those ids.
    fn strip_block_ids(html: &str) -> String {
        let mut out = String::with_capacity(html.len());
        let mut rest = html;
        while let Some(i) = rest.find(" id=\"ink-block-") {
            out.push_str(&rest[..i]);
            let tail = &rest[i + 5..];
            rest = tail.find('"').map_or("", |end| &tail[end + 1..]);
        }
        out.push_str(rest);
        out
    }

    /// Port of `crash_draft_application_test.go`: kills the renderer and the
    /// engine after a journal acknowledgement, then checks exact recovery.
    #[test]
    fn crash_draft_application() {
        let Some(binary) = application_engine("INKISM_TEST_ENGINE") else {
            return;
        };
        for encrypted in encryption_modes() {
            for scenario in [
                "new", "existing", "paged", "saved", "retry", "stalled", "split",
            ] {
                let dir = tempfile::tempdir().unwrap();
                let path = dir.path().join("notes.db");
                let engine = Arc::new(start_engine(&binary, &path, encrypted));
                let mut app = App::start(engine.clone(), false);
                let manifest_path = dir.path().join("manifest.json");
                let manifest_arg = manifest_path.to_string_lossy().into_owned();
                app.node(
                    "e2e-crash-draft.ts",
                    &[
                        ("INKISM_CRASH_SCENARIO", scenario),
                        ("INKISM_CRASH_MANIFEST", &manifest_arg),
                    ],
                );
                let manifest: Value =
                    serde_json::from_slice(&std::fs::read(&manifest_path).unwrap()).unwrap();
                app.stop();
                engine.kill(); // abrupt death, not a clean save
                let _ = engine.close();
                drop(engine);
                let inspect =
                    |engine: &Process| inspect_crash(engine, encrypted, &manifest, scenario);
                let engine = Process::start(&binary, &path).unwrap();
                let before = inspect(&engine);
                engine.close().unwrap();
                let engine = Process::start(&binary, &path).unwrap();
                assert_eq!(
                    inspect(&engine),
                    before,
                    "{scenario}: recovery changed on second reopen"
                );
            }
        }
    }

    /// Port of `draft_recovery_application_test.go`.
    #[test]
    fn draft_recovery_application() {
        let Some(binary) = application_engine("INKISM_TEST_ENGINE") else {
            return;
        };
        for encrypted in encryption_modes() {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("notes.db");
            let engine = Arc::new(start_engine(&binary, &path, encrypted));
            let mut app = App::start(engine.clone(), false);
            app.node("e2e-recovery-import.ts", &[]);
            let check = |engine: &Process| {
                let notes = notes(engine, encrypted);
                // original + complete/partial/missing + rescued and finally saved new draft
                assert_eq!(notes.len(), 6, "unexpected recovered note count");
                notes
            };
            let before = check(&engine);
            app.stop();
            engine.close().unwrap();
            drop(engine);
            let reopened = Process::start(&binary, &path).unwrap();
            assert_eq!(
                check(&reopened),
                before,
                "recovered/original notes changed on runtime restart"
            );
        }
    }

    /// Go `runEditorApplication`: one engine and server, each fixture in turn.
    fn editor_application(env: &[(&str, &str)], fixtures: &[(&str, &str)], bounded: bool) {
        let Some(binary) = application_engine("INKISM_SEGMENT_ENGINE") else {
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let engine = Arc::new(Process::start(&binary, dir.path().join("notes.db")).unwrap());
        let app = App::start(engine, bounded);
        for (script, lazy) in fixtures {
            let mut env = env.to_vec();
            env.push(("INKISM_LAZY", lazy));
            app.node(script, &env);
        }
    }

    fn segment(env: &[(&str, &str)], fixtures: &[(&str, &str)]) {
        editor_application(env, fixtures, false);
    }

    /// Both renderer modes of one script.
    fn both(script: &str) -> [(&str, &str); 2] {
        [(script, "1"), (script, "0")]
    }

    #[test]
    fn default_paged_editor_application() {
        editor_application(&[], &[("e2e-default-paged-editor.ts", "1")], true);
    }

    #[test]
    fn segment_application() {
        let mut fixtures = vec![
            ("e2e-segment-navigator.ts", "1"),
            ("e2e-cross-segment-selection.ts", "1"),
        ];
        for script in [
            "e2e-bounded-selection-application.ts",
            "e2e-large-selection-application.ts",
            "e2e-pending-paste-application.ts",
            "e2e-native-clipboard-application.ts",
            "e2e-selection-yield-application.ts",
            "e2e-source-scan-application.ts",
            "e2e-boundary-application.ts",
        ] {
            fixtures.extend(both(script));
        }
        segment(&[], &fixtures);
    }

    #[test]
    fn block_format_application() {
        let mut fixtures = vec![("e2e-document-selection.ts", "1")];
        for script in [
            "e2e-block-format-application.ts",
            "e2e-pending-heading-application.ts",
            "e2e-block-format-input-application.ts",
        ] {
            fixtures.extend(both(script));
        }
        segment(&[], &fixtures);
    }

    #[test]
    fn vertical_navigation_application() {
        segment(&[], &both("e2e-vertical-navigation-application.ts"));
    }

    #[test]
    fn mouse_selection_application() {
        segment(&[], &both("e2e-mouse-selection-application.ts"));
    }

    #[test]
    fn mouse_auto_scroll_application() {
        segment(
            &[("INKISM_MOUSE_AUTOSCROLL", "1")],
            &both("e2e-mouse-selection-application.ts"),
        );
    }

    #[test]
    fn internal_mouse_selection_application() {
        segment(&[], &both("e2e-internal-mouse-selection-application.ts"));
    }

    #[test]
    fn mouse_reselection_application() {
        segment(
            &[("INKISM_MOUSE_RESELECT", "1")],
            &both("e2e-mouse-selection-application.ts"),
        );
    }

    #[test]
    fn vertical_selection_application() {
        segment(
            &[("INKISM_VERTICAL_SHIFT", "1")],
            &both("e2e-vertical-navigation-application.ts"),
        );
    }

    #[test]
    fn vertical_queue_application() {
        segment(&[], &both("e2e-vertical-queue-application.ts"));
    }

    #[test]
    fn vertical_queue_selection_application() {
        segment(
            &[("INKISM_VERTICAL_SHIFT", "1")],
            &both("e2e-vertical-queue-application.ts"),
        );
    }

    #[test]
    fn internal_vertical_application() {
        segment(&[], &both("e2e-internal-vertical-application.ts"));
    }

    #[test]
    fn vertical_composition_application() {
        segment(&[], &both("e2e-cross-segment-selection.ts"));
    }

    #[test]
    fn internal_wrap_application() {
        segment(&[], &both("e2e-internal-wrap-application.ts"));
    }

    #[test]
    fn internal_wrap_selection_application() {
        segment(
            &[("INKISM_WRAP_SHIFT", "1")],
            &both("e2e-internal-wrap-application.ts"),
        );
    }

    #[test]
    fn document_block_actions_application() {
        segment(&[], &both("e2e-document-block-actions.ts"));
    }

    #[test]
    fn document_drag_application() {
        segment(&[], &both("e2e-document-drag.ts"));
    }

    #[test]
    fn document_block_structures_application() {
        segment(&[], &both("e2e-document-block-structures.ts"));
    }

    #[test]
    fn structure_format_application() {
        segment(&[], &both("e2e-structure-format-application.ts"));
    }

    #[test]
    fn structure_input_application() {
        for command in [
            "toggleBulletList",
            "toggleOrderedList",
            "toggleTaskList",
            "toggleBlockquote",
            "toggleCodeBlock",
        ] {
            let env = [
                ("INKISM_BLOCK_INPUT_CASES", "keys,paste-keys,composition"),
                ("INKISM_BLOCK_FORMAT_COMMAND", command),
            ];
            segment(&env, &both("e2e-block-format-input-application.ts"));
        }
    }

    #[test]
    fn structure_range_application() {
        segment(
            &[("INKISM_STRUCTURE_SELECTION", "range")],
            &both("e2e-structure-format-application.ts"),
        );
    }
}
