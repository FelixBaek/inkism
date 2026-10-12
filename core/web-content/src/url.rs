//! Go `SourceURL`: the subset of Go `net/url` (`Parse` + `String`) that an
//! `http`/`https` URL goes through, ported so the normalized string matches
//! Go byte for byte (no punycode, no trailing slash, no port rewriting).

use std::net::Ipv6Addr;

use crate::Error;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Enc {
    Path,
    Host,
    Zone,
    Fragment,
}

/// Accepts only absolute `http`/`https` URLs with a host and no userinfo,
/// at most 4096 bytes. Returns Go's `url.String()` with the fragment removed.
pub fn source_url(raw: &str) -> Result<String, Error> {
    parse(raw).ok_or_else(|| Error::new("HTTP(S) source URL required"))
}

fn parse(raw: &str) -> Option<String> {
    if raw.len() > 4096 {
        return None;
    }
    let (rest, fragment) = match raw.split_once('#') {
        Some((u, f)) => (u, Some(f)),
        None => (raw, None),
    };
    if rest.bytes().any(|b| b < b' ' || b == 0x7f) {
        return None;
    }
    let (scheme, rest) = scheme(rest)?;
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let (rest, force_query, query) = split_query(rest);
    // Without "//" Go leaves the host empty (opaque or OmitHost), which SourceURL rejects.
    let authority_and_path = rest.strip_prefix("//")?;
    let (authority, path) = match authority_and_path.find('/') {
        Some(i) => authority_and_path.split_at(i),
        None => (authority_and_path, ""),
    };
    // Any '@' means userinfo (rejected) or a parse error.
    if authority.contains('@') {
        return None;
    }
    let host = parse_host(authority)?;
    if hostname(&host).is_empty() {
        return None;
    }
    let decoded_path = unescape(path.as_bytes(), Enc::Path)?;
    if let Some(f) = fragment.filter(|f| !f.is_empty()) {
        unescape(f.as_bytes(), Enc::Fragment)?;
    }
    let mut out = Vec::with_capacity(raw.len() + 16);
    out.extend_from_slice(scheme.as_bytes());
    out.extend_from_slice(b"://");
    out.extend(escape(&host, Enc::Host));
    write_path(&mut out, path, &decoded_path);
    if force_query || !query.is_empty() {
        out.push(b'?');
        out.extend_from_slice(query.as_bytes());
    }
    String::from_utf8(out).ok()
}

/// Returns (rest, force_query, query).
fn split_query(rest: &str) -> (&str, bool, &str) {
    if rest.ends_with('?') && rest.matches('?').count() == 1 {
        return (&rest[..rest.len() - 1], true, "");
    }
    match rest.split_once('?') {
        Some((r, q)) => (r, false, q),
        None => (rest, false, ""),
    }
}

/// EscapedPath: the raw path when it is a valid encoding, else re-escaped.
fn write_path(out: &mut Vec<u8>, path: &str, decoded_path: &[u8]) {
    if escape(decoded_path, Enc::Path) == path.as_bytes() || valid_encoded_path(path.as_bytes()) {
        out.extend_from_slice(path.as_bytes());
    } else {
        out.extend(escape(decoded_path, Enc::Path));
    }
}

fn scheme(raw: &str) -> Option<(String, &str)> {
    for (i, c) in raw.bytes().enumerate() {
        match c {
            b'a'..=b'z' | b'A'..=b'Z' => {}
            b'0'..=b'9' | b'+' | b'-' | b'.' if i > 0 => {}
            b':' if i > 0 => return Some((raw[..i].to_ascii_lowercase(), &raw[i + 1..])),
            _ => return None,
        }
    }
    None
}

/// Go `parseHost` for http(s) (strict colons). Returns the unescaped host.
fn parse_host(host: &str) -> Option<Vec<u8>> {
    match host.rfind('[') {
        Some(0) => parse_bracketed_host(host),
        Some(_) => None,
        None => {
            if let Some(i) = host.find(':') {
                if !valid_optional_port(&host.as_bytes()[i..]) {
                    return None;
                }
            }
            unescape(host.as_bytes(), Enc::Host)
        }
    }
}

/// The "[ipv6%zone]:port" form of [`parse_host`].
fn parse_bracketed_host(host: &str) -> Option<Vec<u8>> {
    let close = host.rfind(']')?;
    let colon_port = &host[close + 1..];
    if !valid_optional_port(colon_port.as_bytes()) {
        return None;
    }
    let name = &host[1..close];
    let mut unescaped = match name.find("%25") {
        Some(z) => {
            let mut h = unescape(&name.as_bytes()[..z], Enc::Host)?;
            h.extend(unescape(&name.as_bytes()[z..], Enc::Zone)?);
            h
        }
        None => unescape(name.as_bytes(), Enc::Host)?,
    };
    if !is_ipv6(&unescaped) {
        return None;
    }
    unescaped.insert(0, b'[');
    unescaped.push(b']');
    unescaped.extend_from_slice(colon_port.as_bytes());
    Some(unescaped)
}

