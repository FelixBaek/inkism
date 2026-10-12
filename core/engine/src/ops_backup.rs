//! Export/import. Export streams notes one by one (bodies fetched per note in
//! batches — a 100k-note library is never fully materialized in memory) to a
//! temp file that is fsynced and atomically renamed over the target path.
//! Import validates the whole file first, then applies it in ONE transaction;
//! any error rolls back everything. Imported notes always get fresh IDs, so
//! an import can never overwrite existing notes.
//!
//! Multi-notebook membership: every exported note carries a `notebook_ids`
//! array (primary notebook first, [] = no memberships). The backup version
//! stays 2 — old apps that do not know the field simply ignore this unknown
//! JSON key, so v2 backups remain readable in both directions. Backups from
//! before multi-notebook support omit the field per note and keep the
//! single-`notebook_id` behavior on import.
//!
//! Optional top-level `default_notebook` `{notebook_id, updated_at}` (a backup
//! notebook) and `default_tag` `{tag, updated_at}`. Import applies each only
//! when this library has no live default, merged by decision time
//! (see `settings::merge`).

use crate::error::{EngineError, Result};
use crate::ids;
use crate::indexer;
use crate::model;
use crate::ops_notes;
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::io::Write;

const EXPORT_VERSION: i64 = 2;

pub fn export(conn: &Connection, args: &Value) -> Result<Value> {
    let path = args
        .get("path")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| EngineError::invalid("export requires path"))?;

    let optional_limit = |name: &str| -> Result<Option<u64>> {
        match args.get(name) { None => Ok(None), Some(value) => value.as_u64().filter(|v|*v>0).map(Some).ok_or_else(||EngineError::invalid(format!("invalid {name}"))) }
    };
    let max_bytes = optional_limit("max_bytes")?;
    if let Some(max_notes) = optional_limit("max_notes")? {
        let count:i64=conn.query_row("SELECT count(*) FROM notes_meta",[],|r|r.get(0))?;
        if count as u64 > max_notes { return Err(EngineError::invalid("export note limit exceeded")); }
    }
    let tmp_path = format!("{}.notes-tmp-{}", path, ids::new_id());
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(&tmp_path)?;
    let result = (|| -> Result<Value> {
        let count = write_export(conn, &file, path, max_bytes)?;
        file.sync_all()?;
        // Close before rename for Windows. On failure the outer cleanup
        // removes only our unique temp file and preserves the prior backup.
        drop(file);
        std::fs::rename(&tmp_path, path)?;
        Ok(json!({ "path": path, "notes": count }))
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp_path);
    }
    result
}

struct ExportWriter { file: std::fs::File, written: u64, limit: u64 }
impl Write for ExportWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() as u64 > self.limit.saturating_sub(self.written) { return Err(std::io::Error::other("export byte limit exceeded")); }
        let size=self.file.write(bytes)?;self.written+=size as u64;Ok(size)
    }
    fn flush(&mut self)->std::io::Result<()> {self.file.flush()}
}

