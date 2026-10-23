//! Engine: the library core. `Engine::open(path)` + `execute(Value)->Value`
//! implement the whole protocol (.private/docs/protocol.md v1). `execute` always
//! returns the response envelope `{ok:true,data}` / `{ok:false,error}` and
//! never panics across the boundary.
//!
//! Threading: the JSONL adapter and (later) the sync module drive the Engine
//! from ONE thread. `Engine` is `Send` but deliberately not `Sync`; callers
//! that want concurrency wrap it in their own Mutex. `connection()` exposes
//! the main `rusqlite::Connection` for engine-internal modules (sync);
//! writers must go through the same single-thread discipline (BEGIN
//! IMMEDIATE transactions) the engine itself uses.

use crate::error::{EngineError, Result};
use crate::indexer::{self, Wakeup};
use crate::ops_backup;
use crate::ops_meta;
use crate::ops_notes;
use crate::schema::{self, Role};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::sync::Arc;
use std::thread::JoinHandle;

pub struct Engine {
    /// Main database path ("<path>"; search index lives at "<path>.search").
    path: String,
    /// Write connection: main database ONLY. BEGIN IMMEDIATE must not lock the index.
    conn: Connection,
    /// Read paths can join the separately attached search index.
    query_conn: Connection,
    wakeup: Arc<Wakeup>,
    worker: Option<JoinHandle<()>>,
}

impl Engine {
    /// Open (create if absent) a Inkism library at `path`.
    pub fn open(path: &str) -> Result<Engine> {
        Self::open_with_key(path, None)
    }

    #[cfg(feature = "encrypted-storage")]
    pub fn open_encrypted(path: &str, key: crate::storage::StorageKey) -> Result<Engine> {
        Self::open_with_key(path, Some(key))
    }

    fn open_with_key(path: &str, key: Option<crate::storage::StorageKey>) -> Result<Engine> {
        if path.trim().is_empty() {
            return Err(EngineError::invalid("empty db path"));
        }
        let search_path = format!("{path}.search");

        // Detect a search index that must be rebuilt before opening anything.
        let search_existed = std::path::Path::new(&search_path).exists();

        let conn = schema::open_connection_with_key(path, Role::Foreground, key.as_ref())?;
        schema::init_main(&conn)?;
        if schema::main_user_version(&conn)? != schema::MAIN_USER_VERSION {
            return Err(EngineError::internal("unsupported main db user_version"));
        }
        // Replay crash drafts that never reached a save BEFORE anything else
        // uses the library and before the index worker starts, so recovered
        // copies are indexed exactly like ordinary saves. A failing draft
        // fails the open (journal + original preserved, never dropped).
        crate::draft_journal::recover_pending(&conn)?;
        // Attach the search file for read paths (backlinks op, FTS MATCH in
        // list). ATTACH creates the file if it does not exist yet.
        let query_conn = schema::open_connection_with_key(path, Role::Foreground, key.as_ref())?;
        crate::storage::attach_search(&query_conn, &search_path, key.as_ref())?;

        let search_conn =
            schema::open_connection_with_key(&search_path, Role::WorkerSearch, key.as_ref())?;
        let search_ok = search_existed
            && schema::search_user_version(&search_conn)? == schema::SEARCH_USER_VERSION;
        schema::init_search(&search_conn)?;
        drop(search_conn);

        let wakeup = Wakeup::new();
        let worker = indexer::Worker::spawn_with_key(path, wakeup.clone(), key);
        let engine = Engine {
            path: path.to_string(),
            conn,
            query_conn,
            wakeup,
            worker: Some(worker),
        };

        // Rebuild queue from metadata when the search file was missing or has
        // an unsupported index version. Coalesced one-row-per-note upsert.
        if !search_ok {
            let n = indexer::enqueue_all(engine.connection())?;
            if n > 0 {
                engine.wakeup.notify();
            }
        }
        Ok(engine)
    }

