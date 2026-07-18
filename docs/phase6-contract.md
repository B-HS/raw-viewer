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

- [x] 6a. 감지 계층 — `src/gl/webgpu/detect.ts`: `navigator.gpu` 유무 → adapter/device 요청 → `shader-f16` feature 감지. 결과는 `WebGpuSupport`로 정규화. 설정 > 정보에서 진단 표시(사용자가 자기 환경 확인 가능).
- [ ] 6b. 컨텍스트 스파이크 — canvas `webgpu` 컨텍스트 구성(`getPreferredCanvasFormat`), rgba16float 렌더 타깃 생성, 단색 클리어 프레임 표시. **실기동 검증 필수(사용자 재석)** — WKWebView에서 실제 프레임이 보이는지.
- [ ] 6c. 업로드 경로 — AETH f16 → `GPUTexture(rgba16float)` 업로드(RGB→RGBA 패딩), L0 JPEG → `copyExternalImageToTexture`.
- [ ] 6d. 패스 이식 1차 — pass1(WB+행렬)과 pass8(출력 변환)만 WGSL로: "업로드→WB→출력"의 최소 사진 표시. 패리티 벡터 §4로 WebGL2와 비교.
- [ ] 6e. 패스 이식 2차 — TONE/CURVE/COLOR (LUT 텍스처 공유 구조 유지).
- [ ] 6f. 패스 이식 3차 — GEOMETRY/DETAIL/EFFECTS + 타일링(MAX_TEXTURE_SIZE 상당 — `maxTextureDimension2D`).
- [ ] 6g. 히스토그램 compute — processed 텍스처에서 workgroup atomics로 256빈 집계, `mapAsync` 비동기 readback(메인스레드 stall 제거, 1/8 축소 불필요 → 풀해상도 정확도).
- [ ] 6h. NR compute — WGSL workgroup 공유 메모리 타일 처리(assessment 2단계).
- [ ] 6i. 백엔드 선택 배관 — useRenderEngine에서 감지 결과로 구현체 선택, 설정 > 성능에 강제 백엔드 옵션(디버그), 3단 폴백 자동화.

> 6b부터는 **각 단계가 실기동 시각 검증을 통과해야 다음으로** 넘어간다(§8.1 검증 사다리 + 사용자 재석). 헤드리스 세션에서는 6a까지만 반입한다 — 무검증 GPU 코드 대량 반입 금지.

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
