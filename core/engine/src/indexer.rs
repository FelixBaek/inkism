//! Background index worker (performance-requirements.md #3).
//!
//! Architecture (review fix #3): the worker owns TWO connections.
//!   * main   ("<db>")  – reads note rows, performs only the tiny
//!     `DELETE FROM index_jobs ...` bookkeeping write (busy_timeout 300 ms,
//!     retried via the durable job row if the foreground wins the lock).
//!   * search ("<db>.search") – performs the heavy work (FTS5 trigram
//!     tokenization of title+text, backlink extraction) inside its own
//!     write transaction on a physically separate SQLite file.
//!
//! The foreground save path never touches the search file and never
//! tokenizes; it only inserts/coalesces a row in `index_jobs` inside the
//! save transaction, then signals the condvar. So a save is never queued
//! behind an expensive index write.
//!
//! Job semantics (version-safe coalescing): one row per note
//! (`index_jobs.note_id` PK). A save UPSERTs the row with the note's new
//! revision as `version`. The worker removes the row only when `version`
//! still matches, so a newer save always survives and is processed again.
//!
//! Lifecycle: drain pending jobs, then park on a condvar with a timeout;
//! `Engine::drop` sets the shutdown flag and joins the thread. Leftover jobs
//! are durable and resumed on the next start; a missing/out-of-date search
//! file triggers a full rebuild enqueue at open (see `Engine::open`).

use crate::links;
use crate::schema::{self, Role};
use rusqlite::{params, Connection, OptionalExtension};
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

/// `(seq, title, content, text, trashed, revision, content_format)` from MAIN.
type NoteRow = (i64, String, String, String, i64, i64, String);

pub struct Wakeup {
    pub state: Mutex<bool>, // "work may be available"
    pub cv: Condvar,
    pub shutdown: AtomicBool,
}

impl Wakeup {
    pub fn new() -> Arc<Self> {
        Arc::new(Wakeup {
            state: Mutex::new(false),
            cv: Condvar::new(),
            shutdown: AtomicBool::new(false),
        })
    }

    /// Called by the foreground after committing an enqueue (or many).
    pub fn notify(&self) {
        let mut flag = self.state.lock().unwrap();
        *flag = true;
        self.cv.notify_all();
    }

    pub fn request_shutdown(&self) {
        self.shutdown.store(true, Ordering::SeqCst);
        self.cv.notify_all();
    }
}

/// Enqueue (or coalesce) an index job. MUST run inside the caller's save
/// transaction so the job is durable exactly with the data change.
pub fn enqueue(conn: &Connection, note_id: &str, version: i64) -> crate::error::Result<()> {
    conn.execute(
        "INSERT INTO index_jobs(note_id, version, enqueued_at)
         VALUES(?1, ?2, ?3)
         ON CONFLICT(note_id) DO UPDATE SET version = excluded.version,
                                            enqueued_at = excluded.enqueued_at",
        params![note_id, version, crate::ids::now_ms()],
    )?;
    Ok(())
}

/// Rebuild helper: enqueue every note in the library (search file missing or
/// version mismatch). One INSERT..SELECT, coalesced by the PK.
pub fn enqueue_all(conn: &Connection) -> crate::error::Result<usize> {
    let n = conn.execute(
        "INSERT INTO index_jobs(note_id, version, enqueued_at)
         SELECT id, revision, ?1 FROM notes_meta WHERE true
         ON CONFLICT(note_id) DO UPDATE SET version = excluded.version,
                                            enqueued_at = excluded.enqueued_at",
        params![crate::ids::now_ms()],
    )?;
    Ok(n)
}

pub fn pending_count(conn: &Connection) -> crate::error::Result<i64> {
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM index_jobs", [], |r| r.get(0))?;
    Ok(n)
}

pub struct Worker {
    main: Connection,
    search: Connection,
    wakeup: Arc<Wakeup>,
}

