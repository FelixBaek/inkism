//! Go `syscall.EscapeArg`: quotes one argument for a Windows command line
//! (MSVCRT rules). Works on UTF-16 units; every special character is ASCII.

const QUOTE: u16 = b'"' as u16;
const BACKSLASH: u16 = b'\\' as u16;
const SPACE: u16 = b' ' as u16;
const TAB: u16 = b'\t' as u16;

pub(crate) fn escape_arg(s: &[u16]) -> Vec<u16> {
    if s.is_empty() {
        return vec![QUOTE, QUOTE];
    }
    let needs_backslash = s.iter().any(|&c| c == QUOTE || c == BACKSLASH);
    let has_space = s.iter().any(|&c| c == SPACE || c == TAB);
    if !needs_backslash && !has_space {
        return s.to_vec();
    }
    if !needs_backslash {
        return [&[QUOTE], s, &[QUOTE]].concat();
    }
    let mut out = Vec::with_capacity(s.len() + 2);
    if has_space {
        out.push(QUOTE);
    }
    let mut slashes = 0;
    for &c in s {
        match c {
            BACKSLASH => slashes += 1,
            QUOTE => {
                out.extend(std::iter::repeat_n(BACKSLASH, slashes + 1));
                slashes = 0;
            }
            _ => slashes = 0,
        }
        out.push(c);
    }
    if has_space {
        out.extend(std::iter::repeat_n(BACKSLASH, slashes));
        out.push(QUOTE);
    }
    out
}

#[cfg(test)]
mod tests {
    fn esc(s: &str) -> String {
        String::from_utf16(&super::escape_arg(&s.encode_utf16().collect::<Vec<_>>())).unwrap()
    }

    #[test]
    fn matches_go_escape_arg() {
        // Expected values from Go syscall.EscapeArg.
        for (input, want) in [
            ("", r#""""#),
            ("plain", "plain"),
            ("a b", r#""a b""#),
            ("a\tb", "\"a\tb\""),
            (r#"a"b"#, r#"a\"b"#),
            (r"C:\dir\", r"C:\dir\"),
            (r"C:\my dir\", r#""C:\my dir\\""#),
            (r#"x\"y z"#, r#""x\\\"y z""#),
            (
                r"--user-data-dir=C:\Users\홍 길동\inkism-pdf-1\profile",
                r#""--user-data-dir=C:\Users\홍 길동\inkism-pdf-1\profile""#,
            ),
        ] {
            assert_eq!(esc(input), want, "{input:?}");
        }
    }
}
