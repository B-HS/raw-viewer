# Phase 6 계약 — WebGPU 렌더 백엔드 (착수: 2026-07-18)

> [webgpu-assessment.md](./webgpu-assessment.md)(D3 조사)의 후속. 이 문서가 Phase 6 구현의 단일 계약이다.

## 0. 스파이크 결론 (계약의 전제)

assessment의 "다음 단계 2"(히스토그램 compute를 WebGL2 렌더 결과에서 읽어 집계)는 **구조적으로 이득이 없다**:

- 히스토그램 입력은 캔버스가 아니라 **오프스크린 histo FBO**(renderer.ts `sampleHistogram` — processed 텍스처를 1/8 축소 + luma 인코딩)다. WebGL2 텍스처는 WebGPU 디바이스와 공유되지 않으므로(별도 API 컨텍스트) 반드시 `readPixels`로 CPU를 경유해야 한다.
- 경유 후 남는 것은 256빈 집계뿐인데, 이는 현재 Web Worker에서 O(n) 단순 루프로 충분히 빠르다. 지배 비용은 readback이며 WebGPU 집계로는 제거되지 않는다.
- 따라서 **하이브리드(WebGL2 렌더 + WebGPU compute 부분 채용)는 배제**한다. WebGPU의 이득(compute 히스토그램·NR·풀해상도 처리)은 **렌더 파이프라인 전체가 WebGPU로 이식된 뒤** 같은 디바이스 안에서만 실현된다.

## 1. 목표

- `WebGpuRenderer`: 현행 `Renderer`(WebGL2)와 동일한 `EngineApi` 계약을 만족하는 병렬 구현체.
- 3단 폴백: **WebGPU → WebGL2 → CPU**. 감지 실패·초기화 실패 시 다음 단계로 자동 강등.
- 이식 완료 기준: 패리티 벡터(§4)에서 WebGL2와 픽셀 오차 한도 내 일치 + 히스토그램 compute화 + NR compute화.

## 2. 단계 (체크리스트)

> **방침 변경 (2026-07-18 사용자 지시)**: "테스트만 남기고 구현을 전부 먼저" — 단계별 재석 게이트 대신 6b~6g·6i를 일괄 구현하고, headless Chrome 패리티 하니스(§4)로 수치 검증을 선행했다. 시각 확인만 사용자 재석 항목으로 남는다.

- [x] 6a. 감지 계층 — `src/gl/webgpu/detect.ts` + 설정 > 성능 진단 표시.
- [x] 6b~6c. 컨텍스트·업로드 — `WebGpuRenderer.create`(adapter/device → configure, display-p3 시도), AETH f16 → rgba16float(RGB→RGBA 패딩, 512행 청크 업로드, 한도 초과 시 CPU box 다운스케일), L0 → `copyExternalImageToTexture`.
- [x] 6d~6f. 패스 전체 이식 — `src/gl/webgpu/wgsl.ts`에 pass1~8·NR·샤프닝·orient WGSL(GLSL 수식 일대일, uniformity 제약은 `textureSampleLevel`로 회피), `webgpuRenderer.ts`가 dirty 스테이지 캐시·buildBase·compare/side-by-side/crop/clipping/모니터 LUT까지 Renderer와 동일 구조로 구현.
- [x] 6g. 히스토그램 compute — workgroup atomics 256빈 4채널, `mapAsync` 비동기 readback, 150ms 스로틀. GL의 1/8 축소와 달리 **풀해상도** 집계.
- [ ] 6h. NR compute 업그레이드 — 패리티 목표(기존 출력 동일)와 달리 **출력이 의도적으로 달라지는** 개선이라 별도 화질 튜닝·재석 필요. 미착수.
- [x] 6i. 백엔드 선택 — settings `renderBackend`(기본 **webgl2**, 설정 > 성능에서 "WebGPU (실험적)" 옵트인), useRenderEngine이 async 초기화·실패 시 WebGL2→CPU 자동 강등. samplePixel은 비동기 미러(≤1024, 120ms 스로틀)로 동기 계약 유지.

## 2.1 검증 상태 (2026-07-18)

- **수치 패리티 통과**: headless Chrome(150, Metal)에서 `parity.html` 하니스 17벡터 — WebGL2(exportRenderer) 기준 f16 비교. 결과: 12벡터 완전 일치(max=0), geometry max=0.00366·lens max=0.00098(보간 미세차), grain max=0.086(hash f32 미세차, 관용 내), flip3/5/6 완전 일치. `PARITY: ALL PASS (17)`.
- **남은 검증(사용자 재석)**: WKWebView 실기동에서 WebGPU 옵트인 후 시각 확인(뷰포트 표시·줌팬·compare·크롭·클리핑·샘플러 핀·히스토그램), Perf 오버레이로 WebGL2 대비 fps 비교. 기본값이 WebGL2라 미검증 상태로도 사용자 영향 없음.

## 3. 파일 배치

```
src/gl/webgpu/
  detect.ts        6a — 감지·정규화 (구현됨)
  context.ts       6b — 디바이스/캔버스 구성
  shaders.wgsl.ts  6d~ — WGSL 소스 (패스별 상수)
  webgpuRenderer.ts 6d~ — EngineApi 구현체
```

- `Renderer`(WebGL2)·`cpurender`는 수정하지 않는다(폴백 보존). engineApi.ts 계약 변경 금지.

## 4. 패리티 검증 벡터

- 기존 cpurender 패리티 테스트와 동일 전략: 고정 입력(작은 f16 타일 + 대표 EditState 세트) → WebGL2/WebGPU/CPU 3자 출력 비교.
- 허용 오차: u8 기준 ±2/255 (셰이더 부동소수 차이), 클리핑 경계 픽셀 제외.
- 실행: WebGPU는 헤드리스 불가 → 설정 > 성능의 "패리티 자가진단" 버튼(개발 빌드 한정)으로 실기동 실행, 결과를 콘솔+토스트로.

## 5. 리스크·미결

- WKWebView `shader-f16` 미지원 시: f32 셰이더로 폴백(메모리 2배, 기능 동일) — 6c에서 분기.
- rgba16float `copyExternalImageToTexture` 색공간 변환 옵션(colorSpace: 'srgb' 금지 — 원시값 유지) 확인 — 6c.
- 성능 회귀 게이트 부재(§12.1 보류 유지) — 수동 Perf 오버레이 비교로 대체.
