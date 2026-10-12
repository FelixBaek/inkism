//! Manifest preparation and receiving run outside the note engine lock.
use crate::{local_storage::LocalStorage, Result, RuntimeError, StoredConfig};
use inkism_engine::attachments::AttachmentMetadata;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use sync_core::attachment::{
    AttachmentTransport, ChunkContext, SealedChunk, ATTACHMENT_CHUNK_BYTES, MAX_ATTACHMENT_BYTES,
    MAX_SEALED_CHUNK_BYTES,
};
use sync_core::{Entity, EntityKind};

#[derive(Clone, Serialize, Deserialize)]
pub struct Manifest {
    version: u32,
    metadata: AttachmentMetadata,
    chunks: Vec<String>,
}
fn invalid(message: &str) -> RuntimeError {
    RuntimeError::Sync(message.into())
}
fn uuid(id: &str) -> bool {
    uuid::Uuid::parse_str(id).is_ok_and(|v| v.to_string() == id)
}
pub fn references(entity: &Entity) -> Result<BTreeSet<String>> {
    let mut ids = BTreeSet::new();
    // Typed metadata attachments travel with the knowledge setting. Arbitrary
    // text UUIDs are not file references and must not block sync on missing files.
    if entity.kind == EntityKind::Setting && entity.id.starts_with("knowledge_note:") && !entity.deleted {
        if let Some(raw)=entity.data["value"].as_str() {
            let metadata:serde_json::Value=serde_json::from_str(raw)?;
            for property in metadata["properties"].as_array().into_iter().flatten() {
                if property["type"]=="attachment" {if let Some(id)=property["value"].as_str().filter(|s|!s.is_empty()){insert_reference(&mut ids,id)?;}}
            }
        }
        return Ok(ids);
    }
    if entity.kind == EntityKind::Setting && entity.id == "workspace_canvas" && !entity.deleted {
        if let Some(raw)=entity.data["value"].as_str() {
            let canvas:serde_json::Value=serde_json::from_str(raw)?;
            for node in canvas["nodes"].as_array().into_iter().flatten() {
                let reference=match node["kind"].as_str(){Some("file")=>node["attachmentId"].as_str(),Some("group")=>node["background"].as_str().filter(|id|uuid(id)),_=>None};
                if let Some(id)=reference {insert_reference(&mut ids,id)?;}
            }
        }
        return Ok(ids);
    }
    // A locked body is ciphertext; its plaintext list names the files.
    if let Some(list) = entity.data.pointer("/locked_body/attachments").and_then(|v| v.as_array()) {
        if matches!(entity.kind,EntityKind::Note|EntityKind::NamedVersion) && !entity.deleted {
            for item in list {
                let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");
                insert_reference(&mut ids, id)?;
            }
        }
        return Ok(ids);
    }
    // A notebook cover photo can be a local attachment (schema v15).
    if entity.kind == EntityKind::Notebook {
        cover_reference(entity, &mut ids)?;
        return Ok(ids);
    }
    if !matches!(entity.kind,EntityKind::Note|EntityKind::NamedVersion)
        || entity.deleted
        || entity.data.get("content_format").and_then(|v| v.as_str()) == Some("text")
    {
        return Ok(ids);
    }
    for field in ["content", "text"] {
        if let Some(value) = entity.data.get(field).and_then(|v| v.as_str()) {
            body_references(value, &mut ids)?;
        }
    }
    Ok(ids)
}
fn cover_reference(entity: &Entity, ids: &mut BTreeSet<String>) -> Result<()> {
    if entity.deleted
        || entity.data.pointer("/cover/kind").and_then(|v| v.as_str()) != Some("attachment")
    {
        return Ok(());
    }
    let url = entity.data.pointer("/cover/url").and_then(|v| v.as_str()).unwrap_or("");
    match url.strip_prefix("/api/attachments/") {
        Some(id) if uuid(id) => {
            ids.insert(id.to_string());
            Ok(())
        }
        _ => Err(invalid("invalid attachment reference")),
    }
}
fn insert_reference(ids: &mut BTreeSet<String>, id: &str) -> Result<()> {
    if !uuid(id) {
        return Err(invalid("invalid attachment reference"));
    }
    ids.insert(id.to_string());
    Ok(())
}
/// Attachment URLs that start a token in note body text.
fn body_references(value: &str, ids: &mut BTreeSet<String>) -> Result<()> {
    for (at, _) in value.match_indices("/api/attachments/") {
        if at > 0
            && !value[..at]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_whitespace() || matches!(c, '"' | '\'' | '('))
        {
            continue;
        }
        let tail = &value[at + "/api/attachments/".len()..];
        let id = tail
            .split(|c: char| !c.is_ascii_alphanumeric() && c != '-' && c != '_')
            .next()
            .unwrap_or("");
        insert_reference(ids, id)?;
    }
    Ok(())
}
impl Manifest {
    fn validate(&self) -> Result<()> {
        let m = &self.metadata;
        if self.version != 1
            || m.name.is_empty()
            || m.name.chars().count() > 255
            || m.name
                .chars()
                .any(|c| c.is_control() || matches!(c, '/' | '\\'))
            || m.media_type.is_empty()
            || m.media_type.len() > 255
            || m.media_type.chars().any(char::is_control)
            || !uuid(&m.id)
            || m.size > MAX_ATTACHMENT_BYTES
            || self.chunks.len() as u64 != m.size.div_ceil(ATTACHMENT_CHUNK_BYTES as u64)
            || m.sha256.len() != 64
            || !m
                .sha256
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(invalid("invalid attachment manifest"));
        }
        let unique: BTreeSet<_> = self.chunks.iter().collect();
        if unique.len() != self.chunks.len() || self.chunks.iter().any(|id| !uuid(id)) {
            return Err(invalid("invalid attachment chunks"));
        }
        Ok(())
    }
}
pub fn cache(conn: &Connection, manifest: &Manifest) -> Result<()> {
    manifest.validate()?;
    if let Some(old) = cached(conn, &manifest.metadata.id)? {
        // Peers may encrypt the same immutable attachment independently.
        if old.metadata != manifest.metadata {
            return Err(invalid("attachment manifest conflict"));
        }
    }
    conn.execute(
        "INSERT OR REPLACE INTO sync_attachment_manifests VALUES (?1,?2)",
        params![manifest.metadata.id, serde_json::to_string(manifest)?],
    )?;
    Ok(())
}
pub fn cached(conn: &Connection, id: &str) -> Result<Option<Manifest>> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT manifest FROM sync_attachment_manifests WHERE id=?1",
            [id],
            |r| r.get(0),
        )
        .optional()?;
    raw.map(|raw| {
        let manifest: Manifest = serde_json::from_str(&raw)?;
        manifest.validate()?;
        if manifest.metadata.id != id {
            return Err(invalid("attachment manifest id mismatch"));
        }
        Ok(manifest)
    })
    .transpose()
}
pub fn prepare(
    path: &str,
    queue_path: &Path,
    cfg: &StoredConfig,
    id: &str,
    storage: &LocalStorage,
) -> Result<Manifest> {
    let store = storage.attachments(Path::new(&format!("{path}.attachments")))?;
    let metadata = store.metadata(id)?;
    store.copy_to(id, &mut std::io::sink())?;
    let mut queue = storage.queue(queue_path, cfg.decode_key()?, &cfg.server_url)?;
    if metadata.size == 0 {
        queue.register_empty(id)?;
    } else {
        for index in 0..metadata.size.div_ceil(ATTACHMENT_CHUNK_BYTES as u64) {
            queue.stage(
                &ChunkContext {
                    attachment_id: id.into(),
                    index: index as u32,
                    total_size: metadata.size,
                },
                &store.read_chunk(id, index as usize)?,
            )?;
        }
    }
    let transport = AttachmentTransport::new(&cfg.server_url, &cfg.token)?;
    while queue.uploaded_ids(id)?.is_none() {
        if !queue.upload_next(&transport)? {
            return Err(invalid("incomplete attachment queue"));
        }
    }
    Ok(Manifest {
        version: 1,
        metadata,
        chunks: queue.uploaded_ids(id)?.unwrap(),
    })
}
pub fn receive(
    path: &str,
    receive_dir: &Path,
    cfg: &StoredConfig,
    entity: &Entity,
    storage: &LocalStorage,
) -> Result<Vec<Manifest>> {
    let refs = references(entity)?;
    if refs.is_empty() {
        return Ok(Vec::new());
    }
    let manifests: Vec<Manifest> = serde_json::from_value(
        entity
            .data
            .get("attachments")
            .cloned()
            .ok_or_else(|| invalid("attachment manifest missing"))?,
    )?;
    let ids: BTreeSet<_> = manifests.iter().map(|m| m.metadata.id.clone()).collect();
    if ids != refs || ids.len() != manifests.len() {
        return Err(invalid("attachment manifest/reference mismatch"));
    }
    for m in &manifests {
        m.validate()?;
    }
    let mut store = storage.attachments(Path::new(&format!("{path}.attachments")))?;
    let key = cfg.decode_key()?;
    let transport = AttachmentTransport::new(&cfg.server_url, &cfg.token)?;
    std::fs::create_dir_all(receive_dir)?;
    for m in &manifests {
        match store.metadata(&m.metadata.id) {
            Ok(existing) => {
                if existing != m.metadata {
                    return Err(invalid("existing attachment differs"));
                }
                store.copy_to(&m.metadata.id, &mut std::io::sink())?;
                remove_received_chunks(receive_dir, m);
                continue;
            }
            Err(inkism_engine::EngineError::NotFound(_)) => {}
            Err(e) => return Err(e.into()),
        }
        // Fetch and authenticate all ciphertext before taking the attachment DB write lock.
        for (index, id) in m.chunks.iter().enumerate() {
            let context = ChunkContext {
                attachment_id: m.metadata.id.clone(),
                index: index as u32,
                total_size: m.metadata.size,
            };
            let chunk_path: PathBuf = receive_dir.join(id);
            let local = std::fs::File::open(&chunk_path).ok().and_then(|f| {
                let mut ciphertext = Vec::new();
                f.take(MAX_SEALED_CHUNK_BYTES as u64 + 1)
                    .read_to_end(&mut ciphertext)
                    .ok()?;
                let sealed = SealedChunk {
                    id: id.clone(),
                    ciphertext,
                };
                sealed
                    .decrypt(&key, &context)
                    .ok()
                    .map(|bytes| (sealed, bytes))
            });
            let (sealed, plain) = match local {
                Some(found) => found,
                None => {
                    let sealed = transport
                        .download(id)?
                        .ok_or_else(|| invalid("attachment chunk missing on relay"))?;
                    let plain = sealed.decrypt(&key, &context)?;
                    let mut tmp = tempfile::NamedTempFile::new_in(receive_dir)?;
                    tmp.write_all(&sealed.ciphertext)?;
                    tmp.as_file().sync_all()?;
                    tmp.persist(&chunk_path)
                        .map_err(|e| RuntimeError::Io(e.to_string()))?;
                    (sealed, plain)
                }
            };
            drop(sealed);
            drop(plain);
        }
        store.import_verified(
            &m.metadata,
            CachedChunks {
                dir: receive_dir,
                manifest: m,
                key: &key,
                index: 0,
                current: std::io::Cursor::new(Vec::new()),
            },
        )?;
        remove_received_chunks(receive_dir, m);
    }
    Ok(manifests)
}

