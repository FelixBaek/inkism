use inkism_engine::workspace;
use rusqlite::Connection;
use serde_json::json;

#[test]
fn workspace_reads_only_metadata_even_without_a_body_table() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE workspace_state(slot INTEGER PRIMARY KEY, ids TEXT, active TEXT, locations TEXT DEFAULT '{}');
        CREATE TABLE notes_meta(id TEXT PRIMARY KEY, title TEXT, revision INTEGER DEFAULT 1);
        INSERT INTO notes_meta(id,title) VALUES('a','제목');
        INSERT INTO workspace_state(slot,ids,active) VALUES(0,'[\"a\",\"deleted\"]','a');",
    )
    .unwrap();
    assert_eq!(
        workspace::get(&conn).unwrap(),
        json!({"tabs":[{"id":"a","title":"제목"}],"active":"a"})
    );
}

#[test]
fn corrupt_workspace_fails_without_replacing_the_stored_value() {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE workspace_state(slot INTEGER PRIMARY KEY, ids TEXT, active TEXT, locations TEXT DEFAULT '{}');
        INSERT INTO workspace_state(slot,ids,active) VALUES(0,'broken-json',NULL);",
    )
    .unwrap();
    assert!(workspace::get(&conn).is_err());
    let stored: String = conn
        .query_row("SELECT ids FROM workspace_state", [], |r| r.get(0))
        .unwrap();
    assert_eq!(stored, "broken-json");
}
