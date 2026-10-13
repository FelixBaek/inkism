//! Note vault RPCs (original `vault.create/unlock/lock/add/open/save/remove/
//! changePassword`).
//!
//! A random 32-byte vault key encrypts note bodies (XChaCha20-Poly1305). The
//! key is wrapped by the password with the existing Argon2id envelope and
//! synced as the `vault_key:<id>` setting, so another device can unlock with
//! the same password. Changing the password rewraps keys only. Unwrapped keys
//! live in memory until `vault_lock` or process exit. Password derivation runs
//! outside the note lock so other requests are not blocked by it.
use std::collections::BTreeMap;

use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use inkism_engine::{settings, vault as store};
use rand::{rngs::OsRng, RngCore};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sync_core::{Entity, EntityKind};
use zeroize::Zeroizing;

use super::{lock_ok, Svc};
use crate::{recovery_envelope, Result, RuntimeError};

const BINDING: [u8; 32] = *b"mindbox-vault-key-envelope-v1\0\0\0";
const AAD: &[u8] = b"mindbox-vault-note-v1:";

/// Unwrapped vault keys by key id.
#[derive(Default)]
pub(crate) struct Keys(std::sync::Mutex<BTreeMap<String, Zeroizing<[u8; 32]>>>);

#[derive(Serialize, Deserialize)]
struct Plain {
    content: String,
    text: String,
    content_format: String,
}

fn wrong_password() -> RuntimeError {
    RuntimeError::config("금고 비밀번호가 맞지 않습니다")
}

fn locked_vault() -> RuntimeError {
    RuntimeError::config("금고가 잠겨 있습니다. 먼저 잠금을 여세요")
}

fn text<'a>(req: &'a Value, key: &str) -> Result<&'a str> {
    req.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| RuntimeError::config(format!("{key} required")))
}

fn revision(req: &Value) -> Result<i64> {
    req.get("revision")
        .and_then(Value::as_i64)
        .filter(|r| *r > 0)
        .ok_or_else(|| RuntimeError::config("revision required"))
}

fn encrypt(key: &[u8; 32], key_id: &str, plain: &Plain) -> Result<String> {
    let bytes = Zeroizing::new(serde_json::to_vec(plain).map_err(|e| RuntimeError::internal(e.to_string()))?);
    let mut nonce = [0u8; 24];
    OsRng.try_fill_bytes(&mut nonce).map_err(|_| RuntimeError::internal("random source unavailable"))?;
    let aad = [AAD, key_id.as_bytes()].concat();
    let sealed = XChaCha20Poly1305::new(key.into())
        .encrypt(XNonce::from_slice(&nonce), Payload { msg: &bytes, aad: &aad })
        .map_err(|_| RuntimeError::internal("vault encryption failed"))?;
    Ok(sync_core::encode_blob(&[nonce.as_slice(), &sealed].concat()))
}

fn decrypt(key: &[u8; 32], key_id: &str, ciphertext: &str) -> Result<Plain> {
    let raw = sync_core::decode_blob(ciphertext).map_err(|_| RuntimeError::internal("locked body is corrupt"))?;
    if raw.len() < 24 + 16 {
        return Err(RuntimeError::internal("locked body is corrupt"));
    }
    let aad = [AAD, key_id.as_bytes()].concat();
    let bytes = Zeroizing::new(
        XChaCha20Poly1305::new(key.into())
            .decrypt(XNonce::from_slice(&raw[..24]), Payload { msg: &raw[24..], aad: &aad })
            .map_err(|_| RuntimeError::internal("locked body cannot be decrypted"))?,
    );
    serde_json::from_slice(&bytes).map_err(|_| RuntimeError::internal("locked body is corrupt"))
}

/// Attachment links inside the plaintext, as `{id, ref}` pairs.
fn attachment_refs(id: &str, plain: &Plain) -> Result<Vec<store::AttachmentRef>> {
    let entity = Entity::new(
        EntityKind::Note,
        id,
        json!({"content": plain.content, "text": plain.text, "content_format": plain.content_format}),
    );
    Ok(crate::attachment_sync::references(&entity)?
        .into_iter()
        .map(|id| store::AttachmentRef { reference: id.clone(), id })
        .collect())
}

