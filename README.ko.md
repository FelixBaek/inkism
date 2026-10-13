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
| `tools/` | 빌드·테스트 스크립트, Windows 설치 파일, 중계 서버 배포, 웹 클리퍼 |

## 빌드

Rust stable과 Node.js 22가 필요합니다.
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

중계 서버는 Rust 크레이트 `core/sync-relay`이고 데이터를 SQLite에 저장합니다. 예전 Go(bbolt) 중계 서버의
`relay.db`는 더 이상 열거나 변환하지 않습니다. 한 번만 쓰는 변환 도구(`desktop/cmd/relay-export`,
`inkism-sync-relay --import-bolt-dump`)는 git 기록의 커밋 `3ca693d`에 남아 있습니다. 그 커밋으로 패키지를
만들어(Go 도구도 필요) 예전 DB를 한 번 변환하세요.

## 라이선스

[MIT](LICENSE). 함께 들어 있는 외부 파일은 각자의 라이선스를 따릅니다:
IBM Plex·Noto Emoji 글꼴(OFL, `frontend/public/fonts/`), Unicode 데이터(`frontend/public/licenses/`).
