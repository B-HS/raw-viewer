# PROCESS — raw-viewer 작업 상태 (세션 연속성 단일 진입점)

> **프로젝트명 = raw-viewer** (사용자 확정, 2026-07-15). 표시명은 **"Raw Viewer"**(Info.plist, 2026-07-18 — 파일·식별자는 raw-viewer 유지). PRD 내 "AetherLens"는 문서상 가칭 — 코드·번들 식별자는 전부 raw-viewer(`app.raw-viewer`), `aether://` 스킴 등 아키텍처 명칭은 스펙 유지.
> ai-process §2 규칙에 따른 세션 간 연속성 문서. 매 스텝마다 체크 상태를 갱신한다. 완료 이력이 쌓이면 docs/history/ 로 이관한다.
> Claude 외 에이전트는 루트 [AGENTS.md](../AGENTS.md)부터 읽는다.

## 새 세션 시작 순서

1. 이 문서 전체 → 아래 "현재 상태 스냅샷"과 "남은 작업"으로 상황 파악.
2. [docs/architecture-backend.md](./architecture-backend.md) · [docs/architecture-frontend.md](./architecture-frontend.md) — 코드를 재탐색하지 않고 구조·계약·함정을 파악.
3. [docs/acknowledge/decisions.md](./acknowledge/decisions.md) — 사용자 결정 전체(왜 이렇게 돼 있는지). 결정을 재질문하지 않는다.
4. 필요 시: [docs/release.md](./release.md)(배포·시크릿·캐시 워밍), docs/bug/(과거 버그 원인·교훈), docs/history/(완료 이력 상세).

## 문서 지도

| 문서 | 내용 |
|------|------|
| [PRD.md](./PRD.md) | **확정 스펙 v2.0** — 모든 구현 판단의 단일 출처. 절대 규칙 R1~R7. §11 체크리스트는 실제 상태 반영됨 |
| [architecture-backend.md](./architecture-backend.md) | Rust 백엔드 모듈맵·디코드 파이프라인(워커 레인·OMP 캡·preload_l0)·색 계약·커맨드/이벤트 전수·함정 |
| [architecture-frontend.md](./architecture-frontend.md) | 프론트 디렉토리맵·스토어 전수·렌더 경로(WebGL2/WebGPU/CPU)·단축키 시스템·함정 |
| [acknowledge/decisions.md](./acknowledge/decisions.md) | 사용자 결정 시간순 전체 |
| [release.md](./release.md) | CI/릴리스 파이프라인·캐시 워밍·시크릿 현황·릴리스 절차·자동 업데이트 |
| [i18n.md](./i18n.md) | 다국어(한/영/일) 구조·번역 PR 기여 절차 |
| [phase6-contract.md](./phase6-contract.md) | WebGPU 백엔드 계약 — 6a~6i 전부 구현·수치 패리티 18벡터 ALL PASS, 시각 검증만 잔여 |
| [phase5-contract.md](./phase5-contract.md) | Phase 5 구현 계약(완료) + 부록 A: 오류 삼킴 전수 분류 |
| phase1~3e-contract.md | 과거 Phase 구현 계약(완료) |
| [webgpu-assessment.md](./webgpu-assessment.md) / [local-adjustments-draft.md](./local-adjustments-draft.md) | WebGPU 사전 조사(phase6로 계승) / 로컬 보정 초안(미착수) |
| bug/ | 버그별 증상·원인·해결·교훈 (release dylib, close 권한, Open With 크래시, 슬라이드쇼 자체 취소, 디코드 CPU 초과구독) |
| history/ | 완료 이력 아카이브 — [phases-0-4-complete.md](./history/phases-0-4-complete.md)(Phase 0~5), [2026-07-18-quality-waves.md](./history/2026-07-18-quality-waves.md)(v0.5.0~v0.5.2 웨이브 상세) |
| quality-assurance/ | 수동 검증 체크리스트([v0.5.0-manual-checklist.md](./quality-assurance/v0.5.0-manual-checklist.md) 진행 중, §8.2 35항목, 필름스트립 실측)·JXL 평가 |

## 기준 문서 (규칙)
- `~/.claude/convention/*.md` — 코드 컨벤션 (arrow-fn only, 주석 금지(JSDoc·SPEC-GAP 예외), 타입 유도, React Compiler 전제 등)
- 커밋: Conventional Commits(type 영어·설명 한국어), author = Hyunseok Byun 단독, Co-Authored-By/AI 트레일러 절대 금지, `git add -A` 금지(선별 스테이징), force push 금지.
- git: dev에서 작업, 웨이브 완료 시 검증 후 dev push. prod 병합·릴리스 태그는 확립된 흐름([release.md](./release.md) 절차 — **워밍 완료 후 태그**)을 따른다.
- 검증 사다리(종료 전 필수): `bunx tsc --noEmit` → `bun run lint` → `bun test src` → `cargo test`(src-tauri) → i18n 키 diff(en/ko/ja 일치) → 필요 시 실기동 스모크(tauri dev 생존·패닉 0, WebGPU 변경 시 parity.html 하니스).

