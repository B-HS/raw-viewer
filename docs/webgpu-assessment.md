# WebGPU 백엔드 조사 (D3, 2026-07-18)

> Phase 5 D3 산출물. 구현 착수 전 조사·설계 방향만 정리한다. 착수는 별도 phase 계약으로.
> **2026-07-18 갱신: 착수·구현 완료 — [phase6-contract.md](./phase6-contract.md)가 이 문서를 대체한다.** 본문 "다음 단계"의 하이브리드 집계안은 스파이크 결과 기각(phase6 §0), 전체 이식으로 완료됐다.

## 목표 (PRD §11 Phase 4)
compute shader 기반 히스토그램·NR(노이즈 감소). 현행 WebGL2 렌더그래프의 프래그먼트 패스 한계(공유 메모리·atomics 부재)를 보완한다.

## 환경 전제
- 현 개발 머신 macOS 26.5.2 — WKWebView WebGPU 사용 가능(요건 충족). `navigator.gpu` 런타임 감지 필수(구 macOS 폴백).
- 두 갈래 선택지:
  1. **웹뷰 WebGPU (JS/WGSL)** — 현행 렌더러(TS)와 같은 계층. 텍스처 공유가 같은 컨텍스트 안에서 해결. WebGL2와 이중 백엔드 유지 필요.
  2. **네이티브 wgpu (Rust)** — CPU 렌더러처럼 백엔드에서 프레임 생성 후 aether로 전송. GPU→CPU 왕복이 생겨 인터랙티브 편집에는 부적합. 배치(Export)나 NR 전처리에만 적합.

## 권장 방향
- **인터랙티브 경로는 웹뷰 WebGPU**로: 렌더그래프 패스 구조(①~⑧)를 유지하고, 히스토그램(현재 워커에서 CPU 집계)을 compute+atomics로 대체 → 첫 이득이 가장 크고 회귀 면적이 작다.
- NR(양방향/NLM급)은 두 번째 단계 — WGSL workgroup 공유 메모리로 타일 처리.
- WebGL2 경로는 폴백으로 유지(기존 CPU 폴백 체계와 3단 폴백: WebGPU → WebGL2 → CPU).

## 리스크
- WKWebView WebGPU의 f16 스토리지 텍스처 지원 범위 확인 필요(`shader-f16` feature 감지).
- 패리티 검증 체계 필요: 기존 cpurender 패리티 테스트처럼 WGSL↔GLSL↔CPU 3자 비교 벡터를 만들어야 한다.
- 듀얼 백엔드 유지 비용 — EngineApi 계약은 이미 백엔드 중립이므로 renderer 구현체 분리로 흡수 가능.

## 다음 단계 (착수 시)
1. `navigator.gpu` 감지 + 어댑터/디바이스 초기화 스파이크(1일).
2. 히스토그램 compute 패스 1개를 WebGL2 렌더 결과 텍스처에서 읽어 집계 — 기존 히스토그램 결과와 수치 비교 테스트.
3. 결과가 유효하면 phase6 계약 작성(패스 이식 순서·패리티 벡터·폴백 매트릭스).
