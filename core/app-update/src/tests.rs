//! Port of the Go update_test.go.

use super::*;
use std::collections::HashMap;
use std::net::TcpListener;
use tempfile::TempDir;

fn keypair() -> (VerifyingKey, SigningKey) {
    let sk = SigningKey::generate(&mut rand_core::OsRng);
    (sk.verifying_key(), sk)
}

#[test]
fn embedded_public_key() {
    parse_public_key(EMBEDDED_PUBLIC_KEY).unwrap();
}

#[test]
fn verify_manifest_cases() {
    let (pk, sk) = keypair();
    let data = br#"{"version":"0.2.0"}"#;
    let sig = sign(&sk, data);
    verify_manifest(&pk, data, sig.as_bytes()).unwrap();
    let (other, _) = keypair();
    let cases: [(&str, &VerifyingKey, &[u8], &[u8]); 4] = [
        ("tampered", &pk, br#"{"version":"9.9.9"}"#, sig.as_bytes()),
        ("wrongKey", &other, data, sig.as_bytes()),
        ("empty", &pk, data, b""),
        ("garbage", &pk, data, b"!!"),
    ];
    for (name, key, data, sig) in cases {
        assert!(verify_manifest(key, data, sig).is_err(), "{name} accepted");
    }
}

#[test]
fn semver() {
    let order = [
        "0.0.0-dev",
        "0.1.0",
        "0.2.0-alpha",
        "0.2.0-alpha.1",
        "0.2.0-alpha.beta",
        "0.2.0-beta.2",
        "0.2.0-beta.11",
        "0.2.0-rc.1",
        "0.2.0",
        "0.10.0",
        "1.0.0",
    ];
    for w in order.windows(2) {
        assert!(
            newer(w[1], w[0]) && !newer(w[0], w[1]),
            "{} should be newer than {}",
            w[1],
            w[0]
        );
    }
    assert!(
        !newer("0.2.0", "0.2.0") && !newer("0.2.0+build", "0.2.0"),
        "equal versions reported newer"
    );
    for bad in [
        "1.2",
        "1.2.3.4",
        "a.b.c",
        "1.-2.3",
        "+1.2.3",
        "1.2.3-",
        "1.2.3-a..b",
    ] {
        assert!(parse_semver(bad).is_none(), "{bad:?} parsed");
    }
}

#[test]
fn feed_base_rules() {
    assert!(feed_base("", "").is_err(), "empty feed accepted");
    assert!(
        feed_base("http://example.com/", "").is_err(),
        "plain http feed accepted"
    );
    assert!(
        feed_base("https://x/", "http://localhost:8000/").is_err(),
        "http override to non-127.0.0.1 accepted"
    );
    assert_eq!(
        feed_base("https://x/", "http://127.0.0.1:8000/feed")
            .unwrap()
            .as_str(),
        "http://127.0.0.1:8000/feed/"
    );
}

/// Minimal stored-entry zip writer: unlike `zip::ZipWriter` it keeps hostile
/// names (duplicates, "..", absolute) exactly as given.
fn make_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
    let crc = |d: &[u8]| {
        let mut c = !0u32;
        for b in d {
            c ^= *b as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 {
                    (c >> 1) ^ 0xEDB8_8320
                } else {
                    c >> 1
                };
            }
        }
        !c
    };
    let (mut out, mut central) = (Vec::new(), Vec::new());
    for (name, body) in entries {
        let off = out.len() as u32;
        let (c, n, len) = (crc(body), name.len() as u16, body.len() as u32);
        let common = |v: &mut Vec<u8>| {
            v.extend_from_slice(&[20, 0, 0, 0, 0, 0, 0, 0, 0, 0]); // version, flags, stored, time, date
            v.extend_from_slice(&c.to_le_bytes());
            v.extend_from_slice(&len.to_le_bytes());
            v.extend_from_slice(&len.to_le_bytes());
            v.extend_from_slice(&n.to_le_bytes());
            v.extend_from_slice(&0u16.to_le_bytes()); // extra
        };
        out.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        common(&mut out);
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(body);
        central.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        central.extend_from_slice(&[20, 0]); // made by
        common(&mut central);
        central.extend_from_slice(&[0; 6]); // comment len, disk, internal attrs
        central.extend_from_slice(&[0; 4]); // external attrs
        central.extend_from_slice(&off.to_le_bytes());
        central.extend_from_slice(name.as_bytes());
    }
    let (cd_off, cd_len, count) = (out.len() as u32, central.len() as u32, entries.len() as u16);
    out.extend_from_slice(&central);
    out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    out.extend_from_slice(&[0; 4]);
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&count.to_le_bytes());
    out.extend_from_slice(&cd_len.to_le_bytes());
    out.extend_from_slice(&cd_off.to_le_bytes());
    out.extend_from_slice(&[0; 2]);
    out
}

