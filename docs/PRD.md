# AetherLens — Product Requirement Document

**v2.0 · 2026-07-15 · One-Shot AI Implementation Spec**

> Tauri 2 + Rust + React 기반 크로스플랫폼 RAW / Common 이미지 뷰어 & 비파괴 보정 애플리케이션

> 이 파일은 사용자가 세션에서 제공한 PRD v2.0 원문을 그대로 옮긴 것이다. 의심스러운 부분이 있으면 사용자에게 원문 대조를 요청한다.

---

## 0. 이 문서를 읽는 AI에게 (Implementation Directive)

### 0.1 문서의 성격
이 문서는 **제안서가 아니라 확정 스펙**이다. `~하면 좋겠다`, `~또는 ~` 같은 선택지는 §12 (보류 항목)를 제외하고 존재하지 않는다. 모든 기술 선택은 이미 결정되었으며, 결정의 근거는 각 절의 `Rationale` 블록에 명시되어 있다.

### 0.2 절대 규칙 (Non-Negotiable Constraints)

| # | 규칙 | 위반 시 결과 |
|---|------|-------------|
| R1 | **디코딩된 픽셀 버퍼를 `invoke` 리턴값(JSON)으로 전달하지 말 것.** 반드시 §2.3의 커스텀 URI 프로토콜을 사용한다. | 45MP = 270MB → JSON 직렬화 시 수 GB, 수십 초 소요. 성능 목표 즉시 불가능. |
| R2 | **편집 연산은 반드시 선형(linear) scene-referred 공간에서 수행한다.** sRGB 감마가 인코딩된 값에 직접 노출/대비를 곱하지 말 것. | 색이 물리적으로 틀림. 라이트룸과 결과가 완전히 달라짐. |
| R3 | **8-bit 텍스처로 편집 파이프라인을 구성하지 말 것.** 작업 버퍼는 `RGBA16F`. | 쉐도우 리프트 시 밴딩 육안 확인됨. |
| R4 | **GPL 라이선스 코드를 링크하지 말 것.** (특히 LibRaw demosaic-pack-GPL2의 AMaZE, exiv2) | 프로젝트 전체가 GPL로 감염되어 MIT 배포 불가. §10 참조. |
| R5 | **원본 파일(CR2/ARW/NEF...)에 절대 쓰기(write)하지 말 것.** 모든 편집은 사이드카 + DB에 저장한다. | 사용자 원본 손실. 복구 불가. |
| R6 | **패닉(`panic!`/`unwrap()`) 금지.** 디코더 경계는 `catch_unwind` + `Result`로 감싼다. | 손상 파일 1개로 앱 전체 크래시. |
| R7 | **WebGPU를 베이스라인으로 가정하지 말 것.** WebGL2가 베이스라인, WebGPU는 런타임 감지 후 progressive enhancement. | macOS Sonoma/Sequoia(WKWebView) 및 Linux WebKitGTK에서 흰 화면. |

### 0.3 구현 순서
§11의 마일스톤 순서를 따른다. Phase 0 → 1 → 2 → 3 → 4. 각 Phase는 독립적으로 동작하는 빌드를 산출해야 한다.

### 0.4 불확실할 때
스펙에 없는 세부사항을 마주치면 **§13 (Open Questions)에 항목을 추가하고, 가장 보수적이고 되돌리기 쉬운 선택**을 한 뒤 코드에 `// SPEC-GAP: <설명>` 주석을 남긴다. 임의로 아키텍처를 바꾸지 않는다.

---

## 1. 제품 정의

### 1.1 한 줄 정의
> **"방향키 하나로 45MP RAW 폴더를 훑고, 슬라이더 한 번으로 60fps 보정하고, 원본은 절대 건드리지 않는 15MB짜리 데스크톱 앱."**

### 1.2 제품 철학

1. **속도가 기능이다.** 사진을 보기 시작하는 데 걸리는 시간이 60ms를 넘으면 뷰어가 아니라 로딩 화면이다.
2. **비파괴(Non-destructive)는 협상 대상이 아니다.** 원본은 read-only 자산이다.
3. **범용성 우선.** 독자 포맷을 만들지 않는다. 나갈 때는 DNG/XMP/ICC 같은 업계 표준으로 나간다.
4. **정직한 색.** 카메라 매트릭스 → 선형 작업 공간 → 디스플레이 변환의 전 과정을 생략하지 않는다.
5. **가벼움.** Electron 대비 바이너리 1/10, 메모리 1/5.

### 1.3 타겟 사용자
- 캐논/소니/니콘/후지 RAW를 다루는 개발자·사진가 (Primary)
- 라이트룸이 무겁다고 느끼지만 색은 포기하고 싶지 않은 사용자
- 폴더 기반 워크플로우(카탈로그 강제 없음)를 선호하는 사용자

### 1.4 명시적 Non-Goal (v2.0 범위 밖)
- 클라우드 동기화 / 계정 시스템
- 카탈로그 강제 임포트 (폴더가 곧 카탈로그다)
- 레이어 기반 합성 (Photoshop 대체 아님)
- 로컬 보정 브러시 / 그라디언트 마스크 → **Phase 4 이후**
- AI 기반 자동 보정 / 피사체 인식 마스킹
- 동영상, HEIC 라이브포토의 동영상 트랙

### 1.5 플랫폼 로드맵

| 플랫폼 | 상태 | 웹뷰 | GPU 백엔드 | 비고 |
|--------|------|------|-----------|------|
| **macOS 13+ (Apple Silicon)** | **P0 — 성능 기준 플랫폼** | WKWebView | WebGL2 (+ WebGPU on macOS 26+) | 모든 성능 목표의 기준 |
| macOS 13+ (Intel) | P1 — best-effort | WKWebView | WebGL2 | 성능 목표 미적용 |
| **Windows 10 1809+ / 11** | **P1 — Phase 4** | WebView2 (Chromium) | WebGL2 + WebGPU | 웹뷰가 더 좋음. 플랫폼 통합만 재구현 |
| Linux (X11/Wayland) | P2 — Phase 4 | WebKitGTK 2.40+ | WebGL2 (불안정) | §9.3 완화책 필수 |

> **Rationale:** macOS를 기준으로 잡되, **모든 플랫폼 의존 코드는 처음부터 §9.1의 `platform` trait 뒤에 격리한다.** 나중에 포팅하는 게 아니라, 처음부터 포팅 가능한 구조로 짓는다. Windows/Linux의 구현체는 Phase 4에서 채우되, trait과 `#[cfg]` 분기는 Phase 1부터 존재해야 한다.

---

## 2. 아키텍처

### 2.1 확정 기술 스택

#### Frontend
| 항목 | 선택 | 버전 | Rationale |
|------|------|------|-----------|
| 프레임워크 | React | 18.3+ | 생태계. Concurrent features로 필름스트립 가상화 유리 |
| 언어 | TypeScript | 5.5+ (`strict: true`) | 셰이더 uniform 타입 안전성 |
| 번들러 | Vite | 5+ | Tauri 공식 권장 |
| 스타일 | Tailwind CSS | 3.4+ | — |
| 아이콘 | lucide-react | — | — |
| UI 프리미티브 | Radix UI | — | 접근성(포커스 트랩/키보드) 무료 획득 |
| 상태관리 | Zustand + Immer | — | Immer **patch**가 Undo/Redo의 기반 (§FR-11) |
| 지도 | Leaflet | 1.9+ | OSM 타일, API 키 불필요 |
| 가상 리스트 | @tanstack/react-virtual | 3+ | 10k장 필름스트립 |
| GPU | **WebGL2 (베이스라인)** / WebGPU (선택적) | — | R7 |

#### Backend (Rust)
| 항목 | 크레이트 / 라이브러리 | 라이선스 | Rationale |
|------|---------------------|---------|-----------|
| 셸 | Tauri | MIT/Apache-2.0 | **v2 필수** (v1은 `Channel`, raw IPC 없음) |
| **RAW 디코딩** | **LibRaw 0.21+ (FFI, `bindgen`)** | **CDDL-1.0 선택** | **CR3 지원. `rawloader`는 CR3 미지원 + 유지보수 정체 → 채택 불가** |
| DNG 쓰기 | `rawler` / `dnglab` | LGPL-2.1 | **sidecar 프로세스로 격리** (§10.2) |
| EXIF | `kamadak-exif` | BSD-2 | exiv2/rexiv2는 **GPL → R4 위반, 금지** |
| Deep 메타데이터 | ExifTool (선택적 외부 프로세스) | Artistic/GPL | 링크 아님. 사용자 PATH에 있을 때만 (§FR-16.4) |
| ICC | `lcms2` | MIT | 출력 프로파일 임베딩 |
| DB / 카탈로그 | `rusqlite` (bundled) | MIT / SQLite=PD | — |
| 병렬 | `rayon` | MIT/Apache | 디코딩 워커 풀 |
| 파일 감시 | `notify` | CC0/Artistic | — |
| 휴지통 | `trash` | MIT | — |
| 클립보드 | `arboard` + `objc2` | MIT | 이미지=arboard, 파일URL=네이티브 |
| 압축(캐시) | `zstd` | BSD | 프록시 캐시 |
| WebP/JPEG/PNG | `image`, `jpeg-encoder`, `png` | MIT/Apache | — |
| AVIF | `ravif` | BSD-3 | — |
| 로깅 | `tracing` + `tracing-subscriber` | MIT | 성능 span 계측 필수 |
| 에러 | `thiserror` (lib) / `anyhow` (app) | MIT/Apache | — |
| macOS FFI | `objc2`, `objc2-app-kit` | MIT | Dock 메뉴, NSPasteboard |
| 렌즈 보정 | **Lensfun XML DB 자체 파싱** (`quick-xml`) | DB=CC-BY-SA-3.0 | **lensfun C 라이브러리는 LGPL-3 → 링크 안 함. 데이터만 읽고 수식은 직접 구현** (§FR-8) |

#### Tauri 플러그인
`tauri-plugin-single-instance`, `tauri-plugin-window-state`, `tauri-plugin-dialog`, `tauri-plugin-fs`, `tauri-plugin-opener`, `tauri-plugin-store`, `tauri-plugin-log`, `tauri-plugin-deep-link`

> **⚠️ Gemini v1.1 PRD의 오류 정정:** `tauri::App::native_toc_menu` API는 **존재하지 않는다**(환각). Dock 메뉴는 §FR-18에 명시된 `objc2` FFI로 직접 구현한다.

### 2.2 레이어 구조

```
┌─────────────────────────────────────────────────────────────────┐
│  UI Layer — React / TypeScript                                  │
│  Filmstrip · Viewport · EditPanel · MetaPanel · ContextMenu      │
├─────────────────────────────────────────────────────────────────┤
│  State Layer — Zustand + Immer Patches                          │
│  EditState(§5.1) · Playlist · History(§FR-11) · Selection       │
├─────────────────────────────────────────────────────────────────┤
│  Render Layer — WebGL2 / WebGPU                                 │
│  RenderGraph(§3.4) · TileManager(§3.5) · TexturePool            │
╞═════════════════ Tauri IPC 경계 ════════════════════════════════╡
│  ① invoke  → 제어/메타데이터 (JSON, 소용량)                       │
│  ② Channel → 진행률·스캔 스트리밍 (JSON 청크)                     │
│  ③ aether:// URI 프로토콜 → 픽셀 버퍼 (바이너리, 대용량)  ★R1      │
╞═════════════════════════════════════════════════════════════════╡
│  Core Layer — Rust                                              │
│  DecodePipeline(§3.1) · ColorEngine(§3.2) · CacheManager        │
│  Catalog(SQLite) · XmpIO · Exporter · LensfunDB                 │
├─────────────────────────────────────────────────────────────────┤
│  Platform Layer — trait Platform (§9.1)                         │
│  MacOsPlatform │ WindowsPlatform │ LinuxPlatform                │
├─────────────────────────────────────────────────────────────────┤
│  Native Deps — LibRaw(FFI) · lcms2 · dnglab(sidecar)            │
└─────────────────────────────────────────────────────────────────┘
```

### 2.3 데이터 흐름 — 픽셀은 IPC를 타지 않는다 ★핵심

**문제:** Tauri `invoke`의 반환값은 JSON 직렬화된다. 45MP × 3ch × 16bit = 270MB → JSON 숫자 배열로는 ~1.5GB 텍스트 + 파싱 수십 초. **성능 목표가 물리적으로 불가능.**

**해결: 커스텀 URI 스킴 프로토콜.** 픽셀은 webview의 네트워크 레이어를 통해 바이너리로 흐른다.

```rust
// src-tauri/src/protocol.rs
tauri::Builder::default()
  .register_asynchronous_uri_scheme_protocol("aether", |app, req, responder| {
      // aether://localhost/pixels/{image_id}/{level}/{tile_x}_{tile_y}?rev=7
      //   level  = l0 | l1 | l2
      //   반환   = raw f16 또는 u16 planar 바이너리 (헤더 16바이트 + 페이로드)
      //   헤더   = [magic:u32][w:u32][h:u32][fmt:u8][channels:u8][pad:u16]
      //   Content-Type: application/octet-stream
      //   Cache-Control: no-cache  (rev 쿼리로 무효화 제어)
      tauri::async_runtime::spawn(async move {
          let res = pixel_service::serve(app, req).await;
          responder.respond(res);
      });
  })
```

```
사용자: 방향키 →
   │
   ├─(1) invoke("navigate", {index}) ──────────────► Rust: Playlist 인덱스 갱신
   │                                                        │
   │                                                        ├─ L0 캐시 히트? → 즉시 ready
   │                                                        └─ 아니면 DecodePipeline 큐에 투입
   │                                                              (기존 in-flight job은 abort)
   │
   ├─(2) Rust ──emit("image:level-ready", {id, level:"l0", rev}) ──► React
   │
   ├─(3) React: fetch("aether://localhost/pixels/{id}/l0")
   │            → ArrayBuffer → gl.texImage2D  ★ JSON 없음, zero-copy에 근접
   │
   ├─(4) emit("image:level-ready", {level:"l1"})  → 텍스처 교체 (~250ms)
   ├─(5) emit("image:level-ready", {level:"l2"})  → 텍스처 교체 (~1.2s)
   │
   └─(6) invoke("get_metadata", {id}) → JSON (소용량, 여기는 invoke가 적절)
```

> **Rationale:** `tauri::ipc::Response::new(Vec<u8>)` (raw IPC)도 v2에서 가능하지만, URI 프로토콜이 우수하다: ① 브라우저 HTTP 캐시/Range 요청 활용, ② `<img>`/`fetch`로 자연스럽게 소비, ③ 타일 단위 요청이 URL로 표현됨, ④ 요청 취소가 `AbortController`로 무료.

### 2.4 동시성 모델

```
┌─ Main Thread (Tauri) ── 이벤트 루프. 절대 블로킹 금지
│
├─ Decode Pool ── rayon, 스레드 수 = physical_cores - 1 (M1: 7, M1 Pro/Max: 9)
│   └ 우선순위 큐: [현재 이미지 L2] > [현재 L1] > [현재 L0]
│                > [±1 L1] > [±2..3 L1] > [±4.. L0] > [백그라운드 필름스트립 L0]
│   └ 취소: 각 job은 AtomicBool 취소 토큰 보유. 500ms 내 미착수 job은 폐기
│
├─ Cache Thread ── SQLite 쓰기 직렬화 (WAL 모드), 프록시 디스크 flush
│
├─ Watch Thread ── notify, 200ms 디바운스
│
└─ Export Pool ── 별도 rayon 풀 (스레드 2). Export가 뷰어를 굶기지 않게 격리
```

**Backpressure:** 방향키 연타(>10 keys/sec) 감지 시 → L2 디코딩 큐 전체 취소, L0만 서빙. 키 입력 정지 후 150ms 뒤 L1/L2 재개.

### 2.5 프로젝트 구조

```
aetherlens/
├── package.json
├── vite.config.ts
├── tailwind.config.ts
├── src/                                # ── React Frontend
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── viewport/
│   │   │   ├── Viewport.tsx            # 캔버스 컨테이너, 줌/팬
│   │   │   ├── CropOverlay.tsx
│   │   │   ├── CompareView.tsx         # Before/After
│   │   │   └── ClippingOverlay.tsx
│   │   ├── filmstrip/
│   │   │   ├── Filmstrip.tsx           # 가상화
│   │   │   └── GridView.tsx
│   │   ├── panels/
│   │   │   ├── EditPanel/
│   │   │   │   ├── BasicSection.tsx
│   │   │   │   ├── ToneCurve.tsx
│   │   │   │   ├── HslSection.tsx
│   │   │   │   ├── DetailSection.tsx
│   │   │   │   ├── LensSection.tsx
│   │   │   │   └── EffectsSection.tsx
│   │   │   ├── MetaPanel/
│   │   │   │   ├── MetaPanel.tsx
│   │   │   │   ├── MetaRow.tsx
│   │   │   │   └── GpsMiniMap.tsx      # Leaflet
│   │   │   └── PresetPanel.tsx
│   │   ├── Histogram.tsx
│   │   ├── ContextMenu.tsx
│   │   └── ExportDialog.tsx
│   ├── gl/                             # ── 렌더 엔진
│   │   ├── RenderGraph.ts              # §3.4 패스 오케스트레이션
│   │   ├── Backend.ts                  # WebGL2 | WebGPU 추상화
│   │   ├── webgl2/
│   │   │   ├── Gl2Backend.ts
│   │   │   ├── TexturePool.ts
│   │   │   └── TileManager.ts          # §3.5
│   │   ├── webgpu/
│   │   │   └── WgpuBackend.ts
│   │   └── shaders/
│   │       ├── common.glsl             # 색공간 변환 함수 라이브러리
│   │       ├── 01_wb_matrix.frag
│   │       ├── 02_lens.frag
│   │       ├── 03_exposure_tone.frag
│   │       ├── 04_tonecurve.frag
│   │       ├── 05_hsl.frag
│   │       ├── 06_detail.frag          # NR + Sharpen
│   │       ├── 07_effects.frag         # vignette, grain
│   │       └── 08_output.frag          # OETF + 클리핑 오버레이
│   ├── store/
│   │   ├── editStore.ts                # Zustand + Immer
│   │   ├── historyStore.ts             # §FR-11
│   │   ├── playlistStore.ts
│   │   └── uiStore.ts
│   ├── ipc/
│   │   ├── commands.ts                 # invoke 래퍼 (타입 안전)
│   │   ├── events.ts                   # listen 래퍼
│   │   └── pixels.ts                   # aether:// fetch + 헤더 파싱
│   ├── types/                          # ★ Rust와 1:1 대응 (§5)
│   │   ├── edit.ts
│   │   ├── metadata.ts
│   │   └── ipc.ts
│   └── shortcuts/
│       └── keymap.ts                   # §FR-20
│
└── src-tauri/                          # ── Rust Backend
    ├── Cargo.toml
    ├── build.rs                        # LibRaw bindgen
    ├── tauri.conf.json
    ├── vendor/
    │   └── libraw/                     # 서브모듈, CDDL-1.0, 무수정
    ├── binaries/
    │   └── dnglab-<target-triple>      # sidecar (§10.2)
    ├── resources/
    │   └── lensfun/                    # CC-BY-SA-3.0 XML DB
    └── src/
        ├── main.rs
        ├── lib.rs
        ├── protocol.rs                 # ★ aether:// (§2.3)
        ├── decode/
        │   ├── mod.rs
        │   ├── libraw_ffi.rs           # unsafe 경계, catch_unwind
        │   ├── pipeline.rs             # L0/L1/L2 (§3.1)
        │   ├── queue.rs                # 우선순위 + 취소
        │   └── common.rs               # jpg/png/webp/tiff/heic
        ├── color/
        │   ├── mod.rs
        │   ├── camera_matrix.rs        # §3.2 DNG-spec 변환
        │   ├── spaces.rs
        │   └── icc.rs                  # lcms2
        ├── meta/
        │   ├── mod.rs
        │   ├── exif.rs                 # kamadak-exif + LibRaw
        │   ├── gps.rs
        │   └── exiftool.rs             # 선택적 sidecar (§FR-16.4)
        ├── xmp/
        │   ├── mod.rs
        │   ├── read.rs
        │   ├── write.rs
        │   └── crs_map.rs              # ★ §5.3 매핑 테이블
        ├── catalog/
        │   ├── mod.rs
        │   ├── schema.rs               # §5.4
        │   └── migrations/
        ├── cache/
        │   ├── mod.rs
        │   └── proxy.rs                # zstd f16
        ├── export/
        │   ├── mod.rs
        │   ├── dng.rs                  # §FR-14.2
        │   ├── raster.rs
        │   └── batch.rs
        ├── lens/
        │   ├── mod.rs
        │   └── lensfun_db.rs
        ├── fs/
        │   ├── scan.rs                 # 스트리밍 (§FR-1.2)
        │   ├── watch.rs
        │   └── pairing.rs              # RAW+JPEG (§FR-1.6)
        ├── platform/                   # ★ §9.1
        │   ├── mod.rs                  # trait Platform
        │   ├── macos/
        │   │   ├── mod.rs
        │   │   ├── dock.rs             # objc2 applicationDockMenu:
        │   │   ├── pasteboard.rs
        │   │   └── bookmarks.rs        # security-scoped
        │   ├── windows/
        │   └── linux/
        └── error.rs
```

---

## 3. 이미지 파이프라인 — 제품의 심장

### 3.1 3단계 프록시 (Progressive Decode)

**원칙:** 사용자는 절대 빈 화면을 보지 않는다. 항상 뭔가 보이고, 점점 좋아진다.

| Level | 생성 방법 | 해상도 | 정밀도 | M1 목표 | 용도 |
|-------|----------|--------|--------|---------|------|
| **L0** | `libraw_unpack_thumb()` — RAW 내장 JPEG 프리뷰 추출. 디코딩 없음 | 보통 1616×1080 ~ 원본크기 | 8-bit sRGB | **≤ 60ms** | 첫 화면, 필름스트립, 빠른 넘김 |
| **L1** | `params.half_size = 1` — 데모자이킹 **생략**, 2×2 CFA 블록 → 1픽셀 직결 | 원본의 1/2 (45MP→11MP) | 16-bit linear | **≤ 250ms** | 편집 인터랙션, 프리로드 |
| **L2** | 풀 언팩 + 데모자이킹 (§3.3) | 원본 100% | 16-bit linear | **≤ 1.2s** | 100% 줌, Export, 최종 확인 |

