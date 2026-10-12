//! Attachment ciphertext: stored byte for byte under a canonical lowercase
//! UUID. The relay never sees vault keys, file names, or plaintext.
use crate::{closing, ReqBody, empty, error, http_error, not_found, read_limited, respond, store, with_allow, Body, Relay};
use hyper::header::{HeaderValue, CONTENT_TYPE};
use hyper::{Method, Request, Response, StatusCode};
use serde::Serialize;

pub const PREFIX: &str = "/v1/blobs/";
/// 24-byte XChaCha20 nonce plus 16-byte Poly1305 tag over an empty plaintext.
const MIN_BYTES: usize = 40;
/// 256 KiB plaintext chunk plus nonce and tag.
const MAX_BYTES: usize = (256 << 10) + 24 + 16;

/// Only the canonical 8-4-4-4-12 lowercase hex form, so one ID never aliases another.
fn valid_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == b'-',
            _ => c.is_ascii_digit() || (b'a'..=b'f').contains(&c),
        })
}

#[derive(Serialize)]
struct Size {
    size: usize,
}

pub async fn serve<B: ReqBody>(r: &Relay, req: Request<B>, id: &str) -> Response<Body> {
    if !valid_id(id) {
        return not_found();
    }
    match *req.method() {
        Method::PUT => put(r, req, id.to_owned()).await,
        Method::GET => get(r, id.to_owned()).await,
        _ => with_allow(http_error(StatusCode::METHOD_NOT_ALLOWED, "method not allowed"), "GET, PUT"),
    }
}

/// First upload 201, identical replay 200, different bytes 409 (original kept).
async fn put<B: ReqBody>(r: &Relay, req: Request<B>, id: String) -> Response<Body> {
    let (body, broken, over) = read_limited(req.into_body(), MAX_BYTES + 1).await;
    closing(store_blob(r, body, broken, id).await, over)
}

async fn store_blob(r: &Relay, body: Vec<u8>, broken: bool, id: String) -> Response<Body> {
    if broken {
        if body.len() > MAX_BYTES {
            return respond(StatusCode::PAYLOAD_TOO_LARGE, &error("blob exceeds maximum size"));
        }
        return respond(StatusCode::BAD_REQUEST, &error("failed to read blob body"));
    }
    if body.len() > MAX_BYTES {
        return respond(StatusCode::PAYLOAD_TOO_LARGE, &error("blob exceeds maximum size"));
    }
    if body.len() < MIN_BYTES {
        return respond(StatusCode::BAD_REQUEST, &error("blob below minimum ciphertext size"));
    }
    let size = body.len();
    let stored = r
        .db(move |s| {
            s.update(|tx| match store::get(tx, store::BLOBS, id.as_bytes())? {
                Some(existing) => Ok(Some(existing == body)),
                None => store::put(tx, store::BLOBS, id.as_bytes(), &body).map(|_| None),
            })
        })
        .await;
    match stored {
        Ok(None) => respond(StatusCode::CREATED, &Size { size }),
        Ok(Some(true)) => respond(StatusCode::OK, &Size { size }),
        Ok(Some(false)) => respond(StatusCode::CONFLICT, &error("blob id already stored with different bytes")),
        Err(e) => respond(StatusCode::INTERNAL_SERVER_ERROR, &error(&e.to_string())),
    }
}

async fn get(r: &Relay, id: String) -> Response<Body> {
    match r.db(move |s| s.view(|tx| store::get(tx, store::BLOBS, id.as_bytes()))).await {
        Ok(Some(payload)) => {
            let mut res = empty(StatusCode::OK);
            *res.body_mut() = Body::sized(payload);
            let h = res.headers_mut();
            h.insert(CONTENT_TYPE, HeaderValue::from_static("application/octet-stream"));
            h.insert("x-content-type-options", HeaderValue::from_static("nosniff"));
            res
        }
        Ok(None) => respond(StatusCode::NOT_FOUND, &error("blob not found")),
        Err(e) => respond(StatusCode::INTERNAL_SERVER_ERROR, &error(&e.to_string())),
    }
}
