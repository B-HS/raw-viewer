# 2026-07-18 품질·성능 웨이브 상세 기록 (v0.5.0 ~ v0.5.2)

> PROCESS.md에서 이관된 당시 체크리스트 원본. 요약과 커밋 해시는 PROCESS.md·git log 참조.
> 릴리스 순서: v0.5.0(WebGPU+compute NR) → v0.5.1(검증 이슈 6건) → v0.5.2(파이프라인 재설계+마무리 9건).

## 완료: 남은 작업 일괄 소진 (2026-07-18 사용자 지시 — 멈추라 할 때까지, 커밋은 마지막 1회)

- [x] W1. C2-후속: react-hooks 경고 31건 → 0건. React Compiler(babel-plugin-react-compiler, target 18) 도입(컨벤션 전제 누락 발견), 파생 상태·렌더 중 조정·모듈 함수 승격으로 근본 수정, useRenderEngine은 mount effect 단일화 + playlist 구독 전환, engine/caps/gpuError는 uiStore로 단일화. incompatible-library 룰만 config off(react-virtual 정보성 진단 — 사유는 acknowledge). 실화면 검증은 W5에서
- [x] W2. store 플러그인 권한을 default(14커맨드)에서 실사용 4커맨드(load/get/set/save)로 축소. persisted-scope는 **불요 종결** — fs 플러그인 자체가 없고 Export는 Rust 커맨드가 직접 파일을 쓴다(스코프 검사 대상 아님)
- [x] W3. 필름스트립 아틀라스: 측정 하니스 문서화([quality-assurance/filmstrip-performance.md](./quality-assurance/filmstrip-performance.md)) — 스크롤 fps 실측은 사용자 재석 항목, "병목 확인 전 미착수" 결정 유지
- [x] W4. WebGPU: [phase6-contract.md](./phase6-contract.md) 작성(스파이크 결론: WebGL↔WebGPU 텍스처 공유 불가 → 하이브리드 배제, 전체 이식 로드맵 6a~6i) + 6a 감지 계층 구현(`src/gl/webgpu/detect.ts`, 설정>성능 진단 표시, i18n 3개국어). 6b부터는 실기동 시각 검증 필수라 사용자 재석 대기
- [x] W5. 검증 사다리 전체 통과 — tsc 0에러, eslint 0에러·0경고, bun test 17, cargo test 324, 프로덕션 빌드(compiler 적용 확인), tauri dev 실기동 스모크(frontend ready 도달·15초 생존·패닉 0) 후 단일 커밋
- 사용자 필요로 제외: Phase 3 수동 35항목(재석), v0.4.0 publish·업데이트 왕복(사용자 publish), README(스크린샷), Windows/Linux(하드웨어), Intel 빌드(dnglab x86_64 결정), 로컬 보정(PRD §12.2 — 별도 PRD 합의 필요)

## 완료: WebGPU 6b~6i 일괄 구현 (2026-07-18 사용자 지시 — "테스트만 남기고 구현 전부 먼저", 커밋은 마지막 1회)

- [x] V1. WGSL 전체 이식(`src/gl/webgpu/wgsl.ts`) — pass1~8·NR·샤프닝·orient·히스토그램 compute, GLSL과 수식 일대일 대응(uniformity 제약은 textureSampleLevel로 회피)
- [x] V2. `WebGpuRenderer`(`src/gl/webgpu/webgpuRenderer.ts`) — Renderer 동일 공개 표면: 업로드(f16 RGBA 패딩·청크), dirty 스테이지 캐시, pass8 뷰포트(compare/side-by-side/crop/clipping/LUT), buildBase, 히스토그램 compute+mapAsync, samplePixel 비동기 미러, renderExport(패리티·export 경로)
- [x] V3. 백엔드 선택 배관 — settings `renderBackend`(기본 webgl2, 설정>성능에서 WebGPU 실험적 옵트인), useRenderEngine async 초기화 + WebGPU 실패 시 WebGL2→CPU 강등, engineApi는 `EngineBackend`(Pick 유도)로 중립화
- [x] V4. 패리티 하니스(parity.html + parityMain.ts) — headless Chrome(Metal)에서 17벡터 **ALL PASS**: 12벡터 완전 일치, geometry 0.00366·lens 0.00098(보간 미세차)·grain 0.086(hash 미세차, 관용 내). orient flip5/6 매핑 오류를 수식 유도로 발견·수정 후 재실행 확정
- [x] V5. 검증 — tsc·eslint 0/0, bun test 17, 프로덕션 빌드, i18n diff 0, tauri dev 실기동(기본 WebGL2 경로 생존·frontend ready·패닉 0). Rust 무변경(cargo 생략). phase6-contract 상태 갱신 후 단일 커밋

## 완료: 6h + v0.5.0 (2026-07-18 사용자 지시 — "6h·docs 마치고 0.5.0으로 커밋, 나머지 테스트는 빌드판에서")