```rust
// decode/pipeline.rs — 의사코드
pub async fn decode_progressive(path: &Path, tok: CancelToken, tx: Channel<LevelReady>) -> Result<()> {
    // ── L0
    if let Some(thumb) = cache.get_l0(path)? {
        tx.send(LevelReady::l0(thumb))?;
    } else {
        let t = libraw::unpack_thumb(path)?;   // 내장 JPEG, 디코딩 아님
        cache.put_l0(path, &t)?;
        tx.send(LevelReady::l0(t))?;
    }
    if tok.cancelled() { return Ok(()); }

    // ── L1  (half_size: 데모자이킹 스킵. LibRaw에서 약 4~5배 빠름)
    let l1 = cache.get_l1(path).or_else(|| {
        let img = libraw::decode(path, Params { half_size: true, use_camera_wb: true,
                                                output_bps: 16, output_color: RAW,
                                                no_auto_bright: true, .. })?;
        cache.put_l1(path, &img)?;   // zstd(f16) 디스크 캐시
        Ok(img)
    })?;
    tx.send(LevelReady::l1(l1))?;
    if tok.cancelled() { return Ok(()); }

    // ── L2  (뷰포트가 100% 줌이거나, 유휴 상태일 때만)
    if should_decode_l2(&tok) {
        let l2 = libraw::decode(path, Params { half_size: false, user_qual: demosaic_for(sensor),
                                               output_bps: 16, output_color: RAW,
                                               use_camera_wb: true, no_auto_bright: true, .. })?;
        tx.send(LevelReady::l2(l2))?;
    }
    Ok(())
}
```

**LibRaw 파라미터 확정값 (전 레벨 공통):**

| 파라미터 | 값 | 이유 |
|---------|-----|------|
| `output_color` | **`0` (raw, 변환 없음)** | ★ LibRaw가 sRGB로 변환하게 두지 않는다. 카메라 네이티브 RGB를 받아서 §3.2를 우리가 수행 |
| `output_bps` | `16` | R3 |
| `use_camera_wb` | `1` | **이거 없으면 모든 사진이 초록빛으로 열린다** |
| `no_auto_bright` | `1` | 자동 밝기 보정 금지 — 우리가 톤을 결정한다 |
| `gamm[0]`, `gamm[1]` | `1.0, 1.0` (선형) | R2. 감마는 §3.4 마지막 패스에서 |
| `highlight` | `0` (clip) → 사용자 설정 시 `2`(blend)/`3`(rebuild) | §FR-3 `highlightRecovery` |
| `user_qual` | §3.3 참조 | — |
| `four_color_rgb` | `0` | — |

### 3.2 컬러 매니지먼트 — 생략 시 "라이트룸이랑 색이 다른데요?"

**v1.1 PRD에는 색 공간에 대한 언급이 한 글자도 없었다. 이것이 가장 큰 결함이었다.**

#### 3.2.1 전체 경로

```
[센서 CFA / 카메라 네이티브 RGB]
        │  ① AsShotNeutral 또는 사용자 WB
        │     → 채널별 게인 (r_gain, 1.0, b_gain)
        ▼
[White-balanced Camera RGB]
        │  ② ColorMatrix1/2 + CameraCalibration1/2 + AnalogBalance
        │     → DNG 스펙 §6 "Mapping Camera Color Space to CIE XYZ"
        │     → CameraToXYZ_D50 = (AB · CC · CM)⁻¹   (조명 온도 보간 포함)
        ▼
[CIE XYZ (D50)]
        │  ③ Bradford chromatic adaptation D50 → D65
        │  ④ XYZ_D65 → linear Rec.2020 매트릭스
        ▼
[★ 작업 공간: linear Rec.2020, scene-referred, f16]  ◄── 모든 편집이 여기서 일어남 (R2)
        │  ⑤ Base Curve (§3.2.4)
        │  ⑥ 모든 편집 패스 (§3.4)
        ▼
[Display / Export 분기]
        ├─ Display: → 모니터 색공간 (Display-P3 or sRGB) + OETF → 캔버스
        └─ Export : → 선택 프로파일(sRGB/P3/Rec2020/ProPhoto) + OETF + ICC 임베딩(lcms2)
```

> **작업 공간을 linear Rec.2020으로 확정한 Rationale:**
> - **ProPhoto**: Adobe 호환에 유리하지만 원색이 **허수(imaginary)** → 셰이더 연산 중 음수 성분 발생, 채도 조정 시 비직관적 결과.
> - **linear Rec.2020**: 실재하는 원색, 대부분 카메라 gamut을 포함, HDR/P3 디스플레이로 가는 경로가 자연스러움, 미래 표준.
> - **sRGB 작업공간**: 절대 금지. 카메라 gamut을 잘라먹는다 (특히 채도 높은 빨강/청록).
> - **트레이드오프:** XMP `crs:` round-trip 시 Adobe의 ProPhoto 기준값과 미세한 차이 발생 → §5.3에서 근사임을 명시.

#### 3.2.2 매트릭스 획득 우선순위
1. 파일 내장 DNG 태그 (`ColorMatrix1/2`, `CameraCalibration1/2`, `ForwardMatrix1/2`, `AsShotNeutral`) — DNG 파일
2. LibRaw `imgdata.rawdata.color.cam_xyz` / `cmatrix` — 대부분의 독자 RAW
3. LibRaw `rgb_cam` (camera → sRGB linear) 역산 — 위가 없을 때
4. **모두 실패 시:** identity 매트릭스 + UI에 `⚠ 이 기종의 컬러 프로파일이 없습니다 (색 부정확)` 배지 표시. **조용히 틀린 색을 보여주지 말 것.**

#### 3.2.3 디스플레이 출력 — macOS = P3가 기본이다

sRGB 픽셀을 태깅 없이 캔버스에 뿌리면 **P3 디스플레이에서 채도가 과장되어 보인다.** 필수 처리:

```ts
// gl/webgl2/Gl2Backend.ts
const gl = canvas.getContext('webgl2', {
  colorSpace: 'display-p3',        // 지원 시
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
  antialias: false,               // 우리가 필터링 관리
  powerPreference: 'high-performance',
});
// 지원 확인 후 설정 (미지원 브라우저는 조용히 무시됨)
if ('drawingBufferColorSpace' in gl) gl.drawingBufferColorSpace = 'display-p3';
if ('unpackColorSpace'        in gl) gl.unpackColorSpace        = 'srgb';

// 실제 적용 여부 검증 → 미지원이면 셰이더 출력 타겟을 sRGB로 폴백
const actual = (gl as any).drawingBufferColorSpace ?? 'srgb';
renderGraph.setDisplaySpace(actual === 'display-p3' ? Space.DisplayP3 : Space.Srgb);
```

- Rust `platform::display_color_space()`가 `NSScreen.colorSpace` (macOS) / DXGI (Windows)를 조회해 프론트에 알린다. 웹뷰 값과 불일치 시 웹뷰 값 우선(실제로 그려지는 게 그것이므로), 로그 경고.
- **모니터 ICC 프로파일 전체 적용(캘리브레이션 대응)은 Phase 4.** v2.0은 P3/sRGB 두 타겟만.

#### 3.2.4 Base Curve (기본 렌더링)
선형 scene-referred 데이터를 그대로 보여주면 **매우 어둡고 밋밋하다.** 반드시 기본 톤 렌더링이 필요.

| 모드 | 설명 | 기본값 |
|------|------|--------|
| `linear` | 곡선 없음. 순수 선형 → sRGB OETF만 | — |
| **`standard`** | **Adobe 유사 base curve.** 하이라이트 롤오프 + 미드톤 리프트. 3차 스플라인 LUT (셰이더 1D 텍스처 256픽셀) | **✅ 기본값** |
| `filmic` | 강한 숄더 롤오프. 고대비 장면용 | — |
| `camera-match` | RAW 내장 JPEG(L0)의 히스토그램에 매칭하는 톤 곡선을 자동 추정 (Phase 3) | — |

### 3.3 데모자이킹 — 라이선스 지뢰밭 통과하기

> **⚠️ 함정:** 가장 유명한 `AMaZE`는 **LibRaw-demosaic-pack-GPL2**에 있다. 링크하는 순간 **프로젝트 전체가 GPL2로 감염 → MIT 배포 불가 (R4 위반).** `AFD`, `VCD`, `LMMSE` 등 GPL demosaic-pack의 모든 알고리즘 동일하게 **금지.**

**허용 (베이스 LibRaw 내장, LGPL-2.1/CDDL-1.0 이중 라이선스 범위):**

| `user_qual` | 알고리즘 | 사용처 |
|------------|---------|--------|
| `0` | Linear (bilinear) | 사용 안 함 |
| `1` | VNG | 사용 안 함 |
| `2` | PPG | 빠른 L2 (배치 Export 등) |
| **`3`** | **AHD** | **✅ 베이어 센서 L2 기본값** |
| `4` | DCB | 사용자 선택 (`품질: 높음`) |
| **`11`** | **DHT** | **✅ 고품질 옵션** (`품질: 최고`) |
| `12` | Modified AHD (Aliasing 억제) | 사용자 선택 |

**후지 X-Trans 특별 처리 ★놓치면 재작업:**
X-Trans는 베이어(2×2)가 아니라 **6×6 패턴**이다. 데모자이킹 경로가 완전히 다르다.
- LibRaw는 X-Trans용으로 `user_qual = 3`(Markesteijn 1-pass) / `4`(Markesteijn 3-pass)를 **자동 매핑**한다.
- **`half_size = 1`은 X-Trans에서 기대대로 동작하지 않는다.** X-Trans의 L1은 `user_qual=0` + `half_size=1` 대신 **`user_qual=3`(Markesteijn 1-pass) + 결과 다운샘플**로 대체한다.
- 센서 타입 판별: `imgdata.idata.xtrans[0][0] != 0` 또는 `filters == 9`.

```rust
fn demosaic_for(idata: &LibrawIdata, quality: Quality) -> i32 {
    let is_xtrans = idata.filters == 9;
    match (is_xtrans, quality) {
        (true,  Quality::Fast)   => 3,   // Markesteijn 1-pass
        (true,  _)               => 4,   // Markesteijn 3-pass
        (false, Quality::Fast)   => 2,   // PPG
        (false, Quality::Normal) => 3,   // AHD  ← 기본
        (false, Quality::High)   => 11,  // DHT
    }
}
```

**기타 센서 예외:**
- **Foveon (Sigma X3F):** CFA 없음. 데모자이킹 미적용. `half_size` 무의미. → **v2.0 지원 범위 밖.** 열면 L0만 표시 + `⚠ 미지원 센서` 배지.
- **모노크롬 바디 (Leica M Monochrom 등):** `filters == 0`. 데모자이킹 스킵, 1채널 → 3채널 복제. WB 비활성화.

### 3.4 GPU 렌더 그래프 — 패스 순서는 물리적으로 의미가 있다

```
[입력 텍스처: RGBA16F, 카메라 네이티브 RGB, linear]
    │
 ①  WhiteBalance + CameraMatrix  (01_wb_matrix.frag)
    │  · WB 게인 → CameraToXYZ_D50 → Bradford → XYZ_D65 → linear Rec.2020
    │  · 여기부터 모든 것이 linear Rec.2020
    ▼
 ②  LensCorrection  (02_lens.frag)  — 기하 왜곡·TCA는 반드시 톤 조작 *전*
    │  · Distortion(역방향 매핑 + bicubic) · TCA(채널별 스케일) · Vignette 보정
    │  ※ 크롭/회전/기하 변환도 이 단계에서 정점 변환으로 통합
    ▼
 ③  Exposure → HighlightRecovery → Shadow/Highlight → Contrast → Black/White
    │  (03_exposure_tone.frag)  — §FR-3 공식
    ▼
 ④  BaseCurve → ToneCurve(RGB → R/G/B 채널별)  (04_tonecurve.frag)
    │  · 1D LUT 텍스처(RGBA16F, 1024×1) 4개 채널
    ▼
 ⑤  HSL / Vibrance / Saturation  (05_hsl.frag)
    │  · HSL은 Rec.2020 → HSV 유사 극좌표. 8개 색상 밴드 가중 보간
    ▼
 ⑥  Detail: NoiseReduction → CaptureSharpening  (06_detail.frag)
    │  ★ 순서 고정: NR이 먼저. 샤프닝 후 NR은 아티팩트를 증폭시킨다
    │  · NR: à trous wavelet shrinkage 3레벨 (luma) + chroma blur
    │  · Sharpen: unsharp mask (radius/amount/detail/masking)
    ▼
 ⑦  Effects: Vignette(창작용) → Grain → Dehaze/Clarity  (07_effects.frag)
    │  ※ 창작용 비네팅은 크롭 *후* 프레임 기준 (렌즈 비네팅 보정과 다름)
    ▼
 ⑧  Output  (08_output.frag)
       · Rec.2020 → Display-P3 (또는 sRGB) 매트릭스
       · gamut 압축 (soft clip, 하드 클리핑 금지)
       · OETF 적용
       · 클리핑 오버레이 (§FR-9.2), Before/After 스플릿 (§FR-17.2) 합성
    ▼
[캔버스]
```

**구현 규칙:**
- 각 패스는 **FBO ping-pong** (`RGBA16F`). 셰이더 8개를 한 덩어리로 합치지 말 것 (uniform 개수 초과 + 디버깅 불가).
- **패스 스킵:** 파라미터가 기본값이면 해당 패스를 건너뛴다. 기본 상태에서는 ①→④→⑧ 3패스만 실행.
- **더티 트래킹:** 패스 N의 uniform이 바뀌면 N 이후만 재실행. 캐시된 중간 FBO를 재사용.
  → 노출 슬라이더를 흔들 때 ①②는 다시 안 돈다.
- WebGL2 확장 필수 체크: `EXT_color_buffer_float` (float FBO 렌더), `OES_texture_float_linear` (float 텍스처 선형 보간). **둘 중 하나라도 없으면 → `RGBA8` + 로그 경고 + UI 배지 `⚠ 저정밀 모드`.**

### 3.5 해상도 전략 — 45MP 셰이더를 매 프레임 돌리지 않는다

#### 3.5.1 편집 해상도 = 화면 해상도
> **이 하나로 60fps 목표는 거저 달성된다.** 화면이 8MP인데 45MP 셰이더를 60번/초 돌릴 이유가 없다.

| 상황 | 셰이더 입력 | 픽셀 수 |
|------|------------|--------|
| Fit 뷰 + 슬라이더 조작 | screen-fit 다운샘플 버퍼 (L1에서 생성) | ≤ 8MP |
| 슬라이더 놓음 (150ms 후) | 동일 (품질 충분) | ≤ 8MP |
| 100% 줌 | 보이는 타일만 L2에서 | ≤ 8MP (뷰포트 크기) |
| Export | L2 풀 해상도, 타일 순회, **1회만** | 45MP |

#### 3.5.2 타일링 — `MAX_TEXTURE_SIZE` 8192 문제 ★놓치면 그냥 안 됨
45MP RAW = 대략 8192×5464. **`MAX_TEXTURE_SIZE`가 8192인 GPU에서는 `texImage2D` 자체가 실패한다.** 100MP(Fuji GFX, Phase One)는 더 심각.

```ts
// gl/webgl2/TileManager.ts
const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);   // M1 = 16384, 일부 GPU = 8192
const TILE = Math.min(2048, maxTex);                    // 2048 고정 (메모리 단편화 최소)

// 이미지를 TILE×TILE 그리드로 분할. 오버랩 = 32px
//   (⑥ Detail 패스의 컨볼루션 커널이 타일 경계를 넘어야 함 → seam 방지)
// 각 타일은 독립 텍스처. 뷰포트에 보이는 타일만 업로드/렌더.
// 보이지 않는 타일은 LRU로 GPU 메모리에서 해제.
```
- **오버랩 32px 필수.** NR/샤프닝 커널이 타일 경계에서 잘리면 격자무늬 seam이 보인다.
- Export 시: 타일 순회 → `readPixels`(f16) → Rust로 스트리밍 → 인코딩.

#### 3.5.3 텍스처 메모리 예산
```
GPU 예산 (M1 8GB unified 기준): 1.5GB 상한
  · 현재 이미지 타일 (보이는 것만): ~400MB
  · 중간 FBO ping-pong × 3:      ~200MB
  · 필름스트립 썸네일 아틀라스:     ~64MB  (4096×4096 아틀라스 × 2)
  · 여유:                        나머지
초과 시: LRU로 비가시 타일 해제 → 그래도 초과 시 L1 fallback + 로그 경고
```

### 3.6 프리로드 정책 — "앞뒤 2장"은 램을 터뜨린다

**v1.1 PRD의 "앞뒤 2장 프리로드" = RAW 270MB × 5 = 1.35GB. M1 8GB에서 스왑 시작.**

```
현재 이미지     : L2 풀 버퍼 1장만 (필요할 때만. Fit 뷰에서는 L1로 충분)
±1             : L1 (11MP f16 ≈ 66MB)
±2 ~ ±3        : L1, 단 메모리 압박 시 L0로 강등
±4 ~ ±10       : L0 썸네일만 (≈ 200KB)
±11 이상       : 디스크 캐시에만 (메모리 없음)

방향 예측       : 오른쪽 이동 중 → 오른쪽 4장 / 왼쪽 1장 비대칭 프리로드
                 (마지막 5회 네비게이션의 방향 다수결)
취소            : 사용자가 지나쳐 간 in-flight job은 즉시 abort
                 (CancelToken.store(true, Ordering::Relaxed))
메모리 상한     : RSS 2.0GB. 초과 시 가장 먼 것부터 L1→L0 강등, 그래도 초과 시 L0 해제
```

### 3.7 디스크 캐시 — 같은 폴더 두 번째 방문은 즉시

**v1.1에는 캐시가 아예 없어서 매번 재디코딩했다.**

```
위치:
  macOS   ~/Library/Caches/app.aetherlens/
  Windows %LOCALAPPDATA%\AetherLens\Cache\
  Linux   $XDG_CACHE_HOME/aetherlens/

키: blake3(absolute_path || mtime_nanos || file_size)   // 내용 해시 아님 — 45MP 해싱은 느림
     · 충돌 무시 가능 수준. 오탐 시 최악 = 잘못된 프록시 → mtime 재확인으로 방어

구조:
  cache/
    l0/{key[0:2]}/{key}.webp      # 썸네일, display-referred, q=85, 최대 512px
    l1/{key[0:2]}/{key}.zst       # ★ f16 linear Rec.2020 planar, zstd level 1
    meta/{key}.json               # EXIF 파싱 결과
    index.sqlite                  # 키 → 크기/atime, LRU 관리

L1을 WebP/JPEG로 저장하지 않는 이유:
  → 편집용 프록시는 16-bit linear scene-referred여야 한다 (R2/R3).
    8-bit display-referred로 저장하면 프록시에서 편집한 결과와 L2 결과가 달라진다.
  → zstd level 1은 f16 노이즈 데이터에서 ~1.3배 압축 + 800MB/s+. I/O가 아니라 CPU가 병목이 안 됨.

기본 상한: 10GB (설정에서 1~100GB). LRU 축출.
무효화: mtime 변경 감지 시 해당 키 폐기.
```

### 3.8 EXIF Orientation ★안 하면 세로 사진이 눕는다

- LibRaw: `imgdata.sizes.flip` (0/3/5/6). **이 값은 LibRaw 출력에 자동 적용되지 않는다.**
- 일반 이미지: EXIF `Orientation` 태그 (1~8).
- **적용 지점:** §3.4 패스 ②의 정점 변환 매트릭스에 통합 (픽셀 재배열 금지 — 무료로 처리 가능).
- 사용자 회전(§FR-6)은 이 위에 **누적**된다: `final_rotation = exif_orientation ∘ user_rotation`.
- Export 시: 픽셀을 실제로 회전시켜 굽고, 출력 EXIF `Orientation = 1`로 기록.

---

## 4. 기능 요구사항 (Functional Requirements)

> 우선순위: **P0** = v2.0 출시 차단 / **P1** = v2.0 포함 / **P2** = Phase 3~4

---

### FR-1 · 디렉토리 스캔 & 네비게이션 `P0`

#### FR-1.1 진입점
1. 앱 내 `파일 열기` (`⌘O`) — 파일/폴더 선택
2. 드래그 앤 드롭 (파일 또는 폴더)
3. Finder `다음으로 열기` → §FR-19
4. Dock 최근 항목 → §FR-18
5. CLI 인자: `aetherlens /path/to/img.CR2`

#### FR-1.2 스캔은 스트리밍이다
> **v1.1의 "비동기 즉시 스캔 후 배열 관리"는 10,000장 폴더에서 수 초간 멈춘다.**

```rust
#[tauri::command]
async fn scan_directory(path: PathBuf, on_batch: Channel<ScanBatch>) -> Result<ScanSummary> {
    // 1. 먼저 요청된 파일 하나를 즉시 emit → 화면에 그림이 뜬다 (< 60ms)
    // 2. std::fs::read_dir 순회 (walkdir 아님 — 하위 폴더 재귀 안 함)
    // 3. 100개마다 Channel로 배치 전송 → 필름스트립이 점진적으로 채워짐
    // 4. 정렬은 프론트에서 (전체 수신 후) 또는 백엔드에서 스트리밍 후 재정렬
    // 5. 5,000개 초과 시 UI에 "N개 스캔 중..." 표시
}
```
- **하위 폴더 재귀 없음.** (선택 옵션 `설정 > 하위 폴더 포함`, 기본 off)
- 심볼릭 링크: 따라가되 순환 감지 (방문한 inode 집합)
- 숨김 파일(`.`) 제외
- `.DS_Store`, `Thumbs.db`, `@eaDir` 제외

