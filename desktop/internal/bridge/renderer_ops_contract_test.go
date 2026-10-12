package bridge

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// Windows' Go bridge and the Rust local API serve the same renderer. A new
// renderer operation must neither disappear on Windows nor expose host-only I/O.
func TestRendererOperationContractMatchesRust(t *testing.T) {
	source, err := os.ReadFile("../../../core/local-api/src/rpc.rs")
	if err != nil {
		t.Fatal(err)
	}
	declaration := regexp.MustCompile(`(?s)const RENDERER_OPS:.*?= &\[(.*?)\];`).FindSubmatch(source)
	if len(declaration) != 2 {
		t.Fatal("missing Rust renderer contract")
	}
	expected := map[string]bool{}
	for _, match := range regexp.MustCompile(`"([a-z_]+)"`).FindAllSubmatch(declaration[1], -1) {
		expected[string(match[1])] = true
	}
	parsed, err := parser.ParseFile(token.NewFileSet(), "http.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	actual := map[string]bool{}
	for _, decl := range parsed.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Name.Name != "rendererRPC" {
			continue
		}
		ast.Inspect(fn, func(node ast.Node) bool {
			clause, ok := node.(*ast.CaseClause)
			if !ok {
				return true
			}
			for _, expression := range clause.List {
				literal, ok := expression.(*ast.BasicLit)
				if !ok {
					continue
				}
				value, err := strconv.Unquote(literal.Value)
				if err == nil {
					actual[value] = true
				}
			}
			return true
		})
	}
	if len(actual) == 0 {
		t.Fatal("missing Go renderer contract")
	}
	for op := range expected {
		if !actual[op] {
			t.Errorf("Windows bridge missing %s", op)
		}
	}
	for op := range actual {
		if !expected[op] {
			t.Errorf("Windows bridge exposes extra operation %s", op)
		}
	}
	for op := range actual {
		if strings.HasPrefix(op, "sync_recovery_") || op == "import" || op == "export" {
			t.Errorf("host-only operation exposed: %s", op)
		}
	}
}
