//! Bounded HTTP delivery of a fully verified, owned temporary download.
use crate::Response;
use bytes::Bytes;
use http_body_util::{combinators::BoxBody, BodyExt, Full};
use hyper::body::{Body, Frame, SizeHint};
use std::{io, pin::Pin, task::{Context, Poll}};
use tokio::io::{AsyncRead, ReadBuf};

pub type HttpBody = BoxBody<Bytes, io::Error>;

pub struct FileBody {
    reader: tokio::fs::File,
    // Keep the spool alive until completion/cancellation; never expose its path.
    _owner: tempfile::NamedTempFile,
    remaining: u64,
}
impl FileBody {
    pub fn new(owner: tempfile::NamedTempFile) -> io::Result<Self> {
        let remaining = owner.as_file().metadata()?.len();
        let reader = tokio::fs::File::from_std(owner.reopen()?);
        Ok(Self { reader, _owner: owner, remaining })
    }
}
impl Body for FileBody {
    type Data = Bytes;
    type Error = io::Error;
    fn poll_frame(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Result<Frame<Bytes>, io::Error>>> {
        if self.remaining == 0 { return Poll::Ready(None); }
        let mut bytes = [0; 64 * 1024];
        let capacity = self.remaining.min(bytes.len() as u64) as usize;
        let mut buffer = ReadBuf::new(&mut bytes[..capacity]);
        match Pin::new(&mut self.reader).poll_read(cx, &mut buffer) {
            Poll::Pending => Poll::Pending,
            Poll::Ready(Err(error)) => Poll::Ready(Some(Err(error))),
            Poll::Ready(Ok(())) => {
                let data = buffer.filled();
                if data.is_empty() { return Poll::Ready(Some(Err(io::Error::new(io::ErrorKind::UnexpectedEof, "download file truncated")))); }
                self.remaining -= data.len() as u64;
                Poll::Ready(Some(Ok(Frame::data(Bytes::copy_from_slice(data)))))
            }
        }
    }
    fn is_end_stream(&self) -> bool { self.remaining == 0 }
    fn size_hint(&self) -> SizeHint { SizeHint::with_exact(self.remaining) }
}

pub fn into_http(response: Response) -> hyper::Response<HttpBody> {
    let mut builder = hyper::Response::builder().status(response.status);
    for (name,value) in &response.headers { builder = builder.header(name,value); }
    let body = if let Some(file) = response.file {
        match FileBody::new(file) {
            Ok(body) => { builder = builder.header("content-length",body.remaining); body.boxed() }
            Err(error) => return into_http(Response::fail(500,error)),
        }
    } else { Full::new(Bytes::from(response.body)).map_err(|never| match never {}).boxed() };
    builder.body(body).unwrap_or_else(|_| hyper::Response::new(Full::new(Bytes::new()).map_err(|never| match never {}).boxed()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Write,Seek};
    #[test]
    fn buffered_adapters_enforce_limit_before_allocating_and_clean_spools() {
        let mut file=tempfile::NamedTempFile::new().unwrap();file.write_all(b"backup").unwrap();
        file.as_file_mut().rewind().unwrap();let path=file.path().to_path_buf();
        let response=Response {status:200,headers:vec![],body:vec![],file:Some(file)}.into_buffered(6).unwrap();
        assert_eq!(response.body,b"backup");assert!(!path.exists());
        let file=tempfile::NamedTempFile::new().unwrap();file.as_file().set_len(100_000_000).unwrap();let path=file.path().to_path_buf();
        let result=Response {status:200,headers:vec![],body:vec![],file:Some(file)}.into_buffered(64*1024*1024);
        assert!(matches!(result,Err(e) if e.kind()==io::ErrorKind::InvalidData));assert!(!path.exists());
    }
    #[tokio::test]
    async fn cancellation_and_truncation_do_not_succeed_as_complete_downloads() {
        let mut file=tempfile::NamedTempFile::new().unwrap();file.write_all(&vec![7;200000]).unwrap();
        let path=file.path().to_path_buf();let mut body=FileBody::new(file).unwrap();
        body.frame().await.unwrap().unwrap();drop(body);assert!(!path.exists());
        let mut file=tempfile::NamedTempFile::new().unwrap();file.write_all(b"complete").unwrap();
        let mut body=FileBody::new(file).unwrap();body._owner.as_file().set_len(0).unwrap();
        assert_eq!(body.frame().await.unwrap().unwrap_err().kind(),io::ErrorKind::UnexpectedEof);
    }
    #[tokio::test]
    async fn bounded_frames_and_drop_remove_the_owned_spool() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        let data = vec![42; 200_000]; file.write_all(&data).unwrap();
        let path = file.path().to_path_buf();
        let mut body = FileBody::new(file).unwrap();
        let mut actual = Vec::new();
        while let Some(frame) = body.frame().await {
            let bytes = frame.unwrap().into_data().unwrap();
            assert!(bytes.len() <= 65536); actual.extend_from_slice(&bytes);
        }
        assert_eq!(actual,data); assert!(path.exists());
        drop(body); assert!(!path.exists());
        let file = tempfile::NamedTempFile::new().unwrap();let path=file.path().to_path_buf();
        drop(FileBody::new(file).unwrap());assert!(!path.exists(),"cancelled downloads clean their spool");
    }
}