#### FR-1.3 지원 확장자 (대소문자 무시)

| 분류 | 확장자 |
|------|--------|
| **RAW — Tier 1 (필수 테스트)** | `.cr2` `.cr3` (Canon) · `.arw` `.sr2` `.srf` (Sony) · `.nef` `.nrw` (Nikon) · `.raf` (Fuji) · `.dng` (Adobe/Leica/Pentax/스마트폰) |
| **RAW — Tier 2 (LibRaw 위임)** | `.orf` (Olympus/OM) · `.rw2` (Panasonic) · `.pef` (Pentax) · `.raw` `.rwl` (Leica) · `.3fr` `.fff` (Hasselblad) · `.iiq` (Phase One) · `.erf` (Epson) · `.mrw` (Minolta) · `.dcr` `.kdc` (Kodak) · `.mos` (Leaf) · `.gpr` (GoPro) |
| **RAW — 미지원 명시** | `.x3f` (Sigma Foveon) → L0만 + `⚠ 미지원 센서` |
| **일반** | `.jpg` `.jpeg` `.png` `.webp` `.tif` `.tiff` `.bmp` `.gif`(첫 프레임) `.avif` |
| **HEIC/HEIF** | `.heic` `.heif` → macOS: 플랫폼 디코더(`platform::decode_heic`). Windows/Linux: `libheif` 없으면 미지원 배지 |

#### FR-1.4 정렬
`설정 > 정렬` — 기본 **파일명 자연 정렬(natural sort)**.
> `IMG_2.CR2` < `IMG_10.CR2` 이어야 한다. 사전순은 오답.

기타: 촬영일시(EXIF) / 수정일 / 파일 크기 / 별점 · 각각 오름/내림.

#### FR-1.5 네비게이션
| 키 | 동작 |
|----|------|
| `←` `→` | 이전 / 다음 |
| `Home` `End` | 처음 / 마지막 |
| `PageUp` `PageDown` | ±10 |
| `⌘←` `⌘→` | 이전/다음 **플래그된** 이미지 |

- **키 리핏 처리:** 연타 시 §2.4 backpressure 발동. 렌더는 rAF에 코얼레싱 (키 이벤트마다 렌더 금지).
- 순환(wrap-around) **없음.** 끝에서 `→` 누르면 짧은 바운스 애니메이션.

#### FR-1.6 RAW + JPEG 페어링 `P1`
`IMG_001.CR2` + `IMG_001.JPG`가 같은 폴더에 있을 때:

| 모드 | 동작 |
|------|------|
| **`stack` (기본)** | 1개 항목으로 묶음. RAW를 primary로 표시. 배지 `RAW+JPEG`. `⌥J`로 토글 |
| `separate` | 2개 항목으로 표시 |

- 페어링 규칙: **stem(확장자 제외 파일명)이 완전 일치** + 같은 디렉토리.
- 삭제/별점/라벨은 **스택 전체에 적용** (stack 모드).
- Sony `.ARW` + `.JPG`, Fuji `.RAF` + `.JPG` 동일.

#### FR-1.7 실시간 파일 감시 `P1`
- `notify` 크레이트, 200ms 디바운스.
- 파일 추가 → 플레이리스트에 삽입 (정렬 순서 유지), 필름스트립에 애니메이션 삽입.
- 파일 삭제(외부) → 리스트에서 제거. 현재 보던 파일이면 다음으로 이동.
- 파일 수정(mtime) → 캐시 무효화 + 재디코딩.
- **테더링 촬영 시나리오 지원**: 폴더에 새 RAW가 떨어지면 자동으로 그 사진으로 점프 (`설정 > 새 파일 자동 선택`, 기본 off).

---

### FR-2 · RAW 디코딩 `P0`
§3.1 ~ §3.3에 전적으로 정의됨. 추가 UI 요구사항만:

- L0/L1/L2 전환 시 **크로스페이드 없음** (즉시 교체). 페이드는 지연처럼 느껴진다.
- 우측 하단에 현재 레벨 인디케이터: `L0 · 프리뷰` / `L1 · 편집 품질` / `L2 · 100%`
  → 설정에서 숨김 가능. 기본 표시.
- L2 디코딩 중에는 인디케이터에 스피너. **전체 화면 스피너 금지** (이미 L0/L1이 보이고 있다).
- 디코딩 실패 → §7.3

---

### FR-3 · 기본 보정 파라미터 `P0`

모든 값은 §3.4 렌더 그래프의 정해진 패스에서 처리. **모든 공식은 linear Rec.2020 공간 기준 (R2).**

| 파라미터 | 범위 | 기본 | 패스 | 공식 / 정의 |
|---------|------|------|------|-------------|
| `whiteBalanceTemp` | 2000–50000 K | AsShot | ① | Planckian locus 보간 → 카메라 채널 게인. AsShot의 K 값은 카메라 매트릭스 역산으로 추정 |
| `whiteBalanceTint` | −150 – +150 | AsShot | ① | green-magenta 축. `g_gain *= 2^(-tint/150 * 0.5)` |
| `exposure` | −5.0 – +5.0 EV | 0 | ③ | `rgb *= exp2(exposure)` — **선형 공간이므로 단순 곱셈** |
| `highlightRecovery` | 0 – 100 | 0 | ③ | 클리핑된 채널을 미클리핑 채널에서 복원. LibRaw `highlight=2` 병용 |
| `highlights` | −100 – +100 | 0 | ③ | 휘도 > 0.6 영역에 부드러운 마스크(smoothstep) 후 게인 |
| `shadows` | −100 – +100 | 0 | ③ | 휘도 < 0.35 영역 마스크 후 게인 |
| `whites` | −100 – +100 | 0 | ③ | 화이트 포인트 이동 |
| `blacks` | −100 – +100 | 0 | ③ | 블랙 포인트 이동 (음수 클램프) |
| `contrast` | −100 – +100 | 0 | ③ | 미드그레이(0.18 linear) 피벗 S-curve. `y = pivot * (x/pivot)^k`, `k = exp2(contrast/100)` |
| `clarity` | −100 – +100 | 0 | ⑦ | 로컬 대비. 반경 큰(σ≈40px) 언샵 마스크, 휘도 채널만 |
| `dehaze` | −100 – +100 | 0 | ⑦ | dark channel prior 근사 + 대비/채도 커플링 |
| `vibrance` | −100 – +100 | 0 | ⑤ | 저채도 픽셀 우선 채도 증가. 스킨톤(hue 20~50°) 보호 |
| `saturation` | −100 – +100 | 0 | ⑤ | 휘도(Rec.2020 계수 0.2627/0.6780/0.0593) 보존 채도 스케일 |

**Bypass Mode (일반 이미지):**
- `.jpg`/`.png` 등도 **완전히 동일한 파이프라인**을 탄다.
- 차이: ① 패스에서 카메라 매트릭스 대신 **파일의 ICC 프로파일**(또는 sRGB 가정) → linear Rec.2020 변환.
- **입력 EOTF 역변환 필수:** sRGB JPEG은 감마 인코딩되어 있다 → `srgb_to_linear()` 후 파이프라인 진입 (R2).
- `whiteBalanceTemp`는 비활성(회색 처리) + 툴팁 `RAW가 아닌 이미지는 색온도를 재계산할 수 없습니다`. 대신 `tempShift` (−100~+100 상대 조정) 제공.
- `highlightRecovery` 비활성 (이미 클리핑된 데이터는 복구할 정보가 없음).

---

### FR-4 · 톤 커브 `P1`

- **커브 4종**: `RGB(합성)`, `Red`, `Green`, `Blue` — 탭 전환.
- 제어점: 최소 2 (0,0)/(1,1), 최대 16. 클릭 추가, 드래그 이동, 더블클릭/우클릭 삭제.
- 보간: **monotone cubic (Fritsch–Carlson)** — Catmull-Rom은 오버슈트로 링잉 발생 → 금지.
- 셰이더 전달: 각 커브를 1024 샘플 1D LUT → `RGBA16F` 텍스처 1개(1024×1, RGBA = R/G/B/RGB 채널) 로 팩.
- 커브 입력 공간: **BaseCurve 적용 후 display-referred 근사 공간** (사용자 직관 = 라이트룸과 동일). 셰이더에서 임시 OETF 적용 → 커브 → 역 EOTF.
- Parametric 커브 (Highlights/Lights/Darks/Shadows 4슬라이더): `P2`
- 배경에 실시간 히스토그램 오버레이 표시.
- 리셋: 커브 위 더블클릭.

---

### FR-5 · HSL / 컬러 믹서 `P1`

8개 밴드 × 3파라미터 = 24 슬라이더:

| 밴드 | 중심 Hue (deg, Rec.2020 기준) |
|------|------|
| Red / Orange / Yellow / Green / Aqua / Blue / Purple / Magenta | 0 / 30 / 60 / 120 / 180 / 240 / 280 / 320 |

- 각 밴드: `Hue` (−100~+100 → ±30° 이동) / `Saturation` (−100~+100) / `Luminance` (−100~+100)
- 밴드 간 **가중 보간**: 각 픽셀의 hue에 대해 인접 밴드 raised-cosine 가중치 (경계 밴딩 방지).
- **타겟 조정 도구(TAT)** `P2`: 이미지 위 드래그 → 해당 hue의 밴드 자동 선택 후 조정.
- `흑백 변환` 토글: 활성 시 HSL이 **B&W 믹서**로 전환 (8밴드 × Luminance만) + Saturation 강제 −100.

---

### FR-6 · 크롭 · 회전 · 기하 `P1`
> **v1.1에는 통째로 빠져 있었다. 뷰어에 크롭이 없으면 보정 프로그램이 아니다.**

- **크롭 (`C`)**: 8핸들 드래그. 오버레이 = 3분할 그리드(기본) / 황금비 / 대각선 / 없음 (`O`로 순환).
- **종횡비 (`⇧A`로 순환)**: Original / Free / 1:1 / 4:3 / 3:2 / 16:9 / 5:4 + 커스텀. `X`로 세로/가로 전환.
- **회전**: `⌘[` `⌘]` 90° 단위. **손실 없음** (§3.8의 정점 변환에 누적).
- **수평 보정(Straighten)**: −45° ~ +45° 슬라이더 + **이미지 위에 선 그리기** → 그 선이 수평/수직이 되도록 자동 회전 + 자동 크롭.
- **Auto Straighten** `P2`: Hough 변환으로 지배적 수평선 추정.
- **기하 변환(Transform)** `P1`: `Vertical` / `Horizontal` (원근 보정) / `Rotate` / `Aspect` / `Scale` / `Offset X/Y` — 각 −100~+100. 4×4 호모그래피로 정점 변환.
- **플립**: 좌우 / 상하.
- **모든 기하 정보는 EditState에 저장.** 픽셀은 Export 때만 실제로 잘린다 (R5, 비파괴).
- 크롭 활성 중에는 잘려나갈 영역을 60% 어둡게 표시하되 **완전히 숨기지 않는다** (다시 늘릴 수 있어야 하므로).

---

### FR-7 · 디테일 — 샤프닝 & 노이즈 리덕션 `P1`
> **RAW는 물리적으로 항상 소프트하다.** 데모자이킹은 보간이고, 대부분 센서에 AA 필터가 있다. 캡처 샤프닝이 없으면 **"카메라 JPEG보다 흐린데요?"**가 첫 리뷰가 된다.

#### FR-7.1 캡처 샤프닝 (패스 ⑥, NR 이후)
| 파라미터 | 범위 | 기본 | 설명 |
|---------|------|------|------|
| `sharpenAmount` | 0 – 150 | **25** (RAW) / 0 (일반) | 언샵 마스크 강도 |
| `sharpenRadius` | 0.5 – 3.0 px | **1.0** | 가우시안 σ |
| `sharpenDetail` | 0 – 100 | **25** | 고주파 가중. 높을수록 미세 디테일, 낮을수록 엣지 위주 |
| `sharpenMasking` | 0 – 100 | 0 | 엣지 마스크. 그래디언트 크기 기반 — 평탄 영역(하늘) 샤프닝 제외 |

- 휘도 채널에만 적용 (컬러 프린징 방지).
- `⌥` + 슬라이더 드래그 → 마스크/디테일 **시각화 모드** (흑백 마스크 표시).
- **L1(half-size) 프록시에서 샤프닝 프리뷰는 부정확하다.** 100% 줌이 아닐 때 샤프닝 슬라이더 옆에 `ⓘ 100% 줌에서 확인하세요` 힌트 표시.

#### FR-7.2 노이즈 리덕션 (패스 ⑥, 샤프닝 이전)
| 파라미터 | 범위 | 기본 | 설명 |
|---------|------|------|------|
| `nrLuminance` | 0 – 100 | **ISO 기반 자동** | à trous wavelet shrinkage 3레벨, soft threshold |
| `nrLumaDetail` | 0 – 100 | 50 | 임계값 곡선 — 디테일 보존 정도 |
| `nrLumaContrast` | 0 – 100 | 0 | 로컬 대비 보존 |
| `nrColor` | 0 – 100 | **25** | chroma 채널 bilateral blur (Lab a/b) |
| `nrColorDetail` | 0 – 100 | 50 | 컬러 엣지 보존 |

**ISO 기반 기본값 자동 설정** (사용자가 손대기 전까지):
```
ISO ≤ 400        → nrLuminance = 0
ISO 400–1600     → 선형 보간 0 → 15
ISO 1600–6400    → 선형 보간 15 → 35
ISO > 6400       → 35 + log2(ISO/6400) * 8, 최대 60
```
- **Hot pixel / dead pixel 제거**: LibRaw `params.med_passes` 대신, 인접 픽셀 대비 이상치 감지 후 median 대체 (기본 on, RAW만).

---

### FR-8 · 렌즈 보정 (Lensfun) `P1`

> **라이선스 주의:** lensfun **C 라이브러리는 LGPL-3** → 링크 금지 (R4 정신). **XML 데이터베이스는 CC-BY-SA-3.0** → 데이터만 읽고, 보정 수식은 우리가 직접 구현한다. 크레딧 화면에 CC-BY-SA 저작자 표시 필수 (§10.4).

- DB: `src-tauri/resources/lensfun/*.xml` 번들 + `설정 > 렌즈 DB 업데이트`로 갱신 가능.
- **매칭**: EXIF `Make` + `Model` + `LensModel` + `FocalLength` + `FNumber` + `FocusDistance`
  → 카메라 crop factor 정규화 → 렌즈 항목 조회 → 초점거리/조리개 보간.
- 매칭 실패 시: 수동 렌즈 선택 드롭다운 + `기억하기` (렌즈 ID → DB 항목 매핑을 카탈로그에 저장).

| 보정 | 모델 | 셰이더 |
|------|------|--------|
| **왜곡(Distortion)** | `poly3` / `poly5` / `ptlens` (Lensfun XML의 `<distortion model=...>`) | 역방향 매핑 + **bicubic** 샘플링 (bilinear은 디테일 뭉갬) |
| **TCA (색수차)** | `linear` / `poly3` — R/B 채널 스케일 | 채널별 UV 스케일 |
| **비네팅(Vignetting)** | `pa` (6th-order poly) — `k1,k2,k3` | 반경 기반 게인. **선형 공간에서 곱셈** (R2) |
| **원근 왜곡 보정** | — | §FR-6 Transform 사용 |

- 각 항목 개별 토글 + 강도 슬라이더 (0~200%, 기본 100%).
- **기본 동작:** `설정 > 렌즈 보정 자동 적용` — 기본 **on** (프로파일 매칭 성공 시).
- DNG 내장 `OpcodeList1/2/3` (WarpRectilinear/FixVignetteRadial)이 있으면 **Lensfun보다 우선.** (스마트폰 DNG는 이걸 반드시 적용해야 정상적으로 보인다.)

---

### FR-9 · 히스토그램 · 클리핑 · 스포이드 `P0`
> **v1.1에서 다이어그램에만 등장하고 스펙이 없었다. 히스토그램 없이 노출 보정은 눈 감고 운전하는 것.**

#### FR-9.1 히스토그램
- 위치: 우측 패널 최상단. 높이 100px 고정.
- 모드 (클릭 순환): `RGB 오버레이(기본)` → `Luminance` → `R/G/B 분리 3단`
- **계산 위치: GPU.** 패스 ⑧ 직전 결과를 `RGBA16F` → transform feedback (WebGL2) 또는 compute shader (WebGPU)로 256bin 히스토그램 생성.
  - **WebGL2 폴백:** 화면 해상도 버퍼를 1/8 다운샘플 후 `readPixels` → **Web Worker에서 CPU 집계.** rAF마다 하지 말고 **150ms 스로틀.**
- 좌/우 상단 모서리에 **클리핑 인디케이터 삼각형** (클릭 시 오버레이 토글).
- 히스토그램 위 마우스오버 → 해당 톤 영역이 이미지에 하이라이트 (`P2`).
- 하단에 현재 파라미터 요약: `f/2.8 · 1/250s · ISO 400 · 85mm`

#### FR-9.2 클리핑 경고 (Blinkies)
| 키 | 동작 |
|----|------|
| `J` | 클리핑 오버레이 토글 (양쪽) |
| `⇧J` | 하이라이트만 |
| `⌥J` | 쉐도우만 |

- 하이라이트 클리핑 (모든 채널 ≥ 1.0) → **빨강** 오버레이
- 쉐도우 클리핑 (모든 채널 ≤ 0.0) → **파랑** 오버레이
- **채널별 클리핑** (일부 채널만) → 해당 채널 보색으로 표시 (선택 옵션)
- 패스 ⑧에서 합성. gamut 압축 **이전** 값 기준으로 판정.

#### FR-9.3 스포이드 & 색상 판독
- **WB 스포이드 (`W`)**: 커서가 스포이드로 변경 → 클릭 시 해당 픽셀을 중성 회색으로 만드는 temp/tint 계산 후 적용. 5×5 평균 샘플.
- **상시 색상 판독:** 뷰포트 마우스오버 시 히스토그램 아래에 표시
  ```
  R 62.3%  G 58.1%  B 54.9%      (기본: 백분율)
  #A08C7E   ·   L* 61.2  a* 3.4  b* 7.8
  ```
  - 클릭으로 단위 전환: 백분율 / 0-255 / 0-65535 / Lab
- **최대 5개 색상 샘플러 핀** 고정 가능 (`⇧클릭`) `P2`

---

### FR-10 · 비파괴 편집 영속성 `P0`
> **v1.1에서 통째로 빠져 있었다.** "방향키로 다음 사진 갔다가 돌아오면 보정값이 남아 있는가?"에 대한 답이 없었다.

**결정: 사이드카 XMP + SQLite 카탈로그 이중화 (Lightroom 방식).**

```
IMG_1234.CR2        ← ★ 절대 수정 금지 (R5)
IMG_1234.xmp        ← 사이드카. 편집값 + 별점 + 라벨 + 키워드. 사람이 읽을 수 있음
~/Library/Application Support/app.aetherlens/catalog.sqlite
                    ← 미러. 빠른 조회/필터/정렬용. 진실의 원천은 아님
```

| 상황 | 동작 |
|------|------|
| 편집 발생 | 즉시 in-memory → **2초 디바운스** 후 catalog 쓰기 → **10초 디바운스 또는 이미지 전환 시** .xmp 쓰기 |
| 이미지 열기 | catalog 조회 → 없으면 .xmp 파싱 → 없으면 기본값 |
| **.xmp가 catalog보다 최신(mtime)** | **.xmp 우선.** (외부 앱이 수정했을 수 있음) → catalog 갱신 + UI 토스트 `외부 변경 사항을 불러왔습니다` |
| DNG 파일 | **DNG는 사이드카를 쓰지 않는 것이 표준.** 하지만 R5(원본 불가침)를 우선 → **DNG도 사이드카 사용.** `설정 > DNG에 XMP 임베드` (기본 off, 켜면 원본 DNG에 쓰기 — 경고 다이얼로그) |
| 앱 종료 | 모든 디바운스 즉시 flush. `on_window_event(CloseRequested)`에서 동기 대기 |
| 크래시 | catalog(WAL)가 최대 2초 손실. .xmp는 최대 10초. **다음 실행 시 catalog → .xmp 재동기화** |
| 파일 이동/이름변경 (외부) | `.xmp`가 같이 안 움직이면 편집값 유실 (사용자 책임). catalog는 blake3(path+mtime+size)로 **재발견 시도** → 성공 시 경로 갱신 |

- `설정 > 사이드카 자동 쓰기` 끌 수 있음 (catalog만 사용). 기본 **on**.
- **읽기 전용 볼륨/권한 없음**: .xmp 쓰기 실패 → 조용히 catalog만 사용 + 상태바에 `🔒 사이드카 저장 불가` 배지.

---

### FR-11 · Undo / Redo `P0`
> **v1.1에 없었다. 보정 앱에 Undo가 없으면 사용 불가.**

**구현: Immer patch 기반 커맨드 스택.**

```ts
// store/historyStore.ts
interface HistoryEntry {
  label: string;              // "노출 +0.40" — UI에 표시
  patches: Patch[];           // immer produce의 forward patches
  inversePatches: Patch[];    // immer의 inverse patches
  timestamp: number;
  coalesceKey?: string;       // 예: "exposure" — 같은 키 연속 시 병합
}
```

| 규칙 | 값 |
|------|-----|
| 스택 깊이 | **이미지당 100단계** (LRU로 오래된 이미지 히스토리 폐기) |
| 슬라이더 드래그 | **코얼레싱.** `pointerdown`~`pointerup`을 1개 엔트리로. 드래그 중에는 스택에 안 쌓음 |
| 연속 조정 | 같은 `coalesceKey` + 500ms 이내 → 병합 |
| 이미지 전환 | 히스토리 **유지** (돌아오면 Undo 가능). 메모리는 patch만이라 가볍다 |
| 세션 간 | **비영속.** 앱 재시작 시 히스토리 리셋 (편집값 자체는 §FR-10으로 보존) |
| 스코프 | 편집값만. 별점/라벨/삭제는 별도 스택 |

