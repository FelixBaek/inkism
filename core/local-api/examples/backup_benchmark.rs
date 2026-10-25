//! Synthetic backup export measurement (no user library or external service).
//! cargo run --release --example backup_benchmark -- 256
//! /usr/bin/time -v reports a fresh process's peak RSS. Attachments are generated
//! in 64 KiB chunks, so fixture allocation does not account for the ZIP's size.
use local_api::{AttachmentMetadata, Attachments, Deadline, Engine, Handler, Request, Result};
use sha2::{Digest, Sha256};
use std::{io::{Read, Write}, sync::Arc, time::Instant};

struct Fixture { count: usize, hash: String, chunk: Vec<u8> }
const FILE_BYTES: usize = 8 * 1024 * 1024;
impl Engine for Fixture {
    fn call(&self, _: Deadline, request: &[u8]) -> Result<Vec<u8>> {
        let req: serde_json::Value = serde_json::from_slice(request)?;
        if req["op"] != "export" { return Err("unexpected benchmark operation".into()); }
        let mut file = std::fs::File::create(req["path"].as_str().ok_or("missing path")?)?;
        file.write_all(b"{\"version\":1,\"notes\":[")?;
        for i in 0..10000 {
            if i > 0 { file.write_all(b",")?; }
            serde_json::to_writer(&mut file, &serde_json::json!({"id":format!("note-{i}"),"title":"Synthetic backup note","content":"Synthetic paragraph. ".repeat(40),"tags":[]}))?;
        }
        file.write_all(b"],\"notebooks\":[]}")?;
        Ok(br#"{"ok":true,"data":{"notes":10000}}"#.to_vec())
    }
    fn attachments(&self) -> Option<&dyn Attachments> { Some(self) }
}
impl Attachments for Fixture {
    fn import(&self, _: Deadline, _: &str, _: &str, _: &mut dyn Read) -> Result<AttachmentMetadata> { Err("unexpected import".into()) }
    fn info(&self, _: Deadline, _: &str) -> Result<AttachmentMetadata> { Err("unexpected info".into()) }
    fn export(&self, _: Deadline, _: &str, output: &mut dyn Write) -> Result<()> {
        for _ in 0..FILE_BYTES/self.chunk.len() { output.write_all(&self.chunk)?; }
        Ok(())
    }
    fn walk(&self, _: Deadline, visit: &mut dyn FnMut(AttachmentMetadata) -> Result<()>) -> Result<()> {
        for i in 0..self.count {
            visit(AttachmentMetadata {id:format!("{i:08x}-1111-4111-8111-111111111111"),name:format!("synthetic-{i}.bin"),media_type:"application/octet-stream".into(),size:FILE_BYTES as u64,sha256:self.hash.clone()})?;
        }
        Ok(())
    }
}
fn main() {
    let mib: usize = std::env::args().nth(1).unwrap_or("256".into()).parse().expect("MiB");
    assert!((8..=2048).contains(&mib) && mib % 8 == 0);
    let chunk: Vec<u8> = (0..65536).map(|i| (i % 251) as u8).collect();
    let mut hash = Sha256::new();
    for _ in 0..FILE_BYTES/chunk.len() { hash.update(&chunk); }
    let fixture = Fixture {count:mib/8,hash:format!("{:x}",hash.finalize()),chunk};
    let mut handler = Handler::default();
    handler.engine = Some(Arc::new(fixture));
    let request = Request {method:"GET".into(),path:"/api/backup".into(),query:None,headers:vec![],host:"127.0.0.1".into(),body:vec![]};
    let start = Instant::now();
    let response = handler.handle(&request);
    assert_eq!(response.status,200,"{}",String::from_utf8_lossy(&response.body));
    let elapsed_ms=start.elapsed().as_secs_f64()*1000.0;
    let mut file=response.file.expect("backup must be file-backed");
    assert!(response.body.is_empty());
    let bundle_bytes=file.as_file().metadata().unwrap().len();
    let mut hash=Sha256::new();let mut buffer=[0;65536];
    loop {let count=file.read(&mut buffer).unwrap();if count==0{break;}hash.update(&buffer[..count]);}
    println!("{}",serde_json::json!({"attachment_mib":mib,"notes":10000,"bundle_bytes":bundle_bytes,"elapsed_ms":elapsed_ms,"sha256":format!("{:x}",hash.finalize())}));
}
