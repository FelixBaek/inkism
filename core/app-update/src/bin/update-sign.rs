//! inkism-update-sign manages the Inkism update-feed ed25519 key.
//! Same files and output as the Go `update-sign`:
//!
//!   inkism-update-sign keygen <private-key> <public-key>   new keypair (private file 0600, never printed)
//!   inkism-update-sign sign   <private-key> <file>          writes <file>.sig (base64 signature)
//!   inkism-update-sign verify <public-key>  <file>          checks <file>.sig

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

use app_update::{
    b64_encode, parse_private_key, parse_public_key, sign, verify_manifest, SigningKey,
};

type R = Result<(), Box<dyn std::error::Error>>;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let Err(e) = run(&args) {
        eprintln!("update-sign: {e}");
        std::process::exit(1);
    }
}

fn sig_path(file: &str) -> PathBuf {
    format!("{file}.sig").into()
}

fn run(args: &[String]) -> R {
    let [cmd, key, file] = args else {
        return Err("usage: update-sign keygen|sign|verify <key> <file>".into());
    };
    match cmd.as_str() {
        "keygen" => {
            let sk = SigningKey::generate(&mut rand_core::OsRng);
            let mut o = OpenOptions::new();
            o.write(true).create_new(true);
            #[cfg(unix)]
            std::os::unix::fs::OpenOptionsExt::mode(&mut o, 0o600);
            o.open(key)?
                .write_all((b64_encode(&sk.to_keypair_bytes()) + "\n").as_bytes())?;
            write_public(file, &(b64_encode(sk.verifying_key().as_bytes()) + "\n"))
        }
        "sign" => {
            let sk = parse_private_key(&fs::read(key)?)?;
            let data = fs::read(file)?;
            write_public(&sig_path(file).to_string_lossy(), &sign(&sk, &data))
        }
        "verify" => {
            let pk = parse_public_key(&String::from_utf8_lossy(&fs::read(key)?))?;
            let data = fs::read(file)?;
            let sig = fs::read(sig_path(file))?;
            verify_manifest(&pk, &data, &sig)?;
            println!("signature OK");
            Ok(())
        }
        _ => Err(format!("unknown command {cmd:?}").into()),
    }
}

/// os.WriteFile(path, data, 0644): create or truncate.
fn write_public(path: &str, data: &str) -> R {
    let mut o = OpenOptions::new();
    o.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut o, 0o644);
    o.open(path)?.write_all(data.as_bytes())?;
    Ok(())
}
