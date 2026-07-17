# PROCESS — raw-viewer 구현 진행 상황

> **프로젝트명 = raw-viewer** (사용자 확정, 2026-07-15). PRD 문서 내 "AetherLens"는 문서상 가칭(§13.2)으로만 남기고 코드·번들 식별자는 전부 raw-viewer 기준: npm `raw-viewer`, cargo `raw-viewer`/`raw_viewer_lib`, identifier `app.raw-viewer`. `aether://` URI 스킴 등 PRD가 정의한 아키텍처 명칭은 스펙 그대로 유지.

> ai-process §2 규칙에 따른 세션 간 연속성 문서. 매 스텝마다 체크 상태를 갱신한다.

## 기준 문서
- [docs/PRD.md](./PRD.md) — **확정 스펙 v2.0.** 모든 구현 판단의 단일 출처. 절대 규칙 R1~R7 준수.
- `~/.claude/convention/*.md` — 코드 컨벤션 (arrow-fn only, 주석 금지(JSDoc·SPEC-GAP 예외), 타입 유도 등)
- `~/personal-llm/*.md` — 개인 작업 규칙 (커밋 author 단독, 요청 전 커밋 금지 등)

## 환경 (확정 — 2026-07-16 신규 머신 이전)
| 항목 | 값 |
|------|-----|
| 기기 | macOS 26.5.2 arm64 (Apple Silicon) |
| Rust | 1.97.0 (rustup, `~/.cargo/bin` — 셸 프로필 미수정) |
| Bun | 1.3.14 (Node 24.18.0 병존) |
| libomp | Homebrew(정적 libomp.a 링크 — 없으면 LibRaw가 OpenMP 없이 빌드되어 X-Trans 병렬화 무효) |
| 프로젝트 루트 | `/Users/hyunseokbyun/development/raw-viewer` (= PRD의 `aetherlens/` 루트) |

신규 클론 복원 절차: `bun install` → rustup → `brew install libomp` → `scripts/sync-vendor.sh` → `scripts/sync-lensfun.sh` → dnglab v0.7.2를 `src-tauri/binaries/dnglab-aarch64-apple-darwin`에 배치(NOTICE.md URL) → `scripts/fetch-fixtures.sh`(tier1 16종, 약 600MB).

## 결정 로그 (사용자 이의 시 재검토)
1. **패키지 매니저 = bun (사용자 확정 지시, 2026-07-15).** 처음 pnpm으로 셋업했다가 사용자 지시로 bun 전환. `bun install` / `bun run dev|build|tauri`. esbuild postinstall은 `trustedDependencies`로 허용. tauri.conf의 before*Command도 bun.
2-0. **git 운용 (사용자 지시, 2026-07-15 오후, 같은 날 보완):** 원격 = `https://github.com/B-HS/raw-viewer` (B-HS 계정, gh 인증 확인). 메인 브랜치 = **prod**, **dev** 분리. **워크플로(웨이브) 완료 시마다 검증 후 dev에 자동 commit/push. prod 병합은 사용자 허락을 받아서만 수행.** feature 브랜치는 웨이브 단위로 사용 후 dev에 머지. 커밋: Conventional Commits(type 영어·설명 한국어), author = Hyunseok Byun 단독, Co-Authored-By/Claude 트레일러 절대 금지(커밋 후 `git log --format='%B' | grep -i 'co-author\|claude'`로 검증). Phase 0~3b는 소급 분리가 불가능해 baseline 커밋 1개로 시작(3b 통합 검증 후), 이후 phase별 feature 브랜치. gitignore: vendor/·binaries/·fixtures/는 스크립트(sync-vendor·fetch-fixtures·NOTICE 기재 dnglab URL)로 재현하므로 미추적.
2. ~~git 미초기화 상태 유지~~ (해제됨 — 위 2-0). 과거 결정 기록:
   - PRD Phase 0의 "vendor/libraw 서브모듈" → **LibRaw 공식 릴리스 tarball을 `src-tauri/vendor/libraw/`에 무수정 전개**로 대체. git init 후 서브모듈 전환 예정.
   - "tests/fixtures git-lfs" → fetch 스크립트로 대체 (`scripts/fetch-fixtures.sh`).
   - "cargo deny pre-commit 훅" → git init 후 설치. 그 전까지는 수동/문서화.
