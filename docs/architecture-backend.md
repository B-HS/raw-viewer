# raw-viewer Rust 백엔드 아키텍처 (src-tauri/src)

기준 커밋: dev 브랜치 e169fe6 (2026-07-18) 시점. 모든 주장에 `파일:라인` 근거를 붙였다. 추측은 "확인 필요"로 표시.

진입점: `main.rs:3-9` — argv가 `__decode` 서브커맨드면 `isolate::dispatch_argv`로 격리 디코드 자식 프로세스로 동작하고 종료, 아니면 `raw_viewer_lib::run()`(lib.rs:46) 실행.

---

## 1. 모듈 맵

| 모듈 | 책임 (1줄) | 핵심 파일 |
|---|---|---|
| `about` | 라이선스 문서 제공(리소스 파일) + 디스크 캐시 통계/삭제 커맨드 | `about/licenses.rs:10-13`, `about/cache.rs:92-101` |
| `cache` | L0(JPEG)/L1(zstd AETH+meta) 디스크 캐시. blake3(path,mtime,size) 키, 2글자 샤딩 | `cache/mod.rs:32-64` |
| `catalog` | 단일 sqlite(catalog.sqlite) 접근 계층. images/presets/recents/lens_overrides 테이블, 마이그레이션 내장 | `catalog/mod.rs:10-16,64-104` |
| `color` | Rec2020 변환 행렬 수학(cam_xyz/rgb_cam→rec2020), sRGB EOTF, 디스플레이 3D LUT(lcms2) | `color/mod.rs`, `color/display_lut.rs` |
| `commands` | 범용 Tauri 커맨드 모음(open/scan/navigate/edit/organize/rename 등) | `commands.rs` |
| `cpurender` | CPU 폴백 렌더러(GPU 패리티 패스) + u8 RGBA AETH 프레임 스토어 | `cpurender/render.rs`, `cpurender/serve.rs`, `cpurender/passes.rs` |
| `decode` | 디코드 라우팅(RAW=LibRaw FFI, 일반=image crate, heic/avif=플랫폼) + `DecodedRaw` 계약 | `decode/mod.rs`, `decode/libraw_ffi.rs`, `decode/common.rs` |
| `edit` | 편집 상태 서비스: 메모리 캐시 + catalog(2s)/XMP(10s) 디바운스 플러시, 낙관적 버전 관리 | `edit/service.rs:13-14,204-245`, `edit/defaults.rs` |
| `error` | `AppError`(ts_rs로 TS 타입 export) / `AppResult` | `error.rs:7-21` |
| `events` | 이벤트 이름 상수 + `RevCounters`(image_id×level별 rev 증가) + emit 헬퍼 | `events.rs:8-46` |
| `exiftool` | 외부 exiftool 탐지(PATH) 및 3초 타임아웃 JSON 실행 | `exiftool/mod.rs:13,46-93` |
| `export` | 래스터 내보내기(타일 수집 f16 캔버스→인코드) + DNG 변환(dnglab 외부 바이너리) + 외부앱 핸드오프 | `export/job.rs`, `export/finish.rs`, `export/dng.rs:8-49`, `export/handoff.rs` |
| `geocode` | Nominatim 역지오코딩. 1.1s 레이트리밋 + 파일 캐시(cache_dir/app.raw-viewer/geocode) | `geocode/mod.rs:7-12,33` |
| `isolate` | `__decode` 서브커맨드(자식) + 부모측 서브프로세스 실행/타임아웃/취소 | `isolate/mod.rs` |
| `lens` | lensfun XML DB 로드/매칭/오버라이드(catalog lens_overrides) + 커맨드 | `lens/mod.rs:30-51`, `lens/db.rs`, `lens/matching.rs`, `lens/service.rs` |
| `meta` | EXIF(kamadak-exif) + LibRaw probe를 합성한 `ImageMetadata` 생성, GPS, capture_ms | `meta/mod.rs:20-97,410`, `meta/exif.rs`, `meta/gps.rs` |
| `organize` | 별점/플래그/라벨: catalog 즉시 기록 + XMP 4s 디바운스 | `organize/service.rs:14,70-113` |
| `pipeline` | 디코드 파이프라인 본체: 우선순위 큐, 워커, 유휴 타이머, PixelStore, 캐시 연동, 이벤트 emit | `pipeline/mod.rs`, `pipeline/queue.rs`, `pipeline/store.rs` |
| `platform` | OS 통합: `Platform` 트레이트, OpenQueue, recents, macOS(dock 메뉴, ImageIO, 클립보드) | `platform/mod.rs:93-112`, `platform/open_queue.rs`, `platform/macos/*` |
| `preset` | 프리셋 저장/적용/가져오기·내보내기(XMP), 번들 프리셋, 섹션 마스크 | `preset/service.rs`, `preset/mask.rs`, `preset/io.rs`, `preset/bundled.rs` |
| `protocol` | `aether://` 커스텀 URI 스킴 핸들러(픽셀/CPU 프레임/원본 서빙) | `protocol.rs` |
| `scan` | 확장자 분류, image_id 생성, `Registry`(id→경로), 디렉토리 스캔 스트리밍, RAW+JPEG 페어링 | `scan/mod.rs`, `scan/pairing.rs` |
| `trashbin` | 휴지통 이동(trash crate). 사이드카 동반 삭제 + registry/store 정리 | `trashbin/mod.rs:7-33` |
| `types*` | serde+ts_rs 공유 타입(TS 바인딩 export): types(코어/EditState), _meta, _export, _lens, _cpurender, _performance, _platform, _preset | `types.rs` 등 |
| `watch` | notify 기반 디렉토리 감시(NonRecursive), 200ms 디바운스, Modified 시 PixelStore 무효화 | `watch/mod.rs:13,104-140` |
| `xmp` | XMP 사이드카 읽기/쓰기: `aether:state`(zstd19+base64 JSON) + crs/xmp 호환 속성 | `xmp/mod.rs` |

