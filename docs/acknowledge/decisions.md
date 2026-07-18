# 사용자 결정 기록 (acknowledge)

> 사용자가 명시적으로 내린 결정의 시간순 전체 목록. 새 세션은 이 문서로 "왜 이렇게 돼 있는지"를 재질문 없이 파악한다. 세부 배경은 [PROCESS.md](../PROCESS.md)와 docs/history/ 참조.

## 2026-07-15 (프로젝트 시작)
- **프로젝트명 = raw-viewer.** PRD의 "AetherLens"는 문서상 가칭. 코드·번들 식별자 전부 raw-viewer (`app.raw-viewer`). `aether://` 스킴 등 아키텍처 명칭은 스펙 유지.
- **패키지 매니저 = bun** (pnpm에서 전환).
- **git 운용**: 원격 `github.com/B-HS/raw-viewer`, 메인 = `prod`, 작업 = `dev`. 웨이브 완료 시 검증 후 dev 자동 commit/push. **prod 병합은 사용자 허락 필요** (단, 이후 세션들에서 "prod = dev 유지" 반복 지시로 웨이브 종료 시 동기화가 사실상 표준 흐름이 됨). 커밋: Conventional Commits(type 영어·설명 한국어), author 사용자 단독, AI 트레일러 금지.
- Tauri 플러그인은 사용 시점 도입. LibRaw는 cc 크레이트로 소스 직접 컴파일(LIBRAW_NOTHREADS, libjpeg 미링크). 벤더는 pin+스크립트 재현(`vendor/` 미추적). 아이콘 자리표시자(브랜딩 보류).
- **연속 진행 지시**: 중단 지시 전까지 Phase 경계에서 멈추지 않는다.

