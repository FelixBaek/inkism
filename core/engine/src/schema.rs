//! Physical schema, split across TWO SQLite files:
//!
//!   main  = "<path>"            notes metadata+bodies, notebooks, history,
//!                               index_jobs (durable work queue), and the
//!                               LOCAL workspace_state row (open tabs). The
//!                               save path writes ONLY here, in short
//!                               transactions.
//!   search= "<path>.search"     FTS5 trigram index + backlinks + the
//!                               note_id->fts-rowid map. Written exclusively
//!                               by the background worker on its own
//!                               connection, so tokenizing a 100k-line body
//!                               never blocks a save. Attached to the main
//!                               connection as `searchidx` for reads.
//!
//! Stale search data is safe: read paths always join back to live
//! `notes_meta`, so a deleted/trashed/unindexed note never leaks into
//! results; at worst the indexed *content* lags briefly (eventual
//! consistency, documented in README).
//!
//! `notes_meta.seq` is an explicit immutable integer id (AUTOINCREMENT, assigned in
//! the insert transaction). It is used as the FTS5 rowid, so the worker can
//! delete a note's index row by rowid — `WHERE rowid=?` on FTS5 is a direct
//! seek, not a scan (verified with EXPLAIN QUERY PLAN in tests). A plain
//! implicit rowid would be renumbered by VACUUM, hence the explicit column.
//!
//! `history.row_seq` comes from the history_seq AUTOINCREMENT table so the
//! retention index/ordering references a real declared column (SQLite cannot
//! index the implicit rowid).
//!
//! v3 added `notes_meta.reminder_at` (nullable UTC ms). The migration is a
//! plain ADD COLUMN inside the init transaction, so a v2 library reopens with
//! all notes intact and `reminder_at` reads back NULL; the partial index
//! `idx_notes_reminder ... WHERE reminder_at IS NOT NULL` serves the
//! `due_reminders` scan over scheduled rows only.

use crate::error::Result;
use rusqlite::Connection;

/// v3 (reminders): `notes_meta.reminder_at` (nullable UTC ms) plus the partial
/// `idx_notes_reminder` index. v2 databases are migrated in place by
/// `init_main`; existing rows keep every column and read back `reminder_at`
/// as NULL.
/// v4 adds bounded local workspace editor positions.
/// v6 adds the LOCAL crash `draft_journal`: the last unsaved editor snapshot
/// per note and editor slot. It deliberately has NO foreign key to `notes_meta`, so deleting
/// the original never destroys the copy; `draft_journal::recover_pending`
/// resolves notebooks and creates a separate note at open time.
/// v7 adds the synced note-level read-only flag; older engines must not open it.
/// v8 separates title/body edit time from general metadata modification time.
/// v9 adds an indexed, automatically derived title-order column.
/// v10 adds notebook hierarchy metadata: `notebooks.parent_id` (nullable, NO
/// foreign key — a remote child notebook can be received before its parent)
/// and `notebooks.description` (NOT NULL, defaults to '').
/// v11 adds indexed many-to-many note/notebook relationships. The legacy
/// primary notebook column remains for the current UI and old payloads.
/// v12 adds synced app `settings` (default notebook) with decision times.
/// v13 adds the original notebook trash: `notebooks.deleted_at` (NULL = live)
/// and `deleted_by` ('user' = chosen, 'app' = moved with its parent).
/// v14 adds the original per-note vault: `notes_meta.locked` and
/// `locked_notes` (ciphertext only; the plaintext body row is emptied).
/// v15 adds the synced notebook cover photo: `notebooks.cover` (nullable
/// canonical JSON, see `notebook_cover`). Existing rows read back NULL.
pub const MAIN_USER_VERSION: i32 = 15;
pub const SEARCH_USER_VERSION: i32 = 13;