`decode` 모듈은 `libraw` feature 게이트 하에 컴파일된다(`lib.rs:34-35`, 기본 feature — `Cargo.toml:73-75`).

---

## 2. 디코드 파이프라인

### 2.1 프록시 레벨 의미

`ProxyLevel { L0, L1, L2 }` (`types.rs:49-56`).

- L0: 임베디드 썸네일 JPEG(레벨 그대로 JPEG 바이트, flip=0으로 emit — `pipeline/mod.rs:640-651`)
- L1: half 해상도 f16 linear RGB (`decode::decode_half` — `decode/mod.rs:111-118`)
- L2: 풀 해상도 f16 linear RGB (`decode::decode_full` — `decode/mod.rs:120-127`)

### 2.2 라우팅 (decode/mod.rs)

- `extract_thumb`(L0): `common::is_common_path`이면 `common::extract_common_thumb`, 아니면 `libraw_ffi::extract_thumb` (`decode/mod.rs:50-57`)
- `decode_half`/`decode_full`: common 경로면 `common::decode_common(path, half, cancel)`, 아니면 `libraw_ffi::decode(path, Half|Full, cancel)` (`decode/mod.rs:111-127`)
- common 확장자: image crate 계열 `jpg jpeg png webp tif tiff bmp gif` + 플랫폼 계열 `heic heif avif` (`decode/common.rs:13-14`)
- heic/heif/avif는 macOS ImageIO(`platform/macos/imageio.rs`)로 sRGB premultiplied RGBA 디코드(`common.rs:247-250`, `imageio.rs:45-65`). 비macOS는 에러(`common.rs:252-255`)
- `probe_metadata`/`probe_iso`는 항상 LibRaw 경로(`decode/mod.rs:59-63,105-109`)

### 2.3 DecodedRaw 계약 (`decode/mod.rs:42-48`)

```rust
pub struct DecodedRaw {
    width: u32, height: u32,
    rgb_f16: Vec<f16>,            // linear light, 3ch interleaved
    cam_to_rec2020: Option<[f32; 9]>, // row-major 3x3, linear cam/src RGB -> linear Rec2020
    flip: u8,                     // 0=none, 3=180도, 5=270도(CCW 90), 6=90도(CW)
}
```

- `rgb_f16`은 **감마 없는 linear**. LibRaw 경로는 `gamm=[1,1]`, `output_color=0`(카메라 네이티브), `output_bps=16`, `no_auto_bright=1`, `use_camera_wb=1`(모노크롬 제외)로 처리 후 `sample/65535.0` 정규화(`libraw_ffi.rs:380-454`).
- `cam_to_rec2020`: `color.cam_xyz`가 있으면 역행렬+D65 화이트 채널 게인 보정 후 Rec2020 결합(`color/mod.rs:80-95`), 없으면 `rgb_cam`(sRGB linear 기준)에 `REC2020_FROM_XYZ_D65 * XYZ_FROM_SRGB_LINEAR` 결합(`color/mod.rs:97-105`, 선택 로직 `libraw_ffi.rs:281-301`). 둘 다 없으면 `None`.
- `flip`: LibRaw `sizes.flip`을 `normalize_flip`으로 정규화(90→6, 180→3, 270→5 — `libraw_ffi.rs:272-279`). 일반 이미지의 flip은 EXIF Orientation을 같은 코드 체계로 매핑(3|4→3, 5|8→5, 6|7→6 — `common.rs:49-62`).
- 중요: `params.user_flip = 0`으로 픽셀 버퍼는 회전하지 않고 flip 코드만 프론트(버텍스 셰이더)에 전달한다. libraw의 `dcraw_make_mem_image`가 flip을 물리 적용하기 때문에 이중 회전 방지 목적(SPEC-GAP 주석 — `libraw_ffi.rs:390-391`).
- X-Trans(filters==9): Half 레벨에서 `half_size` 대신 1-pass Markesteijn(user_qual=3) 풀 디모자이크 후 `downsample_half`로 2x2 평균 다운샘플(`libraw_ffi.rs:393-401,457-462`). Full도 user_qual=3(3-pass가 아닌 1-pass, SPEC-GAP — `libraw_ffi.rs:404-405`). Bayer Half는 `half_size=1, user_qual=0`.
- 모노크롬(colors==1)은 1채널을 3채널로 복제(`libraw_ffi.rs:447-454`).
- 모든 LibRaw 호출은 `guarded()`(catch_unwind)로 감싸 패닉을 `DecodeError::Panic`으로 변환(`libraw_ffi.rs:15-20`).

### 2.4 common.rs 색 처리 (일반 이미지)

- 8/16bpc 판별 후 RGBA로 통일, 알파는 검정 위 합성(alpha 곱 — `common.rs:136-186`).
- 임베디드 ICC가 있고 설명에 "srgb"가 아니면(`icc_is_srgb` — `common.rs:73-78`) lcms2로 source ICC → **rec2020-linear 프로파일**(`display_lut.rs:17-26`) 변환, 행렬은 IDENTITY(`common.rs:80-134`). ICC 변환 실패 시 sRGB 가정으로 폴백(경고 로그 — `common.rs:209-230`).
- ICC 없으면 sRGB EOTF(256 LUT — `common.rs:38-47`, 수식 `color/mod.rs:68-74`)로 선형화하고 행렬은 `rec2020_from_srgb_linear_matrix()`(`common.rs:136-152`).
- 결과는 항상 `cam_to_rec2020: Some(matrix)` 형태의 DecodedRaw(`common.rs:257-274`). half 요청이면 `downsample_half` 재사용(`common.rs:261-265`).
- L0 썸네일: JPEG이면 EXIF 임베디드 썸네일 우선(256px 미만이면 무시 — `common.rs:299-317`), 아니면 풀 디코드 후 512px Triangle 리사이즈 + EXIF 회전 베이크 + JPEG q85 인코드(`common.rs:276-335`). 플랫폼 확장자는 ImageIO 썸네일 API(`common.rs:327-332`).