type Entry<'a> = (&'a str, &'a [u8]);

fn good_entries() -> Vec<Entry<'static>> {
    vec![
        ("Inkism/Inkism.exe", b"new-shell"),
        ("Inkism/inkism-engine.exe", b"new-engine"),
        ("Inkism/README.md", b"readme"),
    ]
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_else(|_| "<missing>".into())
}

#[test]
fn extract_package_cases() {
    let dir = TempDir::new().unwrap();
    let write = |data: Vec<u8>| {
        let p = dir.path().join("p.zip");
        fs::write(&p, data).unwrap();
        p
    };
    extract_package(&write(make_zip(&good_entries())), &dir.path().join("ok")).unwrap();
    assert_eq!(
        read(&dir.path().join("ok/Inkism.exe")),
        "new-shell",
        "not extracted"
    );

    let with = |extra: (&'static str, &'static [u8])| {
        let mut e = good_entries();
        e.push(extra);
        e
    };
    let big = vec![b'x'; (1 << 20) + 1];
    let mut oversize = good_entries()[..2].to_vec();
    oversize.push(("Inkism/BUILD.txt", &big));
    let cases: Vec<(&str, Vec<Entry>)> = vec![
        ("traversal", with(("Inkism/../evil.exe", b""))),
        ("absolute", with(("/etc/evil", b""))),
        ("unexpected", with(("Inkism/profile/notes.db", b""))),
        (
            "noPrefix",
            vec![("Inkism.exe", b""), ("inkism-engine.exe", b"")],
        ),
        ("duplicate", with(("Inkism/Inkism.exe", b""))),
        ("missingExe", vec![("Inkism/Inkism.exe", b"")]),
        ("oversize", oversize),
    ];
    for (name, entries) in cases {
        assert!(
            extract_package(&write(make_zip(&entries)), &dir.path().join(name)).is_err(),
            "{name} accepted"
        );
    }
}

/// Serves a signed manifest for the given zip on 127.0.0.1 (random port);
/// `mutate` tweaks the manifest before signing.
fn feed(sk: &SigningKey, version: &str, zip: &[u8], mutate: impl FnOnce(&mut Manifest)) -> String {
    let mut m = Manifest {
        version: version.into(),
        commit: "abc".into(),
        zip: format!("Inkism-{version}-windows-x64.zip"),
        sha256: hex(&Sha256::digest(zip)),
        notes: "새 기능".into(),
        ..Default::default()
    };
    mutate(&mut m);
    let manifest = serde_json::to_vec(&m).unwrap();
    let sig = sign(sk, &manifest);
    let routes: HashMap<String, Vec<u8>> = [
        ("/feed/latest.json".to_string(), manifest),
        ("/feed/latest.json.sig".into(), sig.into_bytes()),
        (format!("/feed/{}", escape_path(&m.zip)), zip.to_vec()),
    ]
    .into();
    serve(routes)
}

