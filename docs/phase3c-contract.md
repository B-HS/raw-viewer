# Phase 3c 계약 — 플랫폼 통합 · 설정 · i18n

> PRD FR-15(클립보드), FR-18(Dock), FR-19(파일연결/싱글인스턴스), FR-1.6(RAW+JPEG 페어링), FR-16.4(ExifTool), FR-20(설정·커맨드팔레트·i18n·접근성), §10.4(라이선스 화면) 기준.
> 의존성 추가됨: objc2/objc2-app-kit/objc2-foundation(macOS), tauri-plugin-single-instance/window-state/store, quick-xml(3d용 선반입), @tauri-apps/plugin-store, react-i18next/i18next.
> 렌즈보정(FR-8)·DNG XMP 주입·프리셋 xmp import/export·그리드뷰는 **Phase 3d로 이월** (이 계약 범위 아님).

## PL (Rust — platform macOS + 파일연결 + 페어링)
소유: `src-tauri/src/platform/**`(실구현), `commands.rs`·`lib.rs` 배선, `tauri.conf.json`(fileAssociations), `scan/`(페어링), `types.rs`·`types_meta.rs` 불가침(필드 추가 필요 시 새 types_platform.rs).
1. **MacOsPlatform 실구현(objc2)**: `copy_image(png,tiff)` → NSPasteboard에 PNG+TIFF 둘 다 write(FR-15.1) · `copy_files(paths)` → file-url writeObjects · `copy_text` · `reveal_in_file_manager` → NSWorkspace activateFileViewerSelecting · `open_with_app` → openURLs(withApplicationAt:) · `note_recent_document` → NSDocumentController.noteNewRecentDocumentURL · `display_color_space` → NSScreen colorSpace 판정(DisplayP3/Srgb). 나머지(trash restore·bookmarks·decode_heic·dock badge)는 NotSupported 유지.
2. **Dock 메뉴(FR-18.2)**: applicationDockMenu: 델리게이트 서브클래스(objc2 declare_class) — 최근 10개(catalog recents 테이블 신설: migration 004, 열람 시 upsert 최대 20) + `●` 프리픽스(현재 파일, 기본 '점 표시' 스타일) + '최근 항목 지우기'. 클릭 → 앱 활성화 + `dock:open {path}` emit. **Dock 프로세스 렌더 제약으로 setState 체크마크는 시도만**(PRD 폴백 규정). 델리게이트 교체 시 Tauri 기존 델리게이트 메서드를 깨지 않도록 **기존 델리게이트를 서브클래싱/포워딩**(중요 — tauri가 NSApplicationDelegate를 이미 설정함. 안전하게 불가하면 SPEC-GAP 보고 후 Dock 메뉴만 생략하고 나머지 완성).
3. **클립보드 커맨드(FR-15)**: `copy_image_to_clipboard(image_id, png_bytes: tauri::ipc::Request raw body)` — 프론트 캔버스 렌더 PNG(긴 변 4096 상한)를 raw body로 수신, platform.copy_image(png, tiff=None→PNG만이라도; TIFF 변환은 image 크레이트로 생성 가능하면 둘 다) · `copy_files_to_clipboard(image_ids)`(스택이면 페어 포함) · `copy_text(text)`.
4. **파일연결/오픈(FR-19)**: tauri.conf.json bundle.fileAssociations = PRD §FR-19.1 목록(rank Alternate — macOS는 rank/mimeType 미지원 필드면 생략) · lib.rs: `tauri_plugin_single_instance`(**첫 플러그인으로** — argv 경로 → focus_and_open), `tauri_plugin_window_state`, `tauri_plugin_store` init · `.build().run(|app,event| RunEvent::Opened{urls} → focus_and_open)` 패턴으로 전환 · 콜드스타트 큐: Opened가 프론트 준비 전이면 AppState 큐에 버퍼 → `frontend_ready`가 flush(기존 RAW_VIEWER_OPEN env 훅 유지).
5. **RAW+JPEG 페어링(FR-1.6)**: scan에서 같은 dir+stem의 RAW+JPEG를 stack — ImageEntry에 옵션 필드 추가 불가(동결)이므로 **types_platform.rs에 `PairInfo`** 두고 ScanBatch는 그대로(JPEG 쪽 엔트리를 배치에서 제외), 별도 커맨드 `get_pairs(dir) -> Vec<PairInfo{rawId, jpegPath}>`. 휴지통 이동 시 페어 동반(trashbin 연동). separate 모드는 설정(Phase 후속) 전까지 stack 고정.
6. 검증: cargo test 전체 그린(objc2 부분은 유닛 불가 — 컴파일 + 수동 스모크는 오케스트레이터). 커밋 금지.