### 2.5 AETH 직렬화 (`pipeline/store.rs:10-47`)

L1/L2 픽셀 바디 포맷 (리틀엔디언):

```
offset 0..4   "AETH" 매직
offset 4..8   width u32 LE
offset 8..12  height u32 LE
offset 12     fmt   (2 = f16)
offset 13     channels (3 = RGB)
offset 14..16 예약(0)
offset 16..   f16 LE RGB interleaved payload
```

`serialize_aeth`/`parse_aeth_header`(`store.rs:15-47`). 헤더 길이 16(`AETH_HEADER_LEN`).
CPU 렌더 프레임은 **별도 변형**: fmt=0(u8), channels=4(RGBA), 동일 매직/헤더 구조(`cpurender/serve.rs:4-21`).

### 2.6 큐/캐시/PixelStore 흐름 (pipeline/mod.rs)

상태 구성: `Services { registry, store(PixelStore), cache(DiskCache), revs(RevCounters) }`(`pipeline/mod.rs:30-46`), `Pipeline`은 워커 스레드(`worker_count()` = 논리코어-1, 최소 2 — `pipeline/mod.rs:212-216`) + 유휴 타이머 스레드 1개를 spawn(`pipeline/mod.rs:156-181`).

우선순위(작을수록 먼저, 동순위 FIFO — `queue.rs:28-32`):

- `PRIO_CURRENT_L0=0`, `PRIO_CURRENT_L1=10`, `PRIO_CURRENT_L2=20`, `PRIO_NEIGHBOR_BASE=100`(`pipeline/mod.rs:21-24`)
- 이웃: prev/next 각 리스트에서 index별 `100+2i`(L0), 인접 2장(index<=1)만 `+1`(L1)도 추가(`pipeline/mod.rs:228-238`)

navigate 흐름(`pipeline/mod.rs:267-302`):

1. `PerfSettings.preload_radius`(기본 3)로 prev/next 절단
2. 100ms(RAPID_WINDOW) 내 재탐색이면 rapid=true → 현재 L0만 enqueue(`plan_jobs` — `pipeline/mod.rs:240-247`)
3. 창별 desired 셋의 합집합 밖 image_id의 CancelFlag를 set(`cancel_outside` — `pipeline/mod.rs:337-347`)
4. `store.set_current(current)` — LRU 축출 보호(`store.rs:128-145`: current id는 절대 축출 안 됨)
5. `L2Policy::Always`이고 rapid가 아니면 즉시 L2도 enqueue(`pipeline/mod.rs:258-260,298-300`)
6. 150ms(IDLE_DELAY) 후 유휴 타이머가 `plan_idle`(현재 L1→L2→이웃)을 enqueue. `L2Policy::Zoom`이면 유휴 L2 억제(`pipeline/mod.rs:249-264,551-593`)

enqueue 시 dedup: `PendingSet`이 (id, level)당 살아있는 잡 1개만 허용(취소된 owner는 대체 가능 — `pipeline/mod.rs:106-135`). 이미 `store.contains`면 현재 이미지는 메타 재-emit(`reemit`, rev 증가), 이웃은 무시(`pipeline/mod.rs:359-397`).

잡 실행(`run_job` — `pipeline/mod.rs:407-468`):

1. cancel/이미 존재 체크 → registry.resolve 실패 시 `image:decode-failed` emit
2. 디스크 캐시 히트 시(`load_from_cache` — L0=jpg, L1=zstd 해제+`.meta`의 flip/matrix, L2=항상 미스 — `pipeline/mod.rs:470-498`, `cache/mod.rs:133-143`) 캐시 재기록 없이 finalize
3. 미스 시 `decode_level`: L0=extract_thumb, L1/L2 = `PerfSettings.isolated_decode`이면 서브프로세스, 아니면 in-process 디코드 후 `serialize_aeth`(`pipeline/mod.rs:595-662`)
4. `DecodeError::Panic`이면 crash_count 증가, 누적 2회 이상이면 `decode:crash-loop` 이벤트 emit(`pipeline/mod.rs:439-446`)
5. finalize: 디스크 캐시 store(L0/L1만) → LevelMeta 기억 → `store.insert`(PixelStore, LRU 예산 1.5GB — `store.rs:8`) → rev 증가 → `image:level-ready` emit(`pipeline/mod.rs:500-542`)

프론트는 level-ready를 받은 뒤 `aether://pixels/{id}/{level}`로 바디를 fetch한다(3장·4장 참조).

### 2.7 격리 디코드 (`isolate/mod.rs`)

- 자식: `raw-viewer __decode <path> <l0|l1|l2> <out.aeth>` → 디코드 결과 바디를 out에, 메타(width/height/flip/has_color_profile/color_matrix)를 `<out>.json` 사이드카에 기록(`isolate/mod.rs:29-110`). 종료코드: 0 OK, 1 디코드 실패, 2 쓰기 실패, 3 libraw 미탑재, 4 인자 오류(`isolate/mod.rs:5-9`).
- 부모: `current_exe`를 재실행, 50ms 폴링으로 cancel/exit/60s 타임아웃 감시, 실패·취소·타임아웃 시 kill. TempFiles가 Drop에서 산출물 삭제(`isolate/mod.rs:123-212`).
- 패닉이 프로세스 경계로 격리되므로 `map_isolated_error`에는 Panic 분기가 없다(비정상 종료는 exit code로 Failed 처리 — `pipeline/mod.rs:608-613`, `isolate/mod.rs:196`).

### 2.8 CPU 렌더 경로 (cpurender)

