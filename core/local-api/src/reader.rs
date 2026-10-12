//! Explicit, anonymous public-web reading. Resolved addresses are validated in
//! the connector itself, preventing DNS rebinding between validation and use.
use crate::{Request, Response};
use reqwest::{
    blocking::Client,
    dns::{Addrs, Name, Resolve, Resolving},
};
use serde::Deserialize;
use serde_json::json;
use std::{
    io::Read,
    net::{IpAddr, ToSocketAddrs},
    sync::Arc,
    time::{Duration, Instant},
};
use url::Url;
const LIMIT: usize = 2 * 1024 * 1024;
type Error = Box<dyn std::error::Error + Send + Sync>;
fn public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || (a == 100 && (64..=127).contains(&b))
                || (a == 169 && b == 254)
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && (b == 168 || (b == 0 && (c == 0 || c == 2)) || (b == 88 && c == 99)))
                || (a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                || (a == 203 && b == 0 && c == 113))
        }
        IpAddr::V6(ip) => {
            let s = ip.segments();
            // Only native globally routable unicast. Exclude transition,
            // benchmarking, documentation and special-purpose allocations.
            s[0] & 0xe000 == 0x2000
                && s[0] != 0x2002
                && !(s[0] == 0x2001 && (s[1] < 0x0200 || s[1] == 0x0db8))
                && !(s[0] == 0x3fff && s[1] <= 0x0fff)
        }
    }
}
fn validate(raw: &str) -> Result<Url, Error> {
    if raw.len() > 4096 {
        return Err("URL is too long".into());
    }
    let mut u = Url::parse(raw)?;
    if !matches!(u.scheme(), "http" | "https")
        || !u.username().is_empty()
        || u.password().is_some()
        || !matches!(
            (u.scheme(), u.port_or_known_default()),
            ("http", Some(80)) | ("https", Some(443))
        )
    {
        return Err("Only anonymous HTTP/HTTPS pages on standard ports are supported".into());
    }
    let host = u.host().ok_or("missing host")?;
    match host {
        url::Host::Ipv4(ip) if !public(ip.into()) => return Err("private address rejected".into()),
        url::Host::Ipv6(ip) if !public(ip.into()) => return Err("private address rejected".into()),
        url::Host::Domain(name)
            if !name.contains('.') || name.ends_with(".localhost") || name.ends_with(".local") =>
        {
            return Err("local host rejected".into())
        }
        _ => {}
    }
    u.set_fragment(None);
    Ok(u)
}
struct PublicDns;
impl Resolve for PublicDns {
    fn resolve(&self, name: Name) -> Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let addresses = tokio::task::spawn_blocking(move || {
                (host.as_str(), 0)
                    .to_socket_addrs()
                    .map(|a| a.collect::<Vec<_>>())
            })
            .await??;
            if addresses.is_empty() || addresses.iter().any(|a| !public(a.ip())) {
                return Err("DNS resolved to a non-public address".into());
            }
            Ok(Box::new(addresses.into_iter()) as Addrs)
        })
    }
}
fn client() -> Result<Client, Error> {
    Ok(Client::builder()
        .no_proxy()
        .dns_resolver(Arc::new(PublicDns))
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(12))
        .user_agent("Inkism Reader/1.0")
        .build()?)
}
fn fetch(client: &Client, raw: &str) -> Result<serde_json::Value, Error> {
    let mut url = validate(raw)?;
    let until = Instant::now() + Duration::from_secs(12);
    for hop in 0..=5 {
        let remaining = until
            .checked_duration_since(Instant::now())
            .ok_or("reader timed out")?;
        let response = client
            .get(url.clone())
            .timeout(remaining)
            .header("Accept", "text/html,application/xhtml+xml,text/plain;q=0.8")
            .send()?;
        if response.status().is_redirection() {
            if hop == 5 {
                return Err("too many redirects".into());
            }
            let location = response
                .headers()
                .get("location")
                .ok_or("missing redirect location")?
                .to_str()?;
            let next = validate(url.join(location)?.as_str())?;
            if url.scheme() == "https" && next.scheme() != "https" {
                return Err("insecure redirect rejected".into());
            }
            url = next;
            continue;
        }
        if !response.status().is_success() {
            return Err("page could not be read".into());
        }
        let kind = response
            .headers()
            .get("content-type")
            .and_then(|x| x.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        if !matches!(
            kind.as_str(),
            "text/html" | "application/xhtml+xml" | "text/plain"
        ) {
            return Err("page is not HTML or text".into());
        }
        if response.content_length().is_some_and(|n| n > LIMIT as u64) {
            return Err("page exceeds 2 MB".into());
        }
        let mut body = Vec::new();
        response.take((LIMIT + 1) as u64).read_to_end(&mut body)?;
        if body.len() > LIMIT {
            return Err("page exceeds 2 MB".into());
        }
        let source = std::str::from_utf8(&body).map_err(|_| "only UTF-8 pages are supported")?;
        let (title, cleaned) = inkism_web_content::reader(source, kind == "text/plain")?;
        let title = if title.is_empty() {
            url.host_str().unwrap_or("Web page").to_string()
        } else {
            title
        };
        return Ok(
            json!({"url":url.as_str(),"title":title,"html":cleaned.html,"text":cleaned.text}),
        );
    }
    Err("too many redirects".into())
}
pub(crate) fn serve(r: &Request) -> Response {
    if r.method != "POST" {
        return Response::fail(405, "use POST");
    }
    if r.body.len() > 8192 {
        return Response::fail(413, "request too large");
    }
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Input {
        url: String,
    }
    let input: Input = match serde_json::from_slice(&r.body) {
        Ok(v) => v,
        Err(_) => return Response::fail(400, "invalid reader request"),
    };
    match client().and_then(|c| fetch(&c, &input.url)) {
        Ok(data) => Response::json(200, &json!({"ok":true,"data":data})),
        Err(error) => Response::fail(400, error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader, Write},
        net::TcpListener,
        thread,
    };
    fn fixture(response: &'static str) -> (Client, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut headers = String::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" || line.is_empty() {
                    break;
                }
                headers.push_str(&line);
            }
            stream.write_all(response.as_bytes()).unwrap();
            headers
        });
        // Test-only dial override, production always uses PublicDns.
        let client = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .resolve("reader.example", address)
            .timeout(Duration::from_secs(3))
            .build()
            .unwrap();
        (client, server)
    }
    #[test]
    fn rejects_nonpublic_and_credentials_ports_and_transition_addresses() {
        for address in [
            "0.0.0.0",
            "127.0.0.1",
            "10.0.0.1",
            "169.254.169.254",
            "100.64.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "192.0.2.1",
            "198.18.0.1",
            "198.51.100.1",
            "203.0.113.1",
            "224.0.0.1",
            "255.255.255.255",
            "::1",
            "::ffff:127.0.0.1",
            "fe80::1",
            "fc00::1",
            "2002:7f00:1::",
            "2001:db8::1",
            "64:ff9b::7f00:1",
        ] {
            assert!(!public(address.parse().unwrap()), "{address}");
        }
        assert!(public("8.8.8.8".parse().unwrap()));
        assert!(public("2606:4700:4700::1111".parse().unwrap()));
        for u in [
            "file:///etc/passwd",
            "http://localhost",
            "http://127.1",
            "http://2130706433",
            "http://example.com:8080",
            "https://user:password@example.com",
            "http://[::ffff:127.0.0.1]",
        ] {
            assert!(validate(u).is_err(), "{u}");
        }
    }
    #[test]
    fn fetches_fixture_without_auth_and_removes_scripts_and_subresources() {
        let (client,server)=fixture("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n<title>Fixture</title><nav>noise</nav><article><h1>Article</h1><p>safe text</p><script>alert(1)</script><img src='http://127.0.0.1/secret'><iframe src='http://127.0.0.1/'></iframe><form>form</form></article>");
        let result = fetch(&client, "http://reader.example/").unwrap();
        assert_eq!(result["title"], "Fixture");
        assert!(result["html"].as_str().unwrap().contains("safe text"));
        for forbidden in ["script", "iframe", "<img", "127.0.0.1", "noise"] {
            assert!(!result["html"].as_str().unwrap().contains(forbidden));
        }
        let headers = server.join().unwrap().to_lowercase();
        for header in ["authorization:", "cookie:", "referer:"] {
            assert!(!headers.contains(header));
        }
    }
    #[test]
    fn redirects_are_revalidated_before_a_second_connection() {
        let (client,server)=fixture("HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1/secret\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        assert!(fetch(&client, "http://reader.example/")
            .unwrap_err()
            .to_string()
            .contains("private"));
        server.join().unwrap();
    }
    #[test]
    fn rejects_oversize_and_non_document_responses() {
        for response in ["HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 2097153\r\nConnection: close\r\n\r\n", "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"] {
            let (client,server)=fixture(response); assert!(fetch(&client,"http://reader.example/").is_err()); server.join().unwrap();
        }
    }
    #[test]
    fn dns_connector_rejects_loopback_resolution() {
        let runtime = tokio::runtime::Runtime::new().unwrap();
        assert!(runtime
            .block_on(PublicDns.resolve("localhost".parse().unwrap()))
            .is_err());
    }
}