    /// Protocol entry point: one request -> response envelope.
    /// Wake the index worker after a direct write through `connection()`.
    pub fn notify_index(&self) {
        self.wakeup.notify();
    }

    pub fn execute(&self, req: Value) -> Value {
        match self.handle(req) {
            Ok(data) => json!({ "ok": true, "data": data }),
            Err(e) => json!({ "ok": false, "error": e.to_string() }),
        }
    }

    fn handle(&self, req: Value) -> Result<Value> {
        if !req.is_object() {
            return Err(EngineError::invalid("request must be an object"));
        }
        let op = req
            .get("op")
            .and_then(Value::as_str)
            .ok_or_else(|| EngineError::invalid("missing op"))?;
        let conn = self.connection();
        let reply = match op {
            "list" => ops_notes::list(&self.query_conn, &req)?,
            "changes" => ops_notes::changes(&self.query_conn, &req)?,
            "due_reminders" => ops_notes::due_reminders(&self.query_conn, &req)?,
            "get" => ops_notes::get(conn, &req)?,
            "note_preview" => ops_notes::preview(conn, &req)?,
            "random_note" => ops_notes::random_note(&self.query_conn, &req)?,
            "document_info" => crate::blocks::info(&self.query_conn, &req)?,
            "document_find" => crate::blocks::find(&self.query_conn, &req)?,
            "document_blocks" => crate::blocks::page(&self.query_conn, &req)?,
            "document_block_window" => crate::blocks::block_window(&self.query_conn, &req)?,
            "document_segments" => crate::segments::page(&self.query_conn, &req)?,
            "document_locate" => crate::segments::locate(&self.query_conn, &req)?,
            "save" => {
                let v = ops_notes::save(conn, &req)?;
                self.wakeup.notify();
                v
            }
            "document_render" => crate::source_format::document_render(conn, &req)?,
            "convert_content" => {
                let v = ops_notes::convert_content(conn, &req)?;
                self.wakeup.notify();
                v
            }
            "document_splice_source" => {
                let v = ops_notes::splice_source(conn, &req)?;
                self.wakeup.notify();
                v
            }
            "document_splice_html" => {
                let v = ops_notes::splice_html(conn, &req)?;
                self.wakeup.notify();
                v
            }
            "document_splice" => {
                let v = ops_notes::splice(conn, &req)?;
                self.wakeup.notify();
                v
            }
            "patch" => {
                let v = ops_notes::patch(conn, &req)?;
                self.wakeup.notify();
                v
            }
            "delete" => {
                let v = ops_notes::delete(conn, &req)?;
                self.wakeup.notify();
                v
            }
            "notebooks" => ops_meta::notebooks(conn)?,
            "save_notebook" => ops_meta::save_notebook(conn, &req)?,
            "delete_notebook" => {
                let value = ops_meta::delete_notebook(conn, &req)?;
                self.wakeup.notify();
                value
            }
            "trash_notebook" => {
                let value = crate::notebook_trash::trash(conn, &req)?;
                self.wakeup.notify();
                value
            }
            "restore_notebook" => crate::notebook_trash::restore(conn, &req)?,
            "trashed_notebooks" => crate::notebook_trash::list(conn)?,
            "knowledge_get" => crate::knowledge::get(conn, &req)?,
            "knowledge_set" => crate::knowledge::set(conn, &req)?,
            "knowledge_list" => crate::knowledge::list(conn)?,
            "knowledge_settings_get" => crate::knowledge::config_get(conn)?,
            "knowledge_settings_set" => crate::knowledge::config_set(conn, &req)?,
            "link_resolve" => crate::knowledge::resolve(conn, &req)?,
            "graph_get" => crate::knowledge::graph(&self.query_conn)?,
            "relations" => crate::relations::relations(&self.query_conn, &req)?,
            "workspace_tools_get" => crate::workspace_tools::get(conn)?,
            "workspace_tools_set" => {let v=crate::workspace_tools::set(conn,&req)?;self.wakeup.notify();v},
            "font_resources" => crate::resources::list(conn)?,
            "font_resource_set" => {let v=crate::resources::set(conn,&req)?;self.wakeup.notify();v},
            "merge_preview" => crate::merge_changes::preview(conn,&req)?,
            "merge_apply" => {let v=crate::merge_changes::apply(conn,&req)?;self.wakeup.notify();v},
            "merge_undo" => {let v=crate::merge_changes::undo(conn,&req)?;self.wakeup.notify();v},
            "merge_changes" => crate::merge_changes::list(conn)?,
            "semantic_pending" => crate::semantic::pending(conn, &req)?,
            "semantic_search" => crate::semantic::search(conn, &req)?,
            "semantic_status" => crate::semantic::status(conn, &req)?,
            "semantic_put" => {let v=crate::semantic::put(conn,&req)?;self.wakeup.notify();v},
            "semantic_reset" => {let v=crate::semantic::reset(conn)?;self.wakeup.notify();v},
            "wiki_sources" => crate::wiki_changes::sources(&self.query_conn,&req)?,
            "wiki_check" => crate::wiki_changes::check(conn,&req)?,
            "wiki_propose_record" => crate::wiki_changes::record(conn,&req)?,
            "wiki_apply" => {let v=crate::wiki_changes::apply(conn,&req)?;self.wakeup.notify();v},
            "wiki_reject" => crate::wiki_changes::reject(conn,&req)?,
            "wiki_undo" => {let v=crate::wiki_changes::undo(conn,&req)?;self.wakeup.notify();v},
            "wiki_changes" => crate::wiki_changes::list(conn,&req)?,
            "merge_notes" => { let v=crate::writing_ops::merge(conn,&req)?; self.wakeup.notify(); v },
            "page_create" => { let v=crate::knowledge::page_create(conn,&req)?; self.wakeup.notify(); v },
            "daily_note" => { let v=crate::knowledge::daily(conn,&req)?; self.wakeup.notify(); v },
            "template_create" => { let v=crate::knowledge::template_create(conn,&req)?; self.wakeup.notify(); v },
            "type_preset_apply" => { let v=crate::knowledge::type_preset_apply(conn,&req)?; self.wakeup.notify(); v },
            "defaults_get" => crate::settings::get(conn)?,
            "defaults_set" => crate::settings::set(conn, &req)?,
            "tag_color_set" => crate::settings::set_tag_color(conn, &req)?,
            "notebook_icon_set" => crate::settings::set_notebook_icon(conn, &req)?,
            "tags" => ops_meta::tags(conn)?,
            "tag_change_preview" => crate::tag_changes::preview(conn,&req)?,
            "tag_change_list" => crate::tag_changes::list(conn)?,
            "tag_change_apply" => {let v=crate::tag_changes::apply(conn,&req)?;self.wakeup.notify();v},
            "tag_change_undo" => {let v=crate::tag_changes::undo(conn,&req)?;self.wakeup.notify();v},
            "change_tag" => {
                let value = ops_meta::change_tag(conn, &req)?;
                self.wakeup.notify();
                value
            }
            "stats" => ops_meta::stats(conn)?,
            "notebook_counts" => crate::notebook_counts::counts(&self.query_conn)?,
            "trash_retention_get" => crate::trash_retention::get(conn)?,
            "trash_retention_set" => crate::trash_retention::set(conn, &req)?,
            "trash_times" => crate::trash_retention::times(conn, &req)?,
            "trash_purge" => {
                let v = crate::trash_retention::purge(conn, crate::ids::now_ms())?;
                self.wakeup.notify();
                v
            }
            // Local open-tab state: no index jobs, never synced/exported.
            "split_get" => crate::editor_history::split_get(conn)?,
            "split_set" => crate::editor_history::split_set(conn, &req)?,
            "editor_history_get" => crate::editor_history::get(conn)?,
            "editor_history_set" => crate::editor_history::set(conn, &req)?,
            "workspace_get" => crate::workspace::get(conn)?,
            "workspace_set" => crate::workspace::set(conn, &req)?,
            // Crash draft journal: LOCAL-only unsaved-input snapshots. No
            // index jobs, no note writes, no sync surface.
            "draft_journal_put" => crate::draft_journal::put(conn, &req)?,
            "draft_journal_clear" => crate::draft_journal::clear(conn, &req)?,
            "draft_journal_status" => crate::draft_journal::status(conn)?,
            "revision_body" => ops_notes::revision_body(conn, &req)?,
            "history_name_current" | "history_rename" | "history_delete_named" => crate::named_versions::change(conn,&req,op)?,
            "history_body" => crate::named_versions::body(conn,&req)?,
            "history" => ops_notes::history(conn, &req)?,
            "history_changes" => crate::history_changes::changes(conn, &req)?,
            "history_sealed" => crate::encrypted_versions::sealed(conn, &req)?,
            "restore" => {
                let v = ops_notes::restore(conn, &req)?;
                self.wakeup.notify();
                v
            }
            "outgoing_links" => ops_meta::outgoing_links(&self.query_conn, &req)?,
            "reference_preview" => crate::connection_index::preview(&self.query_conn, &req)?,
            "reference_candidates" => crate::connection_index::candidates(&self.query_conn, &req)?,
            "outgoing_references" => crate::connection_index::outgoing(&self.query_conn, &req)?,
            "unlinked_mentions" => crate::connection_index::mentions(&self.query_conn, &req)?,
            "backlink_location" => crate::ops_meta::backlink_location(&self.query_conn, &req)?,
            "backlink_blocks" => ops_meta::backlink_blocks(&self.query_conn, &req)?,
            "backlinks" => ops_meta::backlinks(&self.query_conn, &req)?,
            "validate_import" => ops_backup::validate_import(&req)?,
            "export" => ops_backup::export(conn, &req)?,
            "import" => {
                let v = ops_backup::import(conn, &req)?;
                self.wakeup.notify();
                v
            }
            "index_status" => json!({ "pending": indexer::pending_count(conn)? }),
            "wait_index" => {
                let pending = self.wait_index(crate::limits::WAIT_INDEX_TIMEOUT_MS)?;
                json!({ "pending": pending })
            }
            "health" => ops_meta::health()?,
            other => {
                return Err(EngineError::invalid(format!("unknown op: {other}")));
            }
        };
        Ok(reply)
    }

    /// Wait until the background queue drains or `timeout_ms` elapse.
    /// Returns the remaining pending count (0 when fully indexed). Bounded by
    /// design — tests use this, production never blocks on it.
    pub fn wait_index(&self, timeout_ms: u64) -> Result<i64> {
        let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);
        loop {
            self.wakeup.notify(); // nudge the worker in case it is parked
            let pending = indexer::pending_count(self.connection())?;
            if pending == 0 {
                return Ok(0);
            }
            if std::time::Instant::now() >= deadline {
                return Ok(pending);
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
    }

    /// Direct access to the main connection for engine-internal modules
    /// (future sync). Callers must respect the single-writer transaction
    /// discipline (BEGIN IMMEDIATE) — see struct docs.
    pub fn query_connection(&self) -> &Connection {
        &self.query_conn
    }

    pub fn connection(&self) -> &Connection {
        &self.conn
    }

    pub fn path(&self) -> &str {
        &self.path
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        if let Some(worker) = self.worker.take() {
            self.wakeup.request_shutdown();
            // The worker checks the flag between jobs and inside its park
            // wait, so this join is bounded (finishes the current small
            // batch at most). Detaching instead would leave a stale worker
            // racing a reopened database in tests.
            let _ = worker.join();
        }
    }
}