## T (Rust — ExifTool·라이선스·설정 백엔드)
소유: `src-tauri/src/exiftool/**`, `src-tauri/src/about/**`, `scripts/gen-licenses.sh`, commands.rs·lib.rs 배선.
1. **ExifTool(FR-16.4)**: `detect_exiftool() -> Option<String>`(which), `get_deep_metadata(image_id) -> Option<serde_json::Value>` — `exiftool -j -G1 -a -u -n <file>` subprocess, 3초 타임아웃, 실패 시 None. 번들 금지(GPL — subprocess는 안전).
2. **라이선스 화면 데이터(§10.4)**: cargo-about 설치(brew 또는 cargo install) → `scripts/gen-licenses.sh`가 `cargo about generate`로 `src-tauri/resources/licenses-rust.html` 생성(+ bun 의존성은 `bun pm ls` 기반 간단 목록 JSON). about.toml/about.hbs 작성. `get_licenses() -> String(html)` 커맨드(리소스 파일 read, 번들 리소스 등록 tauri.conf resources). NOTICE.md의 LibRaw CDDL·dnglab LGPL·Lensfun/OSM 고지가 HTML 상단에 오도록 합성.
3. **캐시 관리(FR-20.5)**: `get_cache_stats() -> {l0Bytes, l1Bytes, totalBytes}` · `clear_cache(kind: 'all'|'l0'|'l1')` — cache 디렉터리 스캔/삭제(휴지통 아님, 캐시라 직접 삭제 허용).
4. 검증: cargo test 그린. 커밋 금지.

## FE (프론트 — 설정·팔레트·i18n·통합 UI)
소유: `src/components/settings/**`, `src/components/CommandPalette.tsx`, `src/components/AboutDialog.tsx`, `src/i18n/**`, `src/store/settings.ts`, App/keymap/ipc 배선, 기존 컴포넌트의 문자열 t() 치환.
1. **설정 화면(⌘, FR-20.5)**: 모달, 섹션 = 일반(언어 ko/en, 테마 자동/다크/라이트 — `prefers-color-scheme` + documentElement class, 뷰포트 배경색), 성능(프리로드 범위 ±0~10, L2 자동 디코딩 모드 — 백엔드 반영은 후속으로 store 저장만+SPEC-GAP), 캐시(사용량 표시 + 지우기 버튼 — T의 커맨드), 정보(버전, 라이선스 보기 → AboutDialog). 영속 = @tauri-apps/plugin-store(`settings.json`).
2. **커맨드 팔레트(⌘⇧P, FR-20.4)**: 전 액션 퍼지 검색(직접 구현 — 외부 fuzzy 라이브러리 금지, 단순 subsequence 스코어), 액션 레지스트리(기존 keymap 액션 + 설정/내보내기/프리셋 등), 키보드 내비.
3. **i18n(FR-20.6)**: react-i18next, ko(기본)/en 리소스, **기존 하드코딩 한국어 문자열 전수 t() 치환**(App·패널·다이얼로그·컨텍스트메뉴·상태바·필터바), `Intl.NumberFormat`/`DateTimeFormat` 사용처 정리. 시스템 언어 감지(navigator.language).
4. **스마트 복사(⌘C, FR-15.1)**: 현재 이미지를 EngineApi 경유 오프스크린 렌더(긴 변 4096 상한, sRGB) → canvas.toBlob(png) → `copy_image_to_clipboard` raw body 전송. 진행 토스트(복사 중/완료). 비RAW+미편집이면 파일 바이트 그대로(백엔드에서 판단하도록 image_id만 넘기는 편이 나으면 PL과 프로토콜 협의된 대로 — PL 보고 참조).
5. **Dock/오픈 이벤트**: `dock:open`·`file:open-request` listen → handleOpen. 최근 항목: 파일 메뉴 대체로 팔레트에 '최근 파일' 액션.
6. **페어링 표시(FR-1.6)**: get_pairs 로드 → 필름스트립 셀 `RAW+JPEG` 배지, 휴지통 확인 다이얼로그 '2개 파일' 문구.
7. **접근성(FR-20.7) 1차**: 다이얼로그 포커스 트랩·ESC, 슬라이더 aria(이미 있으면 검수), `prefers-reduced-motion` 존중.
8. 검증: bun run build + prettier. 커밋 금지.

## 공통
스타일·동시작업 규칙은 phase1~3b 계약과 동일. PL/T 병렬 → FE는 두 보고를 받아 후속. 오케스트레이터가 통합 검증·실기동·스크린샷·dev 커밋/푸시를 수행한다.