fn serve(routes: HashMap<String, Vec<u8>>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    std::thread::spawn(move || {
        for mut conn in listener.incoming().flatten() {
            let mut buf = [0u8; 4096];
            let n = conn.read(&mut buf).unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]);
            let path = req.split(' ').nth(1).unwrap_or("");
            let (status, body) = match routes.get(path) {
                Some(b) => ("200 OK", b.as_slice()),
                None => ("404 Not Found", &b"404 page not found\n"[..]),
            };
            let _ = write!(
                conn,
                "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = conn.write_all(body);
        }
    });
    format!("http://{addr}/feed")
}

fn test_updater(feed_url: &str, pk: VerifyingKey, current: &str, dir: &TempDir) -> Updater {
    let args = vec!["--db".into(), r"C:\x\profile\notes.db".into()];
    let mut u = Updater::with_override(
        current,
        "deadbeef",
        "https://unused.invalid/",
        feed_url,
        dir.path().to_path_buf(),
        args,
    );
    u.public_key = Some(pk);
    u
}

#[test]
fn check_and_prepare() {
    let (pk, sk) = keypair();
    let zip = make_zip(&good_entries());
    let dir = || TempDir::new().unwrap();

    let d = dir();
    let u = test_updater(&feed(&sk, "0.2.0", &zip, |_| {}), pk, "0.1.0", &d);
    let s = u.check();
    assert!(
        s.available && s.latest.as_ref().unwrap().version == "0.2.0" && s.error.is_empty(),
        "{s:?}"
    );
    let staging = u.prepare().unwrap();
    assert_eq!(
        read(&staging.join("inkism-engine.exe")),
        "new-engine",
        "staging missing engine"
    );

    let (d1, d2) = (dir(), dir());
    let s = test_updater(&feed(&sk, "0.1.0", &zip, |_| {}), pk, "0.1.0", &d1).check();
    assert!(!s.available && s.error.is_empty(), "same version: {s:?}");
    assert!(
        test_updater(&feed(&sk, "0.1.0", &zip, |_| {}), pk, "0.1.0", &d2)
            .prepare()
            .is_err(),
        "prepared a version that is not newer"
    );

    let (_, other) = keypair();
    let d3 = dir();
    let s = test_updater(&feed(&other, "0.2.0", &zip, |_| {}), pk, "0.1.0", &d3).check();
    assert!(
        !s.available && s.error.contains("서명"),
        "bad signature: {s:?}"
    );

    let d4 = dir();
    let err = test_updater(
        &feed(&sk, "0.2.0", &zip, |m| m.sha256 = "0".repeat(64)),
        pk,
        "0.1.0",
        &d4,
    )
    .prepare();
    assert!(
        err.as_ref()
            .is_err_and(|e| e.to_string().contains("SHA-256")),
        "sha mismatch: {err:?}"
    );

    let d5 = dir();
    let s = test_updater(
        &feed(&sk, "0.2.0", &zip, |m| m.zip = "../x.zip".into()),
        pk,
        "0.1.0",
        &d5,
    )
    .check();
    assert!(!s.error.is_empty(), "bad zip name accepted");
}

#[test]
fn apply_not_supported_off_windows() {
    let d = TempDir::new().unwrap();
    let r = Updater::with_override("0.1.0", "", "https://x/", "", d.path().into(), vec![]).apply();
    if !cfg!(windows) {
        assert!(matches!(r, Err(Error::NotSupported)), "{r:?}");
    }
}

fn setup_swap() -> (TempDir, PathBuf, PathBuf) {
    let d = TempDir::new().unwrap();
    let target = d.path().to_path_buf();
    let staging = target.join(WORK_DIR_NAME).join("staging");
    fs::create_dir_all(&staging).unwrap();
    fs::create_dir_all(target.join("profile")).unwrap();
    for (name, body) in [
        ("Inkism.exe", "old-shell"),
        ("inkism-engine.exe", "old-engine"),
        ("profile/notes.db", "data"),
    ] {
        fs::write(target.join(name), body).unwrap();
    }
    for (name, body) in [
        ("Inkism.exe", "new-shell"),
        ("inkism-engine.exe", "new-engine"),
        ("README.md", "new-readme"),
    ] {
        fs::write(staging.join(name), body).unwrap();
    }
    (d, staging, target)
}

