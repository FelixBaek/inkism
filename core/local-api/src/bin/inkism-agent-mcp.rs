//! MCP stdio server for the read-only Agent API (`docs/agent-api.md`): each
//! tool is one GET on the loopback API, so it can do nothing the API cannot.
//!
//! INKISM_AGENT_TOKEN=inkism_... [INKISM_AGENT_URL=http://127.0.0.1:47832/agent/v1] inkism-agent-mcp

use serde_json::{json, Value};
use std::io::{BufRead, Write};

const PROTOCOL: &str = "2025-06-18";

struct Client {
    base: String,
    token: String,
    http: reqwest::blocking::Client,
}

fn tools() -> Value {
    let page = json!({"cursor": {"type": "string", "description": "next_cursor from the previous page"}, "limit": {"type": "integer", "minimum": 1, "maximum": 100}});
    let with = |extra: Value, required: &[&str]| {
        let mut p = page.clone();
        p.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        json!({"type": "object", "properties": p, "required": required})
    };
    json!([
        {"name": "list_notes", "description": "List Inkism notes (newest first). Keep paging while next_cursor is not null; a page may hold fewer than limit notes.", "inputSchema": with(json!({}), &[])},
        {"name": "search_notes", "description": "Full-text search over Inkism notes.", "inputSchema": with(json!({"query": {"type": "string"}}), &["query"])},
        {"name": "get_note", "description": "Read one note: plain text, Markdown source when the note is Markdown, and properties.", "inputSchema": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"]}},
        {"name": "list_changes", "description": "Notes changed after a cursor, oldest first. removed:true means the note is no longer visible; drop it. Store next_cursor and pass it next time.", "inputSchema": with(json!({}), &[])},
    ])
}

impl Client {
    fn get(&self, path: &str, query: &[(&str, String)]) -> Result<Value, String> {
        let res = self.http.get(format!("{}{path}", self.base)).query(query).bearer_auth(&self.token).send().map_err(|e| format!("Inkism Agent API unreachable: {e}"))?;
        let status = res.status();
        let body: Value = serde_json::from_str(&res.text().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(format!("{status}: {}", body["error"].as_str().unwrap_or("request failed")));
        }
        Ok(body["data"].clone())
    }

    fn call(&self, name: &str, args: &Value) -> Result<Value, String> {
        let s = |k: &str| args[k].as_str().map(str::to_string);
        let mut query: Vec<(&str, String)> = Vec::new();
        if let Some(c) = s("cursor") {
            query.push(("cursor", c));
        }
        if let Some(l) = args["limit"].as_u64() {
            query.push(("limit", l.to_string()));
        }
        match name {
            "list_notes" => self.get("/notes", &query),
            "list_changes" => self.get("/changes", &query),
            "search_notes" => {
                query.push(("q", s("query").ok_or("query required")?));
                self.get("/search", &query)
            }
            "get_note" => {
                let id = s("id").ok_or("id required")?;
                self.get(&format!("/notes/{}", percent_encoding::utf8_percent_encode(&id, percent_encoding::NON_ALPHANUMERIC)), &[])
            }
            _ => Err(format!("unknown tool {name}")),
        }
    }

    /// One JSON-RPC message; `None` for notifications.
    fn handle(&self, msg: &Value) -> Option<Value> {
        let id = msg.get("id")?.clone();
        let params = &msg["params"];
        let result = match msg["method"].as_str().unwrap_or("") {
            "initialize" => json!({
                "protocolVersion": params["protocolVersion"].as_str().unwrap_or(PROTOCOL),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "inkism", "version": env!("CARGO_PKG_VERSION")},
                "instructions": "Read-only access to the user's Inkism notes.",
            }),
            "ping" => json!({}),
            "tools/list" => json!({"tools": tools()}),
            "tools/call" => {
                let (text, error) = match self.call(params["name"].as_str().unwrap_or(""), &params["arguments"]) {
                    Ok(v) => (v.to_string(), false),
                    Err(e) => (e, true),
                };
                json!({"content": [{"type": "text", "text": text}], "isError": error})
            }
            method => return Some(json!({"jsonrpc": "2.0", "id": id, "error": {"code": -32601, "message": format!("method not found: {method}")}})),
        };
        Some(json!({"jsonrpc": "2.0", "id": id, "result": result}))
    }
}

