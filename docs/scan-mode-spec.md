# 스캔(문서 펴기) 모드 스펙 v1 (2026-08-15 합의)

> 사용자 결정: "구김까지 메시 디워프" (acknowledge/decisions.md 2026-08-15). v1 은 Coons patch 기반 — 4 코너 + 4 엣지 곡률 핸들.
> 비파괴 계약(R5)·GPU 패스 체인·기존 flip/크롭 체계와 정합하도록 설계한다.

## 1. 목표와 범위

- 사진 속 문서/종이의 꼭지점 4개(+엣지 굴곡 4개)를 지정하면 직사각형으로 펴서 스캔한 것처럼 표시·익스포트한다.
- v1 커버: 원근 기울어짐, 페이지 말림·휘어짐·완만한 접힘(엣지 곡률로 표현되는 굴곡).
- v1 범위 외(명시 이월): 무작위 잔구김의 완전 평탄화(내부 N×N 그리드 제어점 — v2 후보), 자동 코너 검출, AI 디워프.

## 2. 상태 스키마 (Rust → ts-rs)

```rust
pub struct ScanState {
    pub enabled: bool,
    pub corners: [[f64; 2]; 4],   // tl, tr, br, bl — 원본 정규화 좌표(0..1)
    pub edges: [[f64; 2]; 4],     // top, right, bottom, left — 엣지 곡선의 on-curve 중점 핸들
}
```

- `edges` 는 Bézier 제어점이 아니라 **곡선이 t=0.5 에서 통과하는 중점 핸들**이다(UX 직관 우선). 제어점은 셰이더/오버레이에서 `C = 2M − (P0+P1)/2` 로 유도한다(`gl/scan.ts qbezControl`).

- `EditState.scan: Option<ScanState>` + `#[serde(default)]` — version 2 유지, 구 사이드카는 None.
- 좌표는 **flip/rotate90 적용 전 원본 버퍼 좌표계**(크롭·기하와 동일한 소스 정규화 좌표).
- 엣지 제어점 기본값 = 양 코너의 중점(직선). 프리셋 마스크 `geometry` 섹션에 포함.

## 3. 수학 — Coons patch (역방향 매핑)

출력 직사각형 좌표 (u,v)∈[0,1]² 에 대해 소스 좌표를 닫힌식으로 평가한다(프래그먼트 셰이더 적합, 역행렬 불필요):

- 엣지 곡선: B(t; P0, C, P1) = (1−t)²P0 + 2(1−t)t·C + t²P1
- S(u,v) = (1−v)·Top(u) + v·Bottom(u) + (1−u)·Left(v) + u·Right(v)
  − [(1−u)(1−v)·TL + u(1−v)·TR + (1−u)v·BL + uv·BR]

Top: TL→TR(제어 edges[0]), Right: TR→BR(edges[1]), Bottom: BL→BR(edges[2]), Left: TL→BL(edges[3]).

## 4. 렌더 통합

- **위치**: STAGE_GEOMETRY(pass2). 프래그먼트 역방향 체인 = `vUv → uWarp(기하) → Coons → 렌즈 보정 → 샘플`.
  (순방향 의미: 소스 → 렌즈 보정 → 스캔 펴기 → 기하(수평 등) → 출력)
- **게이트**: `isGeometryPassActive = 기존 워프 활성 || scan.enabled`. dirty(STAGE_GEOMETRY) 비교·stateSignature 에 scan 포함.
- **편집 모드**: `uiStore.scanEditMode` 가 켜진 동안 뷰 렌더는 Coons 를 스킵(원본 위에서 핸들 배치). 익스포트는 항상 적용.
- **출력 치수**: 코너 간 평균 변 길이(픽셀 환산)로 W′×H′ 산출(`scanOutputDims`) → 뷰 metrics(dispDims 앞단)·익스포트 oriented 타깃 치수에 반영. flip/rotate90 교환은 그 위에 기존 composeFlip 체계로 합성.
- **셰이더**: FRAG_PASS2(GLSL)·WGSL_PASS2 동일 수식. uniform: uScanOn, corners 4×vec2, edges 4×vec2.
- CPU 폴백: 기존 SPEC-GAP(기하 미지원)과 동일하게 미지원.

## 5. UI

- 편집 패널 "문서 스캔" 섹션: 활성 토글 + 핸들 편집 토글 + 리셋.
- 뷰포트 오버레이(ScanOverlay): viewportProjection 의 model 로 소스 좌표 ↔ 캔버스 좌표 매핑, 코너 4 + 엣지 4 핸들 드래그. 드래그 1회 = 히스토리 1엔트리(coalesceKey).
- 신규 진입 기본값: 코너 = 프레임 10% 인셋, 엣지 = 중점.

## 6. 검증 (2026-08-15 구현 시 결과)

- TS: Coons 평가 단위 테스트(항등·코너 고정점·중점 통과)·scanOutputDims — pass (`src/gl/scan.test.ts` 6건).
- Rust: scan 없는 구 사이드카 파싱 → None, 프리셋 마스크 geometry 섹션 scan 복사, is_default — pass (`cargo test` 전체 통과, 스냅샷 `phase2-default-editstate.json` 은 `"scan": null` 1줄 추가로 재생성).
- WebGPU 패리티: scan 벡터 추가 → **19벡터 ALL PASS** (scan max 0.00073, 기존 18벡터 수치 불변 — headless Chrome Metal).
  - 이 과정에서 GL 익스포트 orient 패스 결함 발견·수정: `orientModelMatrix` 가 렌더 버퍼 치수 기준으로 쿼드를 만들어, 출력 치수가 버퍼와 다른 최초 사례(스캔)에서 중앙 확대가 발생 → 타깃 치수 기준으로 교정(기존 flip 0/3/5/6 은 수치 동일).
- 실기동 시각 검증은 사용자 재석 시.

## 7. 후속 (이월 항목)

- v2: 내부 그리드 제어점(잔구김), 자동 코너 검출(Rust 엣지 검출), 출력 비율 프리셋(A4/Letter).
- Drawer 모드·레이어별 보정은 별도 스펙(진행 순서: 스캔 → Drawer → 보정).