/// Backup restore may renumber attachments; point old links at current ids.
fn apply_aliases(plain: &mut Plain, refs: &[store::AttachmentRef]) {
    for r in refs.iter().filter(|r| r.id != r.reference) {
        let (from, to) = (format!("/api/attachments/{}", r.reference), format!("/api/attachments/{}", r.id));
        plain.content = plain.content.replace(&from, &to);
        plain.text = plain.text.replace(&from, &to);
    }
}

/// Seal one plaintext named-version row (`content`,`text`,`content_format`)
/// for the vault key `key_id`. `None` when that key is not unlocked here.
pub(crate) fn seal_version(keys: &Keys, key_id: &str, note_id: &str, row: &Value) -> Result<Option<Value>> {
    let Some(key) = lock_ok(&keys.0).get(key_id).cloned() else { return Ok(None) };
    let plain = Plain { content: text(row, "content")?.to_string(), text: text(row, "text")?.to_string(), content_format: text(row, "content_format")?.to_string() };
    let body = store::LockedBody { ciphertext: encrypt(&key, key_id, &plain)?, key_id: key_id.to_string(), attachments: attachment_refs(note_id, &plain)? };
    Ok(Some(json!({
        "locked_body": serde_json::to_value(body).map_err(|e| RuntimeError::internal(e.to_string()))?,
        "plain_bytes": plain.content.len() + plain.text.len(),
    })))
}

impl Svc {
    fn vault_envelopes(&self) -> Result<Vec<(String, String, i64)>> {
        self.with_host(|c| Ok(settings::vault_keys(c)?))
    }

    fn vault_key(&self, key_id: &str) -> Result<Zeroizing<[u8; 32]>> {
        lock_ok(&self.vault.0).get(key_id).cloned().ok_or_else(locked_vault)
    }

    /// Newest unlocked key: new locks use it so a password change on another
    /// device converges on one key over time.
    fn current_key(&self) -> Result<(String, Zeroizing<[u8; 32]>)> {
        // Engine lock first and released before the key lock: `vault_key` is
        // called while holding the engine lock, so never nest the other way.
        let envelopes = self.vault_envelopes()?;
        let keys = lock_ok(&self.vault.0);
        envelopes
            .into_iter()
            .rev()
            .find_map(|(id, _, _)| keys.get(&id).map(|k| (id, k.clone())))
            .ok_or_else(locked_vault)
    }

    fn notify_index(&self) {
        lock_ok(&self.engine).notify_index();
    }

    /// Read, encrypt and write under one engine lock; the engine rechecks the
    /// revision in its write transaction.
    fn with_note<R>(&self, f: impl FnOnce(&Connection) -> Result<R>) -> Result<R> {
        let result = self.with_host(f);
        self.notify_index();
        result
    }

    pub(crate) fn handle_vault(&self, op: &str, req: &Value) -> Result<Value> {
        match op {
            "vault_status" => {
                let exists = !self.vault_envelopes()?.is_empty();
                Ok(json!({"exists": exists, "unlocked": exists && !lock_ok(&self.vault.0).is_empty()}))
            }
            "vault_create" => self.vault_create(req),
            "vault_unlock" => self.vault_unlock(req),
            "vault_lock" => {
                lock_ok(&self.vault.0).clear();
                Ok(json!({"unlocked": false}))
            }
            "vault_change_password" => self.vault_change_password(req),
            "vault_lock_note" => self.vault_lock_note(req),
            "vault_open" => self.vault_open(req),
            "vault_versions" => self.vault_versions(req),
            "vault_save" => self.vault_save(req),
            "vault_unlock_note" => self.vault_unlock_note(req),
            // Original vault.clear: permanently unlock every locked note.
            "vault_clear" => self.vault_clear(),
            // Original vault.delete, without deleting notes: refuse while any
            // locked note still depends on a key.
            "vault_delete" => self.vault_delete(),
            other => Err(RuntimeError::internal(format!("unknown vault op {other}"))),
        }
    }