`render_cpu_frame` 커맨드 → `render_and_store`(`cpurender/render.rs:116-140`): 디스크 L1 캐시 우선, 미스 시 rayon 스레드에서 `decode_half`를 10초 타임아웃으로 실행(`render.rs:17,59-90`) → area 다운스케일 → 패스 체인(wb→tone→curve LUT→color(HSL)→effects→u8 RGBA 출력 — `passes.rs:301` `render_passes`) → u8 RGBA AETH로 `CpuFrameStore.put`(최대 6프레임 LRU — `serve.rs:9,46-63`) → `cpu:frame-ready` emit(`commands.rs:202-217`). 프론트는 `aether://pixels/{id}/cpu`로 fetch. GPU 셰이더와의 패리티는 `cpurender/parity_tests.rs`로 검증.

---

## 3. 색 계약

- **내부 작업 색공간은 rec2020-linear**. 모든 디코드 산출(`rgb_f16`)은 linear이고, 소스→Rec2020 행렬이 `cam_to_rec2020`/`color_matrix`로 함께 전달된다(2.3·2.4). XMP에도 `aether:engine="rec2020-linear"`로 명시(`xmp/mod.rs:102,130`).
- 행렬 상수: `REC2020_FROM_XYZ_D65`, `XYZ_FROM_SRGB_LINEAR`, D65 화이트(`color/mod.rs:3-15`). 화이트 보존 검증 테스트 있음(`color/mod.rs:147-164`).
- sRGB/ICC 처리(common.rs): 2.4 참조 — ICC는 lcms2 RelativeColorimetric으로 rec2020-linear에 직접 변환(행렬=identity), 무ICC는 sRGB EOTF+sRGB→Rec2020 행렬.
- **디스플레이 LUT**: `get_display_lut` 커맨드(`platform/commands.rs:104-110`)가 메인 스크린 ICC(`platform/macos/mod.rs:172-185`)를 받아 lcms2로 **rec2020-linear → 디스플레이 프로파일** 33^3 3D LUT(f32)를 생성(`color/display_lut.rs:6,28-56`). 응답 포맷은 `[size u32 LE][f32 LE * size^3 * 3]`(`display_lut.rs:58-65`), blake3(ICC) 키로 프로세스 내 캐시(`display_lut.rs:67-76`). LUT 인덱싱은 g가 최외곽, x축 = b*n + r(`display_lut.rs:39-45`).
- 내보내기 색: `export/color.rs`(rec2020→sRGB/P3/Rec2020 행렬 + OETF), `export/icc.rs`(출력 ICC 바이트), CPU 렌더용 상수는 `cpurender/color.rs:1-15`.

---

## 4. aether:// 프로토콜 (`protocol.rs`)

등록: `register_asynchronous_uri_scheme_protocol("aether", protocol::handle)`(`lib.rs:65`). 핸들러는 요청을 async runtime에 spawn해 응답(`protocol.rs:40-47`).

| 라우트 | 응답 | 근거 |
|---|---|---|
| `aether://ping` | 200 `pong` (text/plain) | `protocol.rs:187-189` |
| `aether://pixels/{image_id}/{l0\|l1\|l2}` | L0=image/jpeg, L1/L2=application/octet-stream(AETH). PixelStore 히트 우선, 미스 시 디스크 캐시 로드 후 PixelStore에 재삽입, 그래도 없으면 404 | `protocol.rs:158-185` |
| `aether://pixels/{image_id}/cpu` | CpuFrameStore의 u8 RGBA AETH (octet-stream), 없으면 404 | `protocol.rs:140-156` |
| `aether://original/{image_id}` | 원본 파일 바이트. **gif/webp 확장자만 화이트리스트**(애니메이션 재생용), 그 외 404 | `protocol.rs:38,115-138` |
| 그 외 | 404 `not found` | `protocol.rs:191-193` |

CORS: 모든 응답에 `Access-Control-Allow-Origin`을 빌드별 고정 웹뷰 오리진으로 부여 — dev `http://localhost:1420`, Windows `http://tauri.localhost`, 그 외 `tauri://localhost`(`protocol.rs:15-27`). `Cache-Control: no-cache`(rev 기반 재요청 전제). CSP는 `tauri.conf.json:24-41`에서 `aether:`/`http://aether.localhost`를 img-src·connect-src에 허용.

---

## 5. Tauri 커맨드 전체 목록 (lib.rs:150-215 invoke_handler 기준)

