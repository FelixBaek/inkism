//! Task Scheduler registration for the cache-only reminder helper.

use crate::cache::TaskReceipt;
use crate::{clean_path, hex, is_hex, rfc3339_utc, Background, Ctx, Error, Result, Scheduler};
use quick_xml::events::Event;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub const TASK_PREFIX: &str = "Inkism.Reminder.";

/// Named task storage (the Windows Task Scheduler root folder in production).
/// `get` returns [`Error::TaskNotFound`] for a missing task.
pub trait TaskStore: Send + Sync {
    fn get(&self, ctx: &Ctx, name: &str) -> Result<String>;
    fn create(&self, ctx: &Ctx, name: &str, raw: &str) -> Result<()>;
    fn delete(&self, ctx: &Ctx, name: &str) -> Result<()>;
}

pub struct TaskScheduler {
    pub executable: PathBuf,
    pub sid: String,
    pub store: Arc<dyn TaskStore>,
}

/// Escapes text like Go's `xml.EscapeText`.
fn escape_xml(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '"' => out.push_str("&#34;"),
            '\'' => out.push_str("&#39;"),
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '\t' => out.push_str("&#x9;"),
            '\n' => out.push_str("&#xA;"),
            '\r' => out.push_str("&#xD;"),
            c if matches!(c, '\u{20}'..='\u{D7FF}' | '\u{E000}'..='\u{FFFD}' | '\u{10000}'..) => {
                out.push(c)
            }
            _ => out.push('\u{FFFD}'),
        }
    }
    out
}

/// Task definition that runs `<executable> --reminder-cache <id>` every
/// minute from `start_unix_secs`, as the interactive user with least privilege.
pub fn task_xml(id: &str, executable: &Path, sid: &str, start_unix_secs: i64) -> Result<String> {
    let exe = executable
        .to_str()
        .filter(|e| executable.is_absolute() && !e.contains(['\0', '\r', '\n']));
    let (Some(exe), true, false) = (exe, is_hex(id, 32), sid.is_empty()) else {
        return Err(Error::msg("invalid reminder task identity"));
    };
    Ok(format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
<RegistrationInfo><Description>Inkism generic reminders from an opaque schedule cache. No library access.</Description></RegistrationInfo>
<Triggers><TimeTrigger><Repetition><Interval>PT1M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition><StartBoundary>{}</StartBoundary><Enabled>true</Enabled></TimeTrigger></Triggers>
<Principals><Principal id="CurrentUser"><UserId>{}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable><RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable><Enabled>true</Enabled><Hidden>true</Hidden><WakeToRun>false</WakeToRun><ExecutionTimeLimit>PT45S</ExecutionTimeLimit><Priority>7</Priority></Settings>
<Actions Context="CurrentUser"><Exec><Command>{}</Command><Arguments>--reminder-cache {}</Arguments></Exec></Actions>
</Task>"#,
        rfc3339_utc(start_unix_secs),
        escape_xml(sid),
        escape_xml(exe),
        id
    ))
}

#[derive(Default, Debug)]
struct ParsedTask {
    /// (UserId, LogonType, RunLevel)
    principals: Vec<[String; 3]>,
    /// (Command, Arguments)
    execs: Vec<[String; 2]>,
}

fn open_element(name: &str, path: &mut Vec<String>, task: &mut ParsedTask) {
    path.push(name.to_owned());
    match path.iter().skip(1).map(String::as_str).collect::<Vec<_>>()[..] {
        ["Principals", "Principal"] => task.principals.push(Default::default()),
        ["Actions", "Exec"] => task.execs.push(Default::default()),
        _ => {}
    }
}

fn general_ref(r: &quick_xml::events::BytesRef) -> Option<String> {
    Some(match r.resolve_char_ref().ok()? {
        Some(c) => c.to_string(),
        None => match &**r {
            "lt" => "<",
            "gt" => ">",
            "amp" => "&",
            "apos" => "'",
            "quot" => "\"",
            _ => return None,
        }
        .to_string(),
    })
}