    fn vault_create(&self, req: &Value) -> Result<Value> {
        let password = Zeroizing::new(text(req, "password")?.as_bytes().to_vec());
        if !self.vault_envelopes()?.is_empty() {
            return Err(RuntimeError::config("금고가 이미 있습니다"));
        }
        let mut key = Zeroizing::new([0u8; 32]);
        OsRng.try_fill_bytes(key.as_mut()).map_err(|_| RuntimeError::internal("random source unavailable"))?;
        let envelope = sync_core::encode_blob(&recovery_envelope::seal(&key, &password, &BINDING)?);
        let key_id = uuid::Uuid::new_v4().to_string();
        self.with_host(|c| {
            c.execute_batch("BEGIN IMMEDIATE;")?;
            let result = (|| -> Result<()> {
                if !settings::vault_keys(c)?.is_empty() {
                    return Err(RuntimeError::config("금고가 이미 있습니다"));
                }
                settings::write_local(c, &format!("{}{key_id}", settings::VAULT_KEY_PREFIX), Some(&envelope))?;
                Ok(())
            })();
            finish(c, result)
        })?;
        lock_ok(&self.vault.0).insert(key_id, key);
        Ok(json!({"exists": true, "unlocked": true}))
    }

    fn vault_unlock(&self, req: &Value) -> Result<Value> {
        let password = Zeroizing::new(text(req, "password")?.as_bytes().to_vec());
        let mut opened = BTreeMap::new();
        for (key_id, envelope, _) in self.vault_envelopes()? {
            let Ok(raw) = sync_core::decode_blob(&envelope) else { continue };
            if let Ok(key) = recovery_envelope::open(&raw, &password, &BINDING) {
                opened.insert(key_id, Zeroizing::new(*key.as_bytes()));
            }
        }
        if opened.is_empty() {
            return Err(wrong_password());
        }
        lock_ok(&self.vault.0).extend(opened);
        Ok(json!({"exists": true, "unlocked": true}))
    }

    fn vault_change_password(&self, req: &Value) -> Result<Value> {
        let old = Zeroizing::new(text(req, "old_password")?.as_bytes().to_vec());
        let new = Zeroizing::new(text(req, "new_password")?.as_bytes().to_vec());
        let mut rewrapped = Vec::new();
        for (key_id, envelope, _) in self.vault_envelopes()? {
            let Ok(raw) = sync_core::decode_blob(&envelope) else { continue };
            if let Ok(key) = recovery_envelope::open(&raw, &old, &BINDING) {
                let sealed = sync_core::encode_blob(&recovery_envelope::seal(key.as_bytes(), &new, &BINDING)?);
                rewrapped.push((key_id, envelope, sealed));
            }
        }
        if rewrapped.is_empty() {
            return Err(wrong_password());
        }
        self.with_host(|c| {
            c.execute_batch("BEGIN IMMEDIATE;")?;
            let result = (|| -> Result<()> {
                for (key_id, before, after) in &rewrapped {
                    let key = format!("{}{key_id}", settings::VAULT_KEY_PREFIX);
                    // Another change since the read: do not overwrite it.
                    if settings::stored(c, &key)?.and_then(|(v, _)| v).as_deref() != Some(before.as_str()) {
                        return Err(RuntimeError::config("금고 키가 바뀌었습니다. 다시 시도하세요"));
                    }
                    settings::write_local(c, &key, Some(after))?;
                }
                Ok(())
            })();
            finish(c, result)
        })?;
        Ok(json!({"changed": rewrapped.len()}))
    }

