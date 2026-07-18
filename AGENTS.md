# AGENTS — raw-viewer 작업 규칙 (모든 AI 에이전트 공통 진입점)

이 저장소에서 작업하는 모든 AI 에이전트(Claude Code·Cursor·Copilot·Codex 등)는 아래를 따른다. Claude Code는 전역 컨벤션(`~/.claude/convention/*.md`)이 자동 주입되지만, 다른 에이전트는 이 문서를 명시적으로 읽고 시작해야 한다.

## 세션 시작 시퀀스 (필수)

1. **[docs/PROCESS.md](docs/PROCESS.md)** — 현재 상태 스냅샷·남은 작업·환경. 프로젝트 파악의 단일 진입점.
2. **[docs/architecture-backend.md](docs/architecture-backend.md)** · **[docs/architecture-frontend.md](docs/architecture-frontend.md)** — 코드 재탐색 없이 구조·계약·함정 파악.
3. **[docs/acknowledge/decisions.md](docs/acknowledge/decisions.md)** — 사용자 결정 이력. 이미 결정된 것을 재질문하지 않는다.

## 스택·환경 (요약 — 상세는 PROCESS.md)

- Tauri v2 + React 18(React Compiler) + TypeScript strict + Rust. 패키지 매니저 **bun** (npm/node 우회 금지).
- 프론트: Vite + Tailwind 3 + zustand 5 + TanStack react-virtual + i18next(ko/en/ja — 키는 3파일 동일 구조 필수).
- 백엔드: LibRaw FFI(vendor 소스 빌드, GPL pack 제외), 디코드 파이프라인(light/heavy 워커 레인), aether:// 커스텀 프로토콜.
- `src/types/` = ts-rs 생성물 — **직접 수정 금지** (원본은 Rust `#[derive(TS)]`).

## 코드 규칙 핵심 (전역 컨벤션 요약)

- arrow function만, `function` 키워드 금지. `any`/`enum` 금지. 타입은 유도(`ReturnType`·`z.infer`·`Pick` 등) 우선.
- **코드 주석 금지** — 예외는 영어 JSDoc과 `SPEC-GAP:` 주석뿐. 설명은 docs/로.
- `useCallback`/`useMemo` 금지(React Compiler 위임), `useEffect`는 외부 시스템 동기화만.
- `@ts-ignore`/`eslint-disable` 금지. 매직넘버는 상수화. 이모지·아스키아트 금지.
- 시크릿 하드코딩·`.env` 접근 금지.

## 검증 사다리 (종료 전 필수 — 통과 없이 "통과했다" 보고 금지)

```sh
bunx tsc --noEmit
bun run lint          # eslint — 에러·경고 0 유지
bun test src          # 프론트 17건
cd src-tauri && cargo test   # Rust 324건 (PATH에 ~/.cargo/bin, LIBOMP_PREFIX 필요 — PROCESS.md 환경 절)
```
i18n 키를 만졌으면 en/ko/ja 3파일 키 diff 0 확인. WebGPU/WGSL을 만졌으면 `parity.html` 하니스(headless Chrome)로 수치 패리티 확인.

## git 규칙

- 브랜치: **dev에서 작업**, prod는 릴리스 동기화 전용. main 브랜치 없음(기본 브랜치 = prod).
- Conventional Commits(type 영어·설명 한국어). **Co-Authored-By 등 AI 트레일러 절대 금지**, author는 Hyunseok Byun 단독.
- `git add -A` 금지(선별 스테이징), force push 금지, **사용자 요청 전 커밋·푸시 금지**.
- 릴리스: 버전 3파일+lock 상향 → dev push → prod 병합·push → **캐시 워밍 완료 후** `vX.Y.Z` 태그 push ([docs/release.md](docs/release.md)).

## 작업 기록

- 진행 상태는 docs/PROCESS.md 체크리스트로 관리하고 매 스텝 갱신한다.
- 사용자 결정은 docs/acknowledge/decisions.md, 버그는 docs/bug/, 완료 이력은 docs/history/, 검증 절차는 docs/quality-assurance/에 기록한다.