fn append_text(task: &mut ParsedTask, path: &[String], text: &str) {
    let field = match (path[1].as_str(), path[2].as_str(), path[3].as_str()) {
        ("Principals", "Principal", "UserId") => task.principals.last_mut().map(|p| &mut p[0]),
        ("Principals", "Principal", "LogonType") => task.principals.last_mut().map(|p| &mut p[1]),
        ("Principals", "Principal", "RunLevel") => task.principals.last_mut().map(|p| &mut p[2]),
        ("Actions", "Exec", "Command") => task.execs.last_mut().map(|e| &mut e[0]),
        ("Actions", "Exec", "Arguments") => task.execs.last_mut().map(|e| &mut e[1]),
        _ => None,
    };
    if let Some(field) = field {
        field.push_str(text);
    }
}

/// Reads `<root>/Principals/Principal/*` and `<root>/Actions/Exec/*` by local
/// name, taking only the direct text of each leaf (like Go's `xml.Unmarshal`).
fn parse_task(raw: &str) -> Option<ParsedTask> {
    let mut reader = quick_xml::Reader::from_str(raw);
    let mut task = ParsedTask::default();
    let mut path: Vec<String> = Vec::new();
    loop {
        let event = reader.read_event().ok()?;
        if let Event::Start(e) | Event::Empty(e) = &event {
            open_element(e.local_name().as_ref(), &mut path, &mut task);
        }
        let text: Option<String> = match &event {
            Event::Empty(_) | Event::End(_) => {
                path.pop();
                if path.is_empty() {
                    return Some(task);
                }
                None
            }
            Event::Text(t) => Some(t.xml10_content().into_owned()),
            Event::CData(t) => Some(t.xml10_content().into_owned()),
            Event::GeneralRef(r) => Some(general_ref(r)?),
            Event::Eof => return None,
            _ => None,
        };
        if let (Some(text), 4) = (text, path.len()) {
            append_text(&mut task, &path, &text);
        }
    }
}

impl TaskScheduler {
    pub(crate) fn verify(&self, id: &str, raw: &str) -> Result<()> {
        let task = (raw.len() <= 1 << 20)
            .then(|| parse_task(raw))
            .flatten()
            .ok_or_else(|| Error::msg("invalid existing reminder task"))?;
        let foreign = || Error::msg("existing task is not owned by this Inkism");
        let ([[user, logon, level]], [[command, args]]) =
            (task.principals.as_slice(), task.execs.as_slice())
        else {
            return Err(foreign());
        };
        let same_exe = clean_path(Path::new(command))
            .to_string_lossy()
            .to_lowercase()
            == clean_path(&self.executable)
                .to_string_lossy()
                .to_lowercase();
        if user.to_lowercase() != self.sid.to_lowercase()
            || logon != "InteractiveToken"
            || level != "LeastPrivilege"
            || !same_exe
            || *args != format!("--reminder-cache {id}")
        {
            return Err(foreign());
        }
        Ok(())
    }
}

fn now_secs() -> i64 {
    crate::cache::now_millis() / 1000
}

impl Scheduler for TaskScheduler {
    fn enable(&self, ctx: &Ctx, id: &str) -> Result<()> {
        let raw = task_xml(id, &self.executable, &self.sid, now_secs() + 60)?;
        let name = format!("{TASK_PREFIX}{id}");
        match self.store.get(ctx, &name) {
            Ok(existing) => self.verify(id, &existing),
            Err(Error::TaskNotFound) => self.store.create(ctx, &name, &raw),
            Err(e) => Err(e),
        }
    }

    fn disable(&self, ctx: &Ctx, id: &str) -> Result<()> {
        if !is_hex(id, 32) {
            return Err(Error::msg("invalid reminder task ID"));
        }
        let name = format!("{TASK_PREFIX}{id}");
        let raw = match self.store.get(ctx, &name) {
            Err(Error::TaskNotFound) => return Ok(()),
            other => other?,
        };
        self.verify(id, &raw)?;
        self.store.delete(ctx, &name)
    }