### commands.rs
| 커맨드 | 설명 |
|---|---|
| `frontend_ready` | 창 라벨별 보류 중 open 요청 드레인. main 창은 `RAW_VIEWER_OPEN` env + OpenQueue ready 전환(`commands.rs:38-54`) |
| `open_path` | 파일 canonicalize→registry 등록→edit on_navigate→pipeline.navigate. `OpenResult{entry,dir}` 반환(`commands.rs:73-87`) |
| `open_in_new_window` | 새 라벨 발급 후 창별 큐에 경로 적재, WebviewWindow 생성(`commands.rs:56-71`) |
| `scan_directory` | 디렉토리 스캔을 `Channel<ScanBatch>`(100개 배치)로 스트리밍(`commands.rs:89-101`, `scan/mod.rs:112-149`) |
| `navigate` | 현재/이웃 id로 pipeline.navigate + edit 플러시 트리거(`commands.rs:103-115`) |
| `get_edit_state` / `set_edit_state` / `reset_edit_state` | 편집 상태 조회/저장(낙관적 버전, 불일치 시 `AppError::Conflict`)/초기화(`commands.rs:117-142`) |
| `flush_edits` | 편집 즉시 플러시(`commands.rs:144-148`) |
| `get_metadata` | EXIF+LibRaw probe 합성 메타데이터(`commands.rs:150-156`) |
| `set_rating` / `set_flag` / `set_label` / `get_organize` / `flush_organize` | 정리(별점·플래그·라벨) 일괄 처리(`commands.rs:158-186`) |
| `move_to_trash` | 휴지통 이동(+xmp 사이드카), 성공 id 목록 반환(`commands.rs:188-193`) |
| `watch_directory` | WatchService로 디렉토리 감시 교체(`commands.rs:195-199`) |
| `render_cpu_frame` | CPU 렌더 후 `cpu:frame-ready` emit + payload 반환(`commands.rs:201-217`) |
| `set_performance_settings` / `get_performance_settings` | `PerfSettings{preload_radius,l2_policy,isolated_decode}` 갱신/조회(`commands.rs:219-232`) |
| `request_l2` | 현재 이미지 L2 수동 enqueue(줌 시 — `commands.rs:234-238`) |
| `get_reverse_geocode` | EXIF GPS→Nominatim 역지오코딩(spawn_blocking — `commands.rs:240-254`) |
| `list_presets` / `save_preset` / `apply_preset` / `delete_preset` / `export_preset` / `import_preset` | 프리셋 CRUD + XMP 파일 입출력(`commands.rs:256-302`) |
| `copy_settings` | 소스 편집 상태를 마스크 섹션만 다중 대상에 복사(`commands.rs:304-317`) |
| `toggle_fullscreen` / `fullscreen_state` | 창 전체화면 토글/조회(`commands.rs:319-329`) |
| `register_image` | 단일 파일 등록(D&D 등), `ImageEntry` 반환(`commands.rs:331-340`) |
| `probe_capture_dates` | id 목록의 촬영시각(ms) 일괄 조회(`commands.rs:342-350`) |
| `rename_image` | 이름 변경: 확장자 유지 검증→flush→rename→사이드카 이동→catalog reassign→registry/store 재등록(`commands.rs:368-396`) |
| `move_images` / `copy_images` | 다중 이동(사이드카·catalog 동반)/복사(사이드카 동반)(`commands.rs:398-468`) |

### export
| 커맨드 | 설명 |
|---|---|
| `export_begin` | f16 캔버스 잡 생성(최대 4억 픽셀), job_id 반환(`export/commands.rs:28-31`, `export/job.rs:11-48`) |
| `export_tile` | raw body(f16 RGBA LE)+헤더(x-export-job, x-tile-*)로 타일 수집(`export/commands.rs:33-45`) |
| `export_set_watermark` / `read_watermark_png` | 워터마크 PNG 설정/읽기(64MB 제한 — `export/commands.rs:47-73`) |
| `export_finish` | 잡 take 후 spawn_blocking으로 인코드·저장, `export:progress` emit(`export/commands.rs:75-100`) |
| `export_cancel` | 잡 제거+취소 플래그(`export/commands.rs:102-106`) |
| `export_dng` | dnglab 외부 바이너리로 DNG 변환 후 편집 상태 XMP 주입(`export/commands.rs:108-120+`, `export/dng.rs:8-49`) |
| `open_with_edited` (`export::handoff`) | 내보낸 파일을 외부 앱으로 열기(`export/handoff.rs:16-26`) |

### 기타 모듈
| 커맨드 | 설명 |
|---|---|
| `exiftool::detect_exiftool` / `get_deep_metadata` | PATH에서 exiftool 탐지 / -j -G1 JSON 실행(3s 타임아웃)(`exiftool/mod.rs:95-113`) |
| `lens::find_lens_profile` / `list_lens_profiles` / `set_lens_override` | 메타데이터 기반 lensfun 매칭/검색/수동 오버라이드(`lens/mod.rs:30-51`) |
| `about::licenses::get_licenses` | 번들 리소스 licenses-rust.html 반환(`about/licenses.rs:10-13`) |
| `about::cache::get_cache_stats` / `clear_cache` | l0/l1 디렉토리 크기 집계/삭제(`about/cache.rs:92-101`) |
| `platform::commands::copy_image_to_clipboard` | raw PNG body를 NSPasteboard에 PNG+TIFF로(`platform/commands.rs:26-34`) |
| `copy_files_to_clipboard` | 파일 URL 복사(RAW의 페어 JPEG 동반 — `platform/commands.rs:36-59`) |
| `copy_text` | 텍스트 복사(`platform/commands.rs:61-64`) |
| `get_pairs` | 디렉토리의 RAW+JPEG 페어 목록(`platform/commands.rs:66-70`) |
| `note_recent` / `get_recents` / `clear_recents` | 최근 파일 기록(catalog recents + NSDocumentController + dock 현재 표시)(`platform/commands.rs:72-91`) |
| `get_display_color_space` / `has_display_icc_profile` / `get_display_lut` | 디스플레이 P3/sRGB 판별, ICC 존재, 3D LUT 바이트(`platform/commands.rs:93-110`) |
| `reveal_in_file_manager` / `open_with_external` | Finder 표시 / .app 번들 검증 후 외부 앱 열기(`platform/commands.rs:112-136`) |

### 이벤트 채널 (백엔드→프론트 emit)

| 상수 | 이름 | 발생 지점 |
|---|---|---|
| `EVENT_LEVEL_READY` | `image:level-ready` | 디코드/캐시 완료, LevelReadyPayload(rev,flip,matrix 포함) (`events.rs:8`, `pipeline/mod.rs:529-541`) |
| `EVENT_DECODE_FAILED` | `image:decode-failed` | 디코드 실패/미등록 id (`events.rs:9`) |
| `EVENT_FS_CHANGED` | `fs:changed` | watch 디바운스 플러시 (`events.rs:10`, `lib.rs:123-127`) |
| `EVENT_FILE_OPEN_REQUEST` | `file:open-request` | OS open(두 번째 인스턴스/RunEvent::Opened) (`events.rs:11`, `platform/mod.rs:41-46`) |
| `EVENT_DOCK_OPEN` | `dock:open` | macOS dock 최근 메뉴 클릭 (`events.rs:12`, `platform/macos/dock.rs:74`) |
| `EVENT_RECENTS_CHANGED` | `recents:changed` | dock에서 최근 항목 지우기 (`events.rs:13`, `dock.rs:86`) |
| `EVENT_EXPORT_PROGRESS` | `export:progress` | export_finish 인코드 진행 (`events.rs:14`, `export/commands.rs:86-95`) |
| `EVENT_DECODE_CRASH_LOOP` | `decode:crash-loop` | 디코드 패닉 누적 2회 이상 (`types_performance.rs:4`, `pipeline/mod.rs:443`) |
| `EVENT_CPU_FRAME_READY` | `cpu:frame-ready` | CPU 렌더 완료 (`types_cpurender.rs:4`, `commands.rs:213`) |

