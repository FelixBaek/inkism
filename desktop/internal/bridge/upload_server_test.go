package bridge

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http"
	"strconv"
	"testing"
)

func TestUploadServerRequiresAppOriginTokenAndUploadRoute(t *testing.T) {
	fake := &attachmentFake{}
	server, err := StartUploadServer(fake)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	cases := []struct {
		method, path, origin, token, host string
		want                              int
	}{
		{"POST", "/api/attachments", "https://example.com", server.Access.Token, "", 403},
		{"POST", "/api/attachments", "", server.Access.Token, "", 403},
		{"POST", "/api/attachments", "http://wails.localhost", "", "", 403},
		{"POST", "/api/attachments", "http://wails.localhost", "wrong", "", 403},
		{"POST", "/api/attachments", "http://wails.localhost", server.Access.Token, "evil.local", 403},
		{"GET", "/api/attachments", "http://wails.localhost", server.Access.Token, "", 405},
		{"POST", "/api/rpc", "http://wails.localhost", server.Access.Token, "", 404},
		{"GET", "/api/upload-access", "http://wails.localhost", server.Access.Token, "", 404},
	}
	for _, tc := range cases {
		req, _ := http.NewRequest(tc.method, server.Access.URL+tc.path, bytes.NewReader([]byte("must not read")))
		req.Header.Set("Origin", tc.origin)
		req.Header.Set("Authorization", "Bearer "+tc.token)
		if tc.host != "" {
			req.Host = tc.host
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if res.StatusCode != tc.want {
			t.Fatalf("%+v: %d %s", tc, res.StatusCode, body)
		}
		if bytes.Contains(body, []byte(server.Access.Token)) {
			t.Fatal("capability leaked")
		}
	}
	if len(fake.data) != 0 {
		t.Fatal("unauthorized request reached storage")
	}
	request, _ := http.NewRequest("OPTIONS", server.Access.URL+"/api/attachments", nil)
	request.Header.Set("Origin", "http://wails.localhost")
	request.Header.Set("Access-Control-Request-Method", "POST")
	request.Header.Set("Access-Control-Request-Headers", "authorization,content-type")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 204 || response.Header.Get("Access-Control-Allow-Origin") != "http://wails.localhost" {
		t.Fatal("app preflight rejected")
	}
}

func TestUploadServerStreamsMultipartWithoutChangingBytes(t *testing.T) {
	fake := &attachmentFake{}
	server, err := StartUploadServer(fake)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	content := bytes.Repeat([]byte{0, 1, 255, 128, 13, 10}, 350000)
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, _ := form.CreateFormFile("file", "한글 파일.bin")
	part.Write(content)
	form.WriteField("size", strconv.Itoa(len(content)))
	form.Close()
	request, _ := http.NewRequest("POST", server.Access.URL+"/api/attachments", &body)
	request.Header.Set("Origin", "http://wails.localhost")
	request.Header.Set("Authorization", "Bearer "+server.Access.Token)
	request.Header.Set("Content-Type", form.FormDataContentType())
	request.Header.Set("Sec-Fetch-Site", "cross-site")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	result, _ := io.ReadAll(response.Body)
	response.Body.Close()
	if response.StatusCode != 201 {
		t.Fatalf("%d %s", response.StatusCode, result)
	}
	if !bytes.Equal(fake.data, content) {
		t.Fatal("multipart binary bytes changed")
	}
	if response.Header.Get("Access-Control-Allow-Origin") != "http://wails.localhost" {
		t.Fatal("missing upload CORS")
	}
	if err := server.Close(); err != nil {
		t.Fatal(err)
	}
	if res, err := http.DefaultClient.Do(request); err == nil {
		res.Body.Close()
		t.Fatal("upload listener still running")
	}
}

func TestAttachmentRejectsMissingFilePayloadBeforeStorage(t *testing.T) {
	fake := &attachmentFake{}
	server, err := StartUploadServer(fake)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	form.CreateFormFile("file", "nonempty.bin") // Reproduce WebView2's missing File bytes.
	form.WriteField("size", "600017")
	form.Close()
	request, _ := http.NewRequest("POST", server.Access.URL+"/api/attachments", &body)
	request.Header.Set("Origin", "http://wails.localhost")
	request.Header.Set("Authorization", "Bearer "+server.Access.Token)
	request.Header.Set("Content-Type", form.FormDataContentType())
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 400 {
		t.Fatalf("missing bytes: %d", response.StatusCode)
	}
	if fake.data != nil {
		t.Fatal("missing file committed to storage")
	}
}