fn write_export(conn: &Connection, file: &std::fs::File, path: &str, max_bytes: Option<u64>) -> Result<usize> {
    if std::path::Path::new(path).is_dir() {
        return Err(EngineError::invalid("export path is a directory"));
    }
    // The notebook list is fetched once, up front: every membership a note
    // exports must point at a notebook inside this same backup. A dangling
    // reference fails here — before the final rename — so an existing backup
    // at `path` is preserved untouched and only our temp file is removed.
    // Trashed notebooks are included so memberships and restore survive.
    let notebooks = crate::ops_meta::all_notebooks(conn)?;
    validate_notebooks(notebooks.as_array().expect("notebook list"))?;
    let known_notebooks: std::collections::HashSet<&str> = notebooks
        .as_array()
        .expect("notebook list")
        .iter()
        .filter_map(|nb| nb.get("id").and_then(Value::as_str))
        .collect();
    use crate::settings::{stored, DEFAULT_NOTEBOOK, DEFAULT_TAG};
    let default_notebook = crate::settings::default_notebook(conn)?
        .filter(|id| known_notebooks.contains(id.as_str()))
        .zip(stored(conn, DEFAULT_NOTEBOOK)?)
        .map(|(id, (_, at))| json!({ "notebook_id": id, "updated_at": at }));
    let default_tag = stored(conn, DEFAULT_TAG)?
        .and_then(|(tag, at)| tag.map(|tag| json!({ "tag": tag, "updated_at": at })));
    // Locked notes are useless without their wrapped keys.
    let vault_keys: Vec<Value> = crate::settings::vault_keys(conn)?
        .into_iter()
        .map(|(key_id, envelope, at)| json!({ "key_id": key_id, "envelope": envelope, "updated_at": at }))
        .collect();
    let mut w = std::io::BufWriter::new(ExportWriter { file: file.try_clone()?, written: 0, limit: max_bytes.unwrap_or(u64::MAX) });
    w.write_all(b"{\"version\":2,\"exported_at\":")?;
    w.write_all(ids::now_ms().to_string().as_bytes())?;
    w.write_all(b",\"notes\":[")?;

    // Stream metadata rows; bodies are fetched per note (two prepared
    // statements on the same connection are fine for read-read use).
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM notes_meta", [], |r| r.get(0))?;
    let mut meta_stmt = conn.prepare(
        "SELECT id, title, notebook_id, tags, favorite, pinned, archived, trashed, color,
                reminder_at, created_at, updated_at, revision, content_format, reminder_repeat_hours, readonly, edited_at
         FROM notes_meta ORDER BY created_at, id",
    )?;
    let mut body_stmt = conn.prepare("SELECT content, text FROM notes_body WHERE note_id = ?1")?;
    let mut rows = meta_stmt.query([])?;
    let mut written = 0usize;
    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        let title: String = row.get(1)?;
        let notebook_id: Option<String> = row.get(2)?;
        let tags: String = row.get(3)?;
        let (content, text): (String, String) =
            body_stmt.query_row(params![id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        // Full membership list (primary first). note_notebooks has no notebook
        // FK, so a dangling membership would otherwise dangle in the backup;
        // refuse to export such a note at all.
        let notebook_ids = crate::notebook_membership::load(conn, &id)?;
        check_known_notebooks(&id, notebook_id.iter().chain(&notebook_ids), &known_notebooks)?;
        let note = json!({
            "id": id,
            "title": title,
            "content": content,
            "text": text,
            "notebook_id": notebook_id,
            "notebook_ids": notebook_ids,
            "tags": serde_json::from_str::<Value>(&tags).unwrap_or(Value::Array(vec![])),
            "favorite": row.get::<_, i64>(4)? != 0,
            "pinned": row.get::<_, i64>(5)? != 0,
            "readonly": row.get::<_, i64>(15)? != 0,
            "archived": row.get::<_, i64>(6)? != 0,
            "trashed": row.get::<_, i64>(7)? != 0,
            "color": row.get::<_, Option<String>>(8)?,
            "reminder_at": row.get::<_, Option<i64>>(9)?,
            "created_at": row.get::<_, i64>(10)?,
            "updated_at": row.get::<_, i64>(11)?,
            "edited_at": row.get::<_, i64>(16)?,
            "revision": row.get::<_, i64>(12)?, "content_format":row.get::<_,String>(13)?, "reminder_repeat_hours":row.get::<_,Option<i64>>(14)?,
        });
        let mut note = note;
        note["knowledge"] = crate::knowledge::backup_note(conn, &id)?;
        note["named_versions"] = crate::named_versions::backup(conn, &id)?;
        note["encrypted_named_versions"] = crate::encrypted_versions::rows(conn,&id)?;
        if let Some(body) = crate::vault::locked_body(conn, &id)? {
            note["locked"] = json!(true);
            note["locked_body"] = serde_json::to_value(body)?;
        }
        if written > 0 {
            w.write_all(b",")?;
        }
        serde_json::to_writer(&mut w, &note)?;
        written += 1;
    }
    drop(rows);
    drop(meta_stmt);
    drop(body_stmt);
    w.write_all(b"],\"notebooks\":")?;
    serde_json::to_writer(&mut w, &notebooks)?;
    if !vault_keys.is_empty() {
        w.write_all(b",\"vault_keys\":")?;
        serde_json::to_writer(&mut w, &vault_keys)?;
    }
    for (field, setting) in [("default_notebook", default_notebook), ("default_tag", default_tag)] {
        if let Some(setting) = setting {
            write!(w, ",\"{field}\":")?;
            serde_json::to_writer(&mut w, &setting)?;
        }
    }
    w.write_all(b",\"merge_redirects\":")?;
    serde_json::to_writer(&mut w, &crate::redirect_backup::export(conn)?)?;
    w.write_all(b",\"workspace_tools\":")?;
    serde_json::to_writer(&mut w, &crate::workspace_tools::backup(conn)?)?;
    w.write_all(b",\"font_resources\":")?;
    serde_json::to_writer(&mut w, &crate::resources::list(conn)?["items"])?;
    if crate::settings::stored(conn, crate::knowledge::CONFIG_KEY)?.is_some() {
        w.write_all(b",\"knowledge_settings\":")?;
        serde_json::to_writer(&mut w, &crate::knowledge::backup_config(conn)?)?;
    }
    w.write_all(b"}")?;
    w.flush()?;
    debug_assert_eq!(written as i64, count);
    Ok(written)
}

/// Every notebook a note references must be part of the same backup.
fn check_known_notebooks<'a>(
    id: &str,
    references: impl IntoIterator<Item = &'a String>,
    known_notebooks: &std::collections::HashSet<&str>,
) -> Result<()> {
    for notebook in references {
        if !known_notebooks.contains(notebook.as_str()) {
            return Err(EngineError::invalid(format!(
                "note {id} references missing notebook {notebook}"
            )));
        }
    }
    Ok(())
}