impl Worker {
    pub fn spawn(path: &str, wakeup: Arc<Wakeup>) -> std::thread::JoinHandle<()> {
        Self::spawn_with_key(path, wakeup, None)
    }

    pub(crate) fn spawn_with_key(
        path: &str,
        wakeup: Arc<Wakeup>,
        key: Option<crate::storage::StorageKey>,
    ) -> std::thread::JoinHandle<()> {
        let main_path = path.to_string();
        let search_path = format!("{path}.search");
        std::thread::Builder::new()
            .name("inkism-indexer".into())
            .spawn(move || {
                let main = match schema::open_connection_with_key(
                    &main_path,
                    Role::WorkerMain,
                    key.as_ref(),
                ) {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("inkism-engine: index worker disabled (main db): {e}");
                        return;
                    }
                };
                let search = match schema::open_connection_with_key(
                    &search_path,
                    Role::WorkerSearch,
                    key.as_ref(),
                ) {
                    Ok(c) => c,
                    Err(e) => {
                        eprintln!("inkism-engine: index worker disabled (search db): {e}");
                        return;
                    }
                };
                Worker {
                    main,
                    search,
                    wakeup,
                }
                .run();
            })
            .expect("spawn index worker")
    }

    fn run(self) {
        const BATCH: usize = 64;
        while !self.wakeup.shutdown.load(Ordering::SeqCst) {
            if self.run_once(BATCH) {
                return;
            }
        }
    }

    /// One select + process pass. Returns true only when the worker should
    /// shut down.
    fn run_once(&self, batch: usize) -> bool {
        let jobs = match self.select_batch(batch) {
            Ok(j) => j,
            Err(e) => {
                eprintln!("inkism-engine: index worker select failed: {e}");
                return self.park(500);
            }
        };
        if jobs.is_empty() {
            return self.park(500);
        }
        if let Err(e) = self.process_batch(&jobs) {
            eprintln!("inkism-engine: index batch failed: {e}");
            return self.park(500);
        }
        false
    }

    /// Amortize search WAL commits without holding a MAIN write lock.
    /// A job is acknowledged only after the outer search transaction commits.
    fn process_batch(&self, jobs: &[(String, i64)]) -> crate::error::Result<()> {
        self.search.execute_batch("BEGIN IMMEDIATE;")?;
        let completed = match self.index_jobs(jobs) {
            Ok(completed) => completed,
            Err(e) => {
                let _ = self.search.execute_batch("ROLLBACK;");
                return Err(e);
            }
        };
        for (id, version) in completed {
            self.acknowledge(id, version)?;
        }
        Ok(())
    }

    /// Indexes jobs inside the caller's open search transaction and commits it.
    /// Returns the jobs that completed and may be acknowledged.
    fn index_jobs<'a>(
        &self,
        jobs: &'a [(String, i64)],
    ) -> crate::error::Result<Vec<(&'a str, i64)>> {
        let started = std::time::Instant::now();
        let mut completed = Vec::new();
        for (id, version) in jobs {
            if self.wakeup.shutdown.load(Ordering::SeqCst) {
                break;
            }
            match self.index_one(id) {
                Ok(()) => completed.push((id.as_str(), *version)),
                Err(e) => {
                    // SQLITE_FULL/IO errors can roll back the outer transaction.
                    // Never acknowledge earlier work if that happened.
                    if self.search.is_autocommit() {
                        return Err(e);
                    }
                    eprintln!("inkism-engine: index job {id} failed: {e}");
                }
            }
            // A single large document can exceed this budget; do not add
            // another document's work before publishing its search result.
            // A repeatedly failing oldest job must not starve later jobs.
            if !completed.is_empty() && started.elapsed() >= Duration::from_millis(25) {
                break;
            }
        }
        self.search.execute_batch("COMMIT;")?;
        Ok(completed)
    }

    /// Park until notified or `timeout_ms` elapses. Returns true only when
    /// the worker should shut down.
    fn park(&self, timeout_ms: u64) -> bool {
        if self.wakeup.shutdown.load(Ordering::SeqCst) {
            return true;
        }
        let mut flag = self.wakeup.state.lock().unwrap();
        if !*flag {
            let (guard, _waited) = self
                .wakeup
                .cv
                .wait_timeout(flag, Duration::from_millis(timeout_ms))
                .unwrap();
            flag = guard;
        }
        let woken = *flag;
        *flag = false;
        if self.wakeup.shutdown.load(Ordering::SeqCst) {
            return true;
        }
        let _ = woken; // woken or timed out: either way, loop again
        false
    }

    fn select_batch(&self, n: usize) -> crate::error::Result<Vec<(String, i64)>> {
        let mut stmt = self
            .main
            .prepare("SELECT note_id, version FROM index_jobs ORDER BY enqueued_at LIMIT ?1")?;
        let rows = stmt.query_map(params![n as i64], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })?;
        let mut out = Vec::with_capacity(n);
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// Index one note:
    ///   1. read note row from MAIN (read-only),
    ///   2. heavy FTS + backlink write on the SEARCH file,
    ///
    /// The caller commits the group before version-checked acknowledgement.
    /// A missing note means it was deleted: clean stale search rows instead.
    fn index_one(&self, note_id: &str) -> crate::error::Result<()> {
        // ---- 1. read from main db (no write held) ------------------------
        // ponytail: metadata jobs still read the full body; track body revisions if this I/O dominates.
        let note = self
            .main
            .query_row(
                "SELECT m.seq, m.title, b.content, b.text, m.trashed, m.revision, m.content_format
                 FROM notes_meta m
                 LEFT JOIN notes_body b ON b.note_id = m.id
                 WHERE m.id = ?1",
                params![note_id],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, Option<String>>(2)?.unwrap_or_default(),
                        r.get::<_, Option<String>>(3)?.unwrap_or_default(),
                        r.get::<_, i64>(4)?,
                        r.get::<_, i64>(5)?,
                        r.get::<_, String>(6)?,
                    ))
                },
            )
            .optional()?;

        // ---- 2. heavy work on the search file ----------------------------
        self.search.execute_batch("SAVEPOINT index_note;")?;
        let result = (|| -> crate::error::Result<()> {
            match &note {
                None => self.clear_note(note_id)?,
                Some(row) => self.write_note(note_id, row)?,
            }
            self.search.execute_batch("RELEASE index_note;")?;
            Ok(())
        })();
        if let Err(e) = result {
            let _ = self
                .search
                .execute_batch("ROLLBACK TO index_note; RELEASE index_note;");
            return Err(e);
        }

        Ok(())
    }

    fn clear_note(&self, note_id: &str) -> crate::error::Result<()> {
        self.search.execute("DELETE FROM backlink_locations WHERE source_id=?1",[note_id])?;
        self.search.execute("DELETE FROM outgoing_references WHERE source_id=?1",[note_id])?;
        self.search.execute("DELETE FROM connection_text WHERE source_id=?1",[note_id])?;
        self.search.execute("DELETE FROM reference_previews WHERE source_id=?1",[note_id])?;
        self.search
            .execute("DELETE FROM document_layout WHERE note_id=?1", [note_id])?;
        // Note deleted: drop its FTS row, outbound backlinks and
        // map entry. The map is what makes this O(1) lookups.
        let old: Option<i64> = self
            .search
            .query_row(
                "SELECT fts_rowid FROM fts_map WHERE note_id = ?1",
                params![note_id],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(rid) = old {
            self.search
                .execute("DELETE FROM notes_fts WHERE rowid = ?1", params![rid])?;
        }
        self.search.execute(
            "DELETE FROM backlinks WHERE source_id = ?1",
            params![note_id],
        )?;
        self.search.execute(
            "DELETE FROM backlink_titles WHERE source_id=?1",
            params![note_id],
        )?;
        self.search
            .execute("DELETE FROM fts_map WHERE note_id = ?1", params![note_id])?;
        Ok(())
    }

    /// (Re)index one live note unless its stored signature is unchanged.
    fn write_note(&self, note_id: &str, row: &NoteRow) -> crate::error::Result<()> {
        let (seq, title, content, stored_text, trashed, revision, format) = row;
        let text = search_text(format, content, stored_text)?;
        let body_hash: [u8; 32] = if format == "html" {
            crate::blocks::rebuild(&self.search, note_id, *revision, content)?
        } else {
            self.search
                .execute("DELETE FROM document_layout WHERE note_id=?1", [note_id])?;
            Sha256::digest(content.as_bytes()).into()
        };
        let rid = *seq;
        let mut hasher = Sha256::new();
        hasher.update(body_hash);
        hasher.update(format.as_bytes());
        for value in [title.as_str(), text.as_ref()] {
            hasher.update((value.len() as u64).to_le_bytes());
            hasher.update(value.as_bytes());
        }
        hasher.update(trashed.to_le_bytes());
        let signature = hasher.finalize();
        let reusable:bool=self.search.query_row(
            "SELECT EXISTS(SELECT 1 FROM fts_map WHERE note_id=?1 AND fts_rowid=?2 AND index_hash=?3)",
            params![note_id,rid,signature.as_slice()],|r|r.get(0))?;
        if !reusable {
            self.search.execute("DELETE FROM backlink_locations WHERE source_id=?1",[note_id])?;
        self.search.execute("DELETE FROM outgoing_references WHERE source_id=?1",[note_id])?;
        self.search.execute("DELETE FROM connection_text WHERE source_id=?1",[note_id])?;
        self.search.execute("DELETE FROM reference_previews WHERE source_id=?1",[note_id])?;
            if *trashed == 0 {self.search.execute("INSERT INTO connection_text(source_id,folded) VALUES(?1,?2)",params![note_id,text.to_lowercase()])?;}
            if *trashed == 0 && format == "markdown" {for item in crate::connection_index::markdown_previews(content){self.search.execute("INSERT OR IGNORE INTO reference_previews(source_id,anchor,kind,byte_offset,source,label,truncated) VALUES(?1,?2,?3,?4,?5,?6,?7)",params![note_id,item["anchor"].as_str().unwrap(),item["kind"].as_str().unwrap(),item["byte_offset"].as_i64().unwrap(),item["source"].as_str().unwrap(),item["label"].as_str().unwrap(),item["truncated"].as_bool().unwrap()])?;}for(target,start,end,label)in links::markdown_locations(content){self.search.execute("INSERT OR IGNORE INTO backlink_locations(source_id,target,byte_offset,byte_end,label) VALUES(?1,?2,?3,?4,?5)",params![note_id,target,start as i64,end as i64,label])?;}}
            self.search
                .execute("DELETE FROM notes_fts WHERE rowid = ?1", params![rid])?;
            if *trashed == 0 {
                self.search.execute(
                    "INSERT INTO notes_fts(rowid, title, text) VALUES(?1,?2,?3)",
                    params![rid, title, text.as_ref()],
                )?;
            }
            self.search.execute(
                "DELETE FROM backlinks WHERE source_id = ?1",
                params![note_id],
            )?;
            self.search.execute(
                "DELETE FROM backlink_titles WHERE source_id=?1",
                params![note_id],
            )?;
            if *trashed == 0 {
                self.write_backlinks(note_id, content, format)?;
                for (ordinal,item) in crate::connection_index::references(content,format).into_iter().enumerate(){self.search.execute("INSERT INTO outgoing_references(source_id,ordinal,reference,label,embed) VALUES(?1,?2,?3,?4,?5)",params![note_id,ordinal as i64,item["reference"].as_str().unwrap(),item["label"].as_str().unwrap(),item["embed"].as_bool().unwrap()])?;}
            }
            self.search.execute(
            "INSERT INTO fts_map(note_id, fts_rowid,index_hash) VALUES(?1, ?2,?3)
             ON CONFLICT(note_id) DO UPDATE SET fts_rowid = excluded.fts_rowid,index_hash=excluded.index_hash",
            params![note_id, rid,signature.as_slice()],
        )?;
        }
        Ok(())
    }

    /// Outbound links of a live note: by-id backlinks and unresolved titles.
    fn write_backlinks(
        &self,
        note_id: &str,
        content: &str,
        format: &str,
    ) -> crate::error::Result<()> {
        for link in links::extract_format(content, format) {
            let target = match link {
                links::Link::ById(id) => Some(id),
                links::Link::ByTitle(t) => {
                    self.search.execute("INSERT OR IGNORE INTO backlink_titles(target_title,source_id) VALUES(?1,?2)",params![t,note_id])?;
                    None
                }
            };
            if let Some(target) = target {
                if target != *note_id {
                    self.search.execute(
                        "INSERT OR IGNORE INTO backlinks(target_id, source_id)
                     VALUES(?1, ?2)",
                        params![target, note_id],
                    )?;
                }
            }
        }
        Ok(())
    }

    fn acknowledge(&self, note_id: &str, version: i64) -> crate::error::Result<()> {
        // ---- 3. tiny bookkeeping write on main db ------------------------
        // The main-busy timeout is deliberately small; instead of failing the
        // job (which would redo the heavy search work on the next pass) we
        // retry this sub-millisecond DELETE with a small backoff until it
        // lands. Waiting on a lock never blocks the foreground writer.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        loop {
            match self.main.execute(
                "DELETE FROM index_jobs WHERE note_id = ?1 AND version = ?2",
                params![note_id, version],
            ) {
                Ok(_) => return Ok(()),
                Err(e) => {
                    if self.wakeup.shutdown.load(Ordering::SeqCst)
                        || std::time::Instant::now() >= deadline
                    {
                        // Durable row remains; retried on a later pass.
                        return Err(e.into());
                    }
                    std::thread::sleep(std::time::Duration::from_millis(25));
                }
            }
        }
    }
}

