//! Bounded, versioned recovery-key envelope primitives only.
//! No file I/O, DPAPI changes, password policy, RPC or automatic recovery.
//! A host must validate a recovered key against an existing database read-only
//! before publishing a new key envelope. Binding is host-supplied context,
//! not proof that any database can be opened.
use crate::{Result, RuntimeError};
use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use rand::{rngs::OsRng, RngCore};
use zeroize::Zeroizing;

/// Sensitive output intentionally redacts Debug and clears its owned bytes.
pub struct RecoveredKey(Zeroizing<[u8; 32]>);
impl RecoveredKey {
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}
impl std::fmt::Debug for RecoveredKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RecoveredKey([REDACTED])")
    }
}

const MAGIC: &[u8] = b"MINDBOX-RECOVERY-KEY-1\n";
const PURPOSE: u8 = 1;
// RFC 9106's memory-constrained recommendation, fixed for format v1.
// Untrusted parameters are never passed to Argon2.
const MEMORY_KIB: u32 = 65536;
const PASSES: u32 = 3;
const LANES: u32 = 4;
const PARAM_START: usize = MAGIC.len() + 1;
const SALT_START: usize = PARAM_START + 12;
const NONCE_START: usize = SALT_START + 16;
const BINDING_START: usize = NONCE_START + 24;
const AAD_LEN: usize = BINDING_START + 32;
pub const ENVELOPE_BYTES: usize = AAD_LEN + 32 + 16;
pub const MAX_PASSWORD_BYTES: usize = 1024;

fn invalid() -> RuntimeError {
    RuntimeError::config("invalid recovery envelope or passphrase")
}
fn password_valid(password: &[u8]) -> Result<()> {
    if password.is_empty() || password.len() > MAX_PASSWORD_BYTES {
        return Err(invalid());
    }
    Ok(())
}
fn derive(password: &[u8], salt: &[u8]) -> Result<Zeroizing<[u8; 32]>> {
    password_valid(password)?;
    let params = Params::new(MEMORY_KIB, PASSES, LANES, Some(32)).map_err(|_| invalid())?;
    let kdf = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new([0u8; 32]);
    let mut memory = Zeroizing::new(vec![argon2::Block::default(); MEMORY_KIB as usize]);
    kdf.hash_password_into_with_memory(password, salt, key.as_mut(), memory.as_mut_slice())
        .map_err(|_| invalid())?;
    Ok(key)
}

fn validate_header(envelope: &[u8], expected_binding: &[u8; 32]) -> Result<()> {
    if envelope.len() != ENVELOPE_BYTES
        || !envelope.starts_with(MAGIC)
        || envelope[MAGIC.len()] != PURPOSE
        || envelope[PARAM_START..PARAM_START + 4] != MEMORY_KIB.to_le_bytes()
        || envelope[PARAM_START + 4..PARAM_START + 8] != PASSES.to_le_bytes()
        || envelope[PARAM_START + 8..SALT_START] != LANES.to_le_bytes()
        || envelope[BINDING_START..AAD_LEN] != *expected_binding
    {
        return Err(invalid());
    }
    Ok(())
}

/// Wrap a synthetic or explicitly supplied 32-byte key. Caller owns and clears
/// password input; raw key and derived KEK never enter an error or Debug string.
pub fn seal(secret: &[u8; 32], password: &[u8], binding: &[u8; 32]) -> Result<Vec<u8>> {
    password_valid(password)?;
    let mut envelope = Vec::with_capacity(ENVELOPE_BYTES);
    envelope.extend_from_slice(MAGIC);
    envelope.push(PURPOSE);
    envelope.extend_from_slice(&MEMORY_KIB.to_le_bytes());
    envelope.extend_from_slice(&PASSES.to_le_bytes());
    envelope.extend_from_slice(&LANES.to_le_bytes());
    let mut random = [0u8; 40];
    OsRng.try_fill_bytes(&mut random).map_err(|_| invalid())?;
    envelope.extend_from_slice(&random);
    envelope.extend_from_slice(binding);
    let key = derive(password, &envelope[SALT_START..NONCE_START])?;
    let cipher = XChaCha20Poly1305::new(key.as_ref().into());
    let ciphertext = cipher
        .encrypt(
            XNonce::from_slice(&envelope[NONCE_START..BINDING_START]),
            Payload {
                msg: secret,
                aad: &envelope,
            },
        )
        .map_err(|_| invalid())?;
    envelope.extend_from_slice(&ciphertext);
    Ok(envelope)
}