    fn vault_lock_note(&self, req: &Value) -> Result<Value> {
        let id = text(req, "id")?;
        let revision = revision(req)?;
        let (key_id, key) = self.current_key()?;
        self.with_note(|c| {
            let note = inkism_engine::ops_notes::load_note(c, id)?
                .ok_or_else(|| RuntimeError::config(format!("note {id} not found")))?;
            if note.revision != revision {
                return Err(RuntimeError::config("document revision changed"));
            }
            let plain = Plain { content: note.content, text: note.text, content_format: note.content_format };
            let body = store::LockedBody {
                ciphertext: encrypt(&key, &key_id, &plain)?,
                attachments: attachment_refs(id, &plain)?,
                key_id,
            };
            // Seal and store one snapshot at a time inside the engine's
            // revision transaction: memory stays at one plaintext snapshot
            // and its ciphertext instead of every snapshot several times over.
            let mut failure = None;
            let mut seal = |mut version: Value| -> std::result::Result<Value, inkism_engine::EngineError> {
                let sealed = (|| -> Result<store::LockedBody> {
                    let plain = Plain { content: text(&version, "content")?.to_string(), text: text(&version, "text")?.to_string(), content_format: text(&version, "content_format")?.to_string() };
                    version["plain_bytes"] = json!(plain.content.len() + plain.text.len());
                    Ok(store::LockedBody { ciphertext: encrypt(&key, &body.key_id, &plain)?, key_id: body.key_id.clone(), attachments: attachment_refs(id, &plain)? })
                })();
                let sealed = sealed.map_err(|e| {
                    let message = e.to_string();
                    failure = Some(e);
                    inkism_engine::EngineError::internal(message)
                })?;
                let map = version.as_object_mut().expect("backup row is an object");
                map.remove("content");
                map.remove("text");
                map.insert("locked_body".into(), serde_json::to_value(sealed)?);
                Ok(version)
            };
            let result = store::lock_with_sealed_versions(c, id, revision, &body, &mut seal);
            match (result, failure) {
                (Ok(note), _) => Ok(note),
                (Err(_), Some(e)) => Err(e),
                (Err(e), None) => Err(e.into()),
            }
        })
    }

    fn vault_versions(&self,req:&Value)->Result<Value>{
        let id=text(req,"id")?;let action=req.get("action").and_then(Value::as_str).unwrap_or("list");
        self.with_note(|c|{
            let current=inkism_engine::ops_notes::load_summary(c,id)?;
            let current_body=store::locked_body(c,id)?.ok_or_else(||RuntimeError::config("note is not locked"))?;
            let _key=self.vault_key(&current_body.key_id)?;
            // Listing and reading one body never load the other ciphertexts.
            if action=="list"{return Ok(json!({"items":inkism_engine::encrypted_versions::listing(c,id)?}));}
            if action=="body" {
                let hid=text(req,"history_id")?;let row=inkism_engine::encrypted_versions::row(c,id,hid)?.ok_or_else(||RuntimeError::config("version not found"))?;
                let body=store::LockedBody::deserialize(&row["locked_body"]).map_err(|e|RuntimeError::internal(e.to_string()))?;
                let mut plain=decrypt(&*self.vault_key(&body.key_id)?,&body.key_id,&body.ciphertext)?;apply_aliases(&mut plain,&body.attachments);
                return Ok(json!({"title":row["title"],"content":plain.content,"text":plain.text,"content_format":plain.content_format}));
            }
            // Each action touches at most one stored snapshot (plus a new
            // one); the engine checks that row is unchanged and the per-note
            // limits in its transaction, without loading every ciphertext.
            let revision=revision(req)?;
            let current_plain=decrypt(&_key,&current_body.key_id,&current_body.ciphertext)?;
            let current_bytes=current_plain.content.len()+current_plain.text.len();
            drop(current_plain);
            let name=||->Result<String>{let name=text(req,"label")?.trim();if name.is_empty()||name.chars().count()>120{return Err(RuntimeError::config("version name requires 1–120 characters"));}Ok(name.to_string())};
            let mut change=store::EncryptedVersionChange::default();
            let mut restore=None;
            let target;
            if action=="create"{change.put.push(json!({"id":inkism_engine::ids::new_id(),"label":name()?,"title":current.title,"content_format":current.content_format,"created_at":inkism_engine::ids::now_ms(),"plain_bytes":current_bytes,"locked_body":current_body}));}
            else {
                let hid=text(req,"history_id")?;let row=inkism_engine::encrypted_versions::row(c,id,hid)?.ok_or_else(||RuntimeError::config("version not found"))?;
                if req.get("expected_label").and_then(Value::as_str)!=row["label"].as_str(){return Err(RuntimeError::config("version name changed"));}
                match action{
                    "rename"=>{let mut renamed=row.clone();renamed["label"]=json!(name()?);change.put.push(renamed);},
                    "delete"=>{change.remove=Some(hid.to_string());},
                    "restore"=>{
                        let body=store::LockedBody::deserialize(&row["locked_body"]).map_err(|e|RuntimeError::internal(e.to_string()))?;
                        // Authenticate before replacing the live ciphertext.
                        let _=decrypt(&*self.vault_key(&body.key_id)?,&body.key_id,&body.ciphertext)?;
                        change.put.push(json!({"id":inkism_engine::ids::new_id(),"label":format!("Before restore {}",inkism_engine::ids::now_ms()),"title":current.title,"content_format":current.content_format,"created_at":inkism_engine::ids::now_ms(),"plain_bytes":current_bytes,"locked_body":current_body}));
                        restore=Some((text(&row,"title")?.to_string(),text(&row,"content_format")?.to_string(),body));
                    },
                    _=>return Err(RuntimeError::config("unknown vault version action")),
                }
                target=row;
                change.expected=Some((hid.to_string(),&target));
            }
            let restore_ref=restore.as_ref().map(|(title,format,body)|(title.as_str(),format.as_str(),body));
            Ok(store::change_encrypted_version(c,id,revision,&change,restore_ref)?)
        })
    }