fn main() {
    let Ok(token) = std::env::var("INKISM_AGENT_TOKEN") else {
        eprintln!("INKISM_AGENT_TOKEN is required (create one in Inkism settings › Agent API)");
        std::process::exit(2);
    };
    let base = std::env::var("INKISM_AGENT_URL").unwrap_or_else(|_| format!("http://127.0.0.1:{}/agent/v1", local_api::agent::DEFAULT_PORT));
    let http = reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(100)).build().expect("HTTP client");
    let client = Client { base: base.trim_end_matches('/').to_string(), token, http };
    let mut out = std::io::stdout().lock();
    for line in std::io::stdin().lock().lines() {
        let Ok(line) = line else { break };
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(msg) => client.handle(&msg),
            Err(_) if line.trim().is_empty() => None,
            Err(_) => Some(json!({"jsonrpc": "2.0", "id": null, "error": {"code": -32700, "message": "parse error"}})),
        };
        if let Some(reply) = reply {
            let _ = writeln!(out, "{reply}");
            let _ = out.flush();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use local_api::{AgentApi, Engine, Handler, Request};
    use std::sync::{Arc, Mutex};

    struct Real(Mutex<inkism_engine::Engine>);
    impl Engine for Real {
        fn call(&self, _: local_api::Deadline, request: &[u8]) -> local_api::Result<Vec<u8>> {
            Ok(serde_json::to_vec(&self.0.lock().unwrap().execute(serde_json::from_slice(request)?))?)
        }
    }

    fn command(h: &Handler, body: Value) -> Value {
        let r = Request { method: "POST".into(), path: "/api/agent".into(), query: None, headers: vec![("content-type".into(), "application/json".into())], host: String::new(), body: body.to_string().into_bytes() };
        serde_json::from_slice(&h.handle(&r).body).unwrap()
    }

    /// The MCP tools against a real listener and engine.
    #[test]
    fn tools_read_through_the_api() {
        let dir = tempfile::tempdir().unwrap();
        let engine = Arc::new(Real(Mutex::new(inkism_engine::Engine::open(dir.path().join("notes.db").to_str().unwrap()).unwrap())));
        let note = engine.0.lock().unwrap().execute(json!({"op": "save", "note": {"title": "hello", "content": "# hi", "content_format": "markdown"}}))["data"]["id"].clone();
        let config = dir.path().join("agent.json");
        std::fs::write(&config, r#"{"port":0}"#).unwrap();
        let mut handler = Handler::default();
        handler.agent = Some(AgentApi::with_path(engine, None, Some(config)));
        let status = command(&handler, json!({"action": "enable"}))["status"].clone();
        let token = command(&handler, json!({"action": "create", "name": "mcp"}))["data"]["token"].as_str().unwrap().to_string();
        let http = reqwest::blocking::Client::new();
        let client = Client { base: status["url"].as_str().unwrap().to_string(), token, http };
        let call = |name: &str, args: Value| client.handle(&json!({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": args}})).unwrap()["result"].clone();
        let listed = call("list_notes", json!({}));
        assert_eq!(listed["isError"], false, "{listed}");
        assert!(listed["content"][0]["text"].as_str().unwrap().contains("hello"));
        let got: Value = serde_json::from_str(call("get_note", json!({"id": note}))["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(got["markdown"], "# hi");
        assert_eq!(call("get_note", json!({"id": "missing"}))["isError"], true);
        assert_eq!(call("list_changes", json!({}))["isError"], false);
        let bad = Client { token: "inkism_wrong".into(), ..client };
        assert_eq!(bad.handle(&json!({"id": 2, "method": "tools/call", "params": {"name": "list_notes", "arguments": {}}})).unwrap()["result"]["isError"], true);
        assert!(bad.handle(&json!({"method": "notifications/initialized"})).is_none());
        assert_eq!(bad.handle(&json!({"id": 3, "method": "tools/list"})).unwrap()["result"]["tools"].as_array().unwrap().len(), 4);
        assert_eq!(bad.handle(&json!({"id": 4, "method": "resources/write"})).unwrap()["error"]["code"], -32601);
    }
}