## 2026-07-16 (새 머신 · 배포)
- 개발 머신이 `/Users/hyunseokbyun/development/raw-viewer`(macOS 26)로 이전. 복원 절차는 PROCESS.md 환경 절.
- **배포 파이프라인 구축 지시.** CI는 PR·수동 실행 한정(당시 비공개 저장소 macOS 과금 때문 — 공개 후에도 릴리스가 자체 검증하므로 유지).
- Apple 서명 시크릿을 사용자가 등록한 이름 그대로 사용: `MACOS_CERTIFICATE_P12`, `MACOS_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. SIGNING_IDENTITY는 인증서에서 자동 추출.

## 2026-07-17 (릴리스 반복 · 공개 전환)
- 릴리스 흐름 확립: 버전 상향(3파일+lock) → dev push → prod merge → `v*` 태그 push → draft 릴리스 → **publish는 사용자가 직접**.
- Phase 5(뷰어 완성도·건전성·고도화) 전체 착수 지시 — "빠짐없이 문서화 후 멈추지 말고 진행".
- **라이선스 = MIT** (표준 전문, 서드파티는 NOTICE.md). **README는 실사용 스크린샷 생긴 뒤 작성.** **커밋 author 이메일 노출 수용**(히스토리 재작성 안 함).
- **저장소 공개 전환** (사용자 실행). 언어 통계·MIT 인식 확인됨.
- **업데이터**: 개인키는 `~/raw-viewer-updater.key`(로컬, 비밀번호 없음 — 백업 필요), 시크릿 `TAURI_SIGNING_PRIVATE_KEY` 등록됨(비밀번호 시크릿은 불필요). 기존 draft 릴리스 4개(v0.1.1~v0.3.0)는 **draft 유지**, v0.3.1부터 updater 자산 포함.

## 2026-07-18 (사용자 피드백 웨이브)
- 6건 지시: 닫기 버그, Open With 크래시, 아이콘 확대, 전 아이콘 툴팁, **다국어 한/영/일 3개**(언어 파일은 `src/i18n/` 집중, PR로 기여 — docs/i18n.md), **커스텀 타이틀바**(신호등 제거, 전 OS 일관 창 컨트롤+메뉴).
- **eslint 도입** (초기 "미도입" 보류 해제 — Phase 5 건전성 작업의 일환): flat config + typescript-eslint + react-hooks v7(컴파일러 규칙 내장). set-state-in-effect·refs 계열은 warn 유지(C2-후속). `zod-validation-error`는 overrides로 ^4 고정(v3의 `./v4` 서브패스 결함 회피) — `bun.lock` 전체 재생성은 사용자가 거부, lockfile 보존 하에 해결.
- 단축키 배정(스펙과 다른 결정): RAW/JPEG 페어 토글 = **⌘J** (PRD의 ⌥J는 클리핑 검사 J계열이 선점), 슬라이드쇼 = KeyS, 전체화면 = KeyF.

## 2026-07-18 (잔여 작업 일괄 소진 — "멈추라 할 때까지 진행, 커밋은 마지막 1회")
- **React Compiler 도입**: vite에 `babel-plugin-react-compiler`(target 18) + `react-compiler-runtime`. frontend.md 컨벤션("컴파일러 활성화가 useCallback/useMemo 금지의 전제")의 누락 전제를 충족. 번들에 memo cache 적용 확인.
- **eslint `react-hooks/incompatible-library` off**: react-virtual(useVirtualizer)에 대한 "Compilation Skipped" 정보성 진단 2건 — 라이브러리 교체 없이는 해소 불가, 컴포넌트별 스킵은 의도된 동작이라 config 레벨에서 끔(주석 억제 아님).
- **store 플러그인 권한 축소**: `store:default` → allow-load/get/set/save 4개(실사용 전수).
- **persisted-scope 불요 종결**: fs 플러그인 미사용(Export는 Rust 직접 쓰기)이라 적용 대상 아님.
- **아틀라스**: 측정 하니스만 문서화(quality-assurance/filmstrip-performance.md), 실측 전 미착수 유지.
- **WebGPU**: phase6-contract.md 체결 — 하이브리드(부분 채용) 배제, 전체 이식 로드맵. 6a(감지·진단)만 반입, 6b+는 실기동 검증 필수라 사용자 재석 대기.

## 2026-07-18 (WebGPU 일괄 구현)
- **단계별 재석 게이트 해제 지시**: "3번(WebGPU) 빼고는 다 테스트니까 구현을 전부 먼저 하고 테스트를 한꺼번에" — phase6 6b~6g·6i를 일괄 구현. 검증 공백은 headless Chrome 패리티 하니스(parity.html, 17벡터 ALL PASS)로 메움.
- **기본 백엔드는 WebGL2 유지**: WebGPU는 설정 > 성능의 "WebGPU (실험적)" 옵트인. 시각 재석 검증 통과 후 기본화 여부 재결정.
- 6h(NR compute 업그레이드)는 출력이 의도적으로 달라지는 개선이라 별도 화질 튜닝·재석 필요로 미착수 유지. **(→ 같은 날 후속 지시로 해제·구현됨 — 아래)**

## 2026-07-18 (6h + v0.5.0)
- **6h 구현 지시**: "6h 하고 docs 최신·고도화, 나머지 테스트(실화면·실측·publish)는 빌드된 버전에서" — compute NR(9×9 양방향, 공유 메모리 타일) 구현, WebGPU 백엔드 전용(WebGL2는 기존 프래그먼트 NR 유지 — 백엔드 간 NR 출력 상이 수용). 검증은 TS 참조 구현 대조(하니스 18벡터 ALL PASS).
- **v0.5.0 상향 후 커밋·push** — 이후 테스트는 v0.5.0 빌드로 수행.

## 보류·미결로 확정된 것
- WebGPU 백엔드: 조사 문서만(docs/webgpu-assessment.md), 착수는 별도 지시 대기.
- 로컬 보정: PRD §12.2 보류 유지, 스키마 초안만(docs/local-adjustments-draft.md).
- Windows/Linux: 하드웨어 부재로 차단.
- export 경로 persisted-scope, store 플러그인 스코프 축소, `catch {}` 오류 삼킴 정책(분류 완료 — phase5-contract 부록 A): 현상 유지.
- 필름스트립 아틀라스: 실측에서 병목 확인 전 미착수.
- react-hooks compiler 경고 31건(set-state-in-effect·refs): warn 유지, 시각 검증과 병행해 정리(C2-후속).