/// Decode exactly one bounded envelope. Invalid version, purpose, KDF parameters,
/// length and binding are rejected before expensive derivation.
pub fn open(envelope: &[u8], password: &[u8], expected_binding: &[u8; 32]) -> Result<RecoveredKey> {
    validate_header(envelope, expected_binding)?;
    let key = derive(password, &envelope[SALT_START..NONCE_START])?;
    let cipher = XChaCha20Poly1305::new(key.as_ref().into());
    let plain = Zeroizing::new(
        cipher
            .decrypt(
                XNonce::from_slice(&envelope[NONCE_START..BINDING_START]),
                Payload {
                    msg: &envelope[AAD_LEN..],
                    aad: &envelope[..AAD_LEN],
                },
            )
            .map_err(|_| invalid())?,
    );
    let mut result = Zeroizing::new([0u8; 32]);
    if plain.len() != result.len() {
        return Err(invalid());
    }
    result.copy_from_slice(&plain);
    Ok(RecoveredKey(result))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn synthetic_roundtrip_randomizes_and_rejects_wrong_password() {
        let secret = [0x53u8; 32];
        let binding = [0x24u8; 32];
        let password = b"synthetic test passphrase";
        let a = seal(&secret, password, &binding).unwrap();
        let b = seal(&secret, password, &binding).unwrap();
        assert_eq!(a.len(), ENVELOPE_BYTES);
        assert_eq!(
            format!("{:?}", open(&a, password, &binding).unwrap()),
            "RecoveredKey([REDACTED])"
        );
        assert_ne!(a, b);
        assert!(!a.windows(secret.len()).any(|part| part == secret));
        assert!(!a.windows(password.len()).any(|part| part == password));
        assert_eq!(*open(&a, password, &binding).unwrap().as_bytes(), secret);
        let error = open(&a, b"wrong synthetic password", &binding)
            .unwrap_err()
            .to_string();
        assert!(!error.contains("wrong synthetic"));
    }

    #[test]
    fn header_and_size_tampering_are_rejected_before_derivation() {
        let binding = [7u8; 32];
        let envelope = seal(&[9u8; 32], b"synthetic password", &binding).unwrap();
        for offset in [
            0,
            MAGIC.len() - 2,
            MAGIC.len(),
            PARAM_START,
            PARAM_START + 4,
            PARAM_START + 8,
            BINDING_START,
        ] {
            let mut bad = envelope.clone();
            bad[offset] ^= 0xff;
            assert!(validate_header(&bad, &binding).is_err(), "offset {offset}");
            assert!(open(&bad, b"synthetic password", &binding).is_err());
        }
        for size in [0, 1, ENVELOPE_BYTES - 1, ENVELOPE_BYTES + 1, 65537] {
            assert!(open(&vec![0; size], b"synthetic password", &binding).is_err());
        }
        assert!(open(&envelope, b"synthetic password", &[8u8; 32]).is_err());
        let mut bomb = envelope.clone();
        bomb[PARAM_START..SALT_START].fill(255);
        assert!(validate_header(&bomb, &binding).is_err());
        assert!(seal(&[9u8; 32], b"", &binding).is_err());
        assert!(seal(&[9u8; 32], &vec![1; MAX_PASSWORD_BYTES + 1], &binding).is_err());
    }

    #[test]
    fn authenticated_salt_nonce_and_ciphertext_cannot_be_modified() {
        let binding = [3u8; 32];
        let envelope = seal(&[5u8; 32], b"synthetic password", &binding).unwrap();
        for offset in [SALT_START, NONCE_START, AAD_LEN, ENVELOPE_BYTES - 1] {
            let mut bad = envelope.clone();
            bad[offset] ^= 1;
            assert!(
                open(&bad, b"synthetic password", &binding).is_err(),
                "offset {offset}"
            );
        }
        assert_eq!(
            *open(&envelope, b"synthetic password", &binding)
                .unwrap()
                .as_bytes(),
            [5u8; 32]
        );
    }
}