/// Validate a host-staged backup without mutating notes. Import validates again.
pub fn validate_import(args: &Value) -> Result<Value> {
    let path = args
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| EngineError::invalid("validate_import requires path"))?;
    let file = std::fs::File::open(path)?;
    let data: Value = serde_json::from_reader(std::io::BufReader::new(file))?;
    let (notes, _, _) = validate_backup(&data)?;
    Ok(json!({ "notes": notes.len() }))
}

/// Import: parse and validate everything BEFORE touching the database, then
/// one transaction for all writes. Fresh IDs everywhere; notebook references
/// are remapped. Old-style notes (no `notebook_ids`) keep the historical
/// behavior: a dangling notebook id becomes null. New-style notes carry the
/// full membership list and must reference backup notebooks (rejected
/// otherwise). The returned count is the number of notes imported.
pub fn import(conn: &Connection, args: &Value) -> Result<Value> {
    let path = args
        .get("path")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| EngineError::invalid("import requires path"))?;
    let file = std::fs::File::open(path)
        .map_err(|e| EngineError::invalid(format!("cannot open import file: {e}")))?;
    let data: Value = serde_json::from_reader(std::io::BufReader::new(file))
        .map_err(|e| EngineError::invalid(format!("bad backup JSON: {e}")))?;
    let (notes, notebooks, defaults) = validate_backup(&data)?;
    // Allocate all IDs first so forward references and cycles survive import.
    let note_ids: std::collections::HashMap<&str, String> = notes
        .iter()
        .map(|n| (n["id"].as_str().expect("validated note id"), ids::new_id()))
        .collect();

    conn.execute_batch("BEGIN IMMEDIATE;")?;
    let result = (|| -> Result<Value> {
        // notebooks first (fresh ids, remap old->new)
        let nb_map: std::collections::HashMap<&str, String> = notebooks
            .iter()
            .map(|nb| {
                (
                    nb["id"].as_str().expect("validated notebook id"),
                    ids::new_id(),
                )
            })
            .collect();
        import_notebooks(conn, &notebooks, &nb_map)?;

        let now = ids::now_ms();
        let mut imported = 0i64;
        for n in &notes {
            import_note(conn, n, &note_ids, &nb_map, now)?;
            imported += 1;
        }
        import_defaults(conn, &defaults, &nb_map)?;
        if let Some(redirects) = data.get("merge_redirects") { crate::redirect_backup::import(conn,redirects,&note_ids)?; }
        if let Some(workspace) = data.get("workspace_tools") { crate::workspace_tools::import(conn,workspace,&note_ids)?; }
        if let Some(fonts) = data.get("font_resources") { crate::resources::import(conn,fonts)?; }
        if let Some(config) = data.get("knowledge_settings") { crate::knowledge::import_config(conn, config, &note_ids)?; }
        Ok(json!({ "imported": imported }))
    })();
    match result {
        Ok(v) => {
            conn.execute_batch("COMMIT;")?;
            Ok(v)
        }
        Err(e) => {
            // Anything already written in this transaction is rolled back.
            let _ = conn.execute_batch("ROLLBACK;");
            Err(e)
        }
    }
}