/// Only discard this validated manifest's staging files after the durable
/// attachment has passed its size/digest check. Failed imports keep every
/// downloaded chunk for retry. A transient Windows file lock must not prevent
/// an otherwise valid note from syncing; a repeated delivery retries cleanup.
fn remove_received_chunks(receive_dir: &Path, manifest: &Manifest) {
    for id in &manifest.chunks {
        let _ = std::fs::remove_file(receive_dir.join(id));
    }
}

// The only staging files contain relay ciphertext. Decrypt at most one chunk
// at a time while the atomic import checks length/digest. A cache change between
// prefetch and import is authenticated again and causes a rollback on failure.
struct CachedChunks<'a> {
    dir: &'a Path,
    manifest: &'a Manifest,
    key: &'a sync_core::Key,
    index: usize,
    current: std::io::Cursor<Vec<u8>>,
}
impl Read for CachedChunks<'_> {
    fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        loop {
            let n = self.current.read(output)?;
            if n > 0 {
                return Ok(n);
            }
            let Some(id) = self.manifest.chunks.get(self.index) else {
                return Ok(0);
            };
            let mut ciphertext = Vec::new();
            std::fs::File::open(self.dir.join(id))?
                .take(MAX_SEALED_CHUNK_BYTES as u64 + 1)
                .read_to_end(&mut ciphertext)?;
            let context = ChunkContext {
                attachment_id: self.manifest.metadata.id.clone(),
                index: self.index as u32,
                total_size: self.manifest.metadata.size,
            };
            let plain = SealedChunk {
                id: id.clone(),
                ciphertext,
            }
            .decrypt(self.key, &context)
            .map_err(|_| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "cached attachment chunk failed authentication",
                )
            })?;
            self.index += 1;
            self.current = std::io::Cursor::new(plain);
        }
    }
}