추가로 `scan_directory`는 이벤트가 아닌 `tauri::ipc::Channel<ScanBatch>`로 스트리밍한다(`commands.rs:90`).

---

## 6. 상태 관리 (managed state)

| 상태 | 등록 지점 | 비고 |
|---|---|---|
| `platform::OpenQueue` | **`Builder::manage`** (`lib.rs:49`) | setup 이전 등록이 필수: single-instance 플러그인 콜백(`lib.rs:50-54`)과 macOS `RunEvent::Opened`(`lib.rs:230-236`)가 setup 완료 전에 open 요청을 던질 수 있다. `handle_open`은 그래도 `try_state`로 방어하고 미등록 시 드롭 로그(`platform/mod.rs:31-34`). 큐는 frontend_ready 전 요청을 버퍼링(`open_queue.rs:23-37`) |
| `pipeline::AppState` (Services+Pipeline) | setup (`lib.rs:68`) | AppHandle이 필요해 setup에서 생성. 워커/타이머 스레드도 이때 spawn |
| `export::ExportService` | setup (`lib.rs:69`) | |
| `cpurender::CpuFrameStore` | setup (`lib.rs:70`) | |
| `platform::macos::MacOsPlatform` | setup, macOS 한정 (`lib.rs:71-72`) | `CurrentPlatform` 별칭(`platform/mod.rs:114-115`) |
| `platform::RecentsService` | setup (`lib.rs:73-80`) | catalog open 실패 시 in-memory 폴백 |
| `edit::EditService` | setup (`lib.rs:81-88`) | 동일 폴백 패턴 |
| `organize::OrganizeService` | setup (`lib.rs:90-97`) | 동일 |
| `preset::PresetService` | setup (`lib.rs:99-106`) | 동일 |
| `lens::LensService` | setup (`lib.rs:108-119`) | lensfun XML 디렉토리는 리소스 경로, dev에서는 `CARGO_MANIFEST_DIR/resources/lensfun` 폴백 |
| `watch::WatchService` | setup (`lib.rs:121-131`) | emit 클로저=`fs:changed`, invalidate 클로저=`services.store.remove(id)` |

수명 이벤트: `CloseRequested`에서 edit/organize `flush_all`(try_state 사용 — `lib.rs:134-142`), `Destroyed`에서 `pipeline.forget_window(label)`로 창별 desired 셋 해제·범위 밖 취소(`lib.rs:143-147`). `RunEvent::Ready`에서 dock 메뉴 설치(`lib.rs:225-228`).

플러그인: single-instance, dialog, opener, updater, process, window-state(DECORATIONS 제외), store(`lib.rs:50-64`).

---

## 7. 데이터 영속

| 저장소 | 위치 | 내용 |
|---|---|---|
| catalog (sqlite) | `dirs::data_dir()/app.raw-viewer/catalog.sqlite` (`catalog/mod.rs:8,65-69`) | 테이블: images(편집 상태 JSON·edit_version·content_key·sidecar_mtime_ns·rating/flag/label), presets, recents, lens_overrides. 마이그레이션 5개 내장(`catalog/mod.rs:10-16`). WAL+busy_timeout 5s(`catalog/mod.rs:73`). **키는 image_id가 아니라 절대 경로 문자열**(`path_key` — `catalog/mod.rs:60-62`). 같은 파일을 5개 서비스(Edit/Organize/Preset/Recents/Lens)가 각자 커넥션으로 연다 |
| XMP 사이드카 | 이미지와 같은 폴더 `<이름>.xmp`(`xmp/mod.rs:27-29`) | `aether:state` 속성에 EditState JSON을 zstd(19)+base64로 인코드(`xmp/mod.rs:72-76`), Adobe 호환 crs 속성 + xmp:Rating/xmp:Label/aether:Flag 병기(`xmp/mod.rs:84-113,141-150`). 로드 시 **사이드카 mtime이 catalog의 sidecar_mtime_ns보다 최신이면 사이드카가 권위**를 갖고 catalog에 역동기화(`edit/service.rs:159-202`). 쓰기 디바운스: edit 10s, organize 4s(`edit/service.rs:14`, `organize/service.rs:14`) |
| 디스크 픽셀 캐시 | `dirs::cache_dir()/app.raw-viewer/{l0,l1}/<key[0..2]>/<key>.{jpg,zst,meta}` (`cache/mod.rs:9,47-64`) | key=blake3(schema_version=2, path, mtime_ns, size)(`cache/mod.rs:30-39`). L1은 zstd(1) 압축 AETH 바디 + JSON `.meta`(flip/has_color_profile/color_matrix — `cache/mod.rs:86-131`). L2는 의도적으로 미캐시(`cache/mod.rs:133-143`). **축출·용량 상한 없음(무한 성장, SPEC-GAP — `cache/mod.rs:146`)** |
| 지오코딩 캐시 | `cache_dir/app.raw-viewer/geocode/<lat_lng 소수4자리>.json` (`geocode/mod.rs:14-63`) | |
| 설정 (store 플러그인) | tauri-plugin-store `settings.json`(`lib.rs:64`, 프론트 `src/store/settings.ts:46,80`) | 언어·테마·preloadRadius·l2Policy·isolatedDecode 등은 **프론트가 소유**하고 성능 설정만 `set_performance_settings`로 백엔드에 주입. 백엔드는 store 파일을 직접 읽지 않는다 |
| in-memory | PixelStore(1.5GB LRU, current 보호 — `store.rs:8,128-145`), CpuFrameStore(6프레임 — `serve.rs:9`), Registry(id→path RwLock HashMap — `scan/mod.rs:78-110`), RevCounters, EditService 엔트리 캐시 | 프로세스 재시작 시 소실 |

