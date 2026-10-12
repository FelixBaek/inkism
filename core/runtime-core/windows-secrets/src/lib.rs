//! Minimal Windows DPAPI boundary. The runtime itself forbids unsafe Rust.
//! Current-user scope only; never request machine scope or interactive prompts.
#![cfg(windows)]
#![deny(unsafe_op_in_unsafe_fn)]

use std::{io, ptr};
use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
};

pub fn protect(input: &[u8]) -> io::Result<Vec<u8>> {
    transform(input, false)
}
pub fn unprotect(input: &[u8]) -> io::Result<Vec<u8>> {
    transform(input, true)
}

struct Output(CRYPT_INTEGER_BLOB);
impl Drop for Output {
    fn drop(&mut self) {
        if self.0.pbData.is_null() {
            return;
        }
        // DPAPI owns this allocation and reports its exact length. Clear the
        // temporary plaintext before releasing it with the documented allocator.
        unsafe {
            for i in 0..self.0.cbData as usize {
                self.0.pbData.add(i).write_volatile(0);
            }
            LocalFree(self.0.pbData.cast());
        }
    }
}
fn transform(input: &[u8], decrypt: bool) -> io::Result<Vec<u8>> {
    let length = u32::try_from(input.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "secret too large"))?;
    if input.is_empty() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "empty secret"));
    }
    let data = CRYPT_INTEGER_BLOB {
        cbData: length,
        pbData: input.as_ptr().cast_mut(),
    };
    let mut output = Output(CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: ptr::null_mut(),
    });
    // The input slice stays alive throughout the call. Both APIs treat it as
    // input-only. Optional description, entropy and prompt pointers are NULL.
    let ok = unsafe {
        if decrypt {
            CryptUnprotectData(
                &data,
                ptr::null_mut(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output.0,
            )
        } else {
            CryptProtectData(
                &data,
                ptr::null(),
                ptr::null(),
                ptr::null(),
                ptr::null(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output.0,
            )
        }
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    if output.0.pbData.is_null() || output.0.cbData == 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "empty DPAPI output",
        ));
    }
    // Successful DPAPI calls return an allocation valid for cbData bytes. Copy
    // it into Rust ownership; Output then clears and frees the native buffer.
    Ok(unsafe { std::slice::from_raw_parts(output.0.pbData, output.0.cbData as usize) }.to_vec())
}
