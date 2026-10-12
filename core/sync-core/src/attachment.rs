//! Bounded, independently authenticated attachment chunks.
//!
//! The host persists a sealed chunk before attempting upload and reuses those
//! exact bytes on retry. A manifest (sent only after all chunks are uploaded)
//! must keep each random blob ID together with its context and whole-file hash.
use crate::client::RelayClient;
use crate::crypto;
use crate::{Key, Result, SyncError};
use uuid::Uuid;

pub const ATTACHMENT_CHUNK_BYTES: usize = 256 * 1024;
pub const MAX_ATTACHMENT_BYTES: u64 = 1 << 30;
pub const MAX_SEALED_CHUNK_BYTES: usize = ATTACHMENT_CHUNK_BYTES + 40;

/// Authenticated position and size. Relocating a valid ciphertext to a different
/// file, index, or declared size must fail before returning plaintext.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ChunkContext {
    pub attachment_id: String,
    pub index: u32,
    pub total_size: u64,
}

pub(crate) fn validate_blob_id(id: &str) -> Result<()> {
    let uuid =
        Uuid::parse_str(id).map_err(|_| SyncError::Protocol("invalid attachment UUID".into()))?;
    if uuid.hyphenated().to_string() != id {
        return Err(SyncError::Protocol(
            "attachment UUID is not canonical".into(),
        ));
    }
    Ok(())
}

impl ChunkContext {
    pub(crate) fn expected_len(&self) -> Result<usize> {
        validate_blob_id(&self.attachment_id)?;
        if self.total_size == 0 || self.total_size > MAX_ATTACHMENT_BYTES {
            return Err(SyncError::Protocol("invalid attachment size".into()));
        }
        let offset = u64::from(self.index) * ATTACHMENT_CHUNK_BYTES as u64;
        if offset >= self.total_size {
            return Err(SyncError::Protocol(
                "attachment chunk index out of range".into(),
            ));
        }
        Ok((self.total_size - offset).min(ATTACHMENT_CHUNK_BYTES as u64) as usize)
    }

    fn aad(&self, blob_id: &str) -> Result<String> {
        self.expected_len()?;
        validate_blob_id(blob_id)?;
        Ok(format!(
            "inkism:attachment:v1:{}:{}:{}:{}",
            self.attachment_id, self.index, self.total_size, blob_id
        ))
    }
}

/// This ciphertext and ID must be durably staged together before network I/O.
/// Generating a new random nonce for an existing ID is not a valid retry.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SealedChunk {
    pub id: String,
    pub ciphertext: Vec<u8>,
}

impl SealedChunk {
    pub fn encrypt(key: &Key, context: &ChunkContext, plaintext: &[u8]) -> Result<Self> {
        if plaintext.len() != context.expected_len()? {
            return Err(SyncError::Protocol(
                "attachment chunk length mismatch".into(),
            ));
        }
        let id = Uuid::new_v4().hyphenated().to_string();
        let ciphertext = crypto::seal(key, &context.aad(&id)?, plaintext)?;
        Ok(Self { id, ciphertext })
    }

    pub fn decrypt(&self, key: &Key, context: &ChunkContext) -> Result<Vec<u8>> {
        let expected = context.expected_len()?;
        if self.ciphertext.len() != expected + 40 {
            return Err(SyncError::Protocol(
                "sealed attachment length mismatch".into(),
            ));
        }
        crypto::open(key, &context.aad(&self.id)?, &self.ciphertext)
    }
}

/// Attachment I/O uses its own bounded requests and does not occupy the note
/// changes log or materialize an entire file in memory.
pub struct AttachmentTransport {
    relay: RelayClient,
}

impl AttachmentTransport {
    pub fn new(server_url: &str, token: &str) -> Result<Self> {
        Ok(Self {
            relay: RelayClient::new(server_url, token)?,
        })
    }

    pub fn upload(&self, chunk: &SealedChunk) -> Result<()> {
        self.relay.put_attachment_blob(&chunk.id, &chunk.ciphertext)
    }

    /// None means not uploaded yet. Other transport/authentication failures are
    /// errors, not successful empty files.
    pub fn download(&self, id: &str) -> Result<Option<SealedChunk>> {
        Ok(self
            .relay
            .get_attachment_blob(id)?
            .map(|ciphertext| SealedChunk {
                id: id.to_owned(),
                ciphertext,
            }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn context(size: u64, index: u32) -> ChunkContext {
        ChunkContext {
            attachment_id: "12345678-1234-4234-8234-123456789abc".into(),
            index,
            total_size: size,
        }
    }

    #[test]
    fn bounded_roundtrip_and_persisted_retry() {
        let key = Key::generate();
        for (size, index, length) in [(262161, 0, 262144), (262161, 1, 17), (1, 0, 1)] {
            let ctx = context(size, index);
            let plain = vec![123; length];
            let chunk = SealedChunk::encrypt(&key, &ctx, &plain).unwrap();
            assert_eq!(chunk.ciphertext.len(), length + 40);
            let staged = serde_json::to_vec(&chunk).unwrap();
            let resumed: SealedChunk = serde_json::from_slice(&staged).unwrap();
            assert_eq!(resumed.id, chunk.id);
            assert_eq!(resumed.ciphertext, chunk.ciphertext);
            assert_eq!(resumed.decrypt(&key, &ctx).unwrap(), plain);
        }
    }

    #[test]
    fn rejects_substitution_tampering_and_wrong_key() {
        let key = Key::generate();
        let ctx = context(524288, 0);
        let chunk = SealedChunk::encrypt(&key, &ctx, &vec![7; 262144]).unwrap();
        assert!(chunk.decrypt(&Key::generate(), &ctx).is_err());
        assert!(chunk.decrypt(&key, &context(524288, 1)).is_err());
        assert!(chunk.decrypt(&key, &context(524289, 0)).is_err());
        let mut other_file = ctx.clone();
        other_file.attachment_id = Uuid::new_v4().to_string();
        assert!(chunk.decrypt(&key, &other_file).is_err());
        let mut other_id = chunk.clone();
        other_id.id = Uuid::new_v4().to_string();
        assert!(other_id.decrypt(&key, &ctx).is_err());
        let mut damaged = chunk.clone();
        damaged.ciphertext[30] ^= 1;
        assert!(damaged.decrypt(&key, &ctx).is_err());
        damaged.ciphertext.pop();
        assert!(damaged.decrypt(&key, &ctx).is_err());
    }

    #[test]
    fn validates_boundaries_before_encryption() {
        let key = Key::generate();
        assert!(SealedChunk::encrypt(&key, &context(0, 0), b"").is_err());
        assert!(SealedChunk::encrypt(&key, &context(1, 1), b"x").is_err());
        assert!(SealedChunk::encrypt(&key, &context(MAX_ATTACHMENT_BYTES + 1, 0), b"x").is_err());
        assert!(SealedChunk::encrypt(&key, &context(2, 0), b"x").is_err());
        assert_eq!(
            context(MAX_ATTACHMENT_BYTES, 4095).expected_len().unwrap(),
            262144
        );
        assert!(context(MAX_ATTACHMENT_BYTES, 4096).expected_len().is_err());
        let mut ctx = context(1, 0);
        ctx.attachment_id = "../x".into();
        assert!(SealedChunk::encrypt(&key, &ctx, b"x").is_err());
    }
}