## 환경 (2026-07-16 신규 머신 이전)
| 항목 | 값 |
|------|-----|
| 기기 | macOS 26.5.2 arm64 (M5 Max, 논리코어 18) — WebGPU 요건 충족 |
| Rust | 1.97.0 (rustup, `~/.cargo/bin` — 셸 프로필 미수정, `export PATH="$HOME/.cargo/bin:$PATH"` 필요) |
| Bun | 1.3.14 (Node 24.18.0 병존) |
| libomp | Homebrew — 정적 libomp.a 링크 (`export LIBOMP_PREFIX="$(brew --prefix libomp)"` 권장). 런타임 팀 크기는 main.rs가 OMP_NUM_THREADS=4로 캡 |
| 프로젝트 루트 | `/Users/hyunseokbyun/development/raw-viewer` |
| gh CLI | 인증됨 (계정 B-HS) |
| 실사진 테스트 폴더 | `/Volumes/SSD/202309 osaka/DCIM/100CANON` (CR2 153장, 사용자 허가) |

신규 클론 복원: `bun install` → rustup → `brew install libomp` → `scripts/sync-vendor.sh`(libraw) → `scripts/sync-lensfun.sh` → `scripts/fetch-dnglab.sh` → `scripts/fetch-fixtures.sh`(tier1 16종 약 600MB, 테스트용).

## 현재 상태 스냅샷 (2026-07-18 심야 기준)

- **저장소**: 공개(public), MIT. dev=prod 동기화.
- **최신 릴리스**: **v0.5.3 = 첫 공개(published) 릴리스** (2026-07-18, "Raw Viewer 0.5.3" — 영문 릴리스 노트+스크린샷). 자산명은 점 표기(`Raw.Viewer_0.5.3_aarch64.dmg`·`Raw.Viewer.app.tar.gz`)이며 latest.json·자산 URL 200 확인 — **자동 업데이트 엔드포인트 라이브**(기설치 v0.5.2가 0.5.3을 감지해야 함 → 왕복 실검증 가능). v0.1.1~v0.5.2 draft는 의도적 유지.
- **README.md 작성 완료**(영문·히어로 스크린샷 docs/assets/screenshot.jpg·기능 요약·설치·단축키) — prod 반영.
- **시크릿**: Apple 서명·공증 5종 + `TAURI_SIGNING_PRIVATE_KEY` 등록 완료. updater 개인키 = `~/raw-viewer-updater.key`(재생성 금지·**백업은 아직 사용자 미완**).
- **테스트**: Rust 324건 + 프론트 bun test 17건 + E2E 디코드 스모크 12건 + WebGPU 패리티 하니스 18벡터(parity.html, headless Chrome). eslint 에러 0·경고 0.
- **CI**: PR CI + 릴리스(태그) + **prod push 캐시 워밍**(warm-release-cache.yml — 릴리스 콜드 빌드 해소, 14.5분→~11분).
- **기능 상태**: RAW 16기종 + 일반 포맷 뷰잉·비파괴 편집·프리셋·Export(래스터 배치+DNG)·정렬·슬라이드쇼·커스텀 타이틀바·파일 조작·애니메이션·다국어(한/영/일)·자동 업데이트·**WebGPU 렌더 백엔드(실험적 옵트인, compute NR)**·**전방 L0 선로딩 파이프라인**·편집 패널 검색·줌 슬라이더·새 아이콘(라인 조리개).
- **성능**: 디코드 파이프라인 재설계(2026-07-18)로 CR2 153장 실측 유휴 CPU 0.0%(이전 지속 99%). 상세는 architecture-backend.md 파이프라인 절 + bug/2026-07-18-decode-cpu-oversubscription.md.
- **직전 이력**: 2026-07-18 하루 동안 v0.5.0(WebGPU 6a~6i+NR compute) → 실사용 검증(A/B 체크리스트) → v0.5.1(이슈 6건) → v0.5.2(파이프라인 재설계+마무리 9건). 상세는 [history/2026-07-18-quality-waves.md](./history/2026-07-18-quality-waves.md).

## 남은 작업