3. **Tauri 플러그인은 사용 시점에 도입.** Phase 0은 플러그인 0개(로깅은 tracing 직접 사용). single-instance·window-state·dialog·store·opener·log·fs·deep-link는 해당 FR 구현 Phase에서 추가.
4. **LibRaw 빌드: `cc` 크레이트로 소스 직접 컴파일** (configure/make 미사용 — 소스 트리 오염 방지, cargo 환경 내 해결). Makefile.dist 정본 목록 75개 .cpp, `USE_ZLIB`만 정의, libjpeg 미링크(→ lossy-DNG 등 일부 썸네일/포맷 제약, Phase 1에서 재평가. SPEC-GAP). `LIBRAW_NOTHREADS` 채택(Makefile.dist 기본 libraw.a와 동일) — 멀티스레드 디코드 풀 도입 시 재진입 빌드 재검토.
4-1. **벤더 지속 업데이트 메커니즘 (사용자 지시, 2026-07-15):** 일회성 벤더링 금지. 버전·sha256을 `src-tauri/libraw.pin`에 고정하고 `scripts/sync-vendor.sh`가 재현(fetch→sha256 검증→GPL pack 부재·LICENSE.CDDL 확인→원자적 교체→`.vendored` 스탬프)한다. 업데이트는 `scripts/sync-vendor.sh --update <버전>`으로 pin 갱신 → `cargo test` + `cargo deny`로 검증. `vendor/`는 gitignore — pin+스크립트가 재현의 단일 출처라 CI/CD에서 그대로 호출 가능. GitHub Actions 워크플로 자체는 여전히 §12 보류(스크립트 레이어만 준비).
5. **아이콘 = 자리표시자.** §12.1에 따라 브랜딩 보류. python 스크립트로 생성한 단색 1024px PNG → `tauri icon`.
6. **eslint 미도입(Phase 0).** 컨벤션 검증은 prettier 설정 + tsc + 훅. 도입 여부는 사용자와 논의.