| 키 | 동작 |
|----|------|
| `⌘Z` | Undo |
| `⌘⇧Z` | Redo |
| `⌘⌥Z` | 히스토리 패널 열기 (엔트리 목록, 클릭 시 그 시점으로 점프) `P2` |

- **파일 삭제(휴지통)는 Undo 대상.** `⌘Z` → 휴지통에서 복원 (`trash` 크레이트의 restore API. **Linux는 미지원 → 토스트로 안내**).

---

### FR-12 · 프리셋 시스템 — XMP `P1`

> **⚠️ v1.1 PRD의 사실 오류 정정:**
> **"XMP로 저장하면 Lightroom과 Capture One에서 호환된다"는 사실이 아니다.**
> - **Capture One은 Adobe `crs:` 보정값을 읽지 않는다.** 별점/키워드/컬러라벨만 읽는다. 스타일은 자체 `.costyle` 포맷. → **"Capture One 호환" 주장은 삭제.**
> - **Lightroom은 `crs:`를 읽긴 한다.** 하지만 `crs:Exposure2012 = +0.40`의 *의미*는 Adobe Process Version 파이프라인이 정의하며 **그 공식은 비공개**다. → **파일은 열리지만 결과 그림은 다르다.**

**결정: 이중 네임스페이스 XMP.**

```xml
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:aether="http://ns.aetherlens.app/1.0/"

    <!-- ① Adobe 상호운용 (best-effort 근사) -->
    crs:Version="15.0" crs:ProcessVersion="11.0"
    crs:Temperature="6500" crs:Tint="+8"
    crs:Exposure2012="+0.40" crs:Contrast2012="+15"
    crs:Highlights2012="-30" crs:Shadows2012="+25"
    crs:Whites2012="0" crs:Blacks2012="-5"
    crs:Texture="0" crs:Clarity2012="+10" crs:Dehaze="0"
    crs:Vibrance="+12" crs:Saturation="0"
    crs:Sharpness="25" crs:SharpenRadius="1.0"
    crs:LuminanceSmoothing="15" crs:ColorNoiseReduction="25"
    crs:HueAdjustmentRed="0" crs:SaturationAdjustmentRed="0" ...
    crs:CropTop="0.05" crs:CropLeft="0.0" ... crs:CropAngle="1.2"
    crs:HasSettings="True"

    <!-- ② 표준 (진짜로 호환됨) -->
    xmp:Rating="4" xmp:Label="Green"

    <!-- ③ AetherLens 정본 — round-trip 100% 보장 -->
    aether:version="2"
    aether:engine="rec2020-linear"
    aether:state="{base64(zstd(json(EditState)))}">
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
```

**읽기 우선순위:** `aether:state` 존재 → 그것만 사용 (완전 복원). 없으면 `crs:` 파싱 → 근사 임포트 + 토스트 `Lightroom 설정을 가져왔습니다 (근사값)`.

| UI 문구 (정직하게) | |
|---|---|
| 프리셋 저장 다이얼로그 | ☑ Lightroom 호환 필드 포함 *(다른 앱에서 열 수 있으나 결과는 근사치입니다)* |
| 프리셋 목록 아이콘 | `⬢` = AetherLens 정본 / `◈` = LR 임포트(근사) |

**프리셋 기능:**
- 저장: 현재 EditState 중 **체크박스로 선택한 항목만** (예: WB만, 톤만, 디테일 제외).
- 폴더 구조 지원 (`Portrait/`, `Landscape/`, `B&W/`).
- 목록 hover → **필름스트립 썸네일에 실시간 프리뷰** (라이트룸 방식). 200ms 지연 후 발동.
- 파일 위치: `~/Library/Application Support/app.aetherlens/presets/**/*.xmp`
- **Import/Export**: `.xmp` 드래그 앤 드롭. Lightroom `.lrtemplate`(구형 Lua) 임포트는 `P2`.
- **기본 번들 프리셋 10종** 제공: `Neutral`, `Punchy`, `Portrait Soft`, `Landscape Vivid`, `B&W Classic`, `B&W High Contrast`, `Warm Film`, `Cool Cinematic`, `Faded Matte`, `HDR Natural`.
- 단축키: `1`~`5`는 별점이므로, 프리셋은 `⌥1`~`⌥9` (즐겨찾기 슬롯).

---

### FR-13 · 설정 복사/붙여넣기 & 동기화 `P1`
| 키 | 동작 |
|----|------|
| `⌘⇧C` | 현재 이미지의 편집 설정 복사 (체크박스 다이얼로그) |
| `⌘⇧V` | 선택된 이미지들에 붙여넣기 |
| `⌘⌥V` | 이전 이미지 설정 붙여넣기 (다이얼로그 없이) |
| `⌘R` | 편집 초기화 (전체) |
| `⌘⌥R` | 현재 섹션만 초기화 |

- 필름스트립 다중 선택(`⇧클릭`, `⌘클릭`) → `동기화` 버튼 → 선택 항목 일괄 적용.
- **Auto Sync 토글**: 켜면 다중 선택 상태에서 슬라이더 조작 시 전체에 실시간 적용.

---

### FR-14 · Export `P0`

#### FR-14.1 래스터 Export
| 포맷 | 비트 | 옵션 |
|------|------|------|
| **JPEG** | 8 | 품질 0–100 (기본 90), 4:4:4 / 4:2:0 (기본 4:4:4 at q≥90) |
| **PNG** | 8 / 16 | 압축 레벨 |
| **WebP** | 8 | 품질 0–100, 무손실 토글 |
| **TIFF** | 8 / **16** | 무압축 / LZW / ZIP |
| **AVIF** | 8 / 10 / 12 | 품질, speed (기본 6) |
| JPEG XL | — | `P2` |

**공통 옵션:**
- **색 공간:** sRGB (기본) / Display-P3 / Rec.2020 / ProPhoto RGB / Adobe RGB → **ICC 프로파일 임베딩 (lcms2)**. 태깅 안 된 파일 내보내면 안 됨.
- **리사이즈:** 원본 / 긴 변 / 짧은 변 / 폭 / 높이 / 메가픽셀 / 백분율. 리샘플: **Lanczos3**.
- **출력 샤프닝** (리사이즈 후 별도): 없음 / 화면용 / 인쇄(광택) / 인쇄(무광) × 낮음/표준/높음
- **메타데이터:** 전체 / 저작권만 / GPS 제거 ★ / 전체 제거
  → **`GPS 제거`는 SNS 공유 시 필수. 기본값 = `전체 (GPS 포함)`이되, 첫 Export 시 1회 안내 다이얼로그.**
- **워터마크** `P1`: 텍스트 (폰트/크기/불투명도/9방향 위치/여백) 또는 PNG 이미지 오버레이.
- **파일명 템플릿:** `{name}` `{name_lower}` `{seq:3}` `{date:YYYY-MM-DD}` `{time:HHmmss}` `{camera}` `{lens}` `{iso}` `{fnumber}` `{shutter}` `{focal}` `{width}` `{height}` `{preset}`
  - 예: `{date:YYYYMMDD}_{name}_{seq:4}` → `20260715_IMG_1234_0001.jpg`
- **충돌 처리:** 덮어쓰기 / 건너뛰기 / 번호 추가(기본)
- **출력 위치:** 원본과 같은 폴더 / 원본 하위 `Exported/` / 지정 폴더 / 최근 사용

#### FR-14.2 DNG Export ★
> RAW-to-RAW: 소니/캐논 독자 규격으로 **재패킹은 불가능**(특허·비공개). DNG가 유일한 정답.

| 모드 | 내용 | 용도 |
|------|------|------|
| **`mosaic` (기본)** | **원본 CFA 데이터 그대로 보존** + 컬러 매트릭스 + XMP 보정값 임베드. 픽셀은 굽지 않음 | 진짜 아카이브. 라이트룸에서 열면 우리 보정값이 (근사로) 적용된 채 열림. 되돌리기 가능 |
| `linear` | 데모자이킹 + 렌즈보정 + 기하 적용된 **16-bit linear ProPhoto** 픽셀을 굽고, 톤 편집값은 XMP로 | 최대 호환. 편집 일부 되돌리기 가능 |
| `linear-baked` | 모든 편집 적용된 16-bit linear | 다른 앱에 최종본 넘길 때 |

**구현:**
```
mosaic 모드:
  1. dnglab sidecar 실행 (§10.2):  dnglab convert --embed-original=<opt> IN.CR2 OUT.dng
  2. 실패 시 → 폴백 UX (아래)
  3. Rust에서 OUT.dng의 TIFF IFD0에 XMP 패킷(tag 700) 주입
     · TIFF 구조 파싱 → tag 700 존재 시 교체, 없으면 IFD 확장 후 append
     · 기존 태그 오프셋 보정 필수
  4. blake3 검증 후 완료

linear / linear-baked:
  자체 DNG writer (Rust). DNG 1.4 스펙 필수 태그:
  DNGVersion(50706)=1.4.0.0, DNGBackwardVersion=1.1.0.0, PhotometricInterpretation=34892(LinearRaw),
  ColorMatrix1/2, AsShotNeutral, CalibrationIlluminant1/2, UniqueCameraModel,
  BlackLevel, WhiteLevel, BitsPerSample=16, SampleFormat=1, Compression=1(none) 또는 7(lossless JPEG),
  Orientation=1, XMP(700), 임베디드 프리뷰 JPEG(SubIFD)
```

**폴백 UX (필수):** `rawler`가 미지원하는 기종은 반드시 존재한다.
```
┌────────────────────────────────────────────────┐
│ ⚠ DNG 변환 불가                                 │
│                                                │
│ Canon EOS R1 (.CR3) 은 현재 DNG 모자이크        │
│ 변환을 지원하지 않습니다.                        │
│                                                │
│ 대신 사용 가능:                                 │
│  ○ Linear DNG로 내보내기 (권장)                 │
│  ○ 16-bit TIFF로 내보내기                       │
│  ○ 취소                                        │
│                                    [계속]      │
└────────────────────────────────────────────────┘
```
**미지원 기종 목록은 하드코딩하지 말 것.** 실제 변환을 시도하고 sidecar의 exit code / stderr로 판정한다.

**옵션:**
- ☑ 원본 RAW 임베드 (`--embed-original`) — 파일 크기 ~2배, 완전 복원 가능
- ☑ 무손실 JPEG 압축 (기본 on) — 파일 크기 ~50%, 무손실
- 임베디드 프리뷰 크기: 없음 / Medium / Full

#### FR-14.3 배치 Export `P1`
- 다중 선택 → `⌘⇧E`
- **진행 UI:** 진행률 바 + `12 / 340 · 남은 시간 2분 14초` + 개별 항목 상태 + **취소 버튼**
- 실패 항목은 건너뛰고 계속. 완료 후 실패 목록 요약 + `재시도` 버튼.
- **Export Preset**: 설정 조합 저장 (`웹용 2048px sRGB q85 GPS제거`, `인쇄용 TIFF16 AdobeRGB`).
- Export 중에도 뷰어는 반응해야 함 (§2.4 별도 스레드 풀).
- 완료 시 시스템 알림 (`tauri-plugin-notification`) + `Finder에서 보기` 액션.

---

### FR-15 · 컨텍스트 메뉴 & 클립보드 `P0`

> **⚠️ v1.1 오류 정정:** `CF_DIB`는 **Windows 클립보드 포맷**이다. macOS는 `NSPasteboard` + `NSPasteboardTypePNG`/`public.tiff`. §9.1의 platform trait 뒤로 격리.

메뉴 구조 (뷰포트 우클릭):
```
┌─────────────────────────────────────────┐
│ 이미지 복사                      ⌘C     │  ← 픽셀 데이터 (Slack/카톡 붙여넣기용)
│ 파일 복사                       ⌘⌥C     │  ← 파일 참조 (Finder 붙여넣기용) ★둘은 다르다
│ 경로 복사                      ⌘⇧⌥C     │
├─────────────────────────────────────────┤
│ 다음에서 열기                        ▸  │  → Photoshop / Preview / 사용자 등록 앱 / 기타...
│ Finder에서 보기                  ⌘⇧R    │
├─────────────────────────────────────────┤
│ 편집 설정 복사                   ⌘⇧C     │
│ 편집 설정 붙여넣기               ⌘⇧V     │
│ 편집 초기화                      ⌘R      │
│ 프리셋 적용                          ▸  │  → 프리셋 트리
├─────────────────────────────────────────┤
│ 별점                                 ▸  │  → ★☆☆☆☆ ... 없음
│ 컬러 라벨                            ▸  │  → 🔴🟡🟢🔵🟣 없음
│ ⚑ 플래그 지정                     P     │
│ ⚐ 제외 표시                       X     │
├─────────────────────────────────────────┤
│ 내보내기...                      ⌘E     │
│ DNG로 내보내기...               ⌘⇧D     │
├─────────────────────────────────────────┤
│ 이름 변경...                     F2     │
│ 휴지통으로 이동                   ⌫      │
└─────────────────────────────────────────┘
```

**FR-15.1 스마트 복사 — "이미지 복사" ★**
```
현재 파일이 일반 이미지 & 편집값 없음  → 원본 바이너리를 클립보드에 (재인코딩 없음, 무손실)
현재 파일이 일반 이미지 & 편집값 있음  → 편집 적용된 픽셀을 PNG로 렌더 → 클립보드
현재 파일이 RAW                        → 편집 적용된 픽셀을 PNG로 렌더 → 클립보드
```
- 렌더 해상도: **긴 변 4096px 상한** (기본, 설정 가능). 45MP PNG를 클립보드에 넣으면 시스템이 버벅인다.
- 색공간: **sRGB로 변환 + sRGB ICC 임베드.** (클립보드 소비자는 대부분 sRGB를 가정)
- macOS: `NSPasteboardTypePNG` + `NSPasteboardTypeTIFF` **둘 다 write** (앱마다 선호가 다름).
- 비동기 실행. 렌더 중 토스트 `복사 중...` → 완료 시 `클립보드에 복사됨`.
- 이미 L2가 없으면 L1에서 렌더 (품질 경고 없음 — 4096 상한이면 L1으로 충분).

**FR-15.2 파일 복사**
- macOS: `NSPasteboard` + `NSFilenamesPboardType` / `public.file-url`
- **RAW+JPEG 스택** 상태면 두 파일 모두 복사.

**FR-15.3 휴지통으로 이동**
- `trash` 크레이트. **`fs::remove_file` 절대 금지.**
- 삭제 후: 플레이리스트에서 제거 → **다음 이미지**로 이동 → 없으면 이전 → 없으면 빈 상태.
- **`.xmp` 사이드카도 함께 휴지통으로.**
- RAW+JPEG 스택 → 확인 다이얼로그 `2개 파일을 휴지통으로 이동합니다`.
- **`⌘Z`로 복원 가능** (§FR-11).
- 네트워크 볼륨/휴지통 미지원 → 확인 다이얼로그 `⚠ 이 볼륨은 휴지통을 지원하지 않습니다. 영구 삭제하시겠습니까?`

**FR-15.4 다음에서 열기**
- `설정 > 외부 편집기`에 앱 등록 (경로 + 이름 + 아이콘 + **전달 포맷**).
- **RAW를 포토샵에 그냥 넘기면 편집값이 사라진다.** → 전달 포맷 선택:
  - `원본 파일 그대로`
  - `편집 적용본 (TIFF 16-bit)` — 임시 파일 생성 후 전달. 기본값. 임시 파일은 `원본폴더/IMG_1234-Edit.tif`로 저장(라이트룸 방식)
- macOS: `NSWorkspace.openURLs(withApplicationAt:)` — `open -a`보다 안정적.

**FR-15.5 필름스트립 우클릭**
- 위 메뉴 + `선택 항목 N개에 적용` 문구로 다중 대상 지원.

---

### FR-16 · 메타데이터 패널 & GPS 미니맵 `P0`

#### FR-16.1 레이아웃
우측 슬라이드아웃 패널, `I`로 토글. 섹션 접기/펼치기 상태 영속.

#### FR-16.2 필수 필드 (전부 표시. 값 없으면 행 숨김 또는 `—`)

**파일**
파일명 · 절대 경로(말줄임 + 툴팁 전체) · 파일 크기(자동 단위) · 포맷 · 해상도 `8192 × 5464 (44.8 MP)` · 종횡비 · 비트 심도 · 색 공간/ICC 프로파일명 · 생성일 · 수정일 · **XMP 사이드카 유무**

**카메라**
제조사 · 모델 · 시리얼 번호 · 펌웨어 · **센서 타입** (`Bayer RGGB` / `X-Trans` / `Monochrome` / `Foveon`) · 센서 크기 · 크롭 팩터

**렌즈**
렌즈 제조사 · 렌즈 모델 · 렌즈 시리얼 · **렌즈 마운트** · 최대 조리개 · **35mm 환산 초점거리** · 텔레컨버터

**노출**
셔터 속도 (**분수 표기: `1/250s`. 0.004s 아님**) · 조리개 (`f/2.8`) · ISO · 초점거리 (`85mm`) · 노출 보정 (`+0.3 EV`) · 노출 모드 · 측광 모드 · 플래시 (발광 여부 + 모드 + 보정) · 화이트 밸런스 (모드 + K값) · **피사계 심도** (계산: hyperfocal/near/far) · 초점 거리(m) · **드라이브 모드** · 손떨림 보정

**날짜**
촬영 일시 (`DateTimeOriginal`) · 디지털화 일시 · 수정 일시 · **시간대 오프셋** · **서브초(SubSecTime)**

**RAW 전용**
CFA 패턴 · Black Level · White Level · As Shot Neutral · 컬러 매트릭스 존재 여부 · 압축 방식 · **DNG 여부 + DNG 버전** · 임베디드 프리뷰 수/크기 · **Opcode List 존재 여부**

**GPS** → §FR-16.3

**AetherLens**
편집 여부 · 적용된 프리셋 · 별점 · 라벨 · 플래그 · 마지막 편집 시각

#### FR-16.3 GPS & OSM 미니맵
- 위도/경도: **소수점 6자리** (`37.566500, 126.978000`) + **DMS 표기 병행** (`37°33'59.4"N 126°58'40.8"E`)
- 고도 (`+38.2 m`, 해수면 기준/타원체 구분), GPS 방위(`GPSImgDirection` — 촬영 방향), GPS 속도, GPS 타임스탬프(UTC), 측위 방식(`GPSProcessingMethod`), DOP
- **미니맵**: Leaflet + OSM 타일
  ```ts
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors',   // ★ ODbL 필수. 지우면 라이선스 위반
  })
  ```
  - 높이 200px, 줌 14 기본. 마커 = 촬영 위치. **`GPSImgDirection` 있으면 방향 콘(cone) 오버레이.**
  - **OSM 타일 사용 정책 준수 필수:** ① `User-Agent`에 앱 이름+버전+연락처 명시, ② 대량 요청 금지 (타일 프리페치 금지), ③ **로컬 타일 캐시 필수** (`cache/tiles/`, 7일 TTL).
    → 위반 시 IP 차단. 사용자 수 증가 시 자체 타일 서버 또는 MapTiler 전환 검토 (§13).
  - 오프라인/타일 로드 실패 → 좌표 텍스트만 + `지도를 불러올 수 없습니다`
  - `설정 > 지도 타일`: OSM(기본) / 없음 / 커스텀 URL 템플릿
- **버튼:** `좌표 복사` (`37.566500, 126.978000`) · `Google Maps에서 열기` · `Apple 지도에서 열기`(macOS) · `OSM에서 열기`
- **내부 상태는 객체로:** `{ lat: number, lng: number, alt?: number, direction?: number }`
- **역지오코딩(주소 표시)** `P2`: Nominatim. **사용 정책상 초당 1요청 + 캐시 필수.** 기본 off.

#### FR-16.4 Deep 메타데이터 (ExifTool) `P1`
> "GPS 등 여러 정보를 빠짐없이 완벽하게" — **메이커노트 전체 파싱은 ExifTool 외에 현실적 대안이 없다.** (캐논 AF 포인트, 소니 렌즈 보정 데이터, 후지 필름 시뮬레이션 등)

- ExifTool은 **GPL/Artistic 이중 라이선스 + Perl 의존** → **번들하지 않는다.**
- **사용자 PATH에서 자동 탐지** (`which exiftool`). 발견 시 패널 하단에 `▸ 전체 메타데이터 (ExifTool)` 섹션 활성화.
- 미발견 시: `ⓘ ExifTool을 설치하면 메이커노트 전체를 볼 수 있습니다` + `brew install exiftool` 복사 버튼.
- 실행: `exiftool -j -G1 -a -u -n <file>` → JSON 파싱 → 그룹별 트리 표시 + 검색 필터.
- **subprocess 호출 = 링크 아님 → 라이선스 문제 없음** (R4 안전).
- 타임아웃 3초. 실패 시 조용히 섹션 숨김.

#### FR-16.5 공통 동작
- **모든 행 우클릭 → `값 복사` / `필드명 복사` / `행 전체 복사`**
- 패널 상단 `전체 복사 ▾`: **JSON** / **Markdown 표** / **YAML** / **CSV**
  → 개발자 워크플로우 직결. 블로그에 EXIF 표 붙여넣기.
- 검색 필터 (`⌘F` in panel).
- `설정 > 메타데이터 표시 항목` — 섹션/필드 단위 on/off + 순서 드래그.

---

### FR-17 · 필름스트립 · 비교 보기 · 등급 `P0/P1`

#### FR-17.1 필름스트립 `P0`
> **방향키 뷰어에 필름스트립이 없으면 사용자는 자기가 어디 있는지 모른다.**

- 위치: 하단. `⌥F`로 토글. 높이 드래그 조절 (60~200px), 상태 영속.
- **가상화 필수** (`@tanstack/react-virtual`) — 10,000장에서도 60fps 스크롤.
- 각 셀: L0 썸네일 + 파일명 + 배지(`RAW` / `DNG` / `RAW+JPEG` / `편집됨●`) + 별점 + 라벨 색 테두리 + 플래그 아이콘.
- 현재 항목 하이라이트 + **자동 스크롤 센터링**.
- 썸네일 아틀라스: 4096×4096 텍스처에 팩 → 드로우콜 1회.
- 다중 선택: `⇧클릭` (범위), `⌘클릭` (토글), `⌘A` (전체).
- 드래그로 재정렬 **없음** (파일 시스템 순서가 진실).

