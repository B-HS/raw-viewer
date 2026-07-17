# PROCESS — raw-viewer 작업 상태 (세션 연속성 단일 진입점)

> **프로젝트명 = raw-viewer** (사용자 확정, 2026-07-15). PRD 내 "AetherLens"는 문서상 가칭 — 코드·번들 식별자는 전부 raw-viewer(`app.raw-viewer`), `aether://` 스킴 등 아키텍처 명칭은 스펙 유지.
> ai-process §2 규칙에 따른 세션 간 연속성 문서. 매 스텝마다 체크 상태를 갱신한다. 완료 이력이 쌓이면 docs/history/ 로 이관한다.

## 새 세션 시작 순서

1. 이 문서 전체 → 아래 "현재 상태 스냅샷"과 "남은 작업"으로 상황 파악.
2. [docs/architecture-backend.md](./architecture-backend.md) · [docs/architecture-frontend.md](./architecture-frontend.md) — 코드를 재탐색하지 않고 구조·계약·함정을 파악.
3. [docs/acknowledge/decisions.md](./acknowledge/decisions.md) — 사용자 결정 전체(왜 이렇게 돼 있는지). 결정을 재질문하지 않는다.
4. 필요 시: [docs/release.md](./release.md)(배포·시크릿), docs/bug/(과거 버그 원인·교훈), docs/history/(완료 이력 상세).

## 문서 지도

| 문서 | 내용 |
|------|------|
| [PRD.md](./PRD.md) | **확정 스펙 v2.0** — 모든 구현 판단의 단일 출처. 절대 규칙 R1~R7. §11 체크리스트는 실제 상태 반영됨(미구현 4건만 남음) |
| [architecture-backend.md](./architecture-backend.md) | Rust 백엔드 모듈맵·디코드 파이프라인·색 계약·커맨드/이벤트 전수·함정 |
| [architecture-frontend.md](./architecture-frontend.md) | 프론트 디렉토리맵·스토어 전수·렌더 경로·단축키 시스템·함정 |
| [acknowledge/decisions.md](./acknowledge/decisions.md) | 사용자 결정 시간순 전체 |
| [release.md](./release.md) | CI/릴리스 파이프라인·시크릿 현황·릴리스 절차·자동 업데이트 |
| [i18n.md](./i18n.md) | 다국어(한/영/일) 구조·번역 PR 기여 절차 |
| [phase5-contract.md](./phase5-contract.md) | Phase 5 구현 계약(완료) + 부록 A: 오류 삼킴 전수 분류 |
| phase1~3e-contract.md | 과거 Phase 구현 계약(완료) |
| [webgpu-assessment.md](./webgpu-assessment.md) / [local-adjustments-draft.md](./local-adjustments-draft.md) | 장기 과제 조사·초안 (미착수) |
| bug/ | 버그별 증상·원인·해결·교훈 (release dylib, close 권한, Open With 크래시 등) |
| history/ | 완료 이력 아카이브 — [phases-0-4-complete.md](./history/phases-0-4-complete.md)에 Phase 0~5 상세 체크리스트·커밋 해시 |
| quality-assurance/ | 수동 검증 체크리스트(§8.2 35항목 등)·JXL 평가 |

## 기준 문서 (규칙)
- `~/.claude/convention/*.md` — 코드 컨벤션 (arrow-fn only, 주석 금지(JSDoc·SPEC-GAP 예외), 타입 유도, FSD 등)
- 커밋: Conventional Commits(type 영어·설명 한국어), author = Hyunseok Byun 단독, Co-Authored-By/AI 트레일러 절대 금지, `git add -A` 금지(선별 스테이징), force push 금지.
- git: dev에서 작업, 웨이브 완료 시 검증 후 dev push. prod 병합·릴리스 태그는 확립된 흐름([release.md](./release.md) 절차)을 따른다.
- 검증 사다리(종료 전 필수): `bunx tsc --noEmit` → `bun run lint` → `bun test src` → `cargo test`(src-tauri) → 필요 시 실기동 스모크(`scripts/e2e-decode.sh`, 디버그 번들).

## 환경 (2026-07-16 신규 머신 이전)
| 항목 | 값 |
|------|-----|
| 기기 | macOS 26.5.2 arm64 (Apple Silicon) — WebGPU 요건(26+) 충족 |
| Rust | 1.97.0 (rustup, `~/.cargo/bin` — 셸 프로필 미수정, `export PATH="$HOME/.cargo/bin:$PATH"` 필요) |
| Bun | 1.3.14 (Node 24.18.0 병존) |
| libomp | Homebrew — 정적 libomp.a 링크. 없으면 LibRaw가 OpenMP 없이 빌드되어 X-Trans 병렬화 무효 (`export LIBOMP_PREFIX="$(brew --prefix libomp)"` 권장) |
| 프로젝트 루트 | `/Users/hyunseokbyun/development/raw-viewer` |
| gh CLI | 인증됨 (계정 B-HS) |