#[cfg(test)]
mod cached_chunk_tests {
    use super::*;
    use inkism_engine::attachments::AttachmentStore;
    #[test]
    fn successful_chunk_cleanup_keeps_unowned_files_and_never_recurses() {
        let dir = tempfile::tempdir().unwrap();
        let first = uuid::Uuid::new_v4().to_string();
        let second = uuid::Uuid::new_v4().to_string();
        let absent = uuid::Uuid::new_v4().to_string();
        std::fs::write(dir.path().join(&first), b"ciphertext").unwrap();
        // Model a file that cannot be unlinked, without OS-specific permissions.
        std::fs::create_dir(dir.path().join(&second)).unwrap();
        std::fs::write(
            dir.path().join(&second).join("preserve"),
            b"owned elsewhere",
        )
        .unwrap();
        std::fs::write(dir.path().join("unrelated"), b"preserve").unwrap();
        let mut fixture = AttachmentStore::open(&dir.path().join("fixture.db")).unwrap();
        let data = vec![1; ATTACHMENT_CHUNK_BYTES * 2 + 1];
        let metadata = fixture
            .import_reader("fixture", "application/octet-stream", data.as_slice())
            .unwrap();
        let manifest = Manifest {
            version: 1,
            metadata,
            chunks: vec![first.clone(), second.clone(), absent],
        };
        manifest.validate().unwrap();
        remove_received_chunks(dir.path(), &manifest);
        assert!(!dir.path().join(first).exists());
        assert_eq!(
            std::fs::read(dir.path().join(second).join("preserve")).unwrap(),
            b"owned elsewhere"
        );
        assert_eq!(
            std::fs::read(dir.path().join("unrelated")).unwrap(),
            b"preserve"
        );
    }
    #[test]
    fn changed_cached_chunk_rolls_back_import_and_repair_can_retry() {
        let dir = tempfile::tempdir().unwrap();
        let source = vec![0x42; ATTACHMENT_CHUNK_BYTES + 17];
        let mut fixture = AttachmentStore::open(&dir.path().join("fixture.db")).unwrap();
        let metadata = fixture
            .import_reader("fixture", "application/octet-stream", source.as_slice())
            .unwrap();
        let key = sync_core::Key::generate();
        let mut chunks = vec![];
        let mut last = None;
        for (index, plain) in source.chunks(ATTACHMENT_CHUNK_BYTES).enumerate() {
            let context = ChunkContext {
                attachment_id: metadata.id.clone(),
                index: index as u32,
                total_size: metadata.size,
            };
            let sealed = SealedChunk::encrypt(&key, &context, plain).unwrap();
            std::fs::write(dir.path().join(&sealed.id), &sealed.ciphertext).unwrap();
            chunks.push(sealed.id.clone());
            last = Some(sealed);
        }
        let manifest = Manifest {
            version: 1,
            metadata,
            chunks,
        };
        let reader = || CachedChunks {
            dir: dir.path(),
            manifest: &manifest,
            key: &key,
            index: 0,
            current: std::io::Cursor::new(vec![]),
        };
        let last = last.unwrap();
        let mut damaged = last.ciphertext.clone();
        let end = damaged.len() - 1;
        damaged[end] ^= 1;
        std::fs::write(dir.path().join(&last.id), damaged).unwrap();
        let mut destination = AttachmentStore::open(&dir.path().join("destination.db")).unwrap();
        assert!(destination
            .import_verified(&manifest.metadata, reader())
            .is_err());
        assert!(matches!(
            destination.metadata(&manifest.metadata.id),
            Err(inkism_engine::EngineError::NotFound(_))
        ));
        std::fs::write(dir.path().join(last.id), last.ciphertext).unwrap();
        destination
            .import_verified(&manifest.metadata, reader())
            .unwrap();
        let mut restored = vec![];
        destination
            .copy_to(&manifest.metadata.id, &mut restored)
            .unwrap();
        assert_eq!(restored, source);
    }
}