#### FR-17.2 비교 보기 `P1`
| 키 | 모드 |
|----|------|
| `\` (누르고 있는 동안) | **Before/After 순간 전환** — 편집 전 상태를 보여줌 |
| `⇧Y` | 좌/우 분할 (드래그 가능한 구분선) |
| `⌥Y` | 상/하 분할 |
| `Y` | Before \| After 나란히 (독립 캔버스 2개, 줌/팬 동기화) |

- 구분선 위치는 드래그 가능. 더블클릭 시 50% 리셋.
- `Before`의 정의: **편집 없음 상태** (기본) 또는 **히스토리의 특정 시점** (`Before로 설정`, `P2`).
- 2개 이미지 비교(`C` 모드) `P2`

#### FR-17.3 등급 · 플래그 · 라벨 `P1`
| 키 | 동작 | XMP |
|----|------|-----|
| `0`~`5` | 별점 (0=없음) | `xmp:Rating` ★**진짜 표준. LR/Bridge/C1 모두 읽음** |
| `P` | 플래그 (Pick) | `aether:Flag="pick"` + `xmp:Rating` 유지 |
| `X` | 제외 (Reject) | `aether:Flag="reject"` + `crs:Rating="-1"` (LR 관행 호환) |
| `U` | 플래그 해제 | — |
| `⌘1`~`⌘5` | 컬러 라벨 (Red/Yellow/Green/Blue/Purple) | `xmp:Label` (문자열) ★표준 |
| `⌘0` | 라벨 해제 | — |
| `⇧` + 위 키 | 적용 후 **자동으로 다음 이미지** (셀렉 워크플로우) | — |

- **필터 바** (필름스트립 상단): `★≥N` · `플래그` · `라벨` · `편집됨` · `RAW만` · 검색(파일명)
- `⌘⌥X`: 제외 표시된 파일 일괄 휴지통 이동 (확인 다이얼로그 + 목록 미리보기).

#### FR-17.4 그리드 뷰 `P2`
`G`로 전환. 정사각 썸네일 그리드, 크기 슬라이더. 다중 선택/등급 부여용.

---

### FR-18 · macOS Dock 통합 `P1`

> **⚠️ v1.1 오류 정정 2건:**
> 1. **`tauri::App::native_toc_menu`는 존재하지 않는 API다** (Gemini 환각). `objc2` FFI로 직접 구현한다.
> 2. macOS에는 이미 **`NSDocumentController.noteNewRecentDocumentURL(_:)`** 이 있어 Dock 최근 항목이 **자동으로** 채워진다. 하지만 **체크마크 커스텀이 요구사항이므로 `applicationDockMenu:`를 직접 구현**해야 한다. 둘 다 한다.

#### FR-18.1 최근 항목 저장
- 이미지 열기 성공 시:
  1. `catalog.sqlite`의 `recents` 테이블에 upsert (경로, 마지막 열람 시각). **최대 20개** 보존 (표시는 10개).
  2. `platform::note_recent_document(path)` 호출 → macOS: `NSDocumentController.shared.noteNewRecentDocumentURL(url)` (시스템 `최근 항목` 메뉴 자동 연동)
- 존재하지 않는 경로는 표시 시점에 필터링 (파일이 지워졌을 수 있음).

#### FR-18.2 Dock 메뉴 구현 (objc2)
```rust
// platform/macos/dock.rs
// NSApplicationDelegate의 applicationDockMenu: 를 구현한 NSObject 서브클래스를 등록.
// 이 메서드는 Dock 아이콘 우클릭 시 macOS가 호출한다 → 그때마다 NSMenu를 새로 빌드해서 반환.
//
//   ┌──────────────────────────┐
//   │ 최근 항목                 │  (NSMenuItem, disabled, 섹션 헤더)
//   │   ✓ IMG_1234.CR2         │  ← 현재 열린 파일
//   │     IMG_1233.CR2         │
//   │     sunset.jpg           │
//   │   ─────────────────────  │
//   │   최근 항목 지우기         │
//   ├──────────────────────────┤
//   │ 새 창                     │
//   │ (시스템 기본 항목들)       │  ← macOS가 자동 추가 (Show All Windows, Quit 등)
//   └──────────────────────────┘
//
// 체크마크: item.setState(NSControlStateValueOn)
// 액션: 각 NSMenuItem의 target/action → Rust 콜백 → app.emit("dock:open", path)
```

**★ 알려진 제약 (반드시 폴백 구현):**
> Dock 메뉴는 **Dock 프로세스가 렌더링**한다 (앱 프로세스가 아님). 이로 인해 커스텀 뷰, 일부 이미지, **경우에 따라 `setState` 체크마크가 표시되지 않을 수 있다.**

**폴백 (필수):**
- `applicationDockMenu:`에서 체크마크를 `setState`로 시도하되,
- **동시에 타이틀 프리픽스도 적용한다:** 현재 파일은 `"● IMG_1234.CR2"`, 나머지는 `"　IMG_1233.CR2"` (전각 공백으로 정렬 맞춤).
- 체크마크가 렌더되면 `●`가 중복되어 보이므로 → **`설정 > Dock 메뉴 스타일`: `자동(체크마크 시도)` / `점 표시` / `없음`.** 기본 `점 표시` (가장 확실하게 동작).

#### FR-18.3 Dock 항목 클릭 시
1. `NSApp.activate(ignoringOtherApps: true)` — 앱을 최상단으로
2. 메인 윈도우 `set_focus()` + 미니마이즈 상태면 복원
3. `emit("dock:open", { path })` → 프론트가 `navigate_to_path` 호출
4. 해당 파일의 **부모 폴더가 현재 폴더와 다르면 폴더 전체 재스캔**
5. 파일이 이미 없으면 → 토스트 `파일을 찾을 수 없습니다` + 최근 목록에서 제거

#### FR-18.4 Dock 배지 & 기타 `P2`
- 배치 Export 진행 중 → Dock 아이콘에 진행률 배지 (`NSDockTile.setBadgeLabel`)
- 완료 시 `NSApp.requestUserAttention(.informationalRequest)` (백그라운드일 때만)

#### FR-18.5 Windows / Linux 대응 (Phase 4)
| 플랫폼 | 대응 |
|--------|------|
| Windows | **Jump List** (`ICustomDestinationList`). `SetCurrentProcessExplicitAppUserModelID` 선행 필수. 체크마크 없음 → `●` 프리픽스만 |
| Linux | Unity Launcher API는 사실상 사망. **미지원.** 최근 항목은 앱 내 `⌘⇧O` 메뉴로만 제공 |
| **공통** | 앱 내 `파일 > 최근 항목` 메뉴는 **전 플랫폼 필수** (Dock 없이도 접근 가능해야 함) |

---

### FR-19 · 파일 연결 · 싱글 인스턴스 `P0`

#### FR-19.1 tauri.conf.json
```json
{
  "identifier": "app.aetherlens",
  "bundle": {
    "active": true,
    "targets": ["dmg", "app"],
    "fileAssociations": [
      {
        "ext": ["cr2","cr3","arw","sr2","srf","nef","nrw","raf","dng","orf","rw2","pef","raw","rwl","3fr","fff","iiq","erf","mrw","dcr","kdc","mos","gpr"],
        "name": "RAW Image",
        "description": "Camera RAW Image",
        "role": "Editor",
        "rank": "Alternate",
        "mimeType": "image/x-dcraw"
      },
      {
        "ext": ["jpg","jpeg","png","webp","tif","tiff","bmp","gif","avif","heic","heif"],
        "name": "Image",
        "description": "Image File",
        "role": "Viewer",
        "rank": "Alternate",
        "mimeType": "image/*"
      }
    ],
    "macOS": {
      "minimumSystemVersion": "13.0",
      "entitlements": "./entitlements.plist"
    }
  }
}
```
> **`"rank": "Alternate"` 중요.** `"Owner"`로 설치하면 사용자의 기존 기본 앱(미리보기)을 **가로챈다.** 사용자가 명시적으로 바꾸게 두는 것이 예의.

#### FR-19.2 macOS 파일 열기 이벤트 ★
> **`fileAssociations`만으로는 부족하다.** macOS는 Finder에서 파일을 더블클릭할 때 **CLI 인자로 경로를 주지 않는다.** `NSApplication`의 `application:openURLs:` Apple Event로 전달한다.

```rust
// main.rs
tauri::Builder::default()
  .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
      // 2번째 인스턴스가 시작될 때 (주로 Windows/Linux 경로)
      if let Some(path) = argv.iter().skip(1).find(|a| !a.starts_with('-')) {
          focus_and_open(app, path);
      }
  }))
  .build(ctx)?
  .run(|app, event| match event {
      // ★ macOS Finder "다음으로 열기" / 더블클릭은 여기로 온다
      tauri::RunEvent::Opened { urls } => {
          for url in urls {
              if let Ok(path) = url.to_file_path() { focus_and_open(app, &path); }
          }
      }
      _ => {}
  });

fn focus_and_open(app: &AppHandle, path: &Path) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.set_focus();
        let _ = w.show();
    }
    let _ = app.emit("file:open-request", OpenRequest { path: path.to_owned() });
}
```

- **앱 시작 전에 `Opened`가 발생할 수 있다** (콜드 스타트). → 프론트 준비 전 이벤트는 **큐에 버퍼링**했다가 `invoke("frontend_ready")` 수신 후 flush.
- 프론트: `file:open-request` 수신 → ① 부모 폴더가 현재와 다르면 재스캔, ② 해당 파일로 네비게이트.

#### FR-19.3 싱글 인스턴스
- `tauri-plugin-single-instance`. **macOS에서는 사실상 no-op** (OS가 이미 단일 인스턴스 보장 + `Opened` 이벤트로 전달) — 하지만 Windows/Linux를 위해 Phase 1부터 포함.
- `설정 > 파일을 새 창에서 열기` (기본 off). on이면 새 윈도우 생성.
- **다중 윈도우 지원** `P2`: 각 윈도우가 독립 플레이리스트 보유.

#### FR-19.4 Sandbox & 권한 (macOS)
- **v2.0은 non-sandboxed로 출시** (직접 배포, DMG).
  → Mac App Store 배포를 하려면 샌드박스 필수 → 그때 `security-scoped bookmarks` 필요 (§13 보류).
- 다만 **`platform::bookmarks` 모듈 인터페이스는 지금 만들어 둔다** (non-sandbox에서는 no-op 구현).
- `entitlements.plist`: `com.apple.security.files.user-selected.read-write`, `com.apple.security.automation.apple-events` (외부 앱 열기용)
- **Full Disk Access 불필요** — 사용자가 선택/드롭한 경로만 접근.

---

### FR-20 · 설정 · 단축키 · UI 셸 `P1`

#### FR-20.1 레이아웃
```
┌────────────────────────────────────────────────────────────┐
│  ⌘O  ⌘E   [파일명.CR2]  RAW ● ★★★★☆        L2  ⓘ  ⚙        │ 툴바 (44px)
├──────────────────────────────────────────┬─────────────────┤
│                                          │ ▁▂▅█▅▂▁ 히스토그램 │
│                                          │ ─────────────── │
│                                          │ ▸ 기본           │
│              VIEWPORT                    │ ▸ 톤 커브        │
│           (WebGL2 Canvas)                │ ▸ HSL / 컬러     │
│                                          │ ▸ 디테일         │
│                                          │ ▸ 렌즈 보정      │
│                                          │ ▸ 효과           │
│                                          │ ▸ 크롭 · 기하     │
│                                          │ ─────────────── │
│                                          │ ▸ 프리셋         │
│                                          │ ▸ 메타데이터      │
│                                          │   [OSM 미니맵]   │
├──────────────────────────────────────────┴─────────────────┤
│ [필름스트립 — 가상화]                                         │
├────────────────────────────────────────────────────────────┤
│ 12/340 · 8192×5464 · 52.3MB · f/2.8 1/250s ISO400 · 🔒     │ 상태바 (24px)
└────────────────────────────────────────────────────────────┘
```
- 패널 폭 드래그 조절, 상태 영속 (`tauri-plugin-store`).
- `Tab`: 우측 패널 토글 · `⇧Tab`: 필름스트립 토글 · `F`: 전체 화면 · **`L`: 라이트 아웃** (UI 전부 숨김, 이미지만)

#### FR-20.2 줌 & 팬
| 키 / 제스처 | 동작 |
|------------|------|
| `Z` 또는 클릭 | Fit ⇄ 100% 토글 (클릭 지점 중심) |
| `⌘+` / `⌘-` | 줌 인/아웃 |
| `⌘0` | Fit |
| `⌘1` | 100% |
| `⌘2` | 200% |
| 스페이스 + 드래그 | 팬 |
| 트랙패드 핀치 | 줌 |
| 트랙패드 2핑거 | 팬 |
| `⌥` + 스크롤 | 줌 |

- **줌 레벨은 이미지 전환 시 유지** (100%로 보다가 다음 사진 → 100% 유지). 라이트룸 동작.
- 100% 이상 줌 시 보간: **nearest** (픽셀 확인용). 100% 미만: **bicubic**.
- 최대 줌 1600%.

#### FR-20.3 테마
- `자동(시스템)` (기본) / `다크` / `라이트`
- macOS: `NSApp.effectiveAppearance` 감시 → `prefers-color-scheme`
- **뷰포트 배경은 항상 중성 회색** (기본 `#3C3C3C`, 설정 가능 `#000` ~ `#FFF`).
  → **순백/순흑 배경은 인지적 대비로 사진 톤 판단을 왜곡한다.** 기본값을 흰색/검정으로 하지 말 것.

#### FR-20.4 전체 키맵 (§FR-20.4는 `src/shortcuts/keymap.ts` 단일 소스)
```
탐색     ← →  Home End  PgUp PgDn  ⌘← ⌘→(플래그 간)
줌       Z  ⌘0 ⌘1 ⌘2 ⌘+ ⌘-  Space+drag
보기     Tab(패널) ⇧Tab(필름스트립) F(전체화면) L(라이트아웃) I(메타) G(그리드)
비교     \(순간전환) Y ⇧Y ⌥Y
편집     ⌘Z ⌘⇧Z ⌘R ⌘⌥R  ⌘⇧C ⌘⇧V ⌘⌥V
등급     0-5  P X U  ⌘1-⌘5(라벨) ⌘0  ⇧+위(자동전진)
도구     C(크롭) ⇧A(비율) X(회전) O(오버레이) W(WB스포이드) ⌘[ ⌘](90°회전)
검사     J(클리핑) ⇧J ⌥J
파일     ⌘O ⌘E ⌘⇧E(배치) ⌘⇧D(DNG) ⌘C ⌘⌥C ⌘⇧⌥C ⌘⇧R(Finder) ⌫(휴지통) F2(이름변경)
프리셋   ⌥1-⌥9
기타     ⌘, (설정) ⌘⇧P(커맨드 팔레트) ? (단축키 도움말)
```
- **⌘⇧P 커맨드 팔레트** `P1`: 모든 액션을 퍼지 검색. 개발자 워크플로우의 핵심.
- `설정 > 단축키`에서 **전체 리매핑 가능** (`P2`). 프리셋: `AetherLens 기본` / `Lightroom 유사`.

#### FR-20.5 설정 화면 섹션
`일반` · `성능` · `색상` · `파일 관리` · `외부 편집기` · `단축키` · `지도` · `메타데이터` · `캐시` · `고급` · `정보/라이선스`

**`성능` 섹션 노출 항목:**
| 항목 | 기본 | 범위 |
|------|------|------|
| 디코딩 스레드 | 자동 (`cores-1`) | 1 ~ cores |
| 메모리 상한 | 2.0 GB | 0.5 ~ 16 GB |
| 디스크 캐시 상한 | 10 GB | 1 ~ 100 GB |
| L2 자동 디코딩 | 유휴 시에만 | 항상 / 유휴 시 / 100% 줌에서만 |
| 데모자이킹 품질 | 표준(AHD) | 빠름(PPG) / 표준(AHD) / 높음(DCB) / 최고(DHT) |
| GPU 백엔드 | 자동 | 자동 / WebGL2 강제 / WebGPU 강제 |
| 프리로드 범위 | ±3 | ±0 ~ ±10 |
| **캐시 지우기** | — | 버튼 + 현재 사용량 표시 |

#### FR-20.6 i18n `P1`
- `ko`(기본, 시스템 언어 따름) / `en`
- `react-i18next`. 모든 문자열은 `t()` 경유. **하드코딩 금지.**
- 숫자/날짜: `Intl.NumberFormat` / `Intl.DateTimeFormat`
- 확장 대비: `ja`, `zh-Hans`, `de`, `fr` 슬롯만 준비

#### FR-20.7 접근성 `P1`
- 모든 인터랙티브 요소에 `aria-label`, 키보드 포커스 링.
- 슬라이더: 화살표 키로 미세 조정 (`⇧` = 10배 스텝).
- VoiceOver: 뷰포트에 `aria-live="polite"`로 이미지 전환 알림 (`12번째 중 340개, IMG_1234.CR2`).
- **색맹 대응:** 클리핑 오버레이 색상 설정 가능. 라벨은 색+아이콘 병행.
- `prefers-reduced-motion` 존중.

---

## 5. 데이터 모델

### 5.1 EditState — 편집 상태의 유일한 진실
> Rust `struct`와 TypeScript `interface`가 **1:1 대응**해야 한다. 불일치는 컴파일 타임에 잡을 것.
> 권장: Rust에 `#[derive(Serialize, Deserialize, TS)]` (`ts-rs` 크레이트) → `cargo test`가 `src/types/edit.ts`를 자동 생성. **손으로 두 번 쓰지 말 것.**

```ts
// src/types/edit.ts  (ts-rs 자동 생성)
export interface EditState {
  version: 2;                       // 마이그레이션용

  // ── ① White Balance (패스 ①)
  wb: {
    mode: 'as-shot' | 'auto' | 'custom' | 'daylight' | 'cloudy' | 'shade'
        | 'tungsten' | 'fluorescent' | 'flash';
    temp: number;                   // 2000–50000 K
    tint: number;                   // -150–150
    tempShift?: number;             // 비-RAW 전용 상대 조정 -100–100
  };

  // ── ② Lens & Geometry (패스 ②)
  lens: {
    autoProfile: boolean;           // 기본 true
    profileId: string | null;       // Lensfun 항목 ID (수동 선택 시)
    distortion: number;             // 0–200 (%), 기본 100
    tca: number;                    // 0–200
    vignette: number;               // 0–200
    manualVignette: number;         // -100–100 (프로파일 없을 때)
    manualDistortion: number;       // -100–100
  };
  geometry: {
    rotate90: 0 | 1 | 2 | 3;        // 사용자 회전 (EXIF orientation과 별개)
    flipH: boolean;
    flipV: boolean;
    straighten: number;             // -45–45 (deg)
    perspectiveV: number;           // -100–100
    perspectiveH: number;
    perspectiveRotate: number;
    aspectAdjust: number;
    scale: number;                  // 50–200
    offsetX: number; offsetY: number;
  };
  crop: {
    enabled: boolean;
    // 정규화 좌표 (0–1). ★ 회전/기하 적용 *후* 좌표계 기준
    left: number; top: number; right: number; bottom: number;
    aspect: 'original' | 'free' | string;   // "16:9", "1:1", "3:2"...
  } | null;

  // ── ③ Tone (패스 ③)
  tone: {
    exposure: number;               // -5.0–5.0 EV
    contrast: number;               // -100–100
    highlights: number; shadows: number; whites: number; blacks: number;
    highlightRecovery: number;      // 0–100
  };

  // ── ④ Curves (패스 ④)
  baseCurve: 'linear' | 'standard' | 'filmic' | 'camera-match';   // 기본 'standard'
  curves: {
    rgb: CurvePoint[];              // 기본 [{x:0,y:0},{x:1,y:1}]
    red: CurvePoint[]; green: CurvePoint[]; blue: CurvePoint[];
  };

  // ── ⑤ Color (패스 ⑤)
  color: {
    vibrance: number; saturation: number;
    hsl: Record<HslBand, { hue: number; sat: number; lum: number }>;
    bw: boolean;                    // 흑백 변환
  };

  // ── ⑥ Detail (패스 ⑥)
  detail: {
    sharpenAmount: number;          // 0–150, RAW 기본 25
    sharpenRadius: number;          // 0.5–3.0
    sharpenDetail: number;          // 0–100
    sharpenMasking: number;         // 0–100
    nrLuminance: number;            // 0–100 (ISO 기반 자동 초기값)
    nrLumaDetail: number; nrLumaContrast: number;
    nrColor: number; nrColorDetail: number;
    hotPixelRemoval: boolean;       // RAW 기본 true
  };

  // ── ⑦ Effects (패스 ⑦)
  effects: {
    clarity: number;                // -100–100
    dehaze: number;
    vignetteAmount: number;         // -100–100 (창작용)
    vignetteMidpoint: number; vignetteRoundness: number; vignetteFeather: number;
    grainAmount: number; grainSize: number; grainRoughness: number;
  };

  // ── 메타
  meta: {
    appliedPreset: string | null;
    modifiedAt: number;             // epoch ms
  };
}

export type HslBand = 'red'|'orange'|'yellow'|'green'|'aqua'|'blue'|'purple'|'magenta';
export interface CurvePoint { x: number; y: number; }   // 0–1 정규화
```

**불변 규칙:**
- `DEFAULT_EDIT_STATE` 상수 하나만 존재. `isDefault(state)` 로 "편집됨●" 배지 판정.
- `version` 불일치 → `migrate(state)` 함수 경유. 알 수 없는 상위 버전 → 기본값 + 경고 배지.
- **RAW와 비-RAW가 같은 구조를 공유한다.** 적용 불가 필드는 UI에서 비활성화할 뿐, 데이터 구조는 동일.

### 5.2 ImageMetadata (읽기 전용)

