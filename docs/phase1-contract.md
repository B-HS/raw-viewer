# Phase 1 계약 — 뷰어 코어 (모듈 소유권 · API · 포맷)

> Phase 1 병렬 구현의 단일 계약. 여기 정의된 시그니처·포맷·이벤트는 **구현자가 임의 변경 금지** (변경 필요 시 보고). 근거: docs/PRD.md §2.3, §3.1~3.8, §6, §7.3, §11 Phase 1.

## 대상 파일

### R1 (decode+color 담당)
- `src-tauri/src/decode/**` (기존 libraw_ffi 확장), `src-tauri/src/color/**`

### R2 (services 담당)
- `src-tauri/src/pipeline/**` (디코드 큐·픽셀 스토어), `src-tauri/src/cache/**`, `src-tauri/src/scan/**`, `src-tauri/src/protocol.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/events.rs`

### F (frontend 담당)
- `src/**` 전체 (types/는 ts-rs 생성물 — 직접 수정 금지, cargo test로만 갱신)

`src-tauri/src/types.rs`는 **동결** (오케스트레이터 소유. 필드 추가가 필요하면 보고).

## R1 → R2 디코드 API (`decode/mod.rs`에 re-export)

```rust
pub type CancelFlag = std::sync::Arc<std::sync::atomic::AtomicBool>;

pub struct ThumbData { pub jpeg: Vec<u8>, pub width: u32, pub height: u32 }

pub struct DecodedRaw {
    pub width: u32,
    pub height: u32,
    pub rgb_f16: Vec<half::f16>,            // interleaved RGB, row-major, len = w*h*3
    pub cam_to_rec2020: Option<[f32; 9]>,   // row-major 3x3. None = 프로파일 없음(identity 적용 + 경고)
    pub flip: u8,                            // LibRaw sizes.flip (0/3/5/6)
}

pub fn extract_thumb(path: &Path) -> Result<ThumbData, DecodeError>;                       // L0: 내장 JPEG 추출(디코딩 없음). JPEG 아닌 썸네일이면 Err
pub fn decode_half(path: &Path, cancel: &CancelFlag) -> Result<DecodedRaw, DecodeError>;   // L1: half_size=1
pub fn decode_full(path: &Path, cancel: &CancelFlag) -> Result<DecodedRaw, DecodeError>;   // L2: demosaic_for(§3.3)
```

- LibRaw 파라미터: PRD §3.1 표 (output_color=0, output_bps=16, use_camera_wb=1, no_auto_bright=1, gamm=[1,1], four_color_rgb=0). X-Trans(filters==9)는 half_size 대신 Markesteijn 1-pass + 1/2 다운샘플 (§3.3). 모노크롬(filters==0)은 1ch→3ch 복제.
- 전 경로 catch_unwind 가드 (기존 guarded 재사용). cancel은 단계 사이 폴링(coarse) — LibRaw progress 콜백 연동은 후속.
- u16 → f16 정규화: 0..65535 → 0.0..1.0.
- 색행렬 (`color/`): `cam_xyz`(XYZ(D65)→cam) 3x3 역행렬 → cam white(1,1,1)→D65 white 정규화 → `REC2020_FROM_XYZ_D65` 곱. cam_xyz 부재 시 rgb_cam 경로(cam→sRGB linear → XYZ → Rec2020), 그것도 없으면 None. 단위테스트: 유한성·가역성·white→white.
- Bradford D50 보간(§3.2.1 ②③ 전체)은 Phase 2로 이월 — cam_xyz는 D65 기준이므로 Phase 1 근사로 충분. SPEC-GAP 기록.

## aether:// 픽셀 응답 포맷 (R2 구현, F 소비)

```
GET aether://localhost/pixels/{imageId}/{level}?rev={n}    level = l0|l1|l2
L0  → Content-Type: image/jpeg, 바디 = 내장 JPEG 원본 바이트 (webview가 디코딩; SPEC-GAP: §6.3의 AETH 헤더 대신 JPEG 직접 서빙 — "디코딩 없음" 원칙 유지)
L1/L2 → Content-Type: application/octet-stream, 바디 = AETH 헤더 16B + 페이로드
  헤더(LE): [0..4)="AETH" ASCII, [4..8) width u32, [8..12) height u32, [12] fmt u8(2=f16), [13] channels u8(3), [14..16) reserved 0
  페이로드: interleaved row-major RGB f16 LE (SPEC-GAP: planar 대신 interleaved — texImage2D 직행)
모든 응답에 Access-Control-Allow-Origin:* + Cache-Control: no-cache. 미보유 → 404 (F는 다음 level-ready에서 재시도).
```

## 커맨드 (R2 구현, F 소비 — 시그니처 고정)

