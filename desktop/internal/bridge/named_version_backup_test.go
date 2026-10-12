package bridge

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestNamedVersionAttachmentBackup(t *testing.T) {
	old := "11111111-1111-4111-8111-111111111111"
	next := "22222222-2222-4222-8222-222222222222"
	var row map[string]json.RawMessage
	if err := json.Unmarshal([]byte(`{"content":"current","named_versions":[{"label":"kept","content":"<img src=\"/api/attachments/`+old+`\">","text":""}]}`), &row); err != nil {
		t.Fatal(err)
	}
	if err := checkNoteReferences([]map[string]json.RawMessage{row}, map[string]bool{}); err == nil {
		t.Fatal("missing named-version attachment accepted")
	}
	if err := checkNoteReferences([]map[string]json.RawMessage{row}, map[string]bool{old: true}); err != nil {
		t.Fatal(err)
	}
	if err := remapNoteAssets(row, map[string]string{old: next}); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(row["named_versions"]), old) || !strings.Contains(string(row["named_versions"]), next) {
		t.Fatal(string(row["named_versions"]))
	}
}

func TestEncryptedNamedVersionAliases(t *testing.T) {
	old := "11111111-1111-4111-8111-111111111111"
	next := "22222222-2222-4222-8222-222222222222"
	var row map[string]json.RawMessage
	if err := json.Unmarshal([]byte(`{"encrypted_named_versions":[{"label":"kept","locked_body":{"ciphertext":"sealed","attachments":[{"id":"`+old+`","ref":"`+old+`"}]}}]}`), &row); err != nil {
		t.Fatal(err)
	}
	if err := checkNoteReferences([]map[string]json.RawMessage{row}, map[string]bool{}); err == nil {
		t.Fatal("missing attachment accepted")
	}
	if err := remapNoteAssets(row, map[string]string{old: next}); err != nil {
		t.Fatal(err)
	}
	versions, err := versionRows(row, "encrypted_named_versions")
	if err != nil {
		t.Fatal(err)
	}
	body, err := lockedBody(versions[0])
	if err != nil {
		t.Fatal(err)
	}
	if body["ciphertext"] != "sealed" || body.attachments()[0]["id"] != next || body.attachments()[0]["ref"] != old {
		t.Fatalf("bad body: %+v", body)
	}
}