type IdMap<'a> = std::collections::HashMap<&'a str, String>;

fn import_notebooks(conn: &Connection, notebooks: &[Value], nb_map: &IdMap) -> Result<()> {
    for nb in notebooks {
        let old = nb["id"].as_str().expect("validated notebook id");
        let new = &nb_map[old];
        let parent = nb
            .get("parent_id")
            .and_then(Value::as_str)
            .map(|parent| &nb_map[parent]);
        let (deleted_at, deleted_by) = crate::notebook_trash::parse_state(nb, (None, None))?;
        conn.execute(
            "INSERT INTO notebooks(id,name,color,parent_id,description,deleted_at,deleted_by,cover) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                new,
                nb.get("name").and_then(Value::as_str).unwrap_or(""),
                nb.get("color").and_then(Value::as_str),
                parent,
                nb.get("description").and_then(Value::as_str).unwrap_or(""),
                deleted_at,
                deleted_by,
                crate::notebook_cover::arg(nb)?.flatten()
            ],
        )?;
    }
    Ok(())
}

/// Inserts one validated backup note under its freshly allocated id.
fn import_note(
    conn: &Connection,
    n: &Value,
    note_ids: &IdMap,
    nb_map: &IdMap,
    now: i64,
) -> Result<()> {
    let content_format = crate::source_format::from_value(n.get("content_format"))?;
    let new_id = &note_ids[n["id"].as_str().expect("validated note id")];
    let title = n.get("title").and_then(Value::as_str).unwrap_or("");
    let content = crate::links::remap_note_urls(
        n.get("content").and_then(Value::as_str).unwrap_or(""),
        note_ids,
    );
    let text = crate::links::remap_note_urls(
        n.get("text").and_then(Value::as_str).unwrap_or(""),
        note_ids,
    );
    let tags = match n.get("tags") {
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect::<Vec<_>>(),
        _ => vec![],
    };
    ops_notes::check_field_size("content", &content)?;
    ops_notes::check_field_size("text", &text)?;
    ops_notes::check_tags(&tags)?;
    if title.chars().count() > limits_title() {
        return Err(EngineError::invalid("imported title too long"));
    }
    let notebook_id: Option<String> = match n.get("notebook_id") {
        Some(Value::String(old)) => nb_map.get(old.as_str()).cloned(),
        _ => None,
    };
    // Reminders survive import; backups from before v3 have no field
    // and import with none set (see backup_reminder_at).
    let reminder_at = backup_reminder_at(n)?;
    let repeat = backup_reminder_repeat(n)?;
    let created_at = model::opt_timestamp(n, "created_at")?.unwrap_or(now);
    let updated_at = model::opt_timestamp(n, "updated_at")?.unwrap_or(now);
    let edited_at = model::opt_timestamp(n, "edited_at")?.unwrap_or(updated_at);
    let preview = model::preview_of(&text, title);
    conn.execute(
        "INSERT INTO notes_meta(id, seq, title, preview, notebook_id, tags, favorite,
             pinned, archived, trashed, color, reminder_at, created_at, updated_at, edited_at, revision)
         VALUES(?1, NULL,
                ?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,1)",
        params![
            new_id,
            title,
            preview,
            notebook_id,
            serde_json::to_string(&tags).unwrap(),
            flag(n, "favorite"),
            flag(n, "pinned"),
            flag(n, "archived"),
            flag(n, "trashed"),
            n.get("color").and_then(Value::as_str),
            reminder_at,
            created_at,
            updated_at,
            edited_at,
        ],
    )?;
    conn.execute(
        "UPDATE notes_meta SET reminder_repeat_hours=?1,readonly=?3 WHERE id=?2",
        params![repeat, new_id, model::opt_bool(n, "readonly")?.unwrap_or(false)],
    )?;
    conn.execute(
        "INSERT INTO notes_body(note_id, content, text) VALUES(?1,?2,?3)",
        params![new_id, content.as_ref(), text.as_ref()],
    )?;
    // New-style backups carry the full membership list: remap every
    // entry through nb_map and rewrite memberships exactly (primary
    // column becomes the first entry, [] detaches the note from all
    // notebooks). require_existing is satisfied — the notebooks were
    // inserted earlier in this same transaction. Old backups without
    // the field keep the single-notebook insert-trigger behavior.
    if let Some(memberships) = backup_memberships(n, nb_map) {
        crate::notebook_membership::replace(conn, new_id, &memberships, true)?;
    }
    if let Some(body) = backup_locked_body(n)? {
        crate::vault::store_locked(conn, new_id, &body)?;
    }
    conn.execute(
        "UPDATE notes_meta SET content_format=?1 WHERE id=?2",
        params![content_format, new_id],
    )?;
    if let Some(metadata) = n.get("knowledge") { crate::knowledge::import_note(conn, new_id, metadata, note_ids)?; }
    if let Some(versions)=n.get("named_versions"){crate::named_versions::import(conn,new_id,versions,note_ids)?;}
    if let Some(versions)=n.get("encrypted_named_versions"){crate::encrypted_versions::replace(conn,new_id,versions,true)?;}
    indexer::enqueue(conn, new_id, 1)?;
    Ok(())
}

