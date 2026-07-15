# Phase 3b 계약 — Export · 프리셋 · 설정 동기화

> PRD FR-12, FR-13, FR-14, §6.1, §10.2 기준. Phase 1~3a 위에 증축. 의존성 추가됨: image·jpeg-encoder·lcms2·uuid.

## Export 아키텍처 (동결)
GL 풀해상도 타일 readback → invoke raw body 스트리밍 → Rust 조립·색변환·리사이즈·인코딩.
1. 프론트: L2 확보(현재 파이프라인이 유휴 시 L2 디코드; export 시 명시 대기) → EngineApi 확장 `renderExportTiles(state, onTile)` — 소스 풀해상도를 2048 타일(오버랩 32, seam은 중앙 크롭으로 제거)로 전체 패스 ①~⑦ 렌더(⑧ 디스플레이 변환 제외 — **linear Rec2020 f16 그대로** readPixels RGBA16F).
2. Rust 커맨드(스네이크 케이스):
   - `export_begin(request: RasterExportRequest) -> String(job_id)` — request: imageId, 포맷(jpeg|png|tiff|webp), 품질, 색공간(srgb|display-p3|rec2020|adobe-rgb|prophoto), 비트(8|16), 리사이즈(none|longEdge(px)|percent), 출력샤프닝(none), 메타데이터(none|gps-strip|all-best-effort), 파일명템플릿, 출력디렉토리, 충돌정책(rename|overwrite|skip). 타입은 새 `types_export.rs`(ts-rs)로.
   - `export_tile(request: tauri::ipc::Request)` — raw body(InvokeBody::Raw): 헤더 JSON은 Tauri raw request의 headers로(job_id, tileX, tileY, w, h) + f16 RGBA 페이로드. **JSON 배열 직렬화 금지(R1).**
   - `export_finish(job_id) -> PathBuf` — 조립 완료 후: linear Rec2020 → 대상 색공간 매트릭스 + OETF → (리사이즈: 선형 공간 Lanczos3, image crate) → 인코딩 + **ICC 임베드**(lcms2로 프로파일 생성; JPEG=APP2 세그먼트(jpeg-encoder icc 지원), PNG=iCCP, TIFF/WebP는 미지원 시 SPEC-GAP 기록) → 파일명 템플릿({name},{seq:N},{date:...},{iso},{fnumber} 등 FR-14.1 목록) 적용 저장.
   - `export_cancel(job_id)`.
   - 진행 이벤트 `export:progress { jobId, phase: 'render'|'encode', done, total }` (render 진행은 프론트가 자체 표시, Rust는 encode쪽).
3. 메타데이터: EXIF 쓰기는 크레이트 여건 검토(little_exif 등 MIT 계열) — 가능하면 촬영 EXIF 핵심(카메라/노출/일시) 기록 + gps-strip 옵션 준수, 안 되면 Orientation=1 최소 기록 + SPEC-GAP. **GPS 제거 옵션은 반드시 동작**(안 쓰면 됨).
4. DNG(FR-14.2): dnglab sidecar — macOS aarch64 릴리스 바이너리 확보(GitHub release에 없으면 `cargo install dnglab --root <임시>`로 빌드) → `src-tauri/binaries/dnglab-aarch64-apple-darwin` 배치, `export_dng(image_id, out_dir) -> PathBuf`가 subprocess 실행(mosaic 모드, 실패 시 exit code/stderr 그대로 AppError로 → 프론트 폴백 다이얼로그). XMP tag700 주입은 Phase 3c(SPEC-GAP). NOTICE.md에 dnglab LGPL-2.1 + 소스 URL 추가.
5. 배치: 프론트가 선택 목록 순차 실행(이미지당 render→stream→finish), 진행 UI + 취소. Export 중 뷰어 반응성 유지(렌더는 rAF 슬라이스).

## 프리셋(FR-12)·동기화(FR-13)
- catalog migration `003_presets.sql` = PRD §5.4 presets 테이블 그대로.
- 커맨드: `list_presets() -> Vec<PresetInfo>`, `save_preset(name, folder, image_id, mask: Vec<String>) -> PresetInfo`(mask=섹션 키: wb|tone|curves|color|detail|effects|lens|geometry — 마스크 외 필드는 DEFAULT), `apply_preset(preset_id, targets: Vec<String>)`(마스크 필드만 대상 상태에 머지, EditService 경유 저장+버전 증가), `delete_preset(preset_id)`, `copy_settings(from, to: Vec<String>, mask)`. PresetInfo/타입은 types_export.rs 또는 types_preset.rs (ts-rs).
- 번들 프리셋 10종(PRD 목록: Neutral/Punchy/Portrait Soft/Landscape Vivid/B&W Classic/B&W High Contrast/Warm Film/Cool Cinematic/Faded Matte/HDR Natural) — 합리적 EditState 값으로 최초 기동 시 시드(builtin=1, 재시드 방지).
- import/export .xmp 파일은 Phase 3c.

## UI (W)
- **ExportDialog(⌘E / ⌘⇧E 배치)**: 포맷·품질·색공간·비트·리사이즈(긴 변 px/퍼센트)·메타데이터(전체/GPS 제거/없음 — 기본 '전체'지만 첫 export 시 GPS 안내 1회)·파일명 템플릿 입력(+미리보기)·출력 위치(원본 폴더/Exported/지정—plugin-dialog)·충돌 정책. 진행 바 + `N / M` + 취소. 완료 시 Finder에서 보기 버튼(revealItemInDir).
- **DNG 내보내기(⌘⇧D)**: mosaic 실행, 실패 시 폴백 다이얼로그(Linear DNG는 Phase 3c라 '16-bit TIFF로 내보내기' 대체 제시).
- **PresetPanel**: 우측 패널 3번째 탭(편집/메타/프리셋). 폴더 트리 + 목록(⬢ 아이콘), 클릭 적용(현재 이미지, historyStore 1엔트리), 저장 다이얼로그(이름/폴더/섹션 체크박스), 삭제(확인). `⌥1~⌥9` 즐겨찾기 슬롯(목록 상위 9개).
- **설정 복사/붙여넣기**: `⌘⇧C`(전체 복사, 메모리) `⌘⇧V`(선택 항목들에 copy_settings) `⌘⌥V`(이전 이미지 것 즉시). 다중 선택 동기화 버튼(필름스트립 선택 N개 → copy_settings).
- Export 렌더 드라이버: `src/gl/exportRenderer.ts` 신규(기존 renderer 재사용, 기존 파일 동작 불변 — 최소 훅 추가만 허용).

## 소유권
- **X (Rust export)**: `src-tauri/src/export/**`, `types_export.rs`, `binaries/`, commands.rs·lib.rs 배선 추가, NOTICE.md dnglab 절.
- **Q (Rust presets/sync)**: `src-tauri/src/preset/**`, `catalog/migrations/003_presets.sql`, commands.rs·lib.rs 배선 추가(같은 파일 — X와 순차 아님·병렬임: **커맨드 등록 충돌 주의**, 서로 다른 줄 추가만, 실패 시 재시도).
- **W (프론트)**: `src/components/ExportDialog.tsx`, `src/components/panels/PresetPanel.tsx`, `src/gl/exportRenderer.ts`, `src/ipc/`(래퍼), App/keymap 배선. X·Q 완료 후 실행되며 두 보고를 전달받음.
- 공통 규칙·검증은 phase1~3a 계약과 동일 (Rust: cargo test 122+ 유지, W: bun run build + prettier).
