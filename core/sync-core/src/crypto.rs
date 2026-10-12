//! Authenticated encryption for change records.
//!
//! Wire format of a record blob: `base64(nonce || ciphertext || tag)` where
//! the nonce is 24 random bytes and the AEAD is XChaCha20-Poly1305. The record
//! id (relay event id) is bound as associated data, so a ciphertext cannot be
//! replayed under a different id.

use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD};
use base64::Engine as _;
use chacha20poly1305::aead::{Aead, Payload};
use chacha20poly1305::{KeyInit, XChaCha20Poly1305, XNonce};
use rand::rngs::OsRng;
use rand::RngCore;
use zeroize::Zeroize;

use crate::error::{Result, SyncError};

/// Nonce length for XChaCha20-Poly1305.
pub const NONCE_LEN: usize = 24;
/// Vault key length in bytes.
pub const KEY_LEN: usize = 32;
/// Poly1305 tag length.
const TAG_LEN: usize = 16;

/// A 32-byte vault key. The key must never be derived from the relay bearer
/// token; it is generated once on the first device and shared out of band
/// (for example, as a base64 string in a recovery code).
#[derive(Clone)]
pub struct Key([u8; KEY_LEN]);

impl Key {
    /// Wrap raw key bytes.
    pub fn from_bytes(bytes: [u8; KEY_LEN]) -> Self {
        Key(bytes)
    }

    /// Decode a base64 (padded or unpadded) 32-byte key.
    pub fn from_base64(encoded: &str) -> Result<Self> {
        let trimmed = encoded.trim();
        let raw = STANDARD
            .decode(trimmed)
            .or_else(|_| STANDARD_NO_PAD.decode(trimmed))
            .map_err(|err| SyncError::Config(format!("vault key is not valid base64: {err}")))?;
        if raw.len() != KEY_LEN {
            return Err(SyncError::Config(format!(
                "vault key must be {KEY_LEN} bytes, got {}",
                raw.len()
            )));
        }
        let mut bytes = [0u8; KEY_LEN];
        bytes.copy_from_slice(&raw);
        Ok(Key(bytes))
    }

    /// Generate a fresh random key.
    pub fn generate() -> Self {
        let mut bytes = [0u8; KEY_LEN];
        OsRng.fill_bytes(&mut bytes);
        Key(bytes)
    }

    /// Encode for out-of-band sharing.
    pub fn to_base64(&self) -> String {
        STANDARD.encode(self.0)
    }

    /// Raw key bytes. Treat the result as secret.
    pub fn as_bytes(&self) -> &[u8; KEY_LEN] {
        &self.0
    }

    fn cipher(&self) -> Result<XChaCha20Poly1305> {
        XChaCha20Poly1305::new_from_slice(&self.0)
            .map_err(|_| SyncError::Crypto("invalid vault key length".into()))
    }
}

impl Drop for Key {
    fn drop(&mut self) {
        self.0.zeroize();
    }
}

impl std::fmt::Debug for Key {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Key(<redacted>)")
    }
}

/// Encrypt `plaintext`, binding `record_id` as associated data.
///
/// The returned bytes are `nonce || ciphertext || tag`; call
/// [`encode_blob`] to produce the base64 string the relay stores.
pub fn seal(key: &Key, record_id: &str, plaintext: &[u8]) -> Result<Vec<u8>> {
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = key
        .cipher()?
        .encrypt(
            XNonce::from_slice(&nonce),
            Payload {
                msg: plaintext,
                aad: record_id.as_bytes(),
            },
        )
        .map_err(|_| SyncError::Crypto("encryption failed".into()))?;
    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

/// Decrypt a `nonce || ciphertext || tag` blob produced by [`seal`].
///
/// Any wrong key, altered byte, or mismatched record id yields
/// [`SyncError::Crypto`] and the caller must not advance its cursor.
pub fn open(key: &Key, record_id: &str, blob: &[u8]) -> Result<Vec<u8>> {
    if blob.len() < NONCE_LEN + TAG_LEN {
        return Err(SyncError::Crypto("ciphertext is too short".into()));
    }
    let (nonce, ciphertext) = blob.split_at(NONCE_LEN);
    key.cipher()?
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad: record_id.as_bytes(),
            },
        )
        .map_err(|_| {
            SyncError::Crypto("authentication failed: wrong key or tampered record".into())
        })
}

/// Base64-encode a sealed blob for the relay.
pub fn encode_blob(sealed: &[u8]) -> String {
    STANDARD.encode(sealed)
}

/// Base64-decode a relay blob.
pub fn decode_blob(encoded: &str) -> Result<Vec<u8>> {
    STANDARD
        .decode(encoded)
        .or_else(|_| STANDARD_NO_PAD.decode(encoded))
        .map_err(|err| SyncError::Protocol(format!("record blob is not valid base64: {err}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let key = Key::generate();
        let sealed = seal(&key, "event-1", b"hello").unwrap();
        assert_eq!(sealed.len(), NONCE_LEN + 5 + TAG_LEN);
        assert_eq!(open(&key, "event-1", &sealed).unwrap(), b"hello");
    }

    #[test]
    fn tampered_ciphertext_is_rejected() {
        let key = Key::generate();
        let mut sealed = seal(&key, "event-1", b"hello").unwrap();
        let last = sealed.len() - 1;
        sealed[last] ^= 0x01;
        assert!(matches!(
            open(&key, "event-1", &sealed),
            Err(SyncError::Crypto(_))
        ));
    }

    #[test]
    fn wrong_record_id_is_rejected() {
        let key = Key::generate();
        let sealed = seal(&key, "event-1", b"hello").unwrap();
        assert!(open(&key, "event-2", &sealed).is_err());
    }

    #[test]
    fn key_base64_round_trip() {
        let key = Key::generate();
        let restored = Key::from_base64(&key.to_base64()).unwrap();
        assert_eq!(key.as_bytes(), restored.as_bytes());
        assert!(Key::from_base64("abcd").is_err());
    }
}