    fn vault_open(&self, req: &Value) -> Result<Value> {
        let id = text(req, "id")?;
        let (summary, body) = self.with_host(|c| {
            Ok((
                inkism_engine::ops_notes::load_summary(c, id)?,
                store::locked_body(c, id)?.ok_or_else(|| RuntimeError::config("note is not locked"))?,
            ))
        })?;
        let mut plain = decrypt(&*self.vault_key(&body.key_id)?, &body.key_id, &body.ciphertext)?;
        apply_aliases(&mut plain, &body.attachments);
        let mut note = serde_json::to_value(summary).map_err(|e| RuntimeError::internal(e.to_string()))?;
        note["content"] = json!(plain.content);
        note["text"] = json!(plain.text);
        note["content_format"] = json!(plain.content_format);
        Ok(note)
    }

    fn vault_save(&self, req: &Value) -> Result<Value> {
        let id = text(req, "id")?;
        let revision = revision(req)?;
        let title = req.get("title").and_then(Value::as_str);
        let mut plain = Plain {
            content: text(req, "content")?.to_string(),
            text: text(req, "text")?.to_string(),
            content_format: String::new(),
        };
        inkism_engine::ops_notes::check_field_size("content", &plain.content)?;
        inkism_engine::ops_notes::check_field_size("text", &plain.text)?;
        self.with_note(|c| {
            // Omitted format keeps the note's own format.
            plain.content_format = match req.get("content_format").and_then(Value::as_str) {
                Some(format) => format.to_string(),
                None => inkism_engine::ops_notes::load_summary(c, id)?.content_format,
            };
            inkism_engine::source_format::validate(&plain.content_format)?;
            let key_id = store::locked_body(c, id)?
                .ok_or_else(|| RuntimeError::config("note is not locked"))?
                .key_id;
            let key = self.vault_key(&key_id)?;
            let body = store::LockedBody {
                ciphertext: encrypt(&key, &key_id, &plain)?,
                attachments: attachment_refs(id, &plain)?,
                key_id,
            };
            Ok(store::save(c, id, revision, title, &plain.content_format, &body)?)
        })
    }