- [x] N1. 6h NR compute — workgroup 공유 메모리 9×9 양방향 필터(WebGPU 전용, WebGL2는 기존 유지). 하니스에 TS 참조 구현 대조 벡터 추가 → 18벡터 ALL PASS(nr-compute 0.00098)
- [x] N2. 하니스 디버깅 부산물 — 최악 픽셀 진단 출력, uncaptured error 리포팅(`device.onuncapturederror` — 제품에도 반입), "baseCurve='standard'는 중립에서도 CURVE 활성" 함정을 phase6-contract에 기록
- [x] N3. docs 최신화 — phase6-contract(6h·검증 상태), architecture-frontend, release.md, decisions.md
- [x] N4. v0.5.0 상향(3파일+lock) → 검증 사다리(tsc·lint 0/0, bun test 17, 빌드, i18n 0, tauri dev 스모크) → 커밋·push → prod 병합 → v0.5.0 태그

## 진행 중: v0.5.1 검증 후 마무리 웨이브 (2026-07-18 사용자 지시 9건)

- [x] F1. 선택·hover 표시 재설계 — ring/outline이 자식·inline boxShadow에 밀리던 구조를 셀 최상위 오버레이 border(span absolute inset-0)로 교체 (필름스트립·그리드)
- [x] F2. 앱 표시명 "Raw Viewer" — 파일명(productName)까지 바꾸면 GitHub 자산명 공백 치환으로 업데이터 URL이 깨질 위험 → src-tauri/Info.plist 병합(CFBundleDisplayName/CFBundleName)으로 표시명만 변경. 창 title·타이틀바·새 창 title도 정리
- [x] F3+F6(About). AboutSummary 컴포넌트(소개·작성자 Hyunseok Byun @B-HS·저장소 링크, opener 스코프에 github.com/B-HS 추가) — About 다이얼로그 상단 + 설정>정보 탭 공용
- [x] F4. 업데이트 실패 사유 상세화 — describeUpdateError(미공개 릴리스/네트워크/기타 분류) + 원문 축약 병기
- [x] F5·F6. 디코드 파이프라인 개선 (조사 워크플로 3관점 → 구현):
  - CPU 폭주 근본 원인 = 워커 17×OMP 18팀 초과구독: OMP_NUM_THREADS=4·KMP_BLOCKTIME=0 캡(main.rs) + 워커 레인 분리(light L0 전용 2개 / heavy L1·L2 (logical/4).clamp(2,4)개)
  - 이웃 L1 투기 프리로드 제거(neighbor_jobs) — 사용자 전략 "L1/L2는 선택 시"와 일치
  - 전방 L0 전체 선로딩: preload_l0 커맨드(+L0 세대 플래그로 navigate 취소에서 보호), 프론트 스캔 완료·이동 디바운스(800ms) 시 전방 미로딩분 최대 500장 요청, 창 밖 L0 ready는 setLevel만 반영(필름스트립 썸네일 자동 갱신)
  - 낭비 컷: IDLE_DELAY 150→400ms, 큐에 남은 스테일 L2(현재 사진 아님)는 실행 직전 스킵, f16 변환 루프에 취소 체크 삽입
  - 재방문 플래시: stale best 가드에 renderer.hasImage 결합 — 텍스처 없으면 L0 먼저 표시 후 L1 스왑
  - 진행 UI: 뷰포트 배지에 L0·L1·L2 3단 점 표시
- [x] F7. 우측 편집 패널 검색 — 섹션별 라벨 키 인덱스 기반 필터(검색 시 매칭 섹션만 표시·재마운트로 펼침), 3개국어
- [x] F8. 앱 아이콘 — 시안 3종(라인 조리개/채움 조리개/렌즈 링) 제작·사용자 선택(시안 A 라인 조리개) → 투명 배경 1024 렌더 → `tauri icon`으로 전체 세트 재생성
- [x] F9. 검증 — tsc·eslint 0/0, bun test 17, vite build, cargo test 324, i18n diff 0, 실폴더(CR2 153장) 실기동 실측: 전방 L0 프리로드 65장 자동 실행·패닉 0·**유휴 CPU 0.0%**(이전 지속 99% 해소 실증). 커밋은 지시 대기
- 조사 상세: 워크플로 3관점(큐 우선순위/CPU 폭주/캐시 재방문) 보고서 — 근본 원인·권고 전문은 이 세션 기록, 핵심은 architecture-backend.md 파이프라인 절에 반영

## 관련 커밋 (dev)
- 893c164 chore: v0.5.2 버전 상향
- b178c14 docs: 마무리 웨이브 기록·파이프라인 아키텍처 현행화
- 0a0979f chore: 앱 아이콘 교체 (라인 조리개 시안, tauri icon 전체 세트 재생성)
- d27a822 feat: v0.5.1 검증 마무리 UI 5건
- c552f2a perf: 디코드 파이프라인 재설계 (CPU 폭주 해소·전방 L0 선로딩)
- 9c8ffbe chore: v0.5.1 버전 상향
- 0941840 ci: prod 캐시 워밍으로 릴리스 콜드 빌드 해소
- e292466 fix: v0.5.0 수동 검증 이슈 6건 수정
- d325484 chore: v0.5.0 버전 상향
- 9c0e145 feat: NR compute 업그레이드 (phase6 6h) 및 문서 현행화
- 61b8b7f feat: WebGPU 렌더 백엔드 구현 (phase6 6b~6g·6i, 패리티 검증 포함)
- b48efaa refactor: react-hooks 경고 전면 해소·React Compiler 도입 및 잔여 과제 소진