/// Backup vault keys and defaults; local defaults win when already set.
fn import_defaults(conn: &Connection, defaults: &BackupDefaults, nb_map: &IdMap) -> Result<()> {
    use crate::settings::{merge, DEFAULT_NOTEBOOK, DEFAULT_TAG, VAULT_KEY_PREFIX};
    for (key_id, envelope, at) in &defaults.vault_keys {
        let key = format!("{VAULT_KEY_PREFIX}{key_id}");
        // Imported locked notes need this key even if it was deleted here.
        if crate::settings::stored(conn, &key)?.and_then(|(v, _)| v).is_none() {
            crate::settings::write_local(conn, &key, Some(envelope))?;
        } else {
            merge(conn, &key, Some(envelope), *at)?;
        }
    }
    if let Some((old, at)) = &defaults.notebook {
        if crate::settings::default_notebook(conn)?.is_none() {
            merge(conn, DEFAULT_NOTEBOOK, Some(&nb_map[old.as_str()]), *at)?;
        }
    }
    if let Some((tag, at)) = &defaults.tag {
        if crate::settings::default_tag(conn)?.is_none() {
            merge(conn, DEFAULT_TAG, Some(tag), *at)?;
        }
    }
    Ok(())
}

fn limits_title() -> usize {
    crate::limits::MAX_TITLE_CHARS
}

/// New-style backups carry `notebook_ids` per note; the field's absence (old
/// backups) yields None and keeps the single-notebook behavior. Present —
/// possibly `[]` — every entry is remapped through `nb_map`; whole-file
/// validation already guaranteed it is a duplicate-free string array whose
/// entries all name a backup notebook.
fn backup_memberships(
    n: &Value,
    nb_map: &std::collections::HashMap<&str, String>,
) -> Option<Vec<String>> {
    let entries = n.get("notebook_ids")?;
    Some(
        entries
            .as_array()
            .expect("validated notebook_ids array")
            .iter()
            .map(|entry| nb_map[entry.as_str().expect("validated notebook_ids entry")].clone())
            .collect(),
    )
}

/// Read a backup note's reminder: absent (old backups) or null -> none;
/// otherwise it must be an integer within the canonical millisecond range.
fn backup_reminder_at(n: &Value) -> Result<Option<i64>> {
    match n.get("reminder_at") {
        None | Some(Value::Null) => Ok(None),
        Some(v) => match v.as_i64() {
            Some(ms) => {
                model::check_reminder_at(ms)?;
                Ok(Some(ms))
            }
            None => Err(EngineError::invalid(
                "reminder_at must be an integer or null",
            )),
        },
    }
}

fn flag(n: &Value, key: &str) -> i64 {
    if n.get(key).and_then(Value::as_bool).unwrap_or(false) {
        1
    } else {
        0
    }
}

/// Whole-file validation before any write.
/// Optional backup defaults: `(value, updated_at)` per key.
struct BackupDefaults {
    notebook: Option<(String, i64)>,
    tag: Option<(String, i64)>,
    vault_keys: Vec<(String, String, i64)>,
}