image_id = blake3(절대경로 문자열)(`scan/mod.rs:18-20`). 즉 registry/PixelStore/이벤트는 id 기준, catalog/디스크캐시는 경로(+mtime) 기준의 이중 키 체계다.

---

## 8. 빌드

- `build.rs`: `libraw` feature가 켜져 있으면(기본) `vendor/libraw`의 소스 약 70개를 cc로 직접 컴파일(C++14, USE_ZLIB, USE_X3FTOOLS — `build.rs:128-158`), bindgen으로 `libraw.h` → `$OUT_DIR/libraw_bindings.rs` 생성(`build.rs:160-179`, include 지점 `libraw_ffi.rs:1-4`).
- OpenMP: `LIBOMP_PREFIX` env → `brew --prefix libomp` → 고정 경로 순으로 탐색(`build.rs:83-103`). **정적 `libomp.a`를 우선 링크**하고, 없으면 dylib 링크로 폴백하되 그 경우 .app이 자기완결이 아니게 되므로 번들에 libomp.dylib 동봉 + install_name_tool 조치가 필요하다는 SPEC-GAP 경고를 출력(`build.rs:105-126`). libomp이 아예 없으면 OpenMP 없이 빌드(X-Trans 디모자이크 단일 스레드 경고 — `build.rs:106-108`).
- 시스템 zlib 링크(`build.rs:157`).
- vendored/생성물 복원(git에 미포함, 클론 후 필요):
  - `scripts/sync-vendor.sh` — `src-tauri/libraw.pin`(LibRaw 0.21.5 + sha256) 기준으로 `src-tauri/vendor/libraw` 복원
  - `scripts/sync-lensfun.sh` — `src-tauri/lensfun.pin`(lensfun v0.3.95) 기준으로 `src-tauri/resources/lensfun` XML 복원
  - `scripts/fetch-dnglab.sh` — dnglab 0.7.2를 `src-tauri/binaries/dnglab-aarch64-apple-darwin`으로(tauri externalBin — `tauri.conf.json:56-58`)
  - `scripts/fetch-fixtures.sh` — raw.pixls.us에서 tier1 RAW 픽스처 16종을 `tests/fixtures/tier1`으로 (테스트용)
