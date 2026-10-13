//! inkism-sync-relay: serves the encrypted sync relay behind an HTTPS reverse
//! proxy. Flags, environment and exit codes match the former Go binary.
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper_util::rt::{TokioIo, TokioTimer};
use inkism_sync_relay::{google_jwks_fetcher, Relay};
use std::io::Read;
use std::process::exit;
use std::sync::Arc;
use std::time::Duration;
use zeroize::Zeroizing;

const USAGE: &str = "Usage of inkism-sync-relay:
  -db string
    \tOpaque encrypted event database (default \"relay.db\")
  -listen string
    \tListen behind HTTPS reverse proxy (default \"127.0.0.1:47832\")
  -register-owner-key-stdin
    \toffline administrator: register an existing vault key from stdin, then exit
  -tls-cert string
    \tTLS certificate
  -tls-key string
    \tTLS private key
";

fn fatal(msg: impl std::fmt::Display) -> ! {
    eprintln!("{msg}");
    exit(1)
}

fn usage_error(msg: String) -> ! {
    eprint!("{msg}\n{USAGE}");
    exit(2)
}

/// Go's flag package: -name or --name, value as next argument or after '=',
/// parsing stops at the first non-flag argument or "--".
struct Flags {
    listen: String,
    db: String,
    tls_cert: String,
    tls_key: String,
    register: bool,
}

/// The flag name and its inline `=value`; None ends parsing.
fn split_flag(arg: &str) -> Option<(&str, Option<String>)> {
    if arg.len() < 2 || !arg.starts_with('-') {
        return None;
    }
    let mut name = &arg[1..];
    if let Some(rest) = name.strip_prefix('-') {
        if rest.is_empty() {
            return None; // "--" terminates
        }
        name = rest;
    }
    if name.is_empty() || name.starts_with('-') || name.starts_with('=') {
        usage_error(format!("bad flag syntax: {arg}"));
    }
    Some(match name.split_once('=') {
        Some((n, v)) => (n, Some(v.to_owned())),
        None => (name, None),
    })
}

fn parse_bool(inline: Option<&str>, name: &str) -> bool {
    match inline {
        None | Some("1" | "t" | "T" | "true" | "TRUE" | "True") => true,
        Some("0" | "f" | "F" | "false" | "FALSE" | "False") => false,
        Some(v) => usage_error(format!("invalid boolean value {v:?} for -{name}: parse error")),
    }
}

fn parse_flags(args: impl Iterator<Item = String>) -> Flags {
    let mut f = Flags { listen: "127.0.0.1:47832".into(), db: "relay.db".into(), tls_cert: String::new(), tls_key: String::new(), register: false };
    let mut args = args.peekable();
    while let Some(arg) = args.next() {
        let Some((name, inline)) = split_flag(&arg) else { break };
        if name == "h" || name == "help" {
            eprint!("{USAGE}");
            exit(0);
        }
        if name == "register-owner-key-stdin" {
            f.register = parse_bool(inline.as_deref(), name);
            continue;
        }
        let slot = match name {
            "listen" => &mut f.listen,
            "db" => &mut f.db,
            "tls-cert" => &mut f.tls_cert,
            "tls-key" => &mut f.tls_key,
            _ => usage_error(format!("flag provided but not defined: -{name}")),
        };
        *slot = match inline.or_else(|| args.next()) {
            Some(v) => v,
            None => usage_error(format!("flag needs an argument: -{name}")),
        };
    }
    f
}

/// INKISM_<name>, falling back to the old NOOK_<name> so existing .env files keep working.
fn env(name: &str) -> String {
    match std::env::var("INKISM_".to_owned() + name) {
        Ok(v) if !v.is_empty() => v,
        _ => std::env::var("NOOK_".to_owned() + name).unwrap_or_default(),
    }
}

fn register_owner_key_stdin(relay: &mut Relay) {
    let mut raw = Zeroizing::new(Vec::new());
    if std::io::stdin().take(46).read_to_end(&mut raw).is_err() || raw.len() > 45 {
        fatal("invalid recovery provisioning input");
    }
    let text = String::from_utf8_lossy(&raw).trim().to_owned();
    let key = Zeroizing::new(inkism_sync_relay::decode_std(&text).unwrap_or_default());
    if key.is_empty() || relay.register_owner_key(&key).is_err() {
        fatal("recovery provisioning failed; preserve the original key and database");
    }
    eprintln!("owner recovery key registered");
}

fn main() {
    let flags = parse_flags(std::env::args().skip(1));
    let mut relay = Relay::open(&flags.db, &env("RELAY_TOKEN")).unwrap_or_else(|e| fatal(e));
    let (client_id, subject, encoded) = (env("RECOVERY_GOOGLE_CLIENT_ID"), env("RECOVERY_GOOGLE_SUBJECT"), Zeroizing::new(env("RECOVERY_MASTER_KEY")));
    if !client_id.is_empty() || !subject.is_empty() || !encoded.is_empty() {
        let master = Zeroizing::new(inkism_sync_relay::decode_std(&encoded).unwrap_or_else(|| fatal("invalid owner recovery master key")));
        let jwks = google_jwks_fetcher().unwrap_or_else(|e| fatal(e));
        relay.enable_owner_recovery(&client_id, &subject, &master, jwks).unwrap_or_else(|e| fatal(e));
    }
    if flags.register {
        register_owner_key_stdin(&mut relay);
        return;
    }
    let tls = (!flags.tls_cert.is_empty()).then(|| tls_acceptor(&flags.tls_cert, &flags.tls_key).unwrap_or_else(|e| fatal(e)));
    let runtime = tokio::runtime::Runtime::new().unwrap_or_else(|e| fatal(e));
    runtime.block_on(serve(relay, &flags.listen, tls));
}

fn tls_acceptor(cert: &str, key: &str) -> Result<tokio_rustls::TlsAcceptor, Box<dyn std::error::Error>> {
    use tokio_rustls::rustls::pki_types::{pem::PemObject, CertificateDer, PrivateKeyDer};
    let certs = CertificateDer::pem_file_iter(cert)?.collect::<Result<Vec<_>, _>>()?;
    let key = PrivateKeyDer::from_pem_file(key)?;
    let mut config = tokio_rustls::rustls::ServerConfig::builder().with_no_client_auth().with_single_cert(certs, key)?;
    config.alpn_protocols = vec![b"http/1.1".to_vec()];
    Ok(tokio_rustls::TlsAcceptor::from(Arc::new(config)))
}

/// Go's ":port" means every interface.
fn listen_addr(listen: &str) -> String {
    match listen.strip_prefix(':') {
        Some(port) => format!("[::]:{port}"),
        None => listen.to_owned(),
    }
}

// ponytail: Go's 90 s write and 60 s idle timeouts are not enforced; the
// 10 s header and 90 s body read limits are. The reverse proxy bounds the rest.
async fn serve(relay: Relay, listen: &str, tls: Option<tokio_rustls::TlsAcceptor>) {
    let listener = match tokio::net::TcpListener::bind(listen_addr(listen)).await {
        Ok(l) => l,
        Err(_) if listen.starts_with(':') => tokio::net::TcpListener::bind(format!("0.0.0.0{listen}")).await.unwrap_or_else(|e| fatal(e)),
        Err(e) => fatal(format!("listen tcp {listen}: {e}")),
    };
    eprintln!("Private encrypted sync relay: {listen}");
    loop {
        let stream = match listener.accept().await {
            Ok((stream, _addr)) => stream,
            Err(_) => {
                tokio::time::sleep(Duration::from_millis(100)).await;
                continue;
            }
        };
        let (relay, tls) = (relay.clone(), tls.clone());
        tokio::spawn(async move {
            let service = service_fn(move |req| {
                let relay = relay.clone();
                async move { Ok::<_, std::convert::Infallible>(relay.handle(req).await) }
            });
            let mut http = http1::Builder::new();
            http.timer(TokioTimer::new()).header_read_timeout(Duration::from_secs(10));
            match tls {
                Some(acceptor) => {
                    if let Ok(Ok(s)) = tokio::time::timeout(Duration::from_secs(10), acceptor.accept(stream)).await {
                        let _ = http.serve_connection(TokioIo::new(s), service).await;
                    }
                }
                None => {
                    let _ = http.serve_connection(TokioIo::new(stream), service).await;
                }
            }
        });
    }
}

