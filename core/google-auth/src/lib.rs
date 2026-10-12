//! Google sign-in for the Inkism desktop host.
//!
//! - [`auth`]: ephemeral desktop OIDC login (PKCE, loopback redirect) and
//!   ID-token verification against Google's published keys.
//! - [`host`]: the app-lock controller that binds the library to one Google
//!   account, its DPAPI-protected policy store and opt-in server recovery.

pub mod auth;
mod context;
pub mod host;

pub use context::Context;

pub type BoxError = Box<dyn std::error::Error + Send + Sync>;

#[cfg(test)]
mod test_http;
