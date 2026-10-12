//! Bounded JSONL framing shared by the standalone and integrated engines.
use std::io::BufRead;

/// Read one \\n-terminated line, capped at `cap` bytes. Overlong lines are
/// fully drained (never parsed). Returns:
///   Ok(Some(over))  – a line was read; `over` = it exceeded the cap
///   Ok(None)        – clean EOF with no bytes
pub fn read_line_capped<R: BufRead>(
    reader: &mut R,
    line: &mut Vec<u8>,
    cap: usize,
) -> std::io::Result<Option<bool>> {
    line.clear();
    let mut over = false;
    loop {
        let avail = reader.fill_buf()?;
        if avail.is_empty() {
            return if line.is_empty() && !over {
                Ok(None)
            } else {
                Ok(Some(over)) // final line without trailing newline
            };
        }
        match avail.iter().position(|&b| b == b'\n') {
            Some(pos) => {
                over = over || !append_within(line, &avail[..pos], cap);
                reader.consume(pos + 1);
                return Ok(Some(over));
            }
            None => {
                over = over || !append_within(line, avail, cap);
                let n = avail.len();
                reader.consume(n);
            }
        }
    }
}

/// Appends `chunk` when the line stays within `cap`; false when it would not.
fn append_within(line: &mut Vec<u8>, chunk: &[u8], cap: usize) -> bool {
    let fits = line.len() + chunk.len() <= cap;
    if fits {
        line.extend_from_slice(chunk);
    }
    fits
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufReader, Cursor};

    #[test]
    fn blank_lines_never_consume_next_request() {
        for capacity in [1, 2, 7, 256] {
            let mut input =
                BufReader::with_capacity(capacity, Cursor::new(b"\n\r\n{\"op\":\"health\"}\nlast"));
            let mut line = Vec::new();
            for expected in [b"".as_slice(), b"\r", b"{\"op\":\"health\"}", b"last"] {
                assert_eq!(
                    read_line_capped(&mut input, &mut line, 64).unwrap(),
                    Some(false)
                );
                assert_eq!(line, expected);
            }
            assert_eq!(read_line_capped(&mut input, &mut line, 64).unwrap(), None);
        }
    }

    #[test]
    fn oversized_line_is_drained_and_next_line_is_intact() {
        for capacity in [1, 3, 8, 64] {
            let mut input =
                BufReader::with_capacity(capacity, Cursor::new(b"123456789012345\n12345\n123456"));
            let mut line = Vec::new();
            assert_eq!(
                read_line_capped(&mut input, &mut line, 5).unwrap(),
                Some(true)
            );
            assert!(line.len() <= 5);
            assert_eq!(
                read_line_capped(&mut input, &mut line, 5).unwrap(),
                Some(false)
            );
            assert_eq!(line, b"12345");
            assert_eq!(
                read_line_capped(&mut input, &mut line, 5).unwrap(),
                Some(true)
            );
            assert_eq!(read_line_capped(&mut input, &mut line, 5).unwrap(), None);
        }
    }
}