/// Locked note ciphertext from a backup; absent for ordinary notes.
fn backup_locked_body(n: &Value) -> Result<Option<crate::vault::LockedBody>> {
    let Some(raw) = n.get("locked_body") else {
        return Ok(None);
    };
    let body: crate::vault::LockedBody = serde_json::from_value(raw.clone())
        .map_err(|_| EngineError::invalid("bad locked_body in backup"))?;
    crate::vault::validate(&body)?;
    Ok(Some(body))
}

fn backup_vault_keys(data: &Value) -> Result<Vec<(String, String, i64)>> {
    let Some(raw) = data.get("vault_keys") else {
        return Ok(Vec::new());
    };
    let entries = raw.as_array().ok_or_else(|| EngineError::invalid("vault_keys must be an array"))?;
    let mut out = Vec::new();
    for entry in entries {
        let key_id = entry.get("key_id").and_then(Value::as_str).unwrap_or("");
        let envelope = entry.get("envelope").and_then(Value::as_str).unwrap_or("");
        let at = model::opt_timestamp(entry, "updated_at")?
            .ok_or_else(|| EngineError::invalid("vault key requires updated_at"))?;
        let key = format!("{}{key_id}", crate::settings::VAULT_KEY_PREFIX);
        crate::settings::validate(&key, Some(envelope))?;
        out.push((key_id.to_string(), envelope.to_string(), at));
    }
    Ok(out)
}

fn backup_setting(data: &Value, field: &str, value_field: &str) -> Result<Option<(String, i64)>> {
    match data.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(setting) => {
            let value = setting
                .get(value_field)
                .and_then(Value::as_str)
                .ok_or_else(|| EngineError::invalid(format!("{field} requires {value_field}")))?;
            let at = model::opt_timestamp(setting, "updated_at")?
                .ok_or_else(|| EngineError::invalid(format!("{field} requires updated_at")))?;
            Ok(Some((value.to_string(), at)))
        }
    }
}

fn validate_backup(data: &Value) -> Result<(Vec<Value>, Vec<Value>, BackupDefaults)> {
    let version = data.get("version").and_then(Value::as_i64);
    if version != Some(EXPORT_VERSION) && version != Some(1) {
        return Err(EngineError::invalid(format!(
            "unsupported backup version {:?}",
            version
        )));
    }
    let notes = data
        .get("notes")
        .and_then(Value::as_array)
        .ok_or_else(|| EngineError::invalid("backup missing notes array"))?;
    // Notebooks are validated first: per-note membership references below are
    // checked against this list.
    let notebooks = match data.get("notebooks") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(a)) => a.clone(),
        Some(_) => return Err(EngineError::invalid("notebooks must be an array")),
    };
    validate_notebooks(&notebooks)?;
    let known_notebooks: std::collections::HashSet<&str> = notebooks
        .iter()
        .filter_map(|nb| nb.get("id").and_then(Value::as_str))
        .collect();
    let defaults = BackupDefaults {
        notebook: backup_setting(data, "default_notebook", "notebook_id")?,
        tag: backup_setting(data, "default_tag", "tag")?,
        vault_keys: backup_vault_keys(data)?,
    };
    let vault_key_ids:std::collections::HashSet<&str>=defaults.vault_keys.iter().map(|(id,_,_)|id.as_str()).collect();
    for note in notes {
        if let Some(versions)=note.get("encrypted_named_versions") {
            let rows=versions.as_array().filter(|rows|rows.len()<=100).ok_or_else(||EngineError::invalid("invalid encrypted named versions"))?;
            for row in rows {let body:crate::vault::LockedBody=serde_json::from_value(row["locked_body"].clone())?;crate::vault::validate(&body)?;if !vault_key_ids.contains(body.key_id.as_str()){return Err(EngineError::invalid("encrypted version key missing from backup"));}}
        }
    }
    if let Some((id, _)) = &defaults.notebook {
        if !known_notebooks.contains(id.as_str()) {
            return Err(EngineError::invalid("default_notebook references missing notebook"));
        }
    }
    if let Some((tag, _)) = &defaults.tag {
        crate::settings::validate(crate::settings::DEFAULT_TAG, Some(tag))?;
    }
    let mut note_ids = std::collections::HashSet::new();
    for n in notes {
        validate_note(n, &mut note_ids, &known_notebooks)?;
    }
    if let Some(config) = data.get("knowledge_settings") {
        crate::knowledge::validate_config(config)?;
        for id in config["template_ids"].as_array().unwrap().iter().filter_map(Value::as_str).chain(config["daily_template_id"].as_str()) {
            if !note_ids.contains(id) { return Err(EngineError::invalid("knowledge settings reference missing template")); }
        }
    }
    Ok((notes.clone(), notebooks, defaults))
}