    /// sha256(lower(clean(executable)) + "\0" + lower(sid)), hex.
    fn ownership_id(&self) -> String {
        let key = format!(
            "{}\0{}",
            clean_path(&self.executable)
                .to_string_lossy()
                .to_lowercase(),
            self.sid.to_lowercase()
        );
        hex(&Sha256::digest(key.as_bytes()))
    }
}

/// Removes the tasks and caches whose `.task` receipt names this scheduler's
/// owner; caches of other installations are left untouched.
pub fn remove_owned_tasks(ctx: &Ctx, root: &Path, scheduler: Arc<dyn Scheduler>) -> Result<()> {
    let entries = match std::fs::read_dir(root) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.into()),
    };
    let owner = scheduler.ownership_id();
    let mut failures = Vec::new();
    for entry in entries {
        let entry = entry?;
        if entry.file_type().is_ok_and(|t| t.is_dir()) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(id) = name.strip_suffix(".task").filter(|id| is_hex(id, 32)) else {
            continue;
        };
        let receipt = std::fs::read(entry.path())
            .ok()
            .filter(|raw| raw.len() <= 1024)
            .and_then(|raw| serde_json::from_slice::<TaskReceipt>(&raw).ok());
        if !receipt.is_some_and(|r| !r.owner.is_empty() && r.owner == owner) {
            continue;
        }
        let bg = Background {
            root: root.to_path_buf(),
            id: id.to_string(),
            scheduler: Some(scheduler.clone()),
        };
        if let (_, Err(e)) = bg.disable(ctx) {
            failures.push(e);
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(Error::Multiple(failures))
    }
}

/// The Task Scheduler for the current Windows user.
#[cfg(windows)]
pub fn native_scheduler(executable: impl Into<PathBuf>) -> Result<Arc<dyn Scheduler>> {
    Ok(Arc::new(TaskScheduler {
        executable: executable.into(),
        sid: crate::task_windows::current_user_sid()?,
        store: Arc::new(crate::task_windows::NativeTaskStore),
    }))
}