## Phase 0 — 기반 (진행 중)
- [x] 환경 확인 (toolchain·네트워크)
- [x] 기준 문서 저장 (docs/PRD.md)
- [x] Tauri 2 + Vite + React + TS(strict) + Tailwind 스캐폴딩 (bun) — cargo test 5건·bun run build 통과
- [x] vendor/libraw 0.21.5 + build.rs(cc 75파일 + bindgen 0.71) + GPL pack 부재 확인 + FFI 스모크(version/probe) — `libraw.pin` + `scripts/sync-vendor.sh`로 재현/업데이트 가능
- [x] cargo-deny 0.20.2 / src-tauri/deny.toml — permissive 15종 allow, GPL/AGPL/LGPL 미허용, `licenses ok` (417 crates, 0 errors)
- [x] ts-rs 파이프라인 (cargo test → src/types/*.ts 생성) — AppError·PendingOpenRequest 생성 확인
- [x] tracing 계측 + 성능 오버레이 스켈레톤 (EnvFilter + PerfOverlay 스텁)
- [x] platform trait + MacOsPlatform 스텁 (§9.1 전체 시그니처, NotSupported 반환)
- [x] tests/fixtures Tier 1 — `scripts/fetch-fixtures.sh` (raw.pixls.us 16종, 전부 CC0, HEAD 2건 검증. iPhone 15 Pro는 미보유라 iPhone 12 Pro ProRAW로 대체) + `scripts/make-tier2-fixtures.sh` + README. **다운로드는 Phase 1 시작 전 실행 필요**
- [x] aether:// 프로토콜 등록 + ping 응답 (유닛 3건 + tauri dev 실기동으로 webview→Rust 왕복 확인)
- [x] 검증 완료 (2026-07-15, rename 후 재검증): `cargo test` 7건 통과 · `bun run build`(tsc+vite) 통과 · `cargo deny check licenses` ok · `tauri dev` 창 표시 + frontend_ready invoke + aether://ping 수신 로그 확인

**Phase 0 완료.** 잔여(다음 세션): Tier 1 코퍼스 실제 다운로드(`scripts/fetch-fixtures.sh`, 약 500MB+), git init 여부 사용자 결정(→ pre-commit cargo-deny 훅, 커밋 시작).

## Phase 1 — 뷰어 코어 (진행 중)

> **사용자 지시 (2026-07-15): 중단 지시가 있을 때까지 Phase 경계에서 멈추지 말고 연속 진행.**
> 병렬 구현 계약: [docs/phase1-contract.md](./phase1-contract.md) (모듈 소유권·디코드 API·AETH 포맷·커맨드/이벤트 동결)

- [x] Tier 1 코퍼스 다운로드 (scripts/fetch-fixtures.sh, 백그라운드)
- [x] Phase 1 IPC 타입 동결 (types.rs → ts-rs 재생성, 테스트 14건)
- [x] R1: LibRaw 디코드 코어 — L0/L1/L2, catch_unwind+RAII, X-Trans(filters==9)·모노크롬 분기, cam_xyz→Rec2020(전 픽스처 cam_xyz 경로 성공), user_flip=0으로 이중회전 방지
- [x] R2: scan 스트리밍(16파일)·우선순위 큐+취소+backpressure·픽셀 스토어(1.5GB LRU)·디스크 캐시(blake3+zstd l0/l1)·aether:// 픽셀 서빙·커맨드/이벤트 (테스트 49건)
- [x] F: WebGL2 렌더그래프(①④⑧, RGBA16F, display-p3 감지, EXT_color_buffer_float 폴백)·AETH 파싱·뷰포트(fit/100%/팬/orientation)·자연정렬·rAF 코얼레싱 네비·에러 UI·드래그앤드롭
- [x] 통합 검증: cargo test 49건 + bun run build 통과 + **tauri dev E2E 실기동** — RAW_VIEWER_OPEN 콜드스타트 훅으로 5D3 열기 → 스캔 16 → L0 2ms(목표 60ms) → aether l0 fetch → 이웃 L0 프리로드 → L1 1.4s(debug) → aether l1 fetch 확인
- [ ] Phase 1 잔여: 16기종 전부 UI 오픈 육안 확인, 세로 사진(iphone flip=6) 렌더 확인, 색 근사 육안 — Phase 2 통합 시 함께

**Phase 1 코어 완료.** 발견 사항/이월:
- (수정 배정: Phase 2 P) navigate 중복 호출 시 같은 (id,level) in-flight 중복 디코드 (L1 3회 관측)
- (조치함) X3F는 USE_X3FTOOLS 미정의로 open 불가였음 → build.rs에 define 추가 (재빌드로 L0 지원 검증 필요)
- (이월) X-Trans L1이 debug+단일스레드에서 44s — release 빌드 + 스레딩 전략(OpenMP 대안) 재평가 필요 (P2 목표 250ms)
- (이월) 모노크롬 DNG는 JPEG 썸네일 부재 → L0 없음 (L1로 첫 표시. UI 허용 확인 필요)
- (이월) Bradford D50 전체 경로, 캐시 10GB LRU+index.sqlite, bicubic 축소 필터, LibRaw progress 콜백 취소, `⌘O` 파일 다이얼로그(dialog 플러그인)

## Phase 2 — 편집 엔진 (진행 중)
계약: [docs/phase2-contract.md](./phase2-contract.md) · EditState 타입 동결(types.rs → TS 26종)
- [x] EditState §5.1 타입 + ts-rs 생성 · immer 추가 · rusqlite/base64 의존성
- [x] P: catalog(sqlite WAL, 마이그레이션 구조)·XMP 사이드카(aether:state zstd19+b64, crs 근사, R5 가드)·edit 커맨드(메모리 즉시/catalog 2s/xmp 10s, navigate·종료 flush)·ISO 자동 초기값(probe_iso)·pipeline pending-set dedup 픽스 — 테스트 89건
- [x] G: GL 패스 ①~⑧ 전체·더티트래킹(무연산 중립값 기준)·화면해상도 전략·타일링(2048+32)·EngineApi 동결 시그니처·히스토그램 워커·상대 WB 모델 — 단, GPU 부재 환경이라 셰이더 실렌더 미검증 명시
- [x] U: editStore(immer patches, 500ms 디바운스+Conflict 재로드)+historyStore(드래그 코얼레싱)·패널 전체·SVG 톤커브·크롭 오버레이·J/⇧J/⌥J·\ Before·⇧Y 스플릿·W 스포이드·기본값 JSON 동등성 검증
- [x] 통합: cargo test 89건 + bun run build 통과 + tauri dev 실기동(픽셀 서빙 정상·패닉 0·원본 해시 불변·무단 사이드카 없음)
- [ ] **시각 검증 미완**: 실기동 시점에 화면 잠금이라 스크린캡처 불가 — 실렌더 확인(라이트/다크·슬라이더 체감·크롭 UI)은 보류. 완료 단언하지 않음.

Phase 2 SPEC-GAP: WB=AsShot(6500,0) 상대 모델(Planckian Q3→Phase 3), highlightRecovery 근사, ToneCurve/crop/HSL crs: 매핑 Phase 3, 비RAW hotPixelRemoval true 유지(렌더 무효), 외부 사이드카 2~10s 창 레이스(희귀), reset=initial(ISO NR 포함) 복귀.

## Phase 3 — 워크플로우 & 통합 (진행 중)
### 3a (계약: docs/phase3a-contract.md)
- [x] 의존성: kamadak-exif·trash·notify·plugin-dialog/opener(+capabilities 배선)·react-virtual·leaflet
- [x] M: ImageMetadata(§5.2)+get_metadata(exif+probe_metadata 병합, 5D3/iPhone GPS 실측 스냅샷)·organize(catalog 002+xmp 병합, reject=crs:Rating=-1)·휴지통(사이드카 동반, registry/스토어 정리)·notify 감시(200ms coalesce)·fs:changed — 테스트 122건
- [x] V: 필름스트립(가상화+L0 img)·등급 키+필터바·메타 패널+OSM 미니맵·컨텍스트 메뉴·⌘O·감시 연동·상태바
- [x] 통합 검증: cargo test 122건·bun run build·tauri dev 실기동·**스크린샷 시각 확인**(iPhone DNG 세로 렌더 정상, 히스토그램/슬라이더/필름스트립/필터바/상태바 표시, 색 자연스러움 — 다크/라이트 토글 및 조작감은 사용자 확인 필요)

**3a PRD 이탈 기록**: ① macOS `trash` 크레이트는 복원 API 미지원 → 휴지통 ⌘Z 복원 불가(Finder '되돌려 놓기' 안내로 대체, Phase 4에서 objc2 NSFileManager 경로 재검토) ② lens.mount·driveMode·stabilization·hasOpcodeList·iccProfileName은 ExifTool 통합(FR-16.4) 전까지 None ③ iPhone ProRAW(linear DNG)는 sensorType=unknown
### 3b (계약: docs/phase3b-contract.md) — **완료, dev 반영(31473c8)**
> 차단 버그 해결: Bayer L1/L2 렌더 깨짐의 근본 원인은 **build.rs의 LIBRAW_NOTHREADS** — LibRaw 비트리더(getbithuff)·AHD LUT가 프로세스 전역 static이 되어 병렬 디코드에서 상호 오염(비결정적, iPhone 정상은 요행). 조치: 정의 제거(인스턴스 TLS), 캐시 키에 CACHE_SCHEMA_VERSION 혼입으로 오염된 L1 디스크 캐시 무효화, 격리-vs-동시 바이트 동일성 회귀 테스트(5D3·X-T5·모노) 추가. cargo test 185. 수정 후 동시 디코드 덤프 PNG 육안 검증 정상. 결정 로그 4의 LIBRAW_NOTHREADS 채택은 폐기.
- [x] X: Export 엔진 — export_begin/tile(raw body)/finish/cancel, 4포맷 전부 ICC 임베드, linear Lanczos3, little_exif(GPS는 어떤 모드도 미기록), 파일명 템플릿, dnglab v0.7.2 sidecar(macOS arm64 릴리스) — 테스트 184건
- [x] Q: 프리셋(003 마이그레이션, 8섹션 마스크, 번들 10종 시드) + copy_settings — EditService 영속 경로 탑승
- [x] W: ExportDialog·PresetPanel·exportRenderer(타일 interior 전송)·⌘⇧C/V/⌘⌥V·⌥1~9
- [x] 검증: cargo test 184 + bun run build + prettier 통과
- [ ] **차단 버그(통합 중 발견)**: Bayer RAW(5D3) L1/L2 뷰포트 렌더 깨짐 — iPhone linear DNG는 정상, 마진 포함 raw 치수(5796×3870) 표기로 보아 **processed 치수 vs payload 치수 불일치(row stride)** 유력. 3b 이전부터 존재(Bayer 파일 시각 검증 이번이 처음). 디버그 에이전트 진행 중. **해결·재검증 후 dev 커밋/푸시.**

### 3c (계약: docs/phase3c-contract.md) — **완료, dev 반영(13ecc05)**
- [x] PL: objc2 실구현(NSPasteboard PNG+TIFF 스마트복사·파일/텍스트·Finder·open-with·recents)·Dock 메뉴(델리게이트 무교체 class_addMethod 주입, ● 점 표시)·파일연결(rank=Alternate)·Opened 콜드스타트 큐·싱글인스턴스·RAW+JPEG 페어링(get_pairs)·recents(004) — 테스트 206
- [x] T: ExifTool(감지+subprocess 3s deep metadata)·라이선스 화면(cargo-about → resources/licenses-rust.html, NOTICE 합성)·캐시 통계/삭제
- [x] FE: 설정 화면(언어/테마/뷰포트 배경/성능/캐시, plugin-store)·커맨드 팔레트(퍼지)·i18n ko/en 전수 치환·스마트 복사(⌘C, 4096 상한)·페어 배지·reduced-motion
- [x] 통합: cargo test 206 + bun run build + 실기동(패닉 0). 시각 확인은 화면 잠금으로 보류(사용자 재석 시)
- 3c SPEC-GAP: Dock setState 체크마크 미시도(점 표시 고정), open-with 편집본 TIFF는 3d로, 클립보드 TIFF 무압축(메인스레드 히치 가능), fileAssociations 이미지 그룹 mimeType `image/*` 제거(부적합 와일드카드)

### 3d (계약: docs/phase3d-contract.md) — **완료, dev 반영(fb2bb96·2ec6712)**
- [x] LN: Lensfun v0.3.95(pin+sync, CC-BY-SA 고지) 파싱 카메라 751·렌즈 952, 매칭(토큰 스코어·mount 호환·crop 게이트 0.96)·초점 선형보간·비네팅 IDW(3.5), override(005) — 테스트 241
- [x] DX: DNG tag700 주입(EOF append+IFD 재작성 — 기존 오프셋 불변, 재파싱+meta 검증, 원자 rename) 실측 라운드트립(aether:state 100% 복원)·프리셋 .xmp IO·open_with_edited
- [x] FL: gl 패스② 렌즈 보정(poly3/poly5 Newton·ptlens 사전스케일·TCA·pa 비네팅 선형 곱)·LensSection·프리셋 IO UI·편집 적용본 TIFF 외부 열기
- [x] 통합: cargo test 241 + bun run build + 실기동(패닉 0). 시각 확인 보류(화면 잠금)
- 3d SPEC-GAP: 보간은 선형(lensfun 4점 Hermite 대비 3점+ 시 미세 편차), subjectDistance 기본 1000, DNG OpcodeList 우선 규칙(FR-8) 미구현, aperture 미상 시 비네팅 없음

### 3e (계약: docs/phase3e-contract.md) — **완료, dev 반영(c77cd48)**
- [x] QA: perf 하니스(release)·run-acceptance.sh(12/12 PASS)·docs/quality-assurance/phase3-acceptance.md(§8.2 45항목: 자동통과 9·수동 35·성능 미달 1)
- [x] P1: 워터마크(raw body + OETF 후 합성)·배치 실패 요약/재시도·필름스트립 높이 드래그·Y 비교 나란히
- [x] deny.toml IJG/NCSA 허용(permissive — R4 무관), licenses ok 복구
- **성능 실측(M4 Pro/48GB — M1 기준기보다 유리)**: L0 전 기종 ≤2ms ✓ · **L1 목표 250ms 광범위 초과(R5 410ms)** · **X-Trans L1 13.4s**(half_size가 X-Trans에 무효, 풀해상도 단일스레드 Markesteijn — PRD §3.3 지정 방식의 내재 한계) · L2는 Bayer ✓ / X-Trans·GFX100 ✗
- 기타: nikon-z8 고효율 NEF에 LibRaw "data corrupted" 경고(디코드는 완료 — 육안 재검증 필요)

### 3f — **완료, dev 반영(5bafcb4)**
- [x] OpenMP 정적 링크(libomp.a, LIBRAW_FORCE_OPENMP, 미탐지 시 무OpenMP 빌드 폴백): **R5 L1 410→166ms(목표 250 통과)** · GFX100 L2 4070→**1156ms 통과** · 5D3 L2 735→433ms. 바이너리 dylib 의존 0(otool 검증), 동시성 게이트 249 그린
- [x] X-Trans는 Markesteijn OMP 타일 경계 비결정성 실측(스케줄 의존) → **디코드당 단일 스레드 핀**(결정성 유지, 13.4s 유지 — 병렬 시 2.16s 가능)
- [x] 그리드 뷰(G)·히스토리 패널(⌘⌥Z, jumpTo)·단축키 리매핑(38액션 레지스트리+녹화+충돌감지)
- 3f 후속: 워커×내부OMP 오버서브스크립션 튜닝, Bayer L2 재현성 필요 시 동일 핀, GFX100은 X-Trans가 아니라 Bayer 중형(문서 정정 — quality-assurance 반영 필요), 줌/팬 키는 리매핑 제외(GL 소유), 크롭 도구·숫자키 패밀리 fixed

### 결정 반영 (2026-07-16 사용자 확정)
1. **X-Trans 병렬화 = 게이트 완화 후 병렬 (완료, dev 952e1b9)**: 핀 제거 → X-T5 L1 13447→2139ms·L2 13417→2056ms(6.3~6.5×). 게이트는 X-Trans만 절대오차 8/1023(실측 양성 피크 0.0052의 1.5×) 허용, Bayer/모노 바이트 동일성 유지, 15라운드 안정. openmp-report.md §6.
2. **prod 병합 승인 → 실행 완료**: origin/prod = 21c1333 (Phase 0~4b + X-Trans 병렬화).
3. personal-llm 기록 = 생략(사용자).
- 잔여 미달: X-T5는 병렬화 후에도 L1 250/L2 1200 목표 미달(40MP 풀해상도 Markesteijn 자체 한계) — 기준기(M1)에선 더 김. 추가 개선은 bilinear 프록시 전환뿐(품질 트레이드오프, 미채택).

## Phase 4 (진행 중)
### 4a — **완료, dev 반영(c6f93c9)**
- [x] C4: Rust CPU 렌더러(①③④⑤⑦⑧, rayon) — TS 원본→bun 패리티 벡터(LUT 바이트 일치, WB/색공간 1e-3), aether `pixels/{id}/cpu`(AETH u8) + cpu:frame-ready, 5D3@2048px 25~51ms — 테스트 277
- [x] D4: WebGL2 실패 폴백 뷰(강제 플래그 rawviewer.forceCpuRender)·TAT·샘플러 핀(5개)·히스토그램 호버
- 4a SPEC-GAP: CPU 경로는 ②기하/렌즈·⑥NR/샤프닝 미지원, 비-RAW 미지원, 출력 sRGB 고정, 오버레이류 없음
### 4b — **완료, dev 반영(40ec75a)**
- [x] 격리 디코딩(__decode 서브커맨드, 크래시 루프 감지→배너, 기본 off) · 성능 설정 배선(preloadRadius/l2Policy/isolatedDecode — 3c 부채 해소) · 역지오코딩(Nominatim 정책 준수, 기본 off) — 테스트 297
- 후속: 격리 디코드 통합테스트가 스위트를 40분까지 늘림 → #[ignore] 게이팅 또는 nextest 분리 필요

### 4c — **완료, dev 반영(90a8b19)**
- [x] MW: 다중 윈도우 — 윈도우별 내비/idle 상태, union 취소 정책, open_in_new_window(생성 전 큐잉), window-* capability, Destroyed 정리, 설정·컨텍스트 메뉴 배선 — 테스트 304 (수동 확인 절차는 MW 보고 §수동 검증 참조)
- [x] IC: 모니터 ICC — NSColorSpace ICC → lcms2 33³ LUT(relative colorimetric) → pass8 트라이리니어(기본 off) · JXL은 순수 Rust 인코더 미성숙으로 이월(docs/quality-assurance/jxl-assessment.md)
- [x] 격리 디코드 왕복 테스트 게이팅(--ignored + 수용 스크립트 명시 실행) — 기본 스위트 ~77s
- 정정: "스위트 40분"은 X-Trans 병렬화 이전 수치였음(이미 해소)
- 4c SPEC-GAP: PixelStore current 슬롯 단일(다중 윈도우 극한 메모리 압박 시 비활성 창 current evict 가능), EditService on_navigate 단일 current(조기 flush 무해), 다중 윈도우 런타임 검증은 수동 필요

### 유지보수 — **완료, dev 반영(2026-07-16)**
- [x] 신규 머신 환경 복원(위 환경 표·복원 절차) + GitHub 언어 통계 정정 — 생성 파일(licenses-rust.html·licenses-npm.json·ts-rs `src/types/`·lock)을 `.gitattributes` linguist-generated, `about.hbs` vendored, `src/types/`는 `.prettierignore` 제외
- [x] 보안: CSP 명시(`default-src 'self'` 기반 + devCsp, 디버그 번들 기동 후 `frontend ready` 로그로 스모크 검증) · `open_with_external`/`open_with_edited`의 `app_path`를 `ensure_app_bundle`로 검증(테스트 3건) · aether 프로토콜 CORS를 웹뷰 오리진으로 한정 · opener capability를 사용처 기준 축소(reveal + 지도 URL 2종 scope)
- [x] 구조: historyStore↔editStore 순환을 `connectHistoryTarget` 주입으로 해소 · keymap↔settings 순환은 `shortcuts/resolve.ts` 분리로 해소 · `i18n/index.ts` barrel → `i18n/i18n.ts` · store 조작 액션(smartCopy·trash)을 `src/actions/`로 재배치(lib은 순수 유틸만) · gl 공용 타입 `gl/viewTypes.ts` 분리(type-only 순환 해소)
- [x] 컨벤션: 추론 가능한 명시 반환 타입 26곳 제거(재귀 `gcd`·튜플 반환·`replaceRootPatches`/`buildLensPass` 등 컨텍스트 타이핑 필수 7곳은 유지) · 매직넘버 상수화 · Filmstrip/GridView 선택 로직 `components/listSelection.ts` 공통화 · localStorage `JSON.parse as` 3곳 unknown+가드 전환
- [x] Rust: clippy 경고 전체 해소(0건) · 이벤트 채널명 리터럴을 `events.rs` 상수로 집중
- [x] 배포 파이프라인 (사용자 지시, 2026-07-16): GitHub Actions — CI(PR·수동: prettier→tsc→clippy→test→빌드) + Release(`v*` 태그: 버전 일치 검증→검증→`tauri build`→DMG draft 릴리스). 서명·공증은 시크릿 존재 시 자동 활성화(무시크릿이면 무서명 DMG). `scripts/fetch-dnglab.sh` 신설(로컬·CI 공용). 상세·시크릿 목록은 [docs/release.md](./release.md)
- 잔여 결정 사항: `read_watermark_png`·export 출력 경로는 dialog 경유 전제(커맨드 자체는 경로 무제한 — persisted-scope 도입 여부는 추후 결정) · `store:default` 스코프 축소 미적용 · 오류 삼킴(`catch {}`) 패턴은 기존 정책 유지

### 비-RAW 공통 포맷 디코드 — **완료 (2026-07-18, 사용자 버그 리포트로 착수)**
- [x] FR-1.3 일반 포맷: `decode/common.rs` 신설 — jpg/jpeg/png/webp/tif/tiff/bmp/gif(첫 프레임)는 `image` 크레이트, heic/heif/avif는 macOS ImageIO(`platform/macos/imageio.rs`, CGImageSource→sRGB CGBitmapContext, objc2-image-io 추가). `decode::extract_thumb/decode_half/decode_full`에서 확장자 라우팅 — 파이프라인·캐시·격리 디코드·CPU 폴백 전부 무수정 통과.
- [x] 색: sRGB EOTF 역변환(`color::srgb_eotf`로 승격, cpurender는 위임) → linear f16 버퍼 + `cam_to_rec2020 = sRGB→Rec2020 행렬`(`color::rec2020_from_srgb_linear_matrix`). 기존 셰이더/편집 체인이 RAW와 동일하게 동작. 16bpc PNG/TIFF는 16비트 경로 유지, 알파는 검정 합성.
- [x] EXIF orientation → LibRaw flip 코드 매핑(kamadak-exif; 미러 계열은 회전으로 근사). L0(512px JPEG q85)는 회전을 굽고 업스케일 금지. ImageIO 경로는 transform 옵션으로 자체 회전.
- [x] 검증: 유닛 7건(선형화·다운샘플·알파·orientation·썸네일·webp·heic[sips 왕복]) + 실바이너리 `__decode` e2e로 jpg/png/heic/avif × L0/L1/L2 전부 확인.
- SPEC-GAP: 비-RAW 임베디드 ICC(P3 JPEG 등)는 image-크레이트 경로에서 sRGB 가정(ImageIO 경로는 sRGB로 색변환됨). AVIF irot/imir 회전 미반영(EXIF만). 애니메이션 webp/gif는 첫 프레임.

### 4 잔여
WebGPU(macOS 26+ 필요 — 현 머신 26.5.2로 **진행 가능해짐**, 착수는 사용자 지시 대기) · Windows/Linux platform(하드웨어 필요) · 로컬 보정(§12.2 별도 논의) · CI/CD·코드서명(§12.1 보류)

## Phase 5 — 뷰어 완성도·건전성·고도화 (진행 중, 2026-07-18 착수)

> 사양의 단일 출처: [docs/phase5-contract.md](./phase5-contract.md). 사용자 지시: 멈추라 할 때까지 연속 진행. 각 항목 완료 시 검증(부록 B) 통과 후 체크.

### A. 정확성 결함
- [x] A1. 비-RAW 임베디드 ICC 처리 — image `into_decoder().icc_profile()` → sRGB 태그는 고속 경로, 그 외 lcms2 Transform(RGB_8/16→RGB_FLT, 소스 ICC→rec2020 linear 프로파일)로 버퍼 직접 변환 + identity 행렬. 실패 시 sRGB 폴백(warn). 테스트: rec2020-linear ICC 임베드 PNG(비순환 검증)·P3 적색(R>0.70) — 9건 통과
- [ ] A2. 오류 삼킴 선별 정리 (전수 조사 → 부록 A 기록 → (b)(c) 지점 수정)

### B. 빠진 기능
- [x] B1. 정렬 기준 선택 — SortKey 5종+방향(설정 저장), ImageEntry에 modifiedMs·fileSize, 촬영일시는 probe_capture_dates 지연 로딩(수동 EXIF datetime 파서+테스트), rating은 organize 구독. lib/sortEntries 순수 분리
- [x] B2. 플래그 내비게이션 cmd+←/→ (keymap+App, i18n)
- [x] B3. RAW+JPEG 페어 토글 — cmd+J (PRD의 alt+J는 클리핑 검사 J계열이 선점, SPEC-GAP: 바인딩 변경). register_image 커맨드+엔트리 스왑 방식
- [x] B4. 줌 배율 표시 (StatusBar, zoomRatio 공용화, 클릭 fit/100% 토글)
- [x] B5. 전체화면 (KeyF, toggle_fullscreen 커맨드, UI 숨김, onResized 동기화)
- [x] B6. 배치 Export — raster는 기존 구현 확인(shift+cmd+E 선택 전체, 진행/취소/재시도 완비. 평가 오판 정정), DNG 일괄(runDngBatch) 추가
- [x] B7. 슬라이드쇼 (KeyS, 설정 간격 1-30s, 마지막 장 자동 정지, 전체화면 연동, 키 입력 시 해제)
- [ ] B8. 파일 조작 — 이름 변경·이동·복사 (image_id 이관 설계 선행 확인)
- [ ] B9. 자동 업데이트 (updater 플러그인 + latest.json + 서명키 — 개인키는 사용자 등록 필요)
- [x] B10. 애니메이션 GIF/WebP 재생 — aether original/{id} 라우트(gif·webp 화이트리스트+CORS, 테스트), isAnimated(gif 상시·webp VP8X 플래그, 테스트), Viewport img 분기+배지

### C. 엔지니어링 건전성
- [x] C1. 프론트 테스트 — bun test src (sortEntries·keymap·filter 17건 115 어서션), typecheck·test·lint 스크립트, CI 편입
- [x] C2. eslint 10 flat config — tseslint+react-hooks v7(컴파일러 규칙 내장), function/enum 금지 규칙, 에러 0. set-state-in-effect·refs 경고 31건은 후속 정리 항목(아래)로 이관
- [ ] C3. E2E 스모크 (__e2e 서브커맨드, CI 편입)
- [x] C4. PRD §11 체크리스트 정정 — 완료 53건 [x] 반영, 잔여 [ ]는 실제 미구현 4건(Windows·Linux·WebGPU·로컬보정)만

- [ ] C2-후속. react-hooks compiler 경고 31건(set-state-in-effect·refs) 컴포넌트별 정리 — 동작 리팩토링이라 시각 검증과 병행 필요

### D. 고도화
- [ ] D1. 비-RAW L0 고속화 (JPEG EXIF 썸네일 우선)
- [ ] D2. 필름스트립 아틀라스 — 측정 선행, 병목일 때만 구현 (측정 결과 기록)
- [x] D3. WebGPU 조사 문서 (docs/webgpu-assessment.md — 웹뷰 WebGPU 권장, 히스토그램 compute 우선, 3단 폴백)
- [x] D4. 로컬 보정 스키마 초안 (docs/local-adjustments-draft.md — LocalAdjustment 타입·렌더 통합·미결 4건. §12.2 보류 유지, 구현 안 함)
- [x] D5. Windows/Linux — 하드웨어 부재로 차단 확정. platform trait·CI 매트릭스 여지는 준비됨(기록만)

### Phase 3 검증 잔여
§8.2 수동 35항목(사용자 재석 — quality-assurance 문서 참조) · Z8 고효율 NEF 육안 검증 · CPU 폴백·그리드·TAT 등 신규 UI 시각 확인

## Phase 4 (미착수)
PRD §11 체크리스트를 그대로 따른다.

## SPEC-GAP 로그
- (build.rs) libjpeg 미링크: LibRaw의 lossy-JPEG 압축 DNG·일부 내장 썸네일 디코딩 불가 가능. Phase 1 L0 구현 시 재평가.

## 다음 세션 시작점
1. 이 문서와 docs/PRD.md §0(절대 규칙)·§11(마일스톤) 재확인. Phase 4c까지 dev 반영 완료, 2026-07-16 유지보수(보안·구조·컨벤션 정비)도 dev 반영 완료.
2. 남은 트랙: Phase 4 잔여(WebGPU — 현 머신에서 가능) · Phase 3 수동 검증 35항목(사용자 재석) · 유지보수 잔여 결정 사항(persisted-scope·store 스코프).
3. 사용자 지시: 중단 지시 전까지 Phase 경계에서 멈추지 않고 연속 진행. 시각 검증(실렌더)은 사용자 재석 시 수행.