```ts
export interface ImageMetadata {
  file: { name, path, sizeBytes, format, width, height, megapixels, bitDepth,
          colorSpace: string | null, iccProfileName: string | null,
          createdAt, modifiedAt, hasSidecar: boolean };
  camera: { make, model, serial, firmware,
            sensorType: 'bayer' | 'xtrans' | 'monochrome' | 'foveon' | 'unknown',
            cfaPattern: string | null, cropFactor: number | null };
  lens: { make, model, serial, mount, maxAperture, focalLength35mm, teleconverter };
  exposure: { shutterSpeed: { num: number; den: number } | null,
              fNumber, iso, focalLength, exposureBias, exposureMode, meteringMode,
              flash: { fired: boolean; mode: string; compensation: number | null } | null,
              whiteBalance: string | null, wbTemp: number | null,
              subjectDistance: number | null, dof: { near: number; far: number; hyperfocal: number } | null,
              driveMode, stabilization };
  dates: { original, digitized, modified, timezoneOffset, subSec };
  gps: { lat: number; lng: number; alt: number | null; altRef: 'sea' | 'ellipsoid' | null;
         direction: number | null; directionRef: 'true' | 'magnetic' | null;
         speed: number | null; timestamp: string | null;
         processingMethod: string | null; dop: number | null } | null;
  raw: { isDng: boolean; dngVersion: string | null; blackLevel: number[]; whiteLevel: number[];
         asShotNeutral: number[] | null; hasColorMatrix: boolean; compression: string;
         embeddedPreviews: { width: number; height: number; format: string }[];
         hasOpcodeList: boolean } | null;
  warnings: MetadataWarning[];   // 'no-color-profile' | 'unsupported-sensor' | 'corrupt-exif' ...
}
```

### 5.3 XMP `crs:` 매핑 테이블 ★ (Lightroom 상호운용 — best-effort)

> **주의:** 이 매핑은 **의미적 근사**다. Adobe의 Process Version 파이프라인 공식은 비공개이므로 값을 그대로 옮겨도 **결과 그림은 다르다.** UI에서 이를 정직하게 고지한다 (§FR-12).

| AetherLens | crs: (write) | 변환 | round-trip |
|-----------|--------------|------|-----------|
| `wb.temp` | `Temperature` | 1:1 (K) | ✅ 근사 |
| `wb.tint` | `Tint` | 1:1 | ✅ 근사 |
| `tone.exposure` | `Exposure2012` | 1:1 (EV) | ✅ 근사 |
| `tone.contrast` | `Contrast2012` | 1:1 | ⚠️ 곡선 형태 다름 |
| `tone.highlights` | `Highlights2012` | 1:1 | ⚠️ |
| `tone.shadows` | `Shadows2012` | 1:1 | ⚠️ |
| `tone.whites` | `Whites2012` | 1:1 | ⚠️ |
| `tone.blacks` | `Blacks2012` | 1:1 | ⚠️ |
| `tone.highlightRecovery` | — | **매핑 없음** | ❌ aether: only |
| `effects.clarity` | `Clarity2012` | 1:1 | ⚠️ |
| `effects.dehaze` | `Dehaze` | 1:1 | ⚠️ |
| `color.vibrance` | `Vibrance` | 1:1 | ⚠️ |
| `color.saturation` | `Saturation` | 1:1 | ⚠️ |
| `color.hsl.*.hue` | `HueAdjustment{Band}` | 밴드명 매핑* | ⚠️ |
| `color.hsl.*.sat` | `SaturationAdjustment{Band}` | 밴드명 매핑* | ⚠️ |
| `color.hsl.*.lum` | `LuminanceAdjustment{Band}` | 밴드명 매핑* | ⚠️ |
| `color.bw` | `ConvertToGrayscale` | bool | ✅ |
| `detail.sharpenAmount` | `Sharpness` | `clamp(x, 0, 150)` | ⚠️ |
| `detail.sharpenRadius` | `SharpenRadius` | 1:1 | ⚠️ |
| `detail.sharpenDetail` | `SharpenDetail` | 1:1 | ⚠️ |
| `detail.sharpenMasking` | `SharpenEdgeMasking` | 1:1 | ⚠️ |
| `detail.nrLuminance` | `LuminanceSmoothing` | 1:1 | ⚠️ |
| `detail.nrColor` | `ColorNoiseReduction` | 1:1 | ⚠️ |
| `curves.rgb` | `ToneCurvePV2012` | `["0, 0", "255, 255"]` 문자열 배열, 256 리샘플 | ⚠️ 손실 |
| `curves.red/green/blue` | `ToneCurvePV2012Red/Green/Blue` | 동일 | ⚠️ 손실 |
| `baseCurve` | — | **매핑 없음** (Adobe는 프로파일로 처리) | ❌ |
| `crop.*` | `CropTop/Left/Bottom/Right/Angle`, `HasCrop` | 좌표계 변환 필요** | ⚠️ |
| `geometry.perspectiveV/H` | `PerspectiveVertical/Horizontal` | 1:1 | ⚠️ |
| `geometry.rotate90` | `Orientation` (EXIF) | — | ✅ |
| `lens.*` | `LensProfileEnable`, `LensManualDistortionAmount`, `VignetteAmount` | 부분 | ⚠️ |
| `effects.vignetteAmount` | `PostCropVignetteAmount` | 1:1 | ⚠️ |
| `effects.grain*` | `GrainAmount/Size/Frequency` | 1:1 | ⚠️ |
| **전체 상태** | `aether:state` | `base64(zstd(json))` | ✅ **100%** |

\* 밴드명: `red|orange|yellow|green|aqua|blue|purple|magenta` → `Red|Orange|Yellow|Green|Aqua|Blue|Purple|Magenta`
\** Adobe crop 좌표는 **회전 적용 후, 원본 대비 정규화**. 우리 좌표계와 원점/방향 확인 필요 → 단위 테스트 필수.

**필수 동반 필드:**
```
crs:Version="15.0"           # Camera Raw 버전
crs:ProcessVersion="11.0"    # ★ 이게 없으면 LR이 구형 파이프라인으로 해석 → 완전히 다른 그림
crs:HasSettings="True"
crs:RawFileName="IMG_1234.CR2"
```

### 5.4 SQLite 카탈로그 스키마

```sql
PRAGMA journal_mode = WAL;        -- ★ 필수. 읽기와 쓰기 동시 진행
PRAGMA synchronous  = NORMAL;     -- WAL에서 안전 + 빠름
PRAGMA foreign_keys = ON;

-- 이미지 (진실의 원천은 파일시스템 + .xmp. 여기는 캐시/인덱스)
CREATE TABLE images (
  id            INTEGER PRIMARY KEY,
  path          TEXT    NOT NULL UNIQUE,
  dir           TEXT    NOT NULL,
  filename      TEXT    NOT NULL,
  stem          TEXT    NOT NULL,          -- RAW+JPEG 페어링용
  ext           TEXT    NOT NULL,
  content_key   TEXT    NOT NULL,          -- blake3(path||mtime||size) — 캐시 키
  size_bytes    INTEGER NOT NULL,
  mtime_ns      INTEGER NOT NULL,
  is_raw        INTEGER NOT NULL,
  width         INTEGER, height INTEGER,
  -- 자주 필터/정렬하는 EXIF만 비정규화
  captured_at   INTEGER,                   -- epoch ms
  camera_model  TEXT, lens_model TEXT,
  iso           INTEGER, f_number REAL, focal_length REAL,
  shutter_num   INTEGER, shutter_den INTEGER,
  gps_lat       REAL, gps_lng REAL,
  -- 등급
  rating        INTEGER NOT NULL DEFAULT 0,   -- 0–5
  flag          TEXT,                          -- 'pick' | 'reject' | NULL
  label         TEXT,                          -- 'Red'|'Yellow'|...
  -- 편집
  edit_state    TEXT,                          -- JSON. NULL = 미편집
  edit_version  INTEGER NOT NULL DEFAULT 0,    -- 낙관적 동시성
  sidecar_mtime_ns INTEGER,                    -- .xmp와 동기화 판정
  applied_preset   TEXT,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX idx_images_dir        ON images(dir);
CREATE INDEX idx_images_stem       ON images(dir, stem);
CREATE INDEX idx_images_key        ON images(content_key);
CREATE INDEX idx_images_captured   ON images(captured_at);
CREATE INDEX idx_images_rating     ON images(rating) WHERE rating > 0;

-- 전체 메타데이터 (큰 JSON — 별도 테이블로 분리해 images 스캔을 가볍게)
CREATE TABLE metadata (
  image_id  INTEGER PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
  json      TEXT NOT NULL
);

CREATE TABLE recents (
  path       TEXT PRIMARY KEY,
  opened_at  INTEGER NOT NULL
);
CREATE INDEX idx_recents_time ON recents(opened_at DESC);

CREATE TABLE presets (
  id          TEXT PRIMARY KEY,      -- uuid
  name        TEXT NOT NULL,
  folder      TEXT NOT NULL DEFAULT '',
  edit_state  TEXT NOT NULL,         -- JSON (부분 적용용 필드 마스크 포함)
  field_mask  TEXT NOT NULL,         -- JSON string[]
  source      TEXT NOT NULL,         -- 'native' | 'lr-import'
  builtin     INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE lens_overrides (        -- 수동 렌즈 프로파일 매칭 기억
  lens_key    TEXT PRIMARY KEY,      -- "{camera_model}|{lens_model}|{focal}"
  profile_id  TEXT NOT NULL
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE schema_version (version INTEGER NOT NULL);
```

**마이그레이션:** `catalog/migrations/NNN_name.sql`. 앱 시작 시 `schema_version` 비교 후 순차 적용. **다운그레이드 없음** — 상위 버전 DB 발견 시 `⚠ 이 카탈로그는 최신 버전의 AetherLens에서 생성되었습니다` + 읽기 전용 모드.

---

## 6. IPC API 명세

> 모든 command는 `Result<T, AppError>`를 반환. `AppError`는 `serde` 직렬화되어 프론트에서 타입 안전하게 처리.
> **`src/ipc/commands.ts`는 손으로 쓰지 말고 `ts-rs`로 생성.**

### 6.1 Commands (`invoke`)

```rust
// ── 파일 & 스캔
#[tauri::command] async fn scan_directory(path: PathBuf, on_batch: Channel<ScanBatch>) -> Result<ScanSummary>;
#[tauri::command] async fn open_path(path: PathBuf) -> Result<OpenResult>;   // 부모 폴더 스캔 + 인덱스 반환
#[tauri::command] async fn navigate(image_id: ImageId, priority: Priority) -> Result<()>;  // 디코딩 큐 투입
#[tauri::command] async fn cancel_decode(image_id: ImageId) -> Result<()>;
#[tauri::command] async fn frontend_ready() -> Result<Vec<PendingOpenRequest>>;  // 콜드스타트 큐 flush

// ── 메타데이터
#[tauri::command] async fn get_metadata(image_id: ImageId) -> Result<ImageMetadata>;
#[tauri::command] async fn get_deep_metadata(image_id: ImageId) -> Result<Option<serde_json::Value>>; // ExifTool
#[tauri::command] async fn get_color_profile(image_id: ImageId) -> Result<ColorProfileInfo>;
   // → 프론트가 셰이더 uniform으로 쓸 3×3 매트릭스 + WB 게인. ★소용량이라 invoke OK

// ── 편집
#[tauri::command] async fn get_edit_state(image_id: ImageId) -> Result<EditState>;
#[tauri::command] async fn set_edit_state(image_id: ImageId, state: EditState, version: u32) -> Result<u32>;
   // 낙관적 동시성. version 불일치 → Err(AppError::Conflict)
#[tauri::command] async fn reset_edit_state(image_id: ImageId, fields: Option<Vec<String>>) -> Result<EditState>;
#[tauri::command] async fn copy_settings(from: ImageId, to: Vec<ImageId>, mask: Vec<String>) -> Result<()>;

// ── 프리셋
#[tauri::command] async fn list_presets() -> Result<Vec<PresetInfo>>;
#[tauri::command] async fn save_preset(name: String, folder: String, image_id: ImageId, mask: Vec<String>) -> Result<PresetInfo>;
#[tauri::command] async fn apply_preset(preset_id: String, targets: Vec<ImageId>) -> Result<()>;
#[tauri::command] async fn import_preset(path: PathBuf) -> Result<PresetInfo>;
#[tauri::command] async fn export_preset(preset_id: String, path: PathBuf) -> Result<()>;
#[tauri::command] async fn delete_preset(preset_id: String) -> Result<()>;

// ── 등급
#[tauri::command] async fn set_rating(image_ids: Vec<ImageId>, rating: u8) -> Result<()>;
#[tauri::command] async fn set_flag(image_ids: Vec<ImageId>, flag: Option<Flag>) -> Result<()>;
#[tauri::command] async fn set_label(image_ids: Vec<ImageId>, label: Option<String>) -> Result<()>;

// ── Export
#[tauri::command] async fn export_raster(req: RasterExportRequest, on_progress: Channel<ExportProgress>) -> Result<Vec<PathBuf>>;
#[tauri::command] async fn export_dng(req: DngExportRequest, on_progress: Channel<ExportProgress>) -> Result<Vec<PathBuf>>;
#[tauri::command] async fn cancel_export(job_id: String) -> Result<()>;
#[tauri::command] async fn probe_dng_support(image_id: ImageId) -> Result<DngSupport>;  // 폴백 UX용 사전 확인
   // ★ 하드코딩 목록 금지. 실제 dnglab 시도 결과로 판정

// ── 클립보드 & 파일 조작
#[tauri::command] async fn copy_image_to_clipboard(image_id: ImageId, png_bytes: Vec<u8>) -> Result<()>;
   // ★ 픽셀은 프론트 canvas에서 렌더 → PNG 인코딩 → 여기로. 역방향 대용량 IPC는 이것뿐이며
   //    4096px 상한(≈8MB)이므로 허용. 그 이상은 Rust에서 렌더.
#[tauri::command] async fn copy_files_to_clipboard(image_ids: Vec<ImageId>) -> Result<()>;
#[tauri::command] async fn copy_text(text: String) -> Result<()>;
#[tauri::command] async fn move_to_trash(image_ids: Vec<ImageId>) -> Result<TrashResult>;
#[tauri::command] async fn restore_from_trash(token: TrashToken) -> Result<()>;   // ⌘Z
#[tauri::command] async fn rename_file(image_id: ImageId, new_name: String) -> Result<PathBuf>;
#[tauri::command] async fn reveal_in_file_manager(image_id: ImageId) -> Result<()>;
#[tauri::command] async fn open_with_external(image_id: ImageId, app_id: String, format: ExternalFormat) -> Result<()>;

// ── 렌즈
#[tauri::command] async fn find_lens_profile(image_id: ImageId) -> Result<Option<LensProfile>>;
#[tauri::command] async fn list_lens_profiles(query: String) -> Result<Vec<LensProfileInfo>>;
#[tauri::command] async fn set_lens_override(lens_key: String, profile_id: String) -> Result<()>;

// ── 시스템
#[tauri::command] async fn get_recents() -> Result<Vec<RecentEntry>>;
#[tauri::command] async fn clear_recents() -> Result<()>;
#[tauri::command] async fn get_display_color_space() -> Result<String>;   // "display-p3" | "srgb"
#[tauri::command] async fn get_settings() -> Result<Settings>;
#[tauri::command] async fn set_settings(settings: Settings) -> Result<()>;
#[tauri::command] async fn get_cache_stats() -> Result<CacheStats>;
#[tauri::command] async fn clear_cache(kind: CacheKind) -> Result<()>;
#[tauri::command] async fn detect_exiftool() -> Result<Option<String>>;   // 경로 or None
```

### 6.2 Events (`listen`)

| 이벤트 | 페이로드 | 설명 |
|--------|---------|------|
| `image:level-ready` | `{ imageId, level: 'l0'\|'l1'\|'l2', rev, width, height, tiles?: TileGrid }` | **★ 픽셀 자체는 없다.** 프론트가 이 신호를 받고 `aether://`로 fetch |
| `image:decode-failed` | `{ imageId, error: AppError }` | §7.3 |
| `image:warning` | `{ imageId, warning: MetadataWarning }` | `no-color-profile` 등 |
| `scan:progress` | `{ dir, found, done }` | — |
| `fs:changed` | `{ kind: 'created'\|'removed'\|'modified', paths }` | §FR-1.7 |
| `sidecar:external-change` | `{ imageId }` | .xmp가 외부에서 수정됨 |
| `file:open-request` | `{ path }` | Finder/Dock/CLI (§FR-19.2) |
| `dock:open` | `{ path }` | Dock 최근 항목 클릭 |
| `export:progress` | `{ jobId, done, total, current, etaMs }` | — |
| `export:done` | `{ jobId, succeeded, failed: FailedItem[] }` | — |
| `settings:changed` | `Settings` | — |

### 6.3 `aether://` 프로토콜 (§2.3)

```
GET aether://localhost/pixels/{image_id}/{level}?rev={n}
GET aether://localhost/pixels/{image_id}/{level}/{tx}_{ty}?rev={n}     # 타일 (L2)
GET aether://localhost/thumb/{image_id}?size=256                        # WebP, <img> 직결
GET aether://localhost/atlas/{dir_hash}/{page}                          # 필름스트립 아틀라스 (WebP)

응답 (pixels):
  Content-Type: application/octet-stream
  X-Aether-Width / X-Aether-Height / X-Aether-Format(f16|u16|u8) / X-Aether-Channels
  Cache-Control: no-cache
  Body: [magic:u32 = 0x41455448]["AETH"][w:u32][h:u32][fmt:u8][ch:u8][pad:u16] + planar payload
  Accept-Ranges: bytes                 # 부분 로드 지원

취소: 프론트 AbortController → webview가 연결 종료 → Rust responder drop 감지 → 디코딩 job abort
```

---

## 7. 비기능 요구사항

### 7.1 성능 목표 — 기준 하드웨어 명시 ★

> **기준기: MacBook Air M1 (8-core CPU / 7-core GPU / 8GB unified / SSD), macOS 14+**
> **기준 파일: Canon EOS R5 `.CR3` 45MP (약 45MB), 로컬 SSD, 캐시 미스 상태**
> 상위 칩(M2/M3/M4 Pro/Max)에서는 자동으로 여유가 생긴다. **저사양이 기준이어야 목표가 의미 있다.**

| # | 지표 | 목표 | 측정 방법 |
|---|------|------|----------|
| P1 | **L0 표시** (파일 오픈 → 첫 픽셀) | **≤ 60ms** | `tracing` span: `open_path` → `image:level-ready(l0)` → rAF paint |
| P2 | **L1 표시** (편집 가능 상태) | **≤ 250ms** | 동상 |
| P3 | **L2 완료** (100% 품질) | **≤ 1.2s** | 동상 |
| P4 | **캐시 히트 L1** | **≤ 40ms** | 두 번째 방문 |
| P5 | **방향키 연속 이동** (L0 기준) | **≤ 16ms/장** | 100장 연속 이동 평균 |
| P6 | **슬라이더 드래그** | **≥ 60fps** (프레임 예산 16.6ms, 실측 ≤ 8ms) | `PerformanceObserver` long-task 0건 |
| P7 | **필름스트립 스크롤** (10,000장) | **≥ 60fps** | — |
| P8 | **앱 콜드 스타트 → 인터랙티브** | **≤ 700ms** | — |
| P9 | **Export 45MP JPEG q90 sRGB** | **≤ 2.0s** | — |
| P10 | **배치 Export 100장 (2048px JPEG)** | **≤ 45s** | 병렬 |
| P11 | **10,000장 폴더 스캔 완료** | **≤ 3s** (첫 화면은 60ms) | — |
| P12 | **DNG mosaic 변환 45MP** | **≤ 4s** | dnglab sidecar |

**계측 필수:** `tracing` span을 위 지점마다 삽입. `설정 > 고급 > 성능 오버레이` (기본 off)로 실시간 표시:
```
L0 47ms · L1 218ms · L2 1.08s · GPU 6.2ms/f · RSS 1.4GB · VRAM 780MB · cache 62% hit
```

### 7.2 메모리 목표

| 상황 | RSS 목표 |
|------|---------|
| 유휴 (이미지 1장, Fit 뷰) | **≤ 400MB** |
| 45MP RAW 100장 폴더에서 방향키 연타 30초 | **≤ 2.0GB, 단조 증가 없음** ★ |
| 45MP × 5장 100% 줌 왕복 | ≤ 2.5GB |
| 배치 Export 중 | ≤ 3.0GB |

- **누수 검증:** 100장 왕복 3회 후 RSS가 1회차 대비 **+10% 이내**. 초과 시 버그.
- **명시적 해제 필수:**
  - JS: `gl.deleteTexture()`, `gl.deleteFramebuffer()` — GC를 믿지 말 것. WebGL 리소스는 GC 대상이 아니다.
  - `ArrayBuffer` 참조 해제 후 다음 rAF에 `null` 할당.
  - Rust: 디코딩 버퍼는 `Arc`로 공유하되, 프록시 캐시 축출 시 강제 drop.
- macOS `Instruments > Allocations` + `Leaks` 프로파일이 CI 이전 수동 검증 항목.

### 7.3 예외 처리 & 견고성 ★

> **손상 파일 1개로 앱이 죽으면 안 된다. R6.**

```rust
// decode/libraw_ffi.rs
pub fn decode_guarded(path: &Path, params: Params) -> Result<Image, DecodeError> {
    // LibRaw는 C++ 라이브러리다. 손상 파일에서 abort()/segfault 가능.
    let result = std::panic::catch_unwind(AssertUnwindSafe(|| unsafe {
        libraw_decode_inner(path, params)
    }));
    match result {
        Ok(Ok(img))  => Ok(img),
        Ok(Err(e))   => Err(DecodeError::LibRaw(e)),
        Err(_)       => Err(DecodeError::Panic),   // ★ 앱은 계속 산다
    }
}
```