#[cfg(test)] mod collection_cover_reference_tests {
 use super::*;use serde_json::json;
 #[test]fn only_typed_collection_files_are_attachment_references(){
  let id="a0000000-0000-4000-8000-000000000001";
  let mut entity=Entity::new(EntityKind::Setting,"knowledge_note:n",json!({"value":json!({"properties":[{"name":"Cover","type":"attachment","value":id},{"name":"Empty","type":"attachment","value":""},{"name":"Text","type":"text","value":"b0000000-0000-4000-8000-000000000002"}]}).to_string()}));
  assert_eq!(references(&entity).unwrap(),BTreeSet::from([id.to_string()]));entity.deleted=true;assert!(references(&entity).unwrap().is_empty());
 }
}

#[cfg(test)] mod canvas_reference_tests {
 use super::*;use serde_json::json;
 #[test]fn group_backgrounds_and_files_sync_but_external_paths_do_not(){
  let a="a0000000-0000-4000-8000-000000000001";let b="b0000000-0000-4000-8000-000000000002";
  let mut entity=Entity::new(EntityKind::Setting,"workspace_canvas",json!({"value":json!({"nodes":[{"kind":"group","background":a},{"kind":"file","attachmentId":b},{"kind":"group","background":"assets/grid.png"},{"kind":"group","background":"https://example.com/grid.png"},{"kind":"text","text":a}]}).to_string()}));
  assert_eq!(references(&entity).unwrap(),BTreeSet::from([a.to_string(),b.to_string()]));entity.deleted=true;assert!(references(&entity).unwrap().is_empty());
 }
}