/// Go `netip.ParseAddr(s)` succeeding with an IPv6 (not IPv4) address.
fn is_ipv6(s: &[u8]) -> bool {
    let Ok(s) = std::str::from_utf8(s) else {
        return false;
    };
    let (addr, zone) = match s.split_once('%') {
        Some((a, z)) => (a, Some(z)),
        None => (s, None),
    };
    zone != Some("") && addr.parse::<Ipv6Addr>().is_ok()
}

/// Go `URL.Hostname`.
fn hostname(host: &[u8]) -> &[u8] {
    let mut h = host;
    if let Some(colon) = h.iter().rposition(|&b| b == b':') {
        if valid_optional_port(&h[colon..]) {
            h = &h[..colon];
        }
    }
    if h.len() >= 2 && h[0] == b'[' && h[h.len() - 1] == b']' {
        h = &h[1..h.len() - 1];
    }
    h
}

fn valid_optional_port(port: &[u8]) -> bool {
    match port.split_first() {
        None => true,
        Some((b':', digits)) => digits.iter().all(u8::is_ascii_digit),
        Some(_) => false,
    }
}

fn should_escape(c: u8, mode: Enc) -> bool {
    if c.is_ascii_alphanumeric() {
        return false;
    }
    if matches!(mode, Enc::Host | Enc::Zone)
        && matches!(
            c,
            b'!' | b'$'
                | b'&'
                | b'\''
                | b'('
                | b')'
                | b'*'
                | b'+'
                | b','
                | b';'
                | b'='
                | b':'
                | b'['
                | b']'
                | b'<'
                | b'>'
                | b'"'
        )
    {
        return false;
    }
    match c {
        b'-' | b'_' | b'.' | b'~' => return false,
        b'$' | b'&' | b'+' | b',' | b'/' | b':' | b';' | b'=' | b'?' | b'@' => match mode {
            Enc::Path => return c == b'?',
            Enc::Fragment => return false,
            Enc::Host | Enc::Zone => {}
        },
        _ => {}
    }
    !(mode == Enc::Fragment && matches!(c, b'!' | b'(' | b')' | b'*'))
}

fn unhex(c: u8) -> Option<u8> {
    (c as char).to_digit(16).map(|d| d as u8)
}

/// One `%xx` sequence at `s[i]`, with Go's host and zone restrictions.
fn unescape_hex(s: &[u8], i: usize, mode: Enc) -> Option<u8> {
    if i + 2 >= s.len() {
        return None;
    }
    let (hi, lo) = (unhex(s[i + 1])?, unhex(s[i + 2])?);
    let v = hi << 4 | lo;
    let is_25 = &s[i..i + 3] == b"%25";
    if mode == Enc::Host && hi < 8 && !is_25 {
        return None;
    }
    if mode == Enc::Zone && !is_25 && v != b' ' && should_escape(v, Enc::Host) {
        return None;
    }
    Some(v)
}

/// Go `unescape` (modes other than query components).
fn unescape(s: &[u8], mode: Enc) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(s.len());
    let mut i = 0;
    while i < s.len() {
        let c = s[i];
        if c == b'%' {
            out.push(unescape_hex(s, i, mode)?);
            i += 3;
            continue;
        }
        if matches!(mode, Enc::Host | Enc::Zone) && c < 0x80 && should_escape(c, mode) {
            return None;
        }
        out.push(c);
        i += 1;
    }
    Some(out)
}

fn escape(s: &[u8], mode: Enc) -> Vec<u8> {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut out = Vec::with_capacity(s.len());
    for &c in s {
        if should_escape(c, mode) {
            out.extend_from_slice(&[b'%', HEX[(c >> 4) as usize], HEX[(c & 15) as usize]]);
        } else {
            out.push(c);
        }
    }
    out
}

/// Go `validEncoded(s, encodePath)`.
fn valid_encoded_path(s: &[u8]) -> bool {
    s.iter().all(|&c| {
        matches!(
            c,
            b'!' | b'$'
                | b'&'
                | b'\''
                | b'('
                | b')'
                | b'*'
                | b'+'
                | b','
                | b';'
                | b'='
                | b':'
                | b'@'
                | b'['
                | b']'
                | b'%'
        ) || !should_escape(c, Enc::Path)
    })
}