#[cfg(not(windows))]
pub fn native_scheduler(_executable: impl Into<PathBuf>) -> Result<Arc<dyn Scheduler>> {
    Err(Error::msg("background reminders require Windows"))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::cache::write_private_json;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    fn write_receipt(path: &Path, owner: &str) -> Result<()> {
        write_private_json(
            path,
            &TaskReceipt {
                owner: owner.into(),
            },
        )
    }

    #[derive(Default)]
    struct FakeTaskStore {
        tasks: Mutex<HashMap<String, String>>,
        creates: AtomicUsize,
        deletes: AtomicUsize,
    }
    impl TaskStore for FakeTaskStore {
        fn get(&self, _: &Ctx, name: &str) -> Result<String> {
            self.tasks
                .lock()
                .unwrap()
                .get(name)
                .cloned()
                .ok_or(Error::TaskNotFound)
        }
        fn create(&self, _: &Ctx, name: &str, raw: &str) -> Result<()> {
            let mut tasks = self.tasks.lock().unwrap();
            if tasks.contains_key(name) {
                return Err(Error::msg("exists"));
            }
            self.creates.fetch_add(1, Ordering::SeqCst);
            tasks.insert(name.into(), raw.into());
            Ok(())
        }
        fn delete(&self, _: &Ctx, name: &str) -> Result<()> {
            self.deletes.fetch_add(1, Ordering::SeqCst);
            self.tasks.lock().unwrap().remove(name);
            Ok(())
        }
    }

    #[test]
    fn task_lifecycle_identity_and_no_secrets() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(FakeTaskStore::default());
        let id = "a".repeat(32);
        let scheduler = TaskScheduler {
            executable: dir.path().join("Inkism & 한글.exe"),
            sid: "S-1-5-21-123".into(),
            store: store.clone(),
        };
        let ctx = Ctx::new();
        scheduler.enable(&ctx, &id).unwrap();
        scheduler.enable(&ctx, &id).unwrap();
        assert_eq!(
            store.creates.load(Ordering::SeqCst),
            1,
            "repeated registration"
        );
        let raw = store.tasks.lock().unwrap()[&format!("{TASK_PREFIX}{id}")].clone();
        for field in ["--db", "--engine", "Password", "HighestAvailable"] {
            assert!(
                !raw.contains(field),
                "task carries forbidden setting {field}"
            );
        }
        assert!(raw.contains("&amp;") && raw.contains("PT1M"), "{raw}");
        scheduler.disable(&ctx, &id).unwrap();
        scheduler.disable(&ctx, &id).unwrap();
        assert_eq!(store.deletes.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn foreign_task_never_replaced_or_deleted() {
        let dir = tempfile::tempdir().unwrap();
        let id = "b".repeat(32);
        let exe = dir.path().join("Inkism.exe");
        let raw = task_xml(&id, &exe, "S-1-5-21-999", now_secs()).unwrap();
        let store = Arc::new(FakeTaskStore::default());
        store
            .tasks
            .lock()
            .unwrap()
            .insert(format!("{TASK_PREFIX}{id}"), raw);
        let scheduler = TaskScheduler {
            executable: exe.clone(),
            sid: "S-1-5-21-123".into(),
            store: store.clone(),
        };
        let ctx = Ctx::new();
        assert!(
            scheduler.enable(&ctx, &id).is_err() && scheduler.disable(&ctx, &id).is_err(),
            "foreign task accepted"
        );
        assert_eq!(
            (
                store.creates.load(Ordering::SeqCst),
                store.deletes.load(Ordering::SeqCst)
            ),
            (0, 0),
            "foreign task changed"
        );
        assert!(
            task_xml("../../other", &exe, &scheduler.sid, now_secs()).is_err(),
            "invalid ID accepted"
        );
    }

    #[test]
    fn uninstall_only_owned_receipts() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let id = "c".repeat(32);
        let exe = root.join("Inkism.exe");
        let store = Arc::new(FakeTaskStore::default());
        store.tasks.lock().unwrap().insert(
            format!("{TASK_PREFIX}{id}"),
            task_xml(&id, &exe, "S-1-5-21-123", now_secs()).unwrap(),
        );
        store
            .tasks
            .lock()
            .unwrap()
            .insert("Unrelated".into(), "untouched".into());
        let scheduler = Arc::new(TaskScheduler {
            executable: exe,
            sid: "S-1-5-21-123".into(),
            store: store.clone(),
        });
        write_receipt(&root.join(format!("{id}.task")), &scheduler.ownership_id()).unwrap();
        std::fs::write(root.join("not-a-cache.task"), "").unwrap();
        let other_id = "d".repeat(32);
        let other_raw = task_xml(
            &other_id,
            &root.join("other-install").join("Inkism.exe"),
            &scheduler.sid,
            now_secs(),
        )
        .unwrap();
        store
            .tasks
            .lock()
            .unwrap()
            .insert(format!("{TASK_PREFIX}{other_id}"), other_raw);
        write_receipt(&root.join(format!("{other_id}.task")), &"e".repeat(64)).unwrap();
        std::fs::write(
            root.join(format!("{other_id}.json")),
            "preserve-other-cache",
        )
        .unwrap();
        remove_owned_tasks(&Ctx::new(), root, scheduler).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join(format!("{other_id}.json"))).unwrap(),
            "preserve-other-cache",
            "other installation cache changed"
        );
        assert_eq!(store.deletes.load(Ordering::SeqCst), 1);
        assert_eq!(
            store.tasks.lock().unwrap()["Unrelated"],
            "untouched",
            "unrelated task changed"
        );
    }
}