신규 클론 복원: `bun install` → rustup → `brew install libomp` → `scripts/sync-vendor.sh`(libraw) → `scripts/sync-lensfun.sh` → `scripts/fetch-dnglab.sh` → `scripts/fetch-fixtures.sh`(tier1 16종 약 600MB, 테스트용).

## 현재 상태 스냅샷 (2026-07-18 저녁 기준)

- **저장소**: 공개(public), MIT 라이선스 인식됨, 언어 통계 정상(TS 51%/Rust 47%). 브랜치 dev=prod 동기화 상태.
- **최신 릴리스 태그**: **v0.4.0** (draft — publish는 사용자 담당). v0.3.1부터 자동 업데이트 자산 포함. v0.1.1~v0.3.0 draft 4개는 의도적 유지.
- **시크릿**: Apple 서명·공증 5종 + `TAURI_SIGNING_PRIVATE_KEY` 등록 완료. updater 개인키 = `~/raw-viewer-updater.key`(재생성 금지·백업 필요).
- **테스트**: Rust 324건 + 프론트 bun test 17건 + E2E 디코드 스모크 12건. eslint 에러 0(경고 31 — C2-후속). CI(PR·수동)와 릴리스 워크플로 모두 그린.
- **기능 상태**: RAW 16기종 + 일반 포맷(jpg/png/webp/tiff/bmp/gif/heic/heif/avif, 임베디드 ICC 반영) 뷰잉·비파괴 편집·프리셋·Export(래스터 배치+DNG)·정렬 5종·슬라이드쇼·전체화면·커스텀 타이틀바·파일 조작(rename/move/copy)·애니메이션 재생·다국어(한/영/일)·자동 업데이트.
- **Phase 진행**: Phase 0~5 완료(상세: [history/phases-0-4-complete.md](./history/phases-0-4-complete.md)). 2026-07-18 사용자 피드백 웨이브 6건(F1~F6) 완료 — 닫기 버그·Open With 크래시 원인/수정은 [bug/](./bug/) 참조.

## 남은 작업 (착수 대기 — 우선순위 없음, 사용자 지시로 선택)

- [ ] C2-후속: react-hooks compiler 경고 31건(set-state-in-effect·refs) 컴포넌트별 정리 — 동작 리팩토링이라 실화면 검증과 병행 필요
- [ ] Phase 3 수동 검증: §8.2 수동 35항목(quality-assurance 문서), Z8 고효율 NEF 육안, 신규 UI(타이틀바·CPU 폴백·그리드·TAT) 시각 확인 — 사용자 재석 필요
- [ ] v0.4.0 릴리스 publish 후 자동 업데이트 왕복 실검증(구버전 앱에서 감지→설치)
- [ ] README.md — 실사용 스크린샷 확보 후 작성(사용자 결정)
- [ ] WebGPU 백엔드 — 조사 완료([webgpu-assessment.md](./webgpu-assessment.md)), 착수는 별도 phase 계약 작성부터
- [ ] 로컬 보정 — PRD §12.2 보류, 초안만([local-adjustments-draft.md](./local-adjustments-draft.md))
- [ ] Windows/Linux — 하드웨어 확보 전 차단
- [ ] 미결 결정: export 경로 persisted-scope, store 플러그인 스코프 축소, Intel/유니버설 빌드, 필름스트립 아틀라스(실측 병목 확인 시)

## SPEC-GAP 로그 (활성)
- (build.rs) libjpeg 미링크: LibRaw의 lossy-JPEG 압축 DNG·일부 내장 썸네일 디코딩 불가 가능.
- 비-RAW: AVIF irot/imir 회전 미반영(EXIF만), 애니메이션 webp/gif는 정지 시 첫 프레임 편집.
- RAW/JPEG 페어 토글 바인딩 = ⌘J (PRD의 ⌥J는 클리핑 검사가 선점).
- X-Trans 동시 디코드 경계 픽셀 비결정성 — 관용치 13/1023로 게이트(fixtures_test 주석 참조).
- CPU 폴백: 기하/렌즈·NR/샤프닝 미지원, sRGB 고정.

## 사용자 상시 지시
- 중단 지시 전까지 Phase/작업 경계에서 멈추지 않고 연속 진행.
- 시각 검증(실렌더 확인)은 사용자 재석 시 수행.
- prod 병합·릴리스는 확립된 흐름대로, 릴리스 publish는 사용자가 직접.
