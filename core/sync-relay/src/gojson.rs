//! JSON exactly as Go's encoding/json writes and reads it, so stored values and
//! responses stay byte-identical with the Go relay.
use serde::de::{Deserialize, Deserializer, MapAccess, Visitor};
use serde::Serialize;
use serde_json::Value;

/// json.Marshal: serde_json output plus Go's HTML-safe escapes. Those bytes can
/// only occur inside JSON strings, so a byte-level rewrite is exact.
pub fn marshal<T: Serialize>(v: &T) -> Vec<u8> {
    let raw = serde_json::to_vec(v).expect("relay values always serialize");
    let mut out = Vec::with_capacity(raw.len() + 16);
    let mut i = 0;
    while i < raw.len() {
        match raw[i] {
            b'<' => out.extend_from_slice(b"\\u003c"),
            b'>' => out.extend_from_slice(b"\\u003e"),
            b'&' => out.extend_from_slice(b"\\u0026"),
            0xE2 if raw.get(i + 1) == Some(&0x80) && matches!(raw.get(i + 2), Some(0xA8 | 0xA9)) => {
                out.extend_from_slice(if raw[i + 2] == 0xA8 { b"\\u2028" } else { b"\\u2029" });
                i += 2;
            }
            b => out.push(b),
        }
        i += 1;
    }
    out
}

/// One decoded JSON object as Go sees it while filling a struct: entries in
/// input order, keys matched case-insensitively, the last non-null value wins.
/// A top-level `null` decodes to an empty object (Go leaves the zero value).
pub struct Object(Vec<(String, Value)>);

impl<'de> Deserialize<'de> for Object {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Object;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a JSON object")
            }
            fn visit_unit<E>(self) -> Result<Object, E> {
                Ok(Object(Vec::new()))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut m: A) -> Result<Object, A::Error> {
                let mut entries = Vec::new();
                while let Some(entry) = m.next_entry::<String, Value>()? {
                    entries.push(entry);
                }
                Ok(Object(entries))
            }
        }
        d.deserialize_any(V)
    }
}

/// Decodes the first JSON value of `buf` (json.Decoder.Decode). Returns the
/// object and whether only whitespace follows it (the next Decode is io.EOF).
/// `known` enables DisallowUnknownFields.
pub fn decode_first(buf: &[u8], known: Option<&[&str]>) -> Result<(Object, bool), ()> {
    let mut de = serde_json::Deserializer::from_slice(buf);
    let obj = Object::deserialize(&mut de).map_err(|_| ())?;
    if let Some(known) = known {
        if obj.0.iter().any(|(k, _)| !known.iter().any(|n| fold_eq(k, n))) {
            return Err(());
        }
    }
    Ok((obj, de.end().is_ok()))
}

/// json.Unmarshal: exactly one value, unknown fields ignored.
pub fn unmarshal(buf: &[u8]) -> Result<Object, ()> {
    match decode_first(buf, None)? {
        (obj, true) => Ok(obj),
        _ => Err(()),
    }
}

// ponytail: ASCII case folding; Go also folds U+017F/U+212A onto s/k in field names.
fn fold_eq(key: &str, name: &str) -> bool {
    key.eq_ignore_ascii_case(name)
}

impl Object {
    fn each<'a, 'n>(&'a self, name: &'n str) -> impl Iterator<Item = &'a Value> + use<'a, 'n> {
        self.0.iter().filter(move |(k, _)| fold_eq(k, name)).map(|(_, v)| v)
    }
    fn field<T: Default>(&self, name: &str, get: impl Fn(&Value) -> Option<T>) -> Result<T, ()> {
        let mut out = T::default();
        for v in self.each(name).filter(|v| !v.is_null()) {
            out = get(v).ok_or(())?;
        }
        Ok(out)
    }
    pub fn string(&self, name: &str) -> Result<String, ()> {
        self.field(name, |v| v.as_str().map(str::to_owned))
    }
    pub fn u64(&self, name: &str) -> Result<u64, ()> {
        self.field(name, |v| v.as_u64())
    }
    pub fn i64(&self, name: &str) -> Result<i64, ()> {
        self.field(name, |v| v.as_i64())
    }
    pub fn bool(&self, name: &str) -> Result<bool, ()> {
        self.field(name, |v| v.as_bool())
    }
    /// []string: null elements stay "" like Go's zero value.
    pub fn strings(&self, name: &str) -> Result<Vec<String>, ()> {
        self.field(name, strings)
    }
    /// json.RawMessage keeps the last value verbatim, null included.
    pub fn raw(&self, name: &str) -> Option<&Value> {
        self.each(name).last()
    }
    pub fn objects(&self, name: &str) -> Result<Vec<Object>, ()> {
        self.field(name, |v| {
            v.as_array()?
                .iter()
                .map(|item| serde_json::from_value::<Object>(item.clone()).ok())
                .collect()
        })
    }
}

/// Decodes a JSON value into a Go []string.
pub fn strings(v: &Value) -> Option<Vec<String>> {
    v.as_array()?
        .iter()
        .map(|s| match s {
            Value::Null => Some(String::new()),
            Value::String(s) => Some(s.clone()),
            _ => None,
        })
        .collect()
}