**`catch_unwind`로도 못 막는 것:** C++ 라이브러리의 진짜 segfault / abort.
→ **완화책:** ① `Cargo.toml`에 `panic = "unwind"` (abort 금지), ② LibRaw 호출 전 파일 헤더 sanity check (magic bytes, 파일 크기 > 1KB, `libraw_open_file` 리턴 코드 확인), ③ **`설정 > 고급 > 격리 디코딩 프로세스`** (기본 off, 크래시 반복 시 안내) — 별도 프로세스에서 디코딩 후 shared memory로 전달. `P2`.

**실패 UI:**
```
┌──────────────────────────────────────────┐
│              ⚠                           │
│      이미지를 불러올 수 없습니다            │
│                                          │
│  IMG_9999.CR2                            │
│  손상되었거나 지원하지 않는 형식입니다       │
│  (LibRaw: Unexpected end of file)        │
│                                          │
│  [세부 정보 복사]  [Finder에서 보기]       │
│                                          │
│  ← → 로 계속 탐색할 수 있습니다             │
└──────────────────────────────────────────┘
```
- 필름스트립의 해당 셀에 ⚠ 배지. **플레이리스트에서 제거하지 않는다** (사용자가 존재를 알아야 함).
- **방향키는 반드시 계속 동작해야 한다.**

**기타 실패 모드:**
| 상황 | 동작 |
|------|------|
| 파일이 열려 있는 중 삭제됨 | 토스트 + 다음 이미지 자동 이동 |
| 네트워크 볼륨 연결 끊김 | 5초 타임아웃 → `⚠ 볼륨에 접근할 수 없습니다` + 재시도 버튼 |
| 디스크 가득 (Export/캐시) | 명확한 에러 + 필요 용량 표시. **부분 파일 삭제** |
| GPU 컨텍스트 손실 (`webglcontextlost`) | preventDefault → `webglcontextrestored`에서 전체 리소스 재생성. 편집 상태 유지 |
| WebGL2 초기화 실패 | `⚠ GPU 가속 불가` + **CPU 렌더 폴백** (품질 동일, 느림). Linux 필수 |
| 셰이더 컴파일 실패 | 해당 패스 스킵 + 로그. 앱은 계속 |
| 캐시 DB 손상 | 백업 후 재생성. 편집값은 .xmp에서 복원 (§FR-10) |
| dnglab sidecar 없음/실패 | §FR-14.2 폴백 다이얼로그 |
| `.xmp` 파싱 실패 | `.xmp.bak`으로 백업 → 기본값 사용 + 토스트 |
| 극단적 파일 (100MP, 16bit TIFF 800MB) | 타일링(§3.5.2)으로 처리. 메모리 초과 시 L1만 + 배지 |

### 7.4 로깅 & 진단
- `tracing` + `tauri-plugin-log`. 파일: `~/Library/Logs/app.aetherlens/aetherlens.log`, 5MB × 3 로테이션.
- 레벨: 릴리스 `info`, `--debug` 플래그로 `trace`.
- `설정 > 고급 > 진단 정보 복사` → 클립보드에 시스템 정보 + 최근 로그 200줄 + GPU 정보 (`WEBGL_debug_renderer_info`).
- **개인정보 금지:** 로그에 전체 경로 대신 파일명만. GPS 좌표 로깅 금지.

### 7.5 바이너리 & 시작
| 지표 | 목표 |
|------|------|
| `.app` 번들 크기 | **≤ 40MB** (LibRaw + lcms2 + dnglab sidecar + Lensfun DB 포함) |
| DMG | ≤ 25MB |
| 콜드 스타트 → 윈도우 표시 | ≤ 400ms |
| 콜드 스타트 → 인터랙티브 | ≤ 700ms |

- Lensfun XML DB는 ~10MB → **zstd 압축 후 번들, 첫 사용 시 lazy 파싱 + 메모리 인덱스.**
- 프론트엔드 번들: code splitting. Leaflet은 메타 패널 열 때 dynamic import.

---

## 8. 테스트 & 수용 기준

### 8.1 테스트 코퍼스 ★ 이거 없이 개발 시작 금지