```rust
open_path(path: PathBuf) -> AppResult<OpenResult>                       // 등록 + 즉시 현재 이미지로 디코드 킥
scan_directory(dir: PathBuf, on_batch: Channel<ScanBatch>) -> AppResult<ScanSummary>  // FR-1.2 스트리밍(100개 배치), 자연 정렬은 프론트에서
navigate(image_id: String, prev_ids: Vec<String>, next_ids: Vec<String>) -> AppResult<()>
frontend_ready() -> AppResult<Vec<PendingOpenRequest>>                  // 기존 유지
```

- 스캔: 재귀 없음, 숨김/`.DS_Store`류 제외, 지원 확장자 = PRD FR-1.3 전체(대소문자 무시).
- 자연 정렬: **프론트(F)** 가 `Intl.Collator('en', { numeric: true })`로 수행 (IMG_2 < IMG_10 테스트 포함).
- navigate 정책(R2): current L0→L1 즉시, L2는 150ms 유휴 후. prev/next 순서 = 거리순 — 인덱스 0~1은 L1까지, 2~ 는 L0만. 이전 window 밖 in-flight job은 cancel. **backpressure**: navigate 간격 <100ms 연속이면 L0만, 150ms 유휴 타이머 후 현재 이미지 L1/L2 재개 (§2.4).
- 픽셀 스토어(R2): (imageId, level) → Arc<Vec<u8>> (직렬화된 응답 바디). 바이트 상한 1.5GB LRU(현재 이미지 제외 축출).
- 디스크 캐시(R2): `~/Library/Caches/app.raw-viewer/` — 키 blake3(절대경로‖mtime_ns‖size) hex. `l0/{k:0..2}/{k}.jpg` 원본 JPEG, `l1/{k:0..2}/{k}.zst` zstd(level 1)로 압축한 AETH 페이로드(f16 interleaved). L2는 디스크 캐시 안 함. 축출(10GB LRU)·index.sqlite는 후속 — TODO를 PROCESS에 기록.

## 이벤트 (R2 emit, F listen)

| 이벤트 | 페이로드 (types.rs) |
|---|---|
| `image:level-ready` | `LevelReadyPayload` |
| `image:decode-failed` | `DecodeFailedPayload` |

rev: 이미지·레벨별 단조 증가 u32 (파일 변경 감지는 Phase 후속 — Phase 1은 세션 내 1 고정 가능).

## F (프론트) 구성

- `src/gl/`: WebGL2 백엔드 — `EXT_color_buffer_float` 체크(없으면 RGBA8 폴백 + 저정밀 배지), RGBA16F FBO ping-pong 렌더그래프(패스 ①매트릭스 → ④BaseCurve → ⑧출력). L0(JPEG)은 createImageBitmap → sRGB 텍스처 → 패스 ⑧만(이미 display-referred). L1/L2는 AETH 파싱 → RGB16F 텍스처(HALF_FLOAT, UNPACK_ALIGNMENT 2) → 전체 파이프라인.
- BaseCurve standard: monotone cubic(Fritsch–Carlson) 제어점 (0,0)(0.25,0.22)(0.5,0.5)(0.75,0.78)(1,1) → 256샘플 1D LUT. 적용 공간: `linear' = eotf(curve(oetf(linear)))` (FR-4 컨벤션).
- 출력: `drawingBufferColorSpace='display-p3'` 시도 → 실제 값 기준 Rec2020→P3 또는 Rec2020→sRGB 매트릭스 + sRGB OETF (§3.2.3).
- Orientation: flip(0/3/5/6)을 정점 변환으로 (§3.8).
- 뷰포트: fit⇄100% (`Z`/클릭), `⌘0`/`⌘1`, 스페이스+드래그 팬, 핀치/`⌥`+휠 줌. 100% 초과 nearest, 미만 linear(bicubic은 후속 TODO).
- 셸: 플레이리스트 store(zustand 미도입 상태면 useState/useReducer로 시작 — 의존성 추가 시 bun add), `←→` 네비(±3 프리로드 window 계산해 navigate 호출, rAF 코얼레싱), 필수 UI = 레벨 인디케이터(우하단 L0/L1/L2+스피너), 에러 패널(§7.3 — 탐색 계속 가능), 빈 상태(파일 열기 안내 + 드래그앤드롭 + `⌘O`는 후속).
- TS 타입은 `src/types/*.ts`(ts-rs 생성) import — 수정 금지.

## 검증 (각자 + 통합)

- R1: `cargo test` — 색행렬 단위테스트 + tests/fixtures/tier1에 존재하는 파일들로 extract_thumb/decode_half 통합테스트(파일이 하나도 없으면 명시적 실패 메시지). X3F는 thumb만 성공하면 됨.
- R2: 스캔·자연정렬(프론트라 제외)·캐시 키·LRU 단위테스트, AETH 직렬화 라운드트립 테스트.
- F: `bun run build`(tsc) 통과. 
- 통합(오케스트레이터): cargo test 전체, tauri dev 실기동으로 픽스처 폴더 열기 → L0/L1 표시 확인.