#[test]
fn apply_staged_swaps() {
    let (_d, staging, target) = setup_swap();
    let mut launched = Vec::new();
    apply_staged(&staging, &target, |exe| {
        launched.push(read(exe));
        Ok(())
    })
    .unwrap();
    for (name, want) in [
        ("Inkism.exe", "new-shell"),
        ("inkism-engine.exe", "new-engine"),
        ("README.md", "new-readme"),
        ("Inkism.exe.old", "old-shell"),
        ("inkism-engine.exe.old", "old-engine"),
        ("profile/notes.db", "data"),
    ] {
        assert_eq!(read(&target.join(name)), want, "{name}");
    }
    assert_eq!(launched, ["new-shell"]);
}

#[test]
fn apply_staged_rolls_back_when_launch_fails() {
    let (_d, staging, target) = setup_swap();
    let mut launched = Vec::new();
    let r = apply_staged(&staging, &target, |exe| {
        launched.push(read(exe));
        if launched.len() == 1 {
            return Err(io::Error::other("bad exe"));
        }
        Ok(())
    });
    assert!(r.is_err(), "expected error");
    for (name, want) in [
        ("Inkism.exe", "old-shell"),
        ("inkism-engine.exe", "old-engine"),
        ("README.md", "<missing>"),
        ("profile/notes.db", "data"),
    ] {
        assert_eq!(read(&target.join(name)), want, "{name}");
    }
    assert_eq!(launched.len(), 2, "old app not relaunched: {launched:?}");
    assert_eq!(launched[1], "old-shell");
}

#[test]
fn apply_staged_rolls_back_mid_swap() {
    let (_d, staging, target) = setup_swap();
    // A non-empty directory at the engine backup path makes the engine backup
    // rename fail after Inkism.exe has already been swapped.
    fs::create_dir_all(target.join("inkism-engine.exe.old").join("x")).unwrap();
    let r = apply_staged_with(
        &staging,
        &target,
        |_| panic!("launched after failed swap"),
        Duration::ZERO,
    );
    assert!(r.is_err(), "expected error");
    for (name, want) in [
        ("Inkism.exe", "old-shell"),
        ("inkism-engine.exe", "old-engine"),
    ] {
        assert_eq!(read(&target.join(name)), want, "{name}");
    }
}

#[test]
fn run_helper_rejects_foreign_staging() {
    let d = TempDir::new().unwrap();
    let args: Vec<String> = [
        "/tmp/elsewhere",
        "--target",
        d.path().to_str().unwrap(),
        "--wait-pid",
        "1",
        "--",
    ]
    .map(String::from)
    .into();
    assert!(
        run_helper(&args).is_err(),
        "staging outside target accepted"
    );
}

/// End-to-end half of tests/cross-go.sh: serves a feed directory whose
/// latest.json was signed by the Go `update-sign`, then checks and prepares it.
#[test]
#[ignore = "run by tests/cross-go.sh"]
fn cross_go_signed_feed() {
    let dir = PathBuf::from(std::env::var("INKISM_CROSS_FEED_DIR").expect("INKISM_CROSS_FEED_DIR"));
    let pk = parse_public_key(&read(&dir.join("pub.key"))).unwrap();
    let routes = fs::read_dir(&dir)
        .unwrap()
        .flatten()
        .map(|e| {
            (
                format!("/feed/{}", e.file_name().to_string_lossy()),
                fs::read(e.path()).unwrap(),
            )
        })
        .collect();
    let d = TempDir::new().unwrap();
    let u = test_updater(&serve(routes), pk, "0.1.0", &d);
    let s = u.check();
    assert!(s.available && s.error.is_empty(), "{s:?}");
    let staging = u.prepare().unwrap();
    assert_eq!(read(&staging.join("Inkism.exe")), "cross-shell");
}