### 완료 — UX 고도화 웨이브 (2026-07-18, v0.5.2 실사용 피드백 8건 → v0.5.3)
- [x] 1. 메뉴 드롭다운 밖 클릭·Escape 닫힘 — 공용 훅 lib/useDismissOnOutside.ts, 두 메뉴 호버 전환 포함
- [x] 2. 우측 패널 재오픈 토글 — 우측 엣지 중앙 셰브론, lastRightPanel(persist) 복원
- [x] 3. 타이틀바 더블클릭 최대화 — 조사 결과 Tauri 2.11.5 네이티브 제공(권한 기본 포함)이라 **코드 무추가**가 정답(핸들러 추가 시 이중 토글). 실기기 재확인만 잔여
- [x] 4. 좌하단 퀵 바 — ↺↻⇄⇅·크롭, store/geometry.ts 공통화(중복 람다 3곳 → 1)
- [x] 5. 타이틀바 "UI" 메뉴 — 우측 패널·필름스트립·상태 바·퀵 바·줌/디코드 배지·Perf 체크박스(layout.ts persist, 토글 시 메뉴 유지)
- [x] 6. 배포 파일명 "Raw Viewer" — productName 변경 + release.yml 자산 선제 점 리네임(latest.json·SHA256SUMS 정합)·가드 글롭화·본문 xattr 갱신. published 0개라 업데이터 무영향
- [x] 7. Dock 아이콘 — 적용은 됐었고 (a) 가독성 부족 → 선 50·대비 상향, (b) **qlmanage 알파 미보존으로 흰 배경**(사용자 발견) → Chrome 투명 렌더로 재생성·픽셀 검증(bug/2026-07-18-icon-opaque-background.md). 소스 docs/assets/app-icon.svg
- [x] 8. 컨텍스트 메뉴 위치 번쩍임 — 렌더 시점 좌표 동기화 + useLayoutEffect 클램프(ContextMenu.tsx)
- [x] 검증: tsc 0 · eslint 0 · bun test 17 · cargo test 통과(exit 0) · i18n 3파일 676키 diff 0 · dev 실기동 스모크(CR2 153장 로드, 퀵 바·UI 메뉴·배지 렌더 확인, 패닉 0)
- [x] 리뷰 워크플로(4관점+적대 검증) 확정 2건·저심각 4건 전부 반영 — Escape capture+stopPropagation(그리드 동시 닫힘 회귀), 메뉴 role='menu'/'menuitem'+✓ aria-hidden, 컨텍스트 메뉴 재오픈 시 서브메뉴 리셋, 반전 아이콘 SVG(⇄ 의미 충돌 해소), 재오픈 버튼 히트 24px, disabled 호버 제거. 재검증 tsc·eslint·test 통과
- [x] 커밋 `23b0717` → dev·prod push → v0.5.3 상향(`5d3f7e3`) → 워밍 적중 릴리스(Verify 228s+빌드 240s) → draft 자산 5종·latest.json URL 정합 확인

### 사용자 확인 완료 (2026-07-18, v0.5.3 빌드로 전부 pass)
- [x] UX 웨이브 확인(파일명·아이콘 투명·메뉴 닫힘·UI 메뉴·퀵 바·재오픈·컨텍스트 메뉴·더블클릭 최대화) — pass
- [x] 자동 업데이트 왕복(v0.5.2 → 0.5.3 감지·설치) — pass
- [x] v0.5.2 이월 확인(CR2 성능·선택 표시·About·검색·줌·진행 점·Perf·슬라이드쇼·B6·B10 등) — pass
- [x] WebGPU 시각 검증(phase6 §2.1) — pass. **잔여 결정: 기본 백엔드화 여부**

### 사용자 결정·외부 조건 대기
- [x] WebGPU 기본 백엔드화 — **옵트인 유지 결정**(2026-07-18): 시각 검증 pass했으나 사용 데이터 축적 후 재결정
- [ ] 로컬 보정 — PRD §12.2 보류, [초안](./local-adjustments-draft.md)만. 별도 PRD 합의 필요
- [ ] Windows/Linux — 하드웨어 확보 전 차단 / Intel·유니버설 빌드 — dnglab x86_64 확보 결정 필요
- [x] updater 개인키 위치 정리 — `~/environment/raw-viewer-updater.key`로 이동(2026-07-18, 바이트 비교 검증). 머신 외부 백업은 여전히 권장

## SPEC-GAP 로그 (활성)
- (build.rs) libjpeg 미링크: LibRaw의 lossy-JPEG 압축 DNG·일부 내장 썸네일 디코딩 불가 가능.
- (pipeline) 워커 사이징 계약 변경: 구 "논리코어-1"은 단일 스레드 디코드 전제였음 — 현행은 light 2 + heavy (logical/4).clamp(2,4) × OMP 팀 4 캡.
- 비-RAW: AVIF irot/imir 회전 미반영(EXIF만), 애니메이션 webp/gif는 정지 시 첫 프레임 편집.
- RAW/JPEG 페어 토글 바인딩 = ⌘J (PRD의 ⌥J는 클리핑 검사가 선점).
- X-Trans 동시 디코드 경계 픽셀 비결정성 — 관용치 13/1023로 게이트(fixtures_test 주석 참조).
- CPU 폴백: 기하/렌즈·NR/샤프닝 미지원, sRGB 고정.
- L2는 디스크 캐시 미대상(재방문 시 재디코드 — 도입 시 장당 ~120MB 저장 비용, 별도 결정 필요).

## 사용자 상시 지시
- 중단 지시 전까지 Phase/작업 경계에서 멈추지 않고 연속 진행.
- 시각 검증(실렌더 확인)은 사용자 재석 시 수행. 테스트는 가급적 빌드된 릴리스판에서.
- prod 병합·릴리스는 확립된 흐름대로(워밍 후 태그), 릴리스 publish는 사용자가 직접.
