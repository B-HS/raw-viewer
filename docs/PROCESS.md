# PROCESS — raw-viewer 구현 진행 상황

> **프로젝트명 = raw-viewer** (사용자 확정, 2026-07-15). PRD 문서 내 "AetherLens"는 문서상 가칭(§13.2)으로만 남기고 코드·번들 식별자는 전부 raw-viewer 기준: npm `raw-viewer`, cargo `raw-viewer`/`raw_viewer_lib`, identifier `app.raw-viewer`. `aether://` URI 스킴 등 PRD가 정의한 아키텍처 명칭은 스펙 그대로 유지.

> ai-process §2 규칙에 따른 세션 간 연속성 문서. 매 스텝마다 체크 상태를 갱신한다.

## 기준 문서
- [docs/PRD.md](./PRD.md) — **확정 스펙 v2.0.** 모든 구현 판단의 단일 출처. 절대 규칙 R1~R7 준수.
- `~/.claude/convention/*.md` — 코드 컨벤션 (arrow-fn only, 주석 금지(JSDoc·SPEC-GAP 예외), 타입 유도 등)
- `~/personal-llm/*.md` — 개인 작업 규칙 (커밋 author 단독, 요청 전 커밋 금지 등)

## 환경 (확정)
| 항목 | 값 |
|------|-----|
| 기기 | macOS 15.7.3 arm64 (Apple Silicon) |
| Rust | 1.95.0 |
| Node | 22.14.0 / pnpm 10.6.2 |
| 프로젝트 루트 | `/Users/gkn/raw-viewer` (= PRD의 `aetherlens/` 루트) |

## 결정 로그 (사용자 이의 시 재검토)
1. **패키지 매니저 = bun (사용자 확정 지시, 2026-07-15).** 처음 pnpm으로 셋업했다가 사용자 지시로 bun 전환. `bun install` / `bun run dev|build|tauri`. esbuild postinstall은 `trustedDependencies`로 허용. tauri.conf의 before*Command도 bun.
2-0. **git 운용 (사용자 지시, 2026-07-15 오후):** 원격 = `https://github.com/B-HS/raw-viewer` (B-HS 계정, gh 인증 확인). 메인 브랜치 = **prod**, **dev** 분리, feature 브랜치 → dev → prod 흐름. **phase마다 commit/push.** 커밋: Conventional Commits(type 영어·설명 한국어), author = Hyunseok Byun 단독, Co-Authored-By/Claude 트레일러 절대 금지(커밋 후 `git log --format='%B' | grep -i 'co-author\|claude'`로 검증). Phase 0~3b는 소급 분리가 불가능해 baseline 커밋 1개로 시작(3b 통합 검증 후), 이후 phase별 feature 브랜치. gitignore: vendor/·binaries/·fixtures/는 스크립트(sync-vendor·fetch-fixtures·NOTICE 기재 dnglab URL)로 재현하므로 미추적.
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
### 3b 잔여 (미착수)
프리셋(FR-12)+동기화(FR-13) · Export 래스터/DNG/배치(FR-14, dnglab sidecar) · 스마트 복사/클립보드(FR-15, platform macOS 구현) · RAW+JPEG 페어링(FR-1.6) · Dock(FR-18) · 파일연결/싱글인스턴스(FR-19) · 렌즈보정(FR-8) · ExifTool(FR-16.4) · 설정·커맨드팔레트·i18n·접근성(FR-20) · 라이선스 화면(cargo-about)

## Phase 4 (미착수)
PRD §11 체크리스트를 그대로 따른다.

## SPEC-GAP 로그
- (build.rs) libjpeg 미링크: LibRaw의 lossy-JPEG 압축 DNG·일부 내장 썸네일 디코딩 불가 가능. Phase 1 L0 구현 시 재평가.

## 다음 세션 시작점
1. 이 문서와 docs/PRD.md §0(절대 규칙)·§11(마일스톤), phase1~3a 계약 문서 재확인.
2. Phase 3a 워크플로(wf_0bb60c34-2bd) 결과 통합·검증 → 3b 웨이브(프리셋·Export·클립보드·Dock·파일연결 등) 계약 작성 후 진행.
3. 사용자 지시: 중단 지시 전까지 Phase 경계에서 멈추지 않고 연속 진행. 시각 검증(실렌더)은 사용자 재석 시 수행.
