//! AI through a coding CLI the user already signed in to (`claude`, `codex`):
//! `GET /api/ai/cli` lists the installed ones and their models,
//! `POST /api/ai/cli` `{cli, model, system, prompt}` runs one turn and returns `{text}`.
//! The CLI runs with tools off (claude) or a read-only sandbox (codex) in an empty
//! temp folder, so note text cannot make it change files.

use crate::{Deadline, Handler, Request, Response};
use serde::Deserialize;
use serde_json::json;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const CLIS: [&str; 2] = ["claude", "codex"];
const MAX_PROMPT: usize = 400_000;
const MAX_OUTPUT: u64 = 1 << 20;

pub(crate) fn serve(_h: &Handler, r: &Request, deadline: Deadline) -> Response {
    match r.method.as_str() {
        "GET" => {
            let found: Vec<_> = CLIS
                .iter()
                .filter_map(|name| find(name).map(|path| json!({"cli": name, "models": models(name, &path)})))
                .collect();
            Response::json(200, &json!({"ok": true, "data": found}))
        }
        "POST" => {
            if !r.header("content-type").unwrap_or("").starts_with("application/json") {
                return Response::fail(415, "JSON required");
            }
            match serde_json::from_slice::<Turn>(&r.body) {
                Ok(turn) => match run(&turn, deadline) {
                    Ok(text) => Response::json(200, &json!({"ok": true, "data": {"text": text}})),
                    Err(e) => Response::fail(502, e),
                },
                Err(_) => Response::fail(400, "invalid request"),
            }
        }
        _ => Response::fail(405, "method not allowed"),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Turn {
    cli: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    system: String,
    prompt: String,
}

/// PATH first, then the per-user folders the installers use; a desktop launch may not inherit a shell PATH.
fn find(name: &str) -> Option<PathBuf> {
    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    if let Some(home) = &home {
        dirs.push(home.join(".local").join("bin"));
        dirs.push(home.join(".claude").join("local"));
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        dirs.push(PathBuf::from(appdata).join("npm"));
    }
    let exts: &[&str] = if cfg!(windows) { &[".exe", ".cmd", ".bat"] } else { &[""] };
    dirs.iter().flat_map(|d| exts.iter().map(move |e| d.join(format!("{name}{e}")))).find(|p| p.is_file())
}

/// Codex reports its own catalog; Claude Code takes these model IDs (an empty model uses the CLI default).
fn models(name: &str, path: &Path) -> Vec<String> {
    if name == "claude" {
        return ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"].map(String::from).to_vec();
    }
    let out = command(path).args(["debug", "models"]).stdin(Stdio::null()).stderr(Stdio::null()).output();
    let catalog: serde_json::Value = out.ok().and_then(|o| serde_json::from_slice(&o.stdout).ok()).unwrap_or_default();
    catalog["models"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|m| m["visibility"] == "list")
        .filter_map(|m| m["slug"].as_str().map(String::from))
        .collect()
}

fn command(path: &Path) -> Command {
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut c = Command::new(path);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

fn run(turn: &Turn, deadline: Deadline) -> Result<String, String> {
    if !CLIS.contains(&turn.cli.as_str()) {
        return Err("지원하지 않는 CLI입니다".into());
    }
    if turn.prompt.len() + turn.system.len() > MAX_PROMPT {
        return Err("AI 요청이 너무 깁니다".into());
    }
    if turn.model.len() > 200 || turn.model.starts_with('-') {
        return Err("모델 이름이 올바르지 않습니다".into());
    }
    let path = find(&turn.cli).ok_or_else(|| format!("{} CLI를 찾지 못했습니다", turn.cli))?;
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let mut c = command(&path);
    c.current_dir(dir.path());
    let mut stdin = turn.prompt.clone();
    if turn.cli == "claude" {
        c.args(["-p", "--tools", "", "--setting-sources", "", "--strict-mcp-config", "--no-session-persistence", "--disable-slash-commands"]);
        c.args(["--output-format", "text", "--system-prompt", &turn.system]);
    } else {
        c.args(["exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only", "--color", "never"]);
        stdin = format!("{}\n\n{}", turn.system, turn.prompt);
    }
    if !turn.model.is_empty() {
        c.args(["--model", &turn.model]);
    }
    if turn.cli == "codex" {
        c.arg("-");
    }
    let mut child = c.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| e.to_string())?;
    let mut input = child.stdin.take().expect("piped");
    std::thread::spawn(move || input.write_all(stdin.as_bytes()));
    let pipe = |r: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut buf = Vec::new();
            if let Some(r) = r {
                let _ = r.take(MAX_OUTPUT).read_to_end(&mut buf);
            }
            buf
        })
    };
    let out = pipe(child.stdout.take().map(|s| Box::new(s) as _));
    let err = pipe(child.stderr.take().map(|s| Box::new(s) as _));
    let status = loop {
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
            break s;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("{}가 제시간에 답하지 않았습니다", turn.cli));
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let text = String::from_utf8_lossy(&out.join().unwrap_or_default()).trim().to_string();
    if !status.success() || text.is_empty() {
        let err = String::from_utf8_lossy(&err.join().unwrap_or_default()).into_owned();
        let tail: String = err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").chars().take(300).collect();
        return Err(format!("{} 실행 실패: {}", turn.cli, if tail.is_empty() { status.to_string() } else { tail }));
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_cli_and_flag_like_model() {
        let deadline = Instant::now() + Duration::from_secs(5);
        let turn = |cli: &str, model: &str| Turn { cli: cli.into(), model: model.into(), system: String::new(), prompt: "x".into() };
        assert!(run(&turn("sh", ""), deadline).unwrap_err().contains("지원하지"));
        assert!(run(&turn("claude", "--dangerously-skip-permissions"), deadline).unwrap_err().contains("모델"));
    }
}