- 리소스 번들: licenses-rust.html, licenses-npm.json, lensfun/*.xml(`tauri.conf.json:59-62`).
- `libraw_ffi` 테스트가 LibRaw 0.21 버전을 검증(`libraw_ffi.rs:483-486`).

---

## 9. 함정 목록 (실수하기 쉬운 지점)

1. **extern-C 경계 패닉**: LibRaw FFI는 전부 `guarded()`(catch_unwind)로 감싸 Panic을 에러로 회수한다(`libraw_ffi.rs:15-20`). 반면 macOS dock의 `application_dock_menu`는 `extern "C-unwind"` 콜백이고(`dock.rs:89`) `define_class!` 메서드(`dock.rs:34-44`)는 ObjC 런타임이 직접 호출한다 — 이 경로에 패닉 가능 코드를 넣으면 abort/UB 위험이 있어 기존 코드는 `let ... else return` 방어만 쓴다. 이 콜백들 안에서 `unwrap`/`state()`를 쓰지 말 것.
2. **`state()` vs `try_state()`**: `app.state::<T>()`는 미등록이면 패닉. setup 이전·창 파괴 중에 닿을 수 있는 경로(open 처리 `platform/mod.rs:31`, window 이벤트 `lib.rs:136-144`)는 `try_state`를 쓴다. 반대로 protocol 핸들러는 `state::<AppState>()`를 그냥 쓰므로(`protocol.rs:121,141,159`) setup 완료 전 aether 요청이 오면 패닉한다 — 프로토콜은 setup 전에 등록되지만(`lib.rs:65-66`) 메인 창은 tauri.conf.json 선언 창이라 **setup 훅 완료 후에 생성**되고, aether 요청은 웹뷰에서만 발생하므로 현 구조에서는 안전하다. 단 이 안전은 "AppState manage가 setup 안에 있고, setup 전에 웹뷰가 없다"는 전제에 묶여 있다 — setup 이전에 창을 만들게 되면 깨진다.
3. **OpenQueue만 Builder::manage인 이유**: single-instance 콜백·macOS Opened 이벤트가 setup보다 먼저 발화할 수 있어서다(6장). 새 상태를 플러그인 콜백에서 쓴다면 같은 이유로 Builder::manage로 올려야 한다.
4. **파일 rename/move 시 image_id 재계산**: image_id=blake3(절대경로)라 경로가 바뀌면 id도 바뀐다(`scan/mod.rs:18-20`). `rename_image`가 정석 절차: flush_edits → fs::rename → 사이드카 rename → `edits.reassign_path`(catalog 경로 키 이관 — `catalog/mod.rs:171-182`) → 구 id의 registry/store 제거 → 새 entry 등록(`commands.rs:368-396`). 한 단계라도 빠지면 편집/캐시가 고아가 된다. 디스크 픽셀 캐시는 키에 경로가 들어가므로 rename 후 자연 미스(재디코드)가 된다.
5. **flip 이중 적용 금지**: L1/L2 픽셀 버퍼는 회전되지 않은 상태이고 flip 코드는 프론트 셰이더가 적용한다(`libraw_ffi.rs:390-391`). 반면 L0 썸네일(common 경로)은 회전이 **베이크**되어 flip=0으로 emit된다(`common.rs:276-288`, `pipeline/mod.rs:640-651`). 레벨별로 회전 책임이 다르다.
6. **L1 디스크 캐시의 .meta 사이드카**: `.zst`만 복원하면 flip/color_matrix가 소실된다. 반드시 `load_l1`(CachedL1)을 통해 meta와 함께 읽을 것(`cache/mod.rs:11,114-131`). meta 파싱 실패 시 flip=0/행렬 없음으로 조용히 폴백한다(`cache/mod.rs:117-124`) — 회전·색이 틀어지면 이 지점을 의심.
7. **AETH 포맷 두 종류**: pipeline(fmt=2 f16 RGB — `store.rs:10-27`)과 cpurender(fmt=0 u8 RGBA — `serve.rs:4-21`)는 헤더 구조만 같고 payload가 다르다. 소비 측에서 fmt/channels 바이트를 확인해야 한다.
8. **캐시 키와 편집의 상호작용**: 디스크 캐시 키에 mtime이 들어가므로 원본 파일이 수정되면 자동 미스가 되지만, **PixelStore는 id 키**라 파일 수정 후에도 낡은 픽셀을 서빙할 수 있다. 이를 watch의 Modified 이벤트가 `store.remove(id)`로 보정한다(`lib.rs:128-130`, `watch/mod.rs:133-137`). watch가 꺼진 디렉토리에서는 보정이 없다.
9. **catalog는 경로 키 + 다중 커넥션**: 같은 sqlite 파일을 5개 서비스가 따로 연다(`lib.rs:73-119`). WAL·busy_timeout이 있지만 새 서비스 추가 시 트랜잭션 장기 점유 금지. 그리고 catalog에는 image_id가 아예 없다 — id로 조회하려면 registry.resolve로 경로부터 얻는다.
10. **낙관적 버전 충돌**: `set_edit_state`는 `expected_version` 불일치 시 `AppError::Conflict`(`edit/service.rs:204-214`, `catalog/mod.rs:132-155`). 외부에서 사이드카가 갱신되면 로드시 버전이 +1 되므로(`edit/service.rs:168-181`) 프론트가 낡은 버전으로 저장을 시도하면 Conflict가 정상 동작이다.
11. **PixelStore LRU와 current 보호**: 예산 초과 시 current 이미지가 아닌 것만 축출(`store.rs:128-145`). `set_current`를 잊으면 현재 이미지가 축출될 수 있다(navigate가 자동 호출 — `pipeline/mod.rs:288`).
12. **PendingSet dedup 규약**: 잡 등록은 `pending.reserve` 성공 시에만 큐에 push, 잡 종료 시 자기 flag로만 release(`pipeline/mod.rs:111-135,399-405`). 이를 우회해 큐에 직접 push하면 중복 디코드가 발생한다.
13. **취소는 협조적**: CancelFlag는 디코드 중간 체크포인트에서만 확인된다(`libraw_ffi.rs:366-463`의 check_cancel 지점, `common.rs:232-244`). LibRaw의 개별 C 호출 자체는 중단 불가 — 긴 호출 사이에 체크를 넣는 패턴을 유지할 것.
14. **패닉 크래시 루프**: in-process 디코드 패닉이 프로세스 누적 2회에 도달하면 `decode:crash-loop`을 emit(`pipeline/mod.rs:439-446`). 사용자가 `isolated_decode`를 켜면 서브프로세스로 격리된다(`pipeline/mod.rs:652-655`). 카운터는 이미지별이 아닌 전역 누적이며 리셋 없음.
15. **무거운 작업의 스레드 배치**: 디코드는 전용 워커 스레드, exiftool/geocode/export_finish/dng은 `spawn_blocking`(`commands.rs:245`, `export/commands.rs:85`). 단 `render_cpu_frame`은 async 커맨드 본문에서 동기 CPU 렌더를 직접 수행한다(`commands.rs:202-218`) — tauri async 런타임(tokio) 워커를 점유한다. 현재는 CPU 폴백의 단발 프레임 요청이라 허용 범위지만, 고해상·연속 호출로 커지면 `spawn_blocking`으로 옮긴다.
16. **락 규약**: 모든 Mutex/RwLock은 `unwrap_or_else(PoisonError::into_inner)`로 poison을 무시한다(코드베이스 전반, 예 `store.rs:81`). 새 코드도 동일 패턴을 따르고, 락 보유 중 emit/IO를 피할 것(기존 코드는 emit 전에 락을 푼다 — 예 `pipeline/mod.rs:280-287`).
17. **경로의 C 문자열 변환**: unix는 OsStr 바이트, 그 외는 UTF-8 필수 + 내부 NUL 거부(`libraw_ffi.rs:260-270`). Windows 비UTF-8 경로는 디코드 실패한다.
18. **aether original 라우트는 gif/webp 전용**: 다른 확장자를 원본으로 서빙하려면 화이트리스트(`protocol.rs:38`)에 추가해야 하며, 임의 파일 서빙 방지 목적의 의도적 제한이다.
19. **emit 실패는 무시(로그만)**: 모든 emit은 실패해도 로직에 영향 없다(`events.rs:36-46`). 이벤트 전달을 전제로 한 상태 천이를 만들지 말 것.
20. **RAW+JPEG 페어링**: 스캔 시 같은 stem의 JPEG는 목록에서 숨겨진다(`scan/mod.rs:129-131`, `scan/pairing.rs:35-37`). 파일 이동/복사/휴지통에서 페어 JPEG는 자동 동반되지 않고(사이드카만 동반), 클립보드 파일 복사만 페어를 동반한다(`platform/commands.rs:47-53`).