**출처: [raw.pixls.us](https://raw.pixls.us)** — CC0 라이선스 RAW 샘플. 기종별로 전부 있다.

**Tier 1 — 반드시 통과 (CI 게이트):**
| 기종 | 포맷 | 검증 포인트 |
|------|------|------------|
| Canon EOS R5 | CR3 | **CR3 컨테이너 (rawloader가 못 하는 이유)** |
| Canon EOS 5D Mark III | CR2 | 레거시 CR2 |
| Canon EOS R7 | CR3 | 크롭 센서 CR3 |
| Sony A7R IV | ARW | 61MP, 압축 ARW |
| Sony A1 | ARW | 무손실 압축 ARW |
| Nikon Z8 | NEF | 고효율 NEF (**신형 압축 — LibRaw 버전 의존**) |
| Nikon D850 | NEF | 레거시 NEF |
| **Fujifilm X-T5** | **RAF** | **★ X-Trans — 베이어가 아님. §3.3 별도 경로 필수** |
| **Fujifilm GFX 100** | **RAF** | **★ 102MP + X-Trans. 타일링(§3.5.2) 검증** |
| Panasonic S5 | RW2 | — |
| OM System OM-1 | ORF | — |
| Leica Q2 | DNG | 네이티브 DNG |
| iPhone 15 Pro | DNG | **ProRAW — OpcodeList 필수 적용 (§FR-8)** |
| Pentax K-3 III | PEF | — |
| **Leica M Monochrom** | **DNG** | **★ 모노크롬 — `filters == 0`, 데모자이킹 스킵** |
| **Sigma sd Quattro** | **X3F** | **★ Foveon — 미지원 배지 정상 표시 확인** |

**Tier 2 — 엣지 케이스:**
- 손상 파일 (정상 파일을 중간에서 truncate) × 3
- EXIF 없는 RAW
- GPS 있는 파일 / GPS 없는 파일
- 컬러 매트릭스 없는 파일 → `⚠ 프로파일 없음` 배지 확인
- 파일명에 이모지/한글/공백/`'`/`"` 포함
- 매우 긴 경로 (>255자)
- 심볼릭 링크 / 순환 링크
- 대소문자 혼합 확장자 (`.CR2`, `.cr2`, `.Cr2`)
- **10,000장 폴더** (합성 가능 — 같은 파일 복사)
- 네트워크 볼륨 (SMB/AFP)
- 읽기 전용 볼륨
- RAW+JPEG 페어 20쌍
- 100MP TIFF 16bit

**저장 위치:** `tests/fixtures/` (git-lfs). Tier 1 파일들은 리포지토리에 포함, Tier 2는 스크립트로 생성.

### 8.2 수용 기준 (Acceptance Criteria)

**필수 통과 — 하나라도 실패하면 릴리스 불가:**

```
◆ 기능
- [ ] Tier 1의 16개 기종 전부가 열리고, L0/L1/L2가 순서대로 표시된다
- [ ] X-Trans (X-T5, GFX100) 이미지에 격자 아티팩트가 없다
- [ ] 모노크롬 DNG가 컬러 노이즈 없이 흑백으로 표시된다
- [ ] Foveon X3F는 크래시 없이 "미지원 센서" 배지 + L0 표시
- [ ] 손상 CR2를 열어도 패닉 없이 에러 UI가 뜨고, ← → 로 계속 탐색 가능하다
- [ ] 편집 → 다음 사진 → 돌아오기 시 편집값이 그대로 남아 있다
- [ ] 편집 → 앱 종료 → 재시작 시 편집값이 그대로 남아 있다
- [ ] 원본 RAW 파일의 mtime과 blake3 해시가 모든 조작 후에도 변하지 않는다  ★R5
- [ ] ⌘Z가 슬라이더 드래그 1회를 정확히 1단계로 되돌린다 (100단계 아님)
- [ ] 휴지통 이동 후 ⌘Z로 복원되고, 리스트의 원래 위치에 돌아온다
- [ ] RAW 우클릭 → "이미지 복사" → Slack에 ⌘V 하면 편집 적용된 이미지가 붙는다
- [ ] "파일 복사" → Finder에 ⌘V 하면 원본 파일이 복사된다 (위와 다른 동작)
- [ ] Dock 아이콘 우클릭에 최근 10개가 뜨고, 현재 파일에 ● 또는 ✓ 표시가 있다
- [ ] Dock 메뉴 항목 클릭 시 앱이 포커스되고 해당 이미지로 이동한다
- [ ] Finder에서 CR2 우클릭 → "다음으로 열기 > AetherLens" 가 뜬다 (앱 미실행 상태)
- [ ] 앱 실행 중 다른 CR2를 Finder에서 더블클릭 → 새 창이 아니라 기존 창이 갱신된다
- [ ] GPS 있는 사진에서 OSM 미니맵에 마커가 뜬다
- [ ] GPS 없는 사진에서 미니맵 섹션이 숨겨진다 (에러 아님)
- [ ] DNG mosaic Export → Lightroom에서 열림 → 우리 보정값이 (근사로) 적용되어 있다
- [ ] DNG 미지원 기종에서 폴백 다이얼로그가 뜬다 (크래시/무반응 아님)
- [ ] .xmp를 Lightroom에서 열면 별점(xmp:Rating)이 정확히 일치한다  ★진짜 표준
- [ ] 우리가 쓴 .xmp를 다시 읽으면 EditState가 100% 동일하다 (aether:state round-trip)
- [ ] RAW+JPEG 페어가 stack 모드에서 1개 항목으로 표시된다

◆ 색상  ★가장 놓치기 쉬움
- [ ] AsShot WB로 연 이미지가 카메라 내장 JPEG(L0) 대비 ΔE00 < 5 (색상 체커 24패치 기준)
- [ ] 컬러 매트릭스 없는 기종에서 "⚠ 프로파일 없음" 배지가 뜬다 (조용히 틀린 색 금지)
- [ ] P3 디스플레이에서 sRGB JPEG의 채도가 과장되지 않는다 (Preview.app과 비교)
- [ ] Export한 JPEG에 ICC 프로파일이 임베드되어 있다 (exiftool -icc_profile:all 로 확인)
- [ ] 노출 +2EV 후 쉐도우에 밴딩이 없다 (16F 파이프라인 검증)  ★R3
- [ ] iPhone ProRAW DNG에서 OpcodeList가 적용되어 왜곡/비네팅이 보정된다

◆ 성능 (기준기: MacBook Air M1 8GB)
- [ ] 45MP CR3 파일 오픈 → L0 표시 ≤ 60ms
- [ ] L1 표시 ≤ 250ms · L2 ≤ 1.2s
- [ ] 노출 슬라이더 드래그 중 long-task 0건, 60fps 유지
- [ ] 45MP × 100장 폴더에서 방향키 30초 연타 → RSS ≤ 2.0GB, 단조 증가 없음
- [ ] 3회 왕복 후 RSS 증가 ≤ 10% (누수 없음)
- [ ] 10,000장 폴더: 첫 그림 ≤ 60ms, 스캔 완료 ≤ 3s, 필름스트립 60fps

◆ 호환성 / 견고성
- [ ] MAX_TEXTURE_SIZE = 8192로 강제한 환경에서 45MP가 정상 표시된다 (타일링)  ★
- [ ] EXT_color_buffer_float 없는 환경에서 흰 화면이 아니라 "저정밀 모드" 배지 + 정상 동작
- [ ] webglcontextlost 강제 발생 → 자동 복구, 편집 상태 유지
- [ ] 세로 사진(EXIF Orientation 6)이 눕지 않고 세로로 표시된다  ★
- [ ] 파일명 "여름 (바다) 사진 'test'.CR2" 같은 특수문자·이모지 파일명이 정상 처리된다
- [ ] Export 중에도 방향키 탐색이 60fps로 동작한다

◆ 라이선스  ★법적 리스크
- [ ] `cargo tree` 결과에 GPL/AGPL 크레이트가 0개다  ★R4
- [ ] LibRaw demosaic-pack이 링크되지 않았다 (AMaZE 심볼 부재 확인: nm/otool)
- [ ] 앱 내 "정보 > 라이선스" 화면에 LibRaw(CDDL-1.0), Lensfun DB(CC-BY-SA-3.0),
      OSM(ODbL) 저작자 표시가 모두 있다
- [ ] 지도에 "© OpenStreetMap contributors" attribution이 표시된다
```

### 8.3 자동화 테스트

| 레벨 | 도구 | 범위 |
|------|------|------|
| Rust 단위 | `cargo test` | XMP round-trip, crs: 매핑, EXIF 파싱, 컬러 매트릭스 수학, 자연 정렬, 페어링, 캐시 키 |
| Rust 통합 | `cargo test --test decode` | Tier 1 코퍼스 전체 디코딩 + 픽셀 체크섬 회귀 |
| 셰이더 | headless-gl 또는 Playwright | 각 패스의 알려진 입력 → 출력 픽셀 비교 (허용 오차 1/1024) |
| 프론트 단위 | Vitest | EditState 마이그레이션, 히스토리 코얼레싱, 키맵 |
| E2E | Playwright + `tauri-driver` | 열기 → 편집 → Export → 검증 시나리오 |
| 성능 회귀 | 커스텀 벤치 (`criterion` + tracing) | §7.1 지표를 CI에서 측정, **10% 이상 회귀 시 실패** |
| 메모리 | `cargo test --test memory` + `jemalloc` 통계 | 100장 왕복 후 RSS 검증 |
| 시각 회귀 | Playwright 스크린샷 diff | 각 프리셋 적용 결과 |

**골든 이미지:** Tier 1 각 기종의 L2 출력을 PNG16으로 저장 → 회귀 비교. 데모자이킹 알고리즘 변경 시 의도적으로 갱신.

---

## 9. 크로스플랫폼 추상화

> **원칙: 나중에 포팅하는 게 아니라, 처음부터 포팅 가능하게 짓는다.**
> Phase 1~3은 macOS만 구현하되, **trait과 `#[cfg]` 분기는 Phase 1부터 존재**해야 한다. Windows/Linux impl은 `todo!()` 대신 **`Err(AppError::NotSupportedOnPlatform)`** 을 반환한다 (패닉 금지, R6).

### 9.1 `trait Platform`

```rust
// platform/mod.rs
pub trait Platform: Send + Sync + 'static {
    // ── 최근 항목 / Dock
    fn note_recent_document(&self, path: &Path) -> Result<()>;
    fn set_recent_menu(&self, items: &[RecentItem], current: Option<&Path>) -> Result<()>;
    fn set_progress_badge(&self, progress: Option<f32>) -> Result<()>;
    fn request_attention(&self) -> Result<()>;

    // ── 클립보드  ★CF_DIB(Win) vs NSPasteboardTypePNG(mac) 격리
    fn copy_image(&self, png: &[u8], tiff: Option<&[u8]>) -> Result<()>;
    fn copy_files(&self, paths: &[PathBuf]) -> Result<()>;
    fn copy_text(&self, text: &str) -> Result<()>;

    // ── 파일 관리자
    fn reveal_in_file_manager(&self, path: &Path) -> Result<()>;
    fn open_with_app(&self, app: &ExternalApp, paths: &[PathBuf]) -> Result<()>;
    fn list_default_apps(&self, ext: &str) -> Result<Vec<ExternalApp>>;

    // ── 디스플레이
    fn display_color_space(&self) -> Result<ColorSpaceId>;
    fn display_icc_profile(&self) -> Result<Option<Vec<u8>>>;   // Phase 4

    // ── 샌드박스 (macOS MAS 대비. non-sandbox에선 no-op)
    fn create_bookmark(&self, path: &Path) -> Result<Vec<u8>>;
    fn resolve_bookmark(&self, data: &[u8]) -> Result<PathBuf>;
    fn start_access(&self, path: &Path) -> Result<AccessToken>;

    // ── 코덱 (OS 제공)
    fn decode_heic(&self, bytes: &[u8]) -> Result<DecodedImage>;

    // ── 휴지통
    fn move_to_trash(&self, paths: &[PathBuf]) -> Result<Vec<TrashToken>>;
    fn restore_from_trash(&self, token: &TrashToken) -> Result<PathBuf>;
}

#[cfg(target_os = "macos")]   pub type CurrentPlatform = macos::MacOsPlatform;
#[cfg(target_os = "windows")] pub type CurrentPlatform = windows::WindowsPlatform;
#[cfg(target_os = "linux")]   pub type CurrentPlatform = linux::LinuxPlatform;
```

### 9.2 플랫폼별 대응표

| 기능 | macOS (P0) | Windows (P1, Phase 4) | Linux (P2, Phase 4) |
|------|-----------|----------------------|---------------------|
| 최근 항목 UI | Dock 메뉴 (`applicationDockMenu:`) + `noteNewRecentDocumentURL` | **Jump List** (`ICustomDestinationList`) + `SetCurrentProcessExplicitAppUserModelID` | **없음** — 앱 내 메뉴만 |
| 체크마크 | `setState` + `●` 프리픽스 폴백 | `●` 프리픽스만 | — |
| 클립보드 이미지 | `NSPasteboardTypePNG` + `NSPasteboardTypeTIFF` | **`CF_DIBV5`** + `PNG` (등록된 포맷) | `image/png` target (X11 selection / wl-clipboard) |
| 클립보드 파일 | `NSFilenamesPboardType` | `CF_HDROP` | `text/uri-list` |
| 파일 관리자 | `NSWorkspace.activateFileViewerSelecting` | `explorer /select,` | `xdg-open` (선택 불가 — 폴더만) |
| 외부 앱 실행 | `NSWorkspace.openURLs(withApplicationAt:)` | `ShellExecuteW` | `gio open` / `.desktop` exec |
| 파일 연결 | `Info.plist` `CFBundleDocumentTypes` | 레지스트리 `HKCU\Software\Classes` | `.desktop` + `update-desktop-database` |
| 파일 열기 이벤트 | **`RunEvent::Opened`** (Apple Event) ★ | **CLI argv** (single-instance 경유) | CLI argv |
| 휴지통 | `NSFileManager.trashItem` (복원 가능) | Shell API (복원 가능) | XDG trash (**`trash` 크레이트가 복원 미지원 → ⌘Z 불가, 토스트 안내**) |
| 디스플레이 색공간 | `NSScreen.colorSpace` | DXGI `IDXGIOutput6::GetDesc1` | **미지원 → sRGB 가정** |
| HEIC | `CGImageSource` (OS 내장) | WIC (Win10 1809+, HEIF 확장 필요) | **libheif 없으면 미지원 배지** |
| 웹뷰 | WKWebView | **WebView2 (Chromium — 더 좋음)** | WebKitGTK (**문제 많음**) |
| GPU | WebGL2 (+WebGPU on macOS 26+) | WebGL2 + **WebGPU 양호** | WebGL2 불안정 |

### 9.3 Linux 특별 완화책 (Phase 4)
> **WebKitGTK는 GPU 작업에서 지뢰밭이다.** 지금 결정해 두지 않으면 나중에 "왜 Linux만 흰 화면?"으로 며칠 태운다.

```bash
# 런처 스크립트 / .desktop Exec 에 삽입 필요할 수 있음
WEBKIT_DISABLE_DMABUF_RENDERER=1      # NVIDIA 프로프라이어터리 드라이버에서 흰 화면 방지
WEBKIT_DISABLE_COMPOSITING_MODE=1     # 최후 수단 (GPU 가속 완전 포기)
```
- 앱 시작 시 WebGL2 컨텍스트 생성을 **3초 타임아웃**으로 시도 → 실패 시 자동으로 CPU 렌더 폴백 + 안내 배너.
- **CPU 렌더 폴백 경로는 Linux 때문에라도 반드시 구현한다.** (Rust에서 동일 수학을 rayon으로. 느리지만 정확해야 함 — 셰이더와 픽셀 단위 일치 검증)
- 배포: **AppImage 우선** (배포판 파편화 회피), Flatpak `P2`, `.deb`/`.rpm` `P2`.
- `libwebkit2gtk-4.1` 버전 파편화 → AppImage에 번들.

### 9.4 Windows 특이사항 (Phase 4)
- **WebView2는 Chromium** → WebGL2/WebGPU 모두 macOS보다 양호. **오히려 쉽다.**
- **긴 경로:** `\\?\` 프리픽스 필요 (>260자). Rust `std::fs`는 일부 처리하지만 FFI 경계에서 주의.
- **파일 잠금:** Windows는 열린 파일의 삭제/이름변경을 막는다 → 디코딩 후 즉시 파일 핸들 close 필수.
- **경로 대소문자 무시** → `content_key` 계산 시 경로 정규화 (`to_lowercase`) — macOS/Linux와 분기.
- 코드 서명: EV 인증서 없으면 SmartScreen 경고 → §12.

---

## 10. 라이선스 컴플라이언스 ★ 법적 리스크

> **최종 목표: AetherLens 자체 코드는 MIT.**

### 10.1 LibRaw — CDDL-1.0을 선택한다
- LibRaw는 **LGPL-2.1 / CDDL-1.0 이중 라이선스.** 사용자가 **하나를 선택**한다.
- **선택: CDDL-1.0.**
  - **이유:** CDDL은 **파일 단위 copyleft.** LibRaw 소스 파일을 수정하지 않는 한, **정적 링크해도 우리 코드는 MIT를 유지**한다. LGPL을 택하면 정적 링크 시 재링크 가능한 오브젝트 파일 제공 의무가 생겨 배포가 복잡해진다.
  - **조건:** ① LibRaw 소스를 **수정하지 않는다** (`vendor/libraw/`에 서브모듈, 무수정), ② 만약 수정하면 **그 파일만** CDDL로 공개, ③ 저작권 헤더 유지, ④ NOTICE에 CDDL-1.0 전문 포함.
- `Cargo.toml`에 `links = "libraw"` 명시. `build.rs`에서 bindgen.

### 10.2 rawler / dnglab — LGPL-2.1 → **sidecar 프로세스로 격리** ★
- `rawler` 크레이트는 **LGPL-2.1**. Rust 정적 링크는 LGPL의 재링크 요구와 충돌한다 (동적 링크가 사실상 불가).
- **해결: 프로세스 경계로 분리.** `dnglab` CLI를 **Tauri sidecar**(`externalBin`)로 번들하고, `std::process::Command`로 호출한다.
  - **프로세스 실행 = 링크 아님 → LGPL 전파 없음.** (FSF도 exec 경계는 별개 저작물로 본다)
  - `tauri.conf.json`: `"bundle": { "externalBin": ["binaries/dnglab"] }` — target triple 접미사 필요.
  - DNG Export는 지연에 민감하지 않다 (사용자가 명시적으로 누르는 액션) → 프로세스 스폰 오버헤드(~20ms) 무시 가능.
  - **NOTICE에 dnglab(LGPL-2.1) 명시 + 소스 URL 제공.** 수정 없이 그대로 번들하므로 추가 의무 없음.
- **`linear`/`linear-baked` DNG는 자체 writer** (§FR-14.2) → rawler 불필요.

### 10.3 절대 금지 목록 ★
| 라이브러리 | 라이선스 | 대체 |
|-----------|---------|------|
| **LibRaw-demosaic-pack-GPL2** (AMaZE, AFD, VCD, LMMSE) | GPL-2 | 베이스 LibRaw의 **AHD(3) / DCB(4) / DHT(11)** |
| **LibRaw-demosaic-pack-GPL3** | GPL-3 | 동상 |
| **exiv2 / rexiv2 / gexiv2** | GPL-2 | **`kamadak-exif`** (BSD-2) |
| **lensfun (C 라이브러리)** | LGPL-3 | **XML DB만 읽고 수식 자체 구현** (§FR-8) |
| **dcraw** (원본) | 모호/비표준 | LibRaw |
| **ImageMagick** (일부 구성) | 별도 | `image` 크레이트 |
| **libraw + GPL pack 통합 빌드 (일부 배포판 패키지)** | GPL-2 감염 | **직접 빌드.** 시스템 libraw 링크 금지 |

> **★ 함정:** Homebrew/apt의 `libraw` 패키지는 배포판에 따라 GPL demosaic-pack이 포함된 빌드일 수 있다. **반드시 `vendor/libraw/` 서브모듈에서 직접 빌드하고, 빌드 플래그로 GPL pack을 명시적으로 제외한다.**

**검증 (CI 게이트 후보):**
```bash
cargo deny check licenses          # deny.toml에 GPL/AGPL 전면 금지
nm -gU target/release/aetherlens | grep -i amaze   # 결과 있으면 실패
```

### 10.4 저작자 표시 의무 (앱 내 `정보 > 라이선스`)
| 대상 | 라이선스 | 의무 |
|------|---------|------|
| LibRaw | CDDL-1.0 | 라이선스 전문 + 저작권 표시 |
| dnglab / rawler | LGPL-2.1 | 라이선스 전문 + **소스 획득 방법 명시** |
| **Lensfun DB** | **CC-BY-SA-3.0** | **★ 저작자 표시 필수.** "Lens profiles from the Lensfun project (CC BY-SA 3.0)" + DB 수정 시 동일 조건 공유 |
| **OpenStreetMap 타일** | **ODbL** | **★ 지도에 "© OpenStreetMap contributors" 상시 표시.** 지우면 라이선스 위반 |
| Nominatim (역지오코딩) | ODbL + 사용 정책 | 초당 1요청 + User-Agent + 캐시 |
| lcms2 | MIT | 저작권 표시 |
| Rust 크레이트 전체 | 각종 | `cargo-about`로 `licenses.html` 자동 생성 → 앱에 번들 |
| React/Leaflet 등 npm | 각종 | `license-checker`로 생성 |

**빌드 스텝에 포함:** `cargo about generate about.hbs > src/assets/licenses.html`

### 10.5 특허 관련
- **CR3/ARW 등 독자 RAW 포맷의 리버스 엔지니어링**은 LibRaw 측의 문제이며, 우리는 라이브러리 사용자다.
- **DNG는 Adobe가 특허 라이선스를 무료로 부여**한다 (DNG Specification Patent License). 자체 DNG writer 작성에 문제 없음.
- **AVIF/AV1**: AOMedia 특허 풀 — 로열티 프리.
- **JPEG XL**: 로열티 프리.
- **HEIC/HEVC**: ★ 특허 이슈 있음. → **OS 제공 디코더만 사용** (macOS `CGImageSource`, Windows WIC). 자체 libde265 번들 금지.

---

## 11. 구현 마일스톤

> 각 Phase는 **독립적으로 동작하는 빌드**를 산출한다. Phase N이 끝나면 실제로 써볼 수 있어야 한다.

### Phase 0 — 기반 (선행 필수)
```
[ ] Tauri 2 + Vite + React + TS(strict) + Tailwind 스캐폴딩
[ ] vendor/libraw 서브모듈 + build.rs bindgen + GPL pack 제외 빌드 플래그
[ ] cargo-deny / deny.toml (GPL 전면 금지)  ★R4를 처음부터 강제
[ ] ts-rs 파이프라인 (Rust struct → TS interface 자동 생성)
[ ] tracing 계측 + 성능 오버레이 스켈레톤
[ ] platform trait + MacOsPlatform 스텁 (Windows/Linux는 NotSupported 반환)
[ ] tests/fixtures/ 에 Tier 1 코퍼스 배치 (git-lfs)
[ ] aether:// 프로토콜 등록 + 더미 응답  ★R1을 처음부터 강제
검증: 빈 창이 뜬다. cargo deny 통과. aether://ping 이 응답한다.
```

### Phase 1 — 뷰어 코어 (제품의 근간)
```
[ ] LibRaw FFI + catch_unwind 가드 (§7.3)
[ ] L0/L1/L2 progressive decode (§3.1)  ← ★이게 제품의 심장
[ ] aether:// 픽셀 서빙 (바이너리)
[ ] WebGL2 백엔드 + RGBA16F + 확장 체크 + 폴백
[ ] 컬러 매니지먼트 전체 경로 (§3.2)  ← ★생략하면 나중에 전면 재작업
[ ] 렌더 그래프 패스 ① ④ ⑧ (WB/매트릭스 → BaseCurve → Output)
[ ] EXIF Orientation (§3.8)
[ ] 디렉토리 스트리밍 스캔 + 자연 정렬 (§FR-1)
[ ] 방향키 네비 + 프리로드 정책 (§3.6) + backpressure
[ ] 디스크 캐시 (§3.7)
[ ] 줌/팬, Fit/100%
[ ] 에러 UI (§7.3)
검증: Tier 1 16기종 전부 열림. L0 ≤60ms. 45MP 100장 연타 시 RSS ≤2GB.
     세로 사진이 세로로 보인다. 색이 카메라 JPEG과 비슷하다 (ΔE<5).
     ★ 이 시점에 "그냥 빠른 뷰어"로서 이미 쓸 만해야 한다.
```

### Phase 2 — 편집 엔진
```
[ ] 렌더 그래프 전체 패스 ①~⑧ (§3.4) + 더티 트래킹 + 패스 스킵
[ ] 타일링 + MAX_TEXTURE_SIZE 대응 (§3.5.2)  ★
[ ] 편집 해상도 = 화면 해상도 전략 (§3.5.1)  ★60fps의 열쇠
[ ] 기본 보정 슬라이더 전체 (§FR-3)
[ ] 히스토그램 + 클리핑 + 스포이드 (§FR-9)
[ ] 톤 커브 (§FR-4) · HSL (§FR-5)
[ ] 디테일: 샤프닝 + NR + ISO 자동 (§FR-7)
[ ] 크롭/회전/기하 (§FR-6)
[ ] Undo/Redo + 코얼레싱 (§FR-11)
[ ] 영속성: 사이드카 XMP + SQLite (§FR-10)  ★
[ ] Before/After 비교 (§FR-17.2)
검증: 슬라이더 60fps. ⌘Z 정확. 편집 후 재시작 시 유지. 원본 해시 불변(R5).
     MAX_TEXTURE_SIZE=8192 강제 환경에서 45MP 정상.
```

### Phase 3 — 워크플로우 & 통합
```
[ ] 필름스트립 (가상화, 아틀라스) (§FR-17.1)
[ ] 별점/플래그/라벨 + 필터 (§FR-17.3)
[ ] 프리셋 시스템 + XMP 이중 네임스페이스 (§FR-12) + 번들 프리셋 10종
[ ] 설정 복사/붙여넣기 + Auto Sync (§FR-13)
[ ] Export: 래스터 전체 포맷 + ICC + 워터마크 + 파일명 템플릿 (§FR-14.1)
[ ] Export: DNG (mosaic/linear) + dnglab sidecar + 폴백 UX (§FR-14.2)
[ ] 배치 Export (§FR-14.3)
[ ] 컨텍스트 메뉴 + 스마트 복사 + 휴지통 (§FR-15)
[ ] 메타데이터 패널 전체 필드 (§FR-16.2)
[ ] OSM 미니맵 + 타일 캐시 (§FR-16.3)
[ ] ExifTool 연동 (§FR-16.4)
[ ] 렌즈 보정 Lensfun (§FR-8)
[ ] Dock 통합 + 최근 항목 (§FR-18)
[ ] 파일 연결 + RunEvent::Opened + 싱글 인스턴스 (§FR-19)
[ ] 파일 감시 (§FR-1.7) + RAW+JPEG 페어링 (§FR-1.6)
[ ] 설정 화면 + 커맨드 팔레트 + i18n(ko/en) + 접근성 (§FR-20)
[ ] 라이선스 화면 (cargo-about)
검증: §8.2 수용 기준 전체 통과. ★ macOS v2.0 출시 가능 상태.
```

### Phase 4 — 확장
```
[ ] WindowsPlatform 구현 (Jump List, CF_DIBV5, 레지스트리, 긴 경로)
[ ] LinuxPlatform 구현 + AppImage + WebKitGTK 완화책 (§9.3)
[ ] CPU 렌더 폴백 (셰이더와 픽셀 일치 검증)
[ ] WebGPU 백엔드 (compute shader 히스토그램/NR)
[ ] 모니터 ICC 프로파일 전체 적용
[ ] 그리드 뷰 (§FR-17.4)
[ ] 로컬 보정 (마스크/브러시/그라디언트)
[ ] 다중 윈도우
[ ] 격리 디코딩 프로세스 (§7.3)
[ ] JPEG XL · 역지오코딩 · TAT · 히스토리 패널 · 단축키 리매핑
```

---

## 12. 보류 — 별도 논의 필요 ⏸

> **아래 항목은 이 PRD의 범위 밖이다. 구현하지 말 것.** Phase 3 완료 시점에 사용자와 별도 논의 후 추가 PRD를 작성한다.

### 12.1 CI/CD 및 배포 (사용자 요청에 따라 명시적 보류)
```
⏸ GitHub Actions 워크플로우 (matrix build: macOS arm64/x64, Windows x64, Linux x64)
⏸ macOS 코드 서명 (Developer ID Application) + notarization (notarytool)
   ※ 알아둘 것: 서명/공증 없이 배포하면 macOS에서 "손상되었습니다" 로 실행 자체가 안 된다.
     Apple Developer Program($99/년) 필요. 이 결정 없이는 배포 불가.
⏸ Windows 코드 서명 (EV 인증서 — 없으면 SmartScreen 경고)
⏸ Tauri Updater (업데이트 서버, 서명 키 관리, 롤백 전략)
⏸ 릴리스 채널 (stable / beta / nightly)
⏸ 크래시 리포팅 (Sentry / 자체 수집 — 개인정보 정책 필요)
⏸ 텔레메트리 / 사용 통계 (opt-in 여부, GDPR)
⏸ 자동 성능 회귀 게이트 (셀프호스트 러너 필요 — GitHub 러너는 성능 편차가 커서 무의미)
⏸ Homebrew Cask / winget / AUR / Flathub 배포
⏸ 앱 아이콘 · 브랜딩 · 랜딩 페이지
⏸ Mac App Store 배포 (→ 샌드박스 필수 → security-scoped bookmarks 전면 적용 필요)
```

**Phase 0~3 동안의 임시 방편 (이것만 구현):**
- 로컬 빌드: `npm run tauri build`
- 개발 중 테스트: `xattr -cr AetherLens.app` (Gatekeeper 우회, 개발자 본인 기기에서만)
- `cargo deny check licenses`는 **Phase 0부터 로컬 pre-commit 훅으로** 강제 (§10.3)

### 12.2 기타 보류
```
⏸ 로컬 보정 (마스크/브러시/선형·방사형 그라디언트/AI 피사체 선택)
⏸ 파노라마 / HDR 병합
⏸ 테더링 촬영 (카메라 직접 제어 — libgphoto2는 LGPL-2.1 → sidecar 필요)
⏸ 클라우드 동기화 / 계정
⏸ 플러그인 시스템 (WASM 기반 커스텀 필터?)
⏸ 커스텀 카메라 프로파일 (DCP 파일 읽기/생성)
⏸ 프린트 모듈 / 소프트 프루핑
⏸ 자체 타일 서버 (OSM 사용량 초과 시)
```

---

## 13. Open Questions (구현 중 발견 시 여기에 추가)

> AI 구현자에게: 스펙에 없는 결정을 내려야 할 때 **여기에 항목을 추가하고, 코드에 `// SPEC-GAP:` 주석을 남긴 뒤 가장 보수적인 선택**을 한다. 아키텍처를 임의로 바꾸지 않는다.

### 13.1 알려진 미해결 항목

| # | 질문 | 잠정 결정 | 재검토 시점 |
|---|------|----------|-----------|
| Q1 | Adobe crop 좌표계(회전 후 정규화)와 우리 좌표계의 정확한 대응 | 단위 테스트로 실측 후 확정. 불일치 시 `aether:state` 우선, `crs:Crop*`는 미기록 | Phase 3 |
| Q2 | `baseCurve='standard'`의 정확한 스플라인 제어점 | 초기값: Adobe 기본 커브를 색상 체커로 근사 피팅 (`(0,0) (0.25,0.22) (0.5,0.5) (0.75,0.78) (1,1)`), 이후 튜닝 | Phase 1 |
| Q3 | `wb.temp`의 AsShot K값 역산 정확도 | Planckian locus 이분 탐색. 카메라 표시값과 ±200K 이내면 통과 | Phase 2 |
| Q4 | 45MP+ 에서 `readPixels`(f16) 성능 (Export 경로) | 타일 단위 + `PIXEL_PACK_BUFFER` 비동기 readback. 느리면 Rust CPU 렌더로 전환 | Phase 3 |
| Q5 | OSM 타일 사용량이 정책 한도를 넘을 경우 | 사용자 100명까지는 캐시로 충분. 초과 시 MapTiler(무료 티어) 또는 자체 서버 | 출시 후 |
| Q6 | Nikon 신형 고효율 NEF의 LibRaw 지원 범위 | LibRaw 0.21+ 확인. 미지원 시 해당 기종 Tier 1에서 제외 + 배지 | Phase 0 |
| Q7 | Fuji GFX 102MP의 메모리 예산 (2GB 초과 가능) | 타일링 + L1 우선. 초과 시 `⚠ 고해상도 모드` 배지 + L2 비활성 | Phase 2 |
| Q8 | `trash` 크레이트의 Linux 복원 미지원 | ⌘Z 시 토스트 `이 플랫폼에서는 휴지통 복원을 지원하지 않습니다` | Phase 4 |
| Q9 | Foveon(X3F) 지원 여부 재검토 | v2.0 미지원. 사용자 요청 많으면 LibRaw의 X3F 경로 조사 | 출시 후 |

### 13.2 사용자 확인 필요 (Phase 3 완료 후)
1. **CI/CD 및 코드 서명** — §12.1. **Apple Developer Program 가입 여부**가 배포 가능성을 좌우한다.
2. **앱 이름 최종 확정** — `AetherLens`는 가칭. 번들 ID `app.aetherlens`도 함께 결정 필요.
3. **오픈소스 공개 여부** — MIT 공개 시 §10의 NOTICE 정리 + 서브모듈 정리 필요.
4. **로컬 보정 우선순위** — Phase 4의 어느 위치에?

---

## 부록 A. v1.1 대비 변경 요약

| 영역 | v1.1 | v2.0 |
|------|------|------|
| **IPC** | `Decoded RGB Buffer → React` (JSON) | **`aether://` 커스텀 프로토콜 (바이너리)** ★성능 목표 달성 가능해짐 |
| **컬러** | **언급 없음** | 카메라 매트릭스 → linear Rec.2020 → P3/sRGB 전 경로 명시 ★ |
| **디코딩** | "`rawloader` **또는** LibRaw" | **LibRaw 확정** (rawloader는 CR3 미지원) |
| **프록시** | 없음 (1단계) | **L0/L1/L2 3단계** ★체감 속도의 전부 |
| **비트 심도** | 미지정 | **RGBA16F 확정** (8bit는 밴딩) |
| **GPU** | "WebGL/WebGPU" | **WebGL2 베이스라인 + WebGPU 선택적** (WKWebView 제약) |
| **프리로드** | "앞뒤 2장" | **비대칭 + 레벨 강등 + 취소** (앞뒤 2장 = 1.35GB → 램 폭발) |
| **캐시** | 없음 | **SQLite + zstd 프록시 디스크 캐시** |
| **타일링** | 없음 | **MAX_TEXTURE_SIZE 대응 필수** ★없으면 8192 GPU에서 아예 안 됨 |
| **XMP** | "LR/C1 호환" | **C1은 crs:를 안 읽는다 → 문구 삭제.** LR은 근사. **이중 네임스페이스** |
| **데모자이킹** | 미지정 | **AHD/DCB/DHT** (AMaZE는 GPL → 금지) + **X-Trans 별도 경로** ★ |
| **영속성** | **없음** | 사이드카 XMP + SQLite ★ |
| **Undo** | **없음** | Immer patch 스택 + 코얼레싱 ★ |
| **히스토그램** | 다이어그램에만 | 전체 스펙 + 클리핑 + 스포이드 |
| **크롭/기하** | **없음** | 전체 스펙 |
| **샤프닝/NR** | **없음** | 캡처 샤프닝 + ISO 자동 NR ★없으면 "카메라 JPEG보다 흐림" |
| **Orientation** | **없음** | EXIF flip 필수 ★없으면 세로 사진이 누움 |
| **Dock API** | `native_toc_menu` (**존재하지 않는 API — 환각**) | **objc2 `applicationDockMenu:`** + `●` 프리픽스 폴백 |
| **클립보드** | `CF_DIB` (**Windows 포맷인데 macOS 스펙에**) | `NSPasteboardTypePNG`/`TIFF`, platform trait로 격리 |
| **파일 열기** | `fileAssociations`만 | **+ `RunEvent::Opened`** ★Finder 더블클릭은 argv로 안 옴 |
| **성능 기준** | "45MP 1.5초" (기준기 없음) | **MacBook Air M1 8GB / R5 CR3 명시** |
| **라이선스** | LibRaw 언급만 | **CDDL 선택 · GPL 금지 목록 · dnglab sidecar 격리 · CC-BY-SA/ODbL 의무** ★ |
| **테스트** | 없음 | raw.pixls.us Tier 1/2 코퍼스 + 수용 기준 체크리스트 |
| **크로스플랫폼** | 미고려 | `trait Platform` + 대응표 (Phase 4 구현, 구조는 Phase 1부터) |

---

## 부록 B. 빠른 참조 — 절대 하지 말 것

```
✗ 픽셀 버퍼를 invoke 리턴값으로 보내기                    → aether:// 프로토콜 (§2.3)
✗ sRGB 감마 값에 직접 노출/대비 곱하기                     → 선형 공간 변환 후 (§3.2)
✗ RGBA8 텍스처로 편집 파이프라인                          → RGBA16F (R3)
✗ LibRaw output_color = 1(sRGB)로 설정                    → 0(raw). 색 변환은 우리가 (§3.1)
✗ use_camera_wb = 0                                      → 1. 안 그러면 전부 초록빛
✗ no_auto_bright = 0                                     → 1. 톤은 우리가 결정
✗ AMaZE 데모자이킹                                        → GPL 감염. AHD/DCB/DHT (§10.3)
✗ X-Trans에 half_size=1                                   → Markesteijn + 다운샘플 (§3.3)
✗ exiv2 / rexiv2 / lensfun C 라이브러리                    → kamadak-exif / XML 직접 파싱
✗ 시스템 libraw 링크 (GPL pack 포함 가능)                  → vendor 서브모듈 직접 빌드
✗ 원본 RAW에 쓰기                                         → 사이드카 .xmp (R5)
✗ fs::remove_file                                        → trash 크레이트 (§FR-15.3)
✗ unwrap() / expect() (디코딩 경계)                        → Result + catch_unwind (R6)
✗ 45MP 텍스처를 통째로 texImage2D                          → 타일링 (§3.5.2)
✗ 45MP 셰이더를 매 프레임                                  → 화면 해상도 버퍼 (§3.5.1)
✗ "앞뒤 2장 프리로드"                                      → 레벨별 비대칭 (§3.6)
✗ gl.deleteTexture 생략 (GC가 해줄 거라 믿기)              → WebGL 리소스는 GC 대상 아님
✗ 셰이더 8개를 하나로 합치기                               → FBO ping-pong (§3.4)
✗ 타일 오버랩 없이 컨볼루션                                 → 32px 오버랩 (seam 방지)
✗ 커브 보간에 Catmull-Rom                                 → monotone cubic (오버슈트 방지)
✗ 샤프닝 후 NR                                            → NR 먼저 (§3.4 패스 ⑥)
✗ 뷰포트 배경 흰색/검정                                    → 중성 회색 #3C3C3C (§FR-20.3)
✗ 셔터를 0.004s로 표기                                     → 1/250s (§FR-16.2)
✗ 사전순 정렬 (IMG_10 < IMG_2)                            → 자연 정렬 (§FR-1.4)
✗ fileAssociations rank: "Owner"                          → "Alternate" (기본 앱 가로채기 금지)
✗ tauri::App::native_toc_menu                             → 존재하지 않는 API. objc2 (§FR-18.2)
✗ CF_DIB를 macOS에서                                      → NSPasteboardTypePNG (§FR-15)
✗ OSM attribution 제거                                    → ODbL 위반 (§10.4)
✗ CI/CD · 코드 서명 구현                                   → §12. 별도 논의 후
```

---

**문서 끝 · AetherLens PRD v2.0**