/// Plain text that search (and the semantic index) reads for one note body.
pub(crate) fn search_text<'a>(format: &str, content: &'a str, stored_text: &'a str) -> crate::error::Result<Cow<'a, str>> {
    Ok(if format == "text" {
        Cow::Borrowed(content)
    } else if format == "html" && stored_text != content {
        Cow::Borrowed(stored_text)
    } else {
        Cow::Owned(crate::source_format::search_text(format, content)?)
    })
}

#[cfg(test)]
mod batch_tests {
    use super::*;
    fn worker() -> Worker {
        let main = Connection::open_in_memory().unwrap();
        let search = Connection::open_in_memory().unwrap();
        schema::init_main(&main).unwrap();
        schema::init_search(&search).unwrap();
        Worker {
            main,
            search,
            wakeup: Wakeup::new(),
        }
    }
    fn seed(w: &Worker, id: &str) {
        w.main
            .execute(
                "INSERT INTO notes_meta(id,title,created_at,updated_at) VALUES(?1,?1,0,0)",
                [id],
            )
            .unwrap();
        w.main
            .execute(
                "INSERT INTO notes_body(note_id,content,text) VALUES(?1,'<p>본문</p>','본문')",
                [id],
            )
            .unwrap();
        enqueue(&w.main, id, 1).unwrap();
    }
    fn indexed(w: &Worker, id: &str) -> bool {
        w.search
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM fts_map WHERE note_id=?1)",
                [id],
                |r| r.get(0),
            )
            .unwrap()
    }
    #[test]
    fn failed_note_rolls_back_its_layout_without_blocking_other_jobs() {
        let w = worker();
        seed(&w, "bad");
        seed(&w, "good");
        w.search.execute_batch("CREATE TRIGGER reject_bad BEFORE INSERT ON fts_map WHEN NEW.note_id='bad' BEGIN SELECT RAISE(ABORT,'injected'); END;").unwrap();
        w.process_batch(&[("bad".into(), 1), ("good".into(), 1)])
            .unwrap();
        // A slow runner may consume the time budget on the failed note.
        w.process_batch(&[("good".into(), 1)]).unwrap();
        assert!(!indexed(&w, "bad"));
        assert!(indexed(&w, "good"));
        assert_eq!(pending_count(&w.main).unwrap(), 1);
        let stale: i64 = w
            .search
            .query_row(
                "SELECT COUNT(*) FROM document_layout WHERE note_id='bad'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(stale, 0);
        w.search.execute_batch("DROP TRIGGER reject_bad").unwrap();
        w.process_batch(&w.select_batch(64).unwrap()).unwrap();
        assert!(indexed(&w, "bad"));
        assert_eq!(pending_count(&w.main).unwrap(), 0);
    }
    #[test]
    fn commit_failure_preserves_every_job_for_retry() {
        let w = worker();
        seed(&w, "first");
        seed(&w, "second");
        w.search.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE parent(id PRIMARY KEY); CREATE TABLE child(id REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED); CREATE TRIGGER reject_commit AFTER INSERT ON fts_map BEGIN INSERT INTO child VALUES(99); END;").unwrap();
        assert!(w.process_batch(&w.select_batch(64).unwrap()).is_err());
        assert!(!indexed(&w, "first"));
        assert!(!indexed(&w, "second"));
        assert_eq!(pending_count(&w.main).unwrap(), 2);
        assert!(w.search.is_autocommit());
        w.search
            .execute_batch("DROP TRIGGER reject_commit")
            .unwrap();
        w.process_batch(&w.select_batch(64).unwrap()).unwrap();
        // Finish any item deferred by the elapsed-time budget.
        w.process_batch(&w.select_batch(64).unwrap()).unwrap();
        assert!(indexed(&w, "first"));
        assert!(indexed(&w, "second"));
        assert_eq!(pending_count(&w.main).unwrap(), 0);
    }
    #[test]
    fn newer_revision_survives_old_batch_ack_and_deleted_note_is_removed() {
        let w = worker();
        seed(&w, "changed");
        let jobs = w.select_batch(64).unwrap();
        w.main
            .execute("UPDATE notes_meta SET revision=2 WHERE id='changed'", [])
            .unwrap();
        enqueue(&w.main, "changed", 2).unwrap();
        w.process_batch(&jobs).unwrap();
        assert_eq!(w.select_batch(64).unwrap(), vec![("changed".into(), 2)]);
        w.process_batch(&w.select_batch(64).unwrap()).unwrap();
        assert_eq!(pending_count(&w.main).unwrap(), 0);
        assert!(indexed(&w, "changed"));
        w.main
            .execute("DELETE FROM notes_meta WHERE id='changed'", [])
            .unwrap();
        enqueue(&w.main, "changed", 3).unwrap();
        w.process_batch(&w.select_batch(64).unwrap()).unwrap();
        assert!(!indexed(&w, "changed"));
        assert_eq!(pending_count(&w.main).unwrap(), 0);
    }
    #[test]
    fn shutdown_leaves_unprocessed_jobs_durable() {
        let w = worker();
        seed(&w, "resume");
        w.wakeup.request_shutdown();
        w.process_batch(&w.select_batch(64).unwrap()).unwrap();
        assert_eq!(pending_count(&w.main).unwrap(), 1);
        assert!(!indexed(&w, "resume"));
        w.wakeup.shutdown.store(false, Ordering::SeqCst);
        w.process_batch(&w.select_batch(64).unwrap()).unwrap();
        assert_eq!(pending_count(&w.main).unwrap(), 0);
        assert!(indexed(&w, "resume"));
    }
}

