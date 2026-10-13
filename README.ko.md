# Atelier Felix - inkism

[English](README.md)

Windows용 암호화 노트 앱입니다. 노트는 내 PC에 먼저 저장됩니다.

**상태:** 초기 Windows 빌드입니다. 안정판이 아니며, Windows 빌드에는 코드 서명이 없습니다.

## 기능

- 노트북, 태그, 즐겨찾기, 고정, 보관함, 휴지통, 자동 저장, 테마
- 서식 편집기(React/Tiptap)와 원본을 그대로 지키는 HTML / Markdown 직접 편집
- 첨부 파일, 첨부까지 담는 ZIP 백업, 편집 기록, 다시 켜도 유지되는 되돌리기
- 큰 노트도 빠름: 긴 노트는 필요한 부분만 불러와 편집
- AND / OR / NOT과 구절 검색을 지원하는 전체 검색
- Windows 알림으로 오는 리마인더, 웹 클리퍼, 공개 공유 사본
- SQLCipher로 암호화한 로컬 저장소. 키는 Windows DPAPI로 보호
- 작은 중계 서버를 거치는 기기 간 종단 간 암호화 동기화
- 선택 사항: Google 로그인 앱 잠금

## 폴더

| 폴더 | 내용 |
|---|---|
| `frontend/` | 화면(React/Tiptap) |
| `core/` | Rust 엔진: `storage-core`(DB·암호화), `engine`(노트·검색), `sync-core`(동기화), `runtime-core`(앱이 실행하는 묶음) |
| `desktop-tauri/` | Windows 앱 껍데기(Rust/Tauri). 빌드는 `tools/scripts/build-windows-tauri.sh` |
| `desktop/` | 이전 Go/Wails 구현과 구형 데이터 변환·호환성 검사 도구 |
| `tools/` | 빌드·테스트 스크립트, Windows 설치 파일, 중계 서버 배포, 웹 클리퍼 |

## 빌드

Rust stable과 Node.js 22가 필요합니다. Go 1.27 이상은 구형 데이터 변환·Go 백업 호환성 검사에만 필요합니다.
암호화 빌드에는 `perl`, `make`, C 컴파일러도 필요합니다.
Linux에서 Windows용으로 빌드하려면 mingw-w64와 `rustup target add x86_64-pc-windows-gnu`가 필요합니다.

화면을 먼저 빌드하세요. Rust 미리보기 서버가 `frontend/dist`를 제공합니다.

```sh
npm --prefix frontend ci
npm --prefix frontend run build
cargo build --release --manifest-path core/runtime-core/Cargo.toml
cargo run --locked --manifest-path core/local-api/Cargo.toml -- --engine "$PWD/core/runtime-core/target/release/inkism-engine"
```

Windows Tauri 패키지(Linux에서):

```sh
bash tools/scripts/build-windows-tauri.sh --version X.Y.Z
```

`dist/windows-tauri/`와 `dist/Inkism-windows-x64-tauri-unvalidated.zip`을 만든다.
배포 전 Windows 실행·화면·설치 검증이 별도로 필요하다.
`tools/scripts/build-windows.sh`도 같은 Tauri 빌드를 실행합니다.

## 테스트

```sh
cargo test --locked --manifest-path core/local-api/Cargo.toml
cargo test --locked --manifest-path desktop-tauri/src-tauri/Cargo.toml
cargo test --manifest-path core/engine/Cargo.toml        # storage-core, sync-core, runtime-core도 같은 방식
npm --prefix frontend run test:unit
npm --prefix frontend run test:unit:coverage:core
```

핵심 커버리지 명령은 Node 22.23.2에서 CSV 파서·본문 교체·창 편집 이력·편집 작업 실행의 합산 줄/분기/함수 커버리지를 측정하며 어느 지표든 90% 미만이면 실패합니다. 전체 저장소 커버리지 수치는 아닙니다.

Rust 테스트에 `--features encrypted-storage`를 붙이면 암호화 저장소까지 시험합니다.
브라우저 테스트는 Playwright Chromium을 씁니다: `tools/scripts/test-browser.sh`.
알려진 문제: 편집기 브라우저 테스트 상당수가 최근 화면 변경을 따라가지 못해 실패합니다.

## 동기화 중계 서버

`bash tools/scripts/package-sync-relay.sh`를 실행하면 `dist/`에 컨테이너 패키지가 만들어집니다.
그 폴더에서 `.env.example`을 `.env`로 복사하고, 32자 이상의 무작위 `INKISM_RELAY_TOKEN`을 정한 뒤
`docker compose -p inkism-sync up -d --build`를 실행하세요.

## 라이선스

[MIT](LICENSE). 함께 들어 있는 외부 파일은 각자의 라이선스를 따릅니다:
IBM Plex·Noto Emoji 글꼴(OFL, `frontend/public/fonts/`), Unicode 데이터(`frontend/public/licenses/`).

### 용어 설명

서식 편집 화면에서 짧은 단어를 선택하고 `Ctrl+G`(macOS `Cmd+G`) 또는 선택 툴바의 **용어 설명**을 누릅니다. 설명은 본문 안에 저장되며, 점선 밑줄의 단어를 가리키거나 누르면 다시 볼 수 있습니다. AI 설명은 설정된 AI 연결을 사용하며, 초안을 확인하고 **설명 저장**을 눌러야 반영됩니다.

필요할 때만 **용어집 · 노트 연결**을 펼쳐 용어집에 수집하거나 기존 노트를 연결하고 새 노트로 확장합니다. 설명 제거는 연결된 노트나 용어집 항목을 지우지 않습니다. Markdown 편집에서는 설명을 HTML span으로 보존하며, HTML 문서의 Markdown 내보내기는 읽을 수 있는 각주를 만듭니다. 원문 Markdown 내보내기는 원문을 보존합니다.

[Figma: 용어 설명 UI](https://www.figma.com/design/HJUtpZHxA9ssJQS6CSVhko/inkism?node-id=127-26733)