pub const MAIN_SCHEMA_SQL: &str = r#"
-- Local-only undo receipts; never synced/exported as settings.
CREATE TABLE IF NOT EXISTS local_tag_changes(id TEXT PRIMARY KEY,status TEXT NOT NULL,touched_at INTEGER NOT NULL,receipt TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notes_meta (
    id          TEXT NOT NULL UNIQUE,
    seq         INTEGER PRIMARY KEY AUTOINCREMENT,     -- stable FTS rowid (see above)
    title       TEXT NOT NULL DEFAULT '',
    -- ponytail: SQL NOCASE order; locale/numeric order needs separate keys.
    title_order TEXT COLLATE NOCASE GENERATED ALWAYS AS (ltrim(title,' '||char(160,13,10,9,11))) VIRTUAL,
    preview     TEXT NOT NULL DEFAULT '',    -- first 180 chars of text/title,
                                             -- computed at save time so lists
                                             -- never read bodies
    notebook_id TEXT,
    tags        TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
    favorite    INTEGER NOT NULL DEFAULT 0,
    pinned      INTEGER NOT NULL DEFAULT 0,
    readonly    INTEGER NOT NULL DEFAULT 0 CHECK(readonly IN (0,1)),
    archived    INTEGER NOT NULL DEFAULT 0,
    trashed     INTEGER NOT NULL DEFAULT 0,
    color       TEXT,
    reminder_at INTEGER,                     -- UTC ms reminder, NULL = none
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    edited_at   INTEGER NOT NULL DEFAULT 0,
    revision    INTEGER NOT NULL DEFAULT 1
);

-- Bodies are physically separate; loaded only by get/save/history paths.
CREATE TABLE IF NOT EXISTS notes_body (
    note_id TEXT PRIMARY KEY REFERENCES notes_meta(id) ON DELETE CASCADE,
    content TEXT NOT NULL DEFAULT '',
    text    TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS notebooks (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    color       TEXT,
    -- v10: parent_id has NO foreign key on purpose (a remote child can be
    -- received before its parent); top-level rows read back NULL.
    parent_id   TEXT,
    description TEXT NOT NULL DEFAULT '',
    deleted_at  INTEGER,
    deleted_by  TEXT CHECK(deleted_by IN ('user','app')),
    cover       TEXT  -- v15: canonical JSON (notebook_cover), NULL = none
);

CREATE TABLE IF NOT EXISTS note_notebooks (
    note_id TEXT NOT NULL REFERENCES notes_meta(id) ON DELETE CASCADE,
    notebook_id TEXT NOT NULL,
    PRIMARY KEY(note_id,notebook_id)
);
CREATE INDEX IF NOT EXISTS idx_note_notebooks_notebook ON note_notebooks(notebook_id,note_id);
-- v14: vault ciphertext. The runtime holds keys; the engine never decrypts.
-- `attachments` keeps [{id,ref}] so sync/backup can carry and remap files.
CREATE TABLE IF NOT EXISTS locked_notes (
    note_id     TEXT PRIMARY KEY REFERENCES notes_meta(id) ON DELETE CASCADE,
    key_id      TEXT NOT NULL,
    ciphertext  TEXT NOT NULL,
    attachments TEXT NOT NULL DEFAULT '[]'
);
-- v12: synced settings. `value` has no notebook FK (sync order is free);
-- NULL is an explicit, synced "none"; a missing row was never decided here.
CREATE TABLE IF NOT EXISTS settings (
    key        TEXT PRIMARY KEY,
    value      TEXT,
    updated_at INTEGER NOT NULL
);
-- Existing save/splice/import/sync SQL still writes the primary column.
-- Repeating the same primary preserves additional relationships; moving it
-- replaces that relationship only, and explicit NULL removes all memberships.
CREATE TRIGGER IF NOT EXISTS note_notebooks_insert AFTER INSERT ON notes_meta
WHEN NEW.notebook_id IS NOT NULL BEGIN
    INSERT INTO note_notebooks(note_id,notebook_id) VALUES(NEW.id,NEW.notebook_id);
END;
CREATE TRIGGER IF NOT EXISTS note_notebooks_primary AFTER UPDATE OF notebook_id ON notes_meta
WHEN OLD.notebook_id IS NOT NEW.notebook_id BEGIN
    DELETE FROM note_notebooks WHERE note_id=NEW.id AND (notebook_id=OLD.notebook_id OR NEW.notebook_id IS NULL);
    INSERT OR IGNORE INTO note_notebooks(note_id,notebook_id)
        SELECT NEW.id,NEW.notebook_id WHERE NEW.notebook_id IS NOT NULL;
END;

-- Content history snapshots (max 20 per note, see limits.rs).
CREATE TABLE IF NOT EXISTS history (
    id         TEXT PRIMARY KEY,
    note_id    TEXT NOT NULL REFERENCES notes_meta(id) ON DELETE CASCADE,
    title      TEXT NOT NULL DEFAULT '',
    content    TEXT NOT NULL DEFAULT '',
    text       TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    row_seq    INTEGER NOT NULL DEFAULT 0,
    note_revision INTEGER
);
CREATE TABLE IF NOT EXISTS encrypted_named_versions (id TEXT PRIMARY KEY,note_id TEXT NOT NULL REFERENCES notes_meta(id) ON DELETE CASCADE,data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_encrypted_versions_note ON encrypted_named_versions(note_id);
CREATE TABLE IF NOT EXISTS history_seq (seq INTEGER PRIMARY KEY AUTOINCREMENT);
CREATE INDEX IF NOT EXISTS idx_history_note ON history(note_id, created_at DESC, row_seq DESC);

-- Keyset order (pinned DESC, updated_at DESC, id DESC) over view filters.
-- Leading (trashed, archived) columns let every view answer filter + order
-- from ONE backward index scan (no temp B-tree sort at 100k notes; verified
-- by an EXPLAIN QUERY PLAN test). Backward scan yields the DESC order.
CREATE INDEX IF NOT EXISTS idx_notes_view
    ON notes_meta(trashed, archived, pinned, updated_at, id);
CREATE INDEX IF NOT EXISTS idx_notes_notebook ON notes_meta(notebook_id,trashed,archived,pinned,updated_at,id);
CREATE INDEX IF NOT EXISTS idx_notes_favorite ON notes_meta(trashed,archived,favorite,pinned,updated_at,id);
CREATE INDEX IF NOT EXISTS idx_notes_trash ON notes_meta(trashed,pinned,updated_at,id);
CREATE INDEX IF NOT EXISTS idx_notes_title ON notes_meta(title);
-- Ascending date sorts negate pinned for ordering; page seeks fix this cohort.
CREATE INDEX IF NOT EXISTS idx_notes_created ON notes_meta(trashed,archived,pinned DESC,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_notes_created_asc ON notes_meta(trashed,archived,(-pinned),created_at,id);
CREATE INDEX IF NOT EXISTS idx_notes_edited_asc ON notes_meta(trashed,archived,(-pinned),updated_at,id);

-- Durable index work queue (main DB only, so a save + its job commit
-- atomically). One row per note; re-saving coalesces by bumping `version`.
CREATE TABLE IF NOT EXISTS index_jobs (
    note_id     TEXT PRIMARY KEY,
    version     INTEGER NOT NULL,
    enqueued_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_enqueued ON index_jobs(enqueued_at);

-- Open-tab workspace state: LOCAL convenience data only. Deliberately kept
-- out of export/import (logical backups carry notes + notebooks, never this
-- table) and out of sync — a fresh device starts with an empty workspace.
-- Exactly ONE row (slot = 0); workspace_set upserts ids+active atomically
-- after full validation, so a rejected request preserves the previous row.
-- Stored ids are NOT foreign keys: tabs may reference notes being created,
-- and workspace_get re-checks liveness against notes_meta (titles only).
CREATE TABLE IF NOT EXISTS split_layout (slot INTEGER PRIMARY KEY CHECK(slot=0), note_id TEXT, mode TEXT NOT NULL, state TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS editor_history (
    note_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    revision INTEGER NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY(note_id, kind),
    FOREIGN KEY(note_id) REFERENCES notes_meta(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS workspace_state (
    slot   INTEGER PRIMARY KEY CHECK (slot = 0),
    ids    TEXT NOT NULL DEFAULT '[]',  -- JSON array of note ids, in tab order
    locations TEXT NOT NULL DEFAULT '{}', -- local editor positions, no bodies
    active TEXT                          -- active tab id or NULL
);

-- Crash draft journal (LOCAL only: excluded from export/import and sync).
-- The last unsaved editor snapshot per note and editor slot, written by draft_journal_put
-- and acknowledged away by draft_journal_clear with the put's token. A late
-- save ack carries the OLD token, so it can never clear a newer draft.
-- NO foreign key to notes_meta: deleting/trashing the original must preserve
-- the crash copy; recovery at Engine::open resolves the notebook then and
-- always creates a separate note instead of touching the original.
--   complete rows: content = whole body.
--   partial rows:  baseline = exact stored revision text kept on the first
--                  put (reused on re-put so history expiry/deletion cannot
--                  break recovery); edits = sequential UTF-8 byte splices
--                  validated against that baseline at put time.
CREATE TABLE IF NOT EXISTS draft_journal (
    id             TEXT NOT NULL,
    editor         TEXT NOT NULL DEFAULT 'main',
    token          TEXT NOT NULL,
    title          TEXT NOT NULL DEFAULT '',
    notebook_id    TEXT,
    tags           TEXT NOT NULL DEFAULT '[]',
    content_format TEXT NOT NULL,
    body_kind      TEXT NOT NULL CHECK(body_kind IN ('complete','partial')),
    revision       INTEGER NOT NULL,
    baseline       TEXT,
    edits          TEXT,
    content        TEXT,
    updated_at     INTEGER NOT NULL,
    byte_count     INTEGER NOT NULL,
    PRIMARY KEY(id, editor)
);
"#;

pub const SEARCH_SCHEMA_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS document_layout (
    note_id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL,
    block_count INTEGER NOT NULL,
    byte_count INTEGER NOT NULL,
    content_hash BLOB
);
CREATE TABLE IF NOT EXISTS document_blocks (
    note_id TEXT NOT NULL REFERENCES document_layout(note_id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL,
    byte_offset INTEGER NOT NULL,
    html TEXT NOT NULL,
    search_text TEXT NOT NULL,
    search_folded TEXT NOT NULL,
    PRIMARY KEY(note_id,ordinal)
);

-- Only oversized blocks need an internal layout. Positions address the original
-- cached block; virtual ancestor tags are metadata, never canonical content.
CREATE TABLE IF NOT EXISTS document_segment_index (
    note_id TEXT PRIMARY KEY REFERENCES document_layout(note_id) ON DELETE CASCADE,
    content_hash BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS document_segment_layout (
    note_id TEXT NOT NULL,
    block_ordinal INTEGER NOT NULL,
    content_hash BLOB NOT NULL,
    segment_count INTEGER NOT NULL,
    supported INTEGER NOT NULL,
    PRIMARY KEY(note_id,block_ordinal),
    FOREIGN KEY(note_id,block_ordinal) REFERENCES document_blocks(note_id,ordinal)
        ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS document_segments (
    note_id TEXT NOT NULL,
    block_ordinal INTEGER NOT NULL,
    ordinal INTEGER NOT NULL,
    byte_offset INTEGER NOT NULL,
    byte_count INTEGER NOT NULL,
    start_context TEXT NOT NULL,
    end_context TEXT NOT NULL,
    PRIMARY KEY(note_id,block_ordinal,ordinal),
    FOREIGN KEY(note_id,block_ordinal) REFERENCES document_segment_layout(note_id,block_ordinal)
        ON DELETE CASCADE ON UPDATE CASCADE
);
-- Optional lookup indexes; the v7 cached source/context format is unchanged.
CREATE INDEX IF NOT EXISTS idx_document_block_position ON document_blocks(note_id,byte_offset);
CREATE INDEX IF NOT EXISTS idx_document_segment_position ON document_segments(note_id,block_ordinal,byte_offset);

-- FTS5 trigram: substring search (Korean included) for queries >= 3 chars.
-- rowid == notes_meta.seq. No UNINDEXED id column: deletes are by rowid.
CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    title,
    text,
    tokenize = 'trigram'
);

-- Maps note ids to their FTS rowid so the worker can delete index rows for
-- notes that no longer exist in the main DB.
CREATE TABLE IF NOT EXISTS fts_map (
    note_id TEXT PRIMARY KEY,
    fts_rowid INTEGER NOT NULL UNIQUE,
    index_hash BLOB
);

-- Backlinks built from [[Title]] / note://ID in the same worker pass.
CREATE TABLE IF NOT EXISTS backlinks (
    target_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    PRIMARY KEY (target_id, source_id)
);
CREATE INDEX IF NOT EXISTS idx_backlinks_source ON backlinks(source_id);
CREATE TABLE IF NOT EXISTS reference_previews (source_id TEXT NOT NULL,anchor TEXT NOT NULL,kind TEXT NOT NULL,byte_offset INTEGER NOT NULL,source TEXT NOT NULL,label TEXT NOT NULL,truncated INTEGER NOT NULL,PRIMARY KEY(source_id,anchor,kind));
CREATE TABLE IF NOT EXISTS connection_text (source_id TEXT PRIMARY KEY, folded TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outgoing_references (
 source_id TEXT NOT NULL, ordinal INTEGER NOT NULL, reference TEXT NOT NULL, label TEXT NOT NULL, embed INTEGER NOT NULL,
 PRIMARY KEY(source_id,ordinal)
);
CREATE TABLE IF NOT EXISTS backlink_locations (
 source_id TEXT NOT NULL, target TEXT NOT NULL, byte_offset INTEGER NOT NULL, byte_end INTEGER NOT NULL, label TEXT NOT NULL,
 PRIMARY KEY(source_id,byte_offset)
);
CREATE INDEX IF NOT EXISTS idx_backlink_locations_target ON backlink_locations(source_id,target);
CREATE TABLE IF NOT EXISTS backlink_titles (
    target_title TEXT NOT NULL,
    source_id TEXT NOT NULL,
    PRIMARY KEY(target_title,source_id)
);
CREATE INDEX IF NOT EXISTS idx_backlink_titles_source ON backlink_titles(source_id);
"#;

/// Open one connection with the pragmas both paths need.
/// Worker connections use a low busy_timeout on the MAIN file so a slow
/// foreground save never waits behind the worker's short bookkeeping writes.
/// The SEARCH file is only written by the worker; its busy timeout can stay
/// moderate because nothing else writes it.
pub fn open_connection(path: &str, role: Role) -> Result<Connection> {
    open_connection_with_key(path, role, None)
}

pub(crate) fn open_connection_with_key(
    path: &str,
    role: Role,
    key: Option<&crate::storage::StorageKey>,
) -> Result<Connection> {
    let conn = crate::storage::open(std::path::Path::new(path), key)?;
    let (busy_ms, cache) = match role {
        Role::Foreground => (5_000, -8_000), // ~8 MiB page cache
        Role::WorkerMain => (300, -2_000),
        Role::WorkerSearch => (3_000, -8_000),
    };
    conn.busy_timeout(std::time::Duration::from_millis(busy_ms))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    conn.pragma_update(None, "cache_size", cache)?;
    Ok(conn)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Foreground,
    WorkerMain,
    WorkerSearch,
}

pub fn init_main(conn: &Connection) -> Result<()> {
    let version = main_user_version(conn)?;
    if version > MAIN_USER_VERSION {
        return Err(crate::error::EngineError::invalid(
            "database was created by a newer Inkism version",
        ));
    }
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let r = (|| -> rusqlite::Result<()> {
        conn.execute_batch(MAIN_SCHEMA_SQL)?;
        if version < 12 {
            conn.execute_batch("INSERT OR IGNORE INTO note_notebooks(note_id,notebook_id)
                SELECT id,notebook_id FROM notes_meta WHERE notebook_id IS NOT NULL;")?;
        }
        add_missing_column(
            conn,
            "draft_journal",
            "notebook_ids",
            "ALTER TABLE draft_journal ADD COLUMN notebook_ids TEXT;",
        )?;
        // v2 -> v3 migration: notes created before reminders have no column.
        // ALTER TABLE keeps every existing row; the column reads back NULL.
        add_missing_column(
            conn,
            "notes_meta",
            "reminder_at",
            "ALTER TABLE notes_meta ADD COLUMN reminder_at INTEGER;",
        )?;
        // The partial due-reminder index is created HERE, not in
        // MAIN_SCHEMA_SQL, so it exists only after the column does on both
        // fresh and upgraded databases. `WHERE NOT NULL` keeps it to the few
        // scheduled rows so due lookups are a range scan (see due_reminders).
        add_missing_column(
            conn,
            "notes_meta",
            "reminder_repeat_hours",
            "ALTER TABLE notes_meta ADD COLUMN reminder_repeat_hours INTEGER;",
        )?;
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_notes_reminder \
             ON notes_meta(trashed, reminder_at, id) WHERE reminder_at IS NOT NULL;",
        )?;
        add_missing_column(
            conn,
            "split_layout",
            "state",
            "ALTER TABLE split_layout ADD COLUMN state TEXT NOT NULL DEFAULT '{}';",
        )?;
        add_missing_column(
            conn,
            "workspace_state",
            "locations",
            "ALTER TABLE workspace_state ADD COLUMN locations TEXT NOT NULL DEFAULT '{}';",
        )?;
        add_missing_column(
            conn,
            "history",
            "note_revision",
            "ALTER TABLE history ADD COLUMN note_revision INTEGER;",
        )?;
        add_missing_column(conn,"history","label","ALTER TABLE history ADD COLUMN label TEXT;")?;
        for table in ["notes_meta", "history"] {
            let present: i64 = conn.query_row(
                &format!(
                    "SELECT count(*) FROM pragma_table_info('{table}') WHERE name='content_format'"
                ),
                [],
                |r| r.get(0),
            )?;
            if present == 0 {
                conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN content_format TEXT NOT NULL DEFAULT 'html' CHECK(content_format IN ('html','text','markdown'));"))?;
            }
        }
        add_missing_column(
            conn,
            "notes_meta",
            "readonly",
            "ALTER TABLE notes_meta ADD COLUMN readonly INTEGER NOT NULL DEFAULT 0 CHECK(readonly IN (0,1));",
        )?;
        add_missing_column(
            conn,
            "notes_meta",
            "edited_at",
            "ALTER TABLE notes_meta ADD COLUMN edited_at INTEGER NOT NULL DEFAULT 0; UPDATE notes_meta SET edited_at=updated_at;",
        )?;
        // After migration: old schemas do not have this column during MAIN_SCHEMA_SQL.
        conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_notes_content_edited ON notes_meta(trashed,archived,pinned DESC,edited_at DESC,id DESC);
            CREATE INDEX IF NOT EXISTS idx_notes_content_edited_asc ON notes_meta(trashed,archived,(-pinned),edited_at,id);")?;
        // Generated columns are listed by table_xinfo, not table_info.
        let has_title_order: i64 = conn.query_row(
            "SELECT count(*) FROM pragma_table_xinfo('notes_meta') WHERE name='title_order'",
            [], |row| row.get(0),
        )?;
        if has_title_order == 0 {
            conn.execute_batch("ALTER TABLE notes_meta ADD COLUMN title_order TEXT COLLATE NOCASE GENERATED ALWAYS AS (ltrim(title,' '||char(160,13,10,9,11))) VIRTUAL;")?;
        }
        conn.execute_batch("CREATE INDEX IF NOT EXISTS idx_notes_title_order ON notes_meta(trashed,archived,pinned DESC,title_order DESC,id DESC);
            CREATE INDEX IF NOT EXISTS idx_notes_title_order_asc ON notes_meta(trashed,archived,(-pinned),title_order,id);")?;
        // v10: notebook hierarchy metadata. `parent_id` has NO foreign key by
        // design (a remote child can arrive before its parent); existing rows
        // keep every column and read back NULL / ''. The index is created
        // after the ALTERs so it covers the columns on fresh and upgraded
        // databases alike.
        add_missing_column(
            conn,
            "notebooks",
            "parent_id",
            "ALTER TABLE notebooks ADD COLUMN parent_id TEXT;",
        )?;
        add_missing_column(
            conn,
            "notebooks",
            "description",
            "ALTER TABLE notebooks ADD COLUMN description TEXT NOT NULL DEFAULT '';",
        )?;
        conn.execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_notebooks_parent ON notebooks(parent_id,id);",
        )?;
        add_missing_column(
            conn,
            "notes_meta",
            "locked",
            "ALTER TABLE notes_meta ADD COLUMN locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1));",
        )?;
        // v13: notebook trash. Existing rows read back live (NULL).
        add_missing_column(
            conn,
            "notebooks",
            "deleted_at",
            "ALTER TABLE notebooks ADD COLUMN deleted_at INTEGER;
                ALTER TABLE notebooks ADD COLUMN deleted_by TEXT CHECK(deleted_by IN ('user','app'));",
        )?;
        // v15: notebook cover photo. Existing rows read back NULL (no cover).
        add_missing_column(
            conn,
            "notebooks",
            "cover",
            "ALTER TABLE notebooks ADD COLUMN cover TEXT;",
        )?;
        conn.pragma_update(None, "user_version", MAIN_USER_VERSION)
    })();
    finish_tx(conn, r)
}

/// Runs `ddl` when `table` lacks `column` (in-place schema upgrade).
fn add_missing_column(
    conn: &Connection,
    table: &str,
    column: &str,
    ddl: &str,
) -> rusqlite::Result<()> {
    let present: i64 = conn.query_row(
        "SELECT count(*) FROM pragma_table_info(?1) WHERE name=?2",
        [table, column],
        |r| r.get(0),
    )?;
    if present == 0 {
        conn.execute_batch(ddl)?;
    }
    Ok(())
}

pub fn init_search(conn: &Connection) -> Result<()> {
    let version = search_user_version(conn)?;
    if version > SEARCH_USER_VERSION {
        return Err(crate::error::EngineError::invalid(
            "search index version is newer than this app",
        ));
    }
    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let r = (|| -> rusqlite::Result<()> {
        if version < 4 {
            // These are disposable caches, not canonical bodies. Invalidate
            // together so old rows cannot claim readiness with missing offsets.
            conn.execute_batch(
                "DROP TABLE IF EXISTS document_blocks; DROP TABLE IF EXISTS document_layout;",
            )?;
        }
        conn.execute_batch(SEARCH_SCHEMA_SQL)?;
        let has_hash: i64 = conn.query_row(
            "SELECT count(*) FROM pragma_table_info('document_layout') WHERE name='content_hash'",
            [],
            |r| r.get(0),
        )?;
        if has_hash == 0 {
            conn.execute_batch("ALTER TABLE document_layout ADD COLUMN content_hash BLOB;")?;
        }
        let has_hash: i64 = conn.query_row(
            "SELECT count(*) FROM pragma_table_info('fts_map') WHERE name='index_hash'",
            [],
            |r| r.get(0),
        )?;
        if has_hash == 0 {
            conn.execute_batch("ALTER TABLE fts_map ADD COLUMN index_hash BLOB;")?;
        }
        if version < 8 {
            // Existing v7 spans are reusable; reschedule smaller 64KiB blocks.
            conn.execute_batch("DELETE FROM document_segment_index;")?;
        }
        if version < 9 {
            // Rebuild old unsupported task layouts; canonical notes and the
            // existing top-level/FTS caches stay intact.
            conn.execute_batch(
                "DELETE FROM document_segment_index; DELETE FROM document_segment_layout;",
            )?;
        }
        if version < 12 {
            // Rebuild link targets and Markdown byte locations after derived-schema upgrade.
            conn.execute_batch("UPDATE fts_map SET index_hash=NULL;")?;
        }
        if version < 13 {
            // Segment contexts gained opening-tag offsets (`at`); rebuild the
            // derived layouts so internal edits can identify their blocks.
            conn.execute_batch(
                "DELETE FROM document_segment_index; DELETE FROM document_segment_layout;",
            )?;
        }
        conn.pragma_update(None, "user_version", SEARCH_USER_VERSION)
    })();
    finish_tx(conn, r)
}

pub fn main_user_version(conn: &Connection) -> Result<i32> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
}

pub fn search_user_version(conn: &Connection) -> Result<i32> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get(0))?)
}

fn finish_tx(conn: &Connection, r: rusqlite::Result<()>) -> Result<()> {
    match r {
        Ok(()) => {
            conn.execute_batch("COMMIT;")?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(e.into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_notebooks_upgrade_without_losing_metadata() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE notebooks(id TEXT PRIMARY KEY,name TEXT NOT NULL,color TEXT);
            INSERT INTO notebooks VALUES('old','Previous','#123456');
            PRAGMA user_version=9;",
        )
        .unwrap();
        init_main(&c).unwrap();
        init_main(&c).unwrap();
        let row: (String, Option<String>, Option<String>, String) = c
            .query_row(
                "SELECT name,color,parent_id,description FROM notebooks WHERE id='old'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            row,
            (
                "Previous".into(),
                Some("#123456".into()),
                None,
                String::new()
            )
        );
        assert_eq!(main_user_version(&c).unwrap(), MAIN_USER_VERSION);
        let index: i64 = c
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type='index' AND name='idx_notebooks_parent'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(index, 1);
        let cover: Option<String> = c
            .query_row("SELECT cover FROM notebooks WHERE id='old'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cover, None);
    }

    #[test]
    fn creates_twice_ok() {
        let dir = std::env::temp_dir().join(format!("ne-schema-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("t.db");
        let _ = std::fs::remove_file(&p);
        let c = open_connection(p.to_str().unwrap(), Role::Foreground).unwrap();
        init_main(&c).unwrap();
        init_main(&c).unwrap();
        assert_eq!(main_user_version(&c).unwrap(), MAIN_USER_VERSION);
        let s = open_connection(
            format!("{}.search", p.to_str().unwrap()).as_str(),
            Role::WorkerSearch,
        )
        .unwrap();
        init_search(&s).unwrap();
        init_search(&s).unwrap();
        assert_eq!(search_user_version(&s).unwrap(), SEARCH_USER_VERSION);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