/// One backup note entry; records its id in `note_ids` to reject duplicates.
fn validate_note<'a>(
    n: &'a Value,
    note_ids: &mut std::collections::HashSet<&'a str>,
    known_notebooks: &std::collections::HashSet<&str>,
) -> Result<()> {
    crate::source_format::from_value(n.get("content_format"))?;
    if let Some(metadata) = n.get("knowledge") { crate::knowledge::validate_note(metadata)?; }
    if !n.is_object() {
        return Err(EngineError::invalid("note entry is not an object"));
    }
    let id = n
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| EngineError::invalid("note entry missing id"))?;
    if !note_ids.insert(id) {
        return Err(EngineError::invalid("duplicate note id in backup"));
    }
    if let Some(tags) = n.get("tags") {
        if !tags.is_array() {
            return Err(EngineError::invalid("tags must be an array"));
        }
    }
    if let Some(t) = n.get("title") {
        if !t.is_string() {
            return Err(EngineError::invalid("title must be a string"));
        }
    }
    backup_reminder_at(n)?;
    backup_reminder_repeat(n)?;
    backup_locked_body(n)?;
    model::opt_bool(n, "readonly")?;
    for key in ["created_at", "updated_at", "edited_at"] {
        model::opt_timestamp(n, key)?;
    }
    // Full membership typing via the shared parser: array of strings (no
    // null, no duplicates, max 1024, notebook_id must match the first
    // entry). Backup IDs need not be UUIDs; what must hold is that every
    // referenced notebook exists in this same backup.
    if let Some(memberships) = crate::notebook_membership::parse_ids(n)? {
        check_known_notebooks(id, &memberships, known_notebooks)?;
    }
    Ok(())
}

fn validate_notebooks(notebooks: &[Value]) -> Result<()> {
    let mut notebook_ids = std::collections::HashSet::new();
    let mut parents = std::collections::HashMap::new();
    for notebook in notebooks {
        let id = notebook
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty())
            .ok_or_else(|| EngineError::invalid("notebook entry missing id"))?;
        if !notebook_ids.insert(id) {
            return Err(EngineError::invalid("duplicate notebook id in backup"));
        }
        let parent = match notebook.get("parent_id") {
            None | Some(Value::Null) => None,
            Some(Value::String(parent)) if !parent.is_empty() => Some(parent.as_str()),
            _ => return Err(EngineError::invalid("bad notebook parent_id in backup")),
        };
        match notebook.get("description") {
            None | Some(Value::Null) => {}
            Some(Value::String(description)) => {
                ops_notes::check_field_size("notebook description", description)?
            }
            _ => return Err(EngineError::invalid("bad notebook description in backup")),
        }
        // Old backups have no trash state and import live, and no cover.
        crate::notebook_trash::parse_state(notebook, (None, None))?;
        crate::notebook_cover::arg(notebook)?;
        parents.insert(id, parent);
    }
    check_notebook_graph(&parents)
}

/// Validate the complete graph before any IDs/rows are changed. Shared
/// ancestor chains are visited once, including child-before-parent backups.
fn check_notebook_graph(parents: &std::collections::HashMap<&str, Option<&str>>) -> Result<()> {
    let mut settled = std::collections::HashSet::new();
    for id in parents.keys() {
        let mut path = std::collections::HashSet::new();
        let mut cursor = Some(*id);
        while let Some(current) = cursor {
            if settled.contains(current) {
                break;
            }
            if !path.insert(current) {
                return Err(EngineError::invalid("notebook cycle in backup"));
            }
            cursor = *parents
                .get(current)
                .ok_or_else(|| EngineError::invalid("missing parent notebook in backup"))?;
        }
        settled.extend(path);
    }
    Ok(())
}

fn backup_reminder_repeat(n: &Value) -> Result<Option<i64>> {
    let v = model::opt_i64(n, "reminder_repeat_hours")?.flatten();
    if let Some(h) = v {
        model::check_reminder_repeat(h)?;
    }
    Ok(v)
}