    fn vault_unlock_note(&self, req: &Value) -> Result<Value> {
        let id = text(req, "id")?;
        let revision = revision(req)?;
        self.with_note(|c| {
            let body = store::locked_body(c, id)?.ok_or_else(|| RuntimeError::config("note is not locked"))?;
            let mut plain = decrypt(&*self.vault_key(&body.key_id)?, &body.key_id, &body.ciphertext)?;
            apply_aliases(&mut plain, &body.attachments);
            // Decrypt and restore one snapshot at a time inside the engine's
            // revision transaction (see `vault_lock_note`).
            let mut failure = None;
            let mut open = |mut version: Value| -> std::result::Result<Value, inkism_engine::EngineError> {
                let opened = (|| -> Result<Plain> {
                    let body: store::LockedBody = store::LockedBody::deserialize(&version["locked_body"]).map_err(|e| RuntimeError::internal(e.to_string()))?;
                    let mut old = decrypt(&*self.vault_key(&body.key_id)?, &body.key_id, &body.ciphertext)?;
                    apply_aliases(&mut old, &body.attachments);
                    Ok(old)
                })();
                let old = opened.map_err(|e| {
                    let message = e.to_string();
                    failure = Some(e);
                    inkism_engine::EngineError::internal(message)
                })?;
                version["content"] = json!(old.content);
                version["text"] = json!(old.text);
                version["content_format"] = json!(old.content_format);
                version.as_object_mut().expect("encrypted row is an object").remove("locked_body");
                Ok(version)
            };
            let result = store::unlock_with_opened_versions(c, id, revision, &plain.content, &plain.text, &plain.content_format, &mut open);
            match (result, failure) {
                (Ok(note), _) => Ok(note),
                (Err(_), Some(e)) => Err(e),
                (Err(e), None) => Err(e.into()),
            }
        })
    }

    fn vault_clear(&self) -> Result<Value> {
        let ids: Vec<(String, i64)> = self.with_host(|c| {
            let mut stmt = c.prepare("SELECT id,revision FROM notes_meta WHERE locked=1 ORDER BY id")?;
            let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
            Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
        })?;
        for (id, revision) in &ids {
            self.handle_vault("vault_unlock_note", &json!({"id": id, "revision": revision}))?;
        }
        Ok(json!({"unlocked_notes": ids.len()}))
    }

    fn vault_delete(&self) -> Result<Value> {
        self.with_host(|c| {
            c.execute_batch("BEGIN IMMEDIATE;")?;
            let result = (|| -> Result<()> {
                let locked: i64 = c.query_row("SELECT (SELECT count(*) FROM notes_meta WHERE locked=1)+(SELECT count(*) FROM encrypted_named_versions)", [], |r| r.get(0))?;
                if locked > 0 {
                    return Err(RuntimeError::config("잠긴 노트가 남아 있습니다. 먼저 모두 해제하세요"));
                }
                for (key_id, _, _) in settings::vault_keys(c)? {
                    settings::write_local(c, &format!("{}{key_id}", settings::VAULT_KEY_PREFIX), None)?;
                }
                Ok(())
            })();
            finish(c, result)
        })?;
        lock_ok(&self.vault.0).clear();
        Ok(json!({"exists": false, "unlocked": false}))
    }
}

fn finish(conn: &Connection, result: Result<()>) -> Result<()> {
    match result {
        Ok(()) => {
            conn.execute_batch("COMMIT;")?;
            Ok(())
        }
        Err(e) => {
            let _ = conn.execute_batch("ROLLBACK;");
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn note_ciphertext_round_trips_and_binds_key_id() {
        let key = [7u8; 32];
        let plain = Plain { content: "<p>비밀</p>".into(), text: "비밀".into(), content_format: "html".into() };
        let sealed = encrypt(&key, "k1", &plain).unwrap();
        assert!(!sealed.contains("비밀"));
        assert_eq!(decrypt(&key, "k1", &sealed).unwrap().text, "비밀");
        assert!(decrypt(&key, "k2", &sealed).is_err());
        let mut aliased = Plain { content: "<a href=\"/api/attachments/old-id\">f</a>".into(), text: String::new(), content_format: "html".into() };
        apply_aliases(&mut aliased, &[store::AttachmentRef { id: "new-id".into(), reference: "old-id".into() }]);
        assert!(aliased.content.contains("/api/attachments/new-id"));
    }
}
