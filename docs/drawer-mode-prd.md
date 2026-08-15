# Drawer 모드 PRD (2026-08-15 합의)

> 사용자 결정: 목표 수준 = **Photoshop 수준**, 레이어별 보정 = **드로잉 레이어별**(acknowledge/decisions.md 2026-08-15).
> 단일 세션 구현 불가 규모임을 고지·합의했고, 아래 **단계(D1~D4)로 나눠 순차 구현**한다. 각 단계는 독립 검증 후 다음으로.

## 0. 아키텍처 원칙

- **비파괴(R5) 유지**: 드로잉은 원본에 쓰지 않는다. 오브젝트(스트로크·도형·텍스트)를 **벡터 데이터로 사이드카/DB에 저장**하고 렌더 시 래스터라이즈한다. 픽셀 스냅샷 저장은 D4의 래스터 전용 도구에서만 별도 결정.
- **파이프라인 독립 합성**: 드로잉은 보정 체인(WB~effects)과 독립. 뷰는 pass8(디스플레이 변환) 직전, 익스포트는 orient 직전에 **linear Rec.2020으로 변환 후 알파 합성**한다. NR·샤픈·톤이 드로잉에 적용되지 않는 것이 의도된 동작이다(주석·드로잉은 보정 대상이 아님). 히스토그램도 드로잉 제외.
- **좌표계**: 모든 오브젝트 좌표는 **소스 정규화 uv(0..1)** — 줌·팬·회전·플립·스캔과 무관하게 이미지에 고정된다.
- **래스터라이즈**: v1은 오프스크린 Canvas2D(sRGB 8bit premultiplied) → 텍스처 업로드. 대상 해상도는 proc 버퍼(뷰)/renderW×H(익스포트)에 맞춘다.
- **프리셋·설정 복사에서 제외**: 드로잉은 사진 고유 콘텐츠다. 프리셋 마스크 섹션에 넣지 않는다(다른 사진으로 그림이 복사되는 사고 방지).

## 1. 상태 스키마 (Rust → ts-rs, D1 범위)

```rust
pub struct DrawerState {
    pub layers: Vec<DrawerLayer>,           // 아래(0)→위(N-1) 순서로 합성
}
pub struct DrawerLayer {
    pub id: String,
    pub name: String,
    pub visible: bool,
    pub opacity: f64,                        // 0..100
    pub objects: Vec<DrawerObject>,
}
pub enum DrawerObject {                      // serde tag = "kind"
    Stroke { tool, color, size, opacity, points: Vec<[f64; 2]> },   // tool: brush | pencil | eraser
    Shape  { shape, color, size, fill, from: [f64; 2], to: [f64; 2] },  // shape: line | arrow | rect | ellipse
    Text   { text, color, size, position: [f64; 2] },
}
```

- `EditState.drawer: Option<DrawerState>` + `#[serde(default)]` — scan과 동일한 additive 마이그레이션(version 2 유지).
- eraser 는 **자기 합성물에만** 작용(Canvas2D destination-out) — 사진 픽셀은 절대 지우지 않는다.
- size 는 소스 긴 변 대비 % (해상도 독립). color 는 `#rrggbb`.
- D2~D4 확장(전부 `#[serde(default)]` — D1 사이드카 호환): 레이어에 `blend`(normal/multiply/screen/overlay)·`transform`(offsetX/offsetY %, scale %, rotate °)·`adjust`(brightness/contrast/saturation ±100, hue ±180°), 오브젝트에 `clip`(올가미 폴리곤) + `fill`(시드 채우기)·`clone`(점열+오프셋)·`blur`(점열) variant.

## 2. 단계 로드맵

| 단계 | 내용 | 상태 |
|------|------|------|
| **D1** | 드로잉 레이어 기반 — 레이어(추가/삭제/순서/표시/불투명도), 브러시·연필·지우개·직선/화살표/사각형/타원·텍스트, 색상 선택, 뷰 합성 + 익스포트/클립보드 합성, 히스토리·i18n | **완료 (2026-08-15)** |
| **D2** | blend mode(multiply/screen/overlay), 레이어 이동(move 도구+드래그)·변형(오프셋/배율/회전 슬라이더), 올가미 선택 제한(오브젝트별 clip 폴리곤 저장), 플러드 필(재계산+WeakMap 레이어 캐시 — acknowledge 결정) | **완료 (2026-08-15)** |
| **D3** | **레이어별 보정**: 밝기·대비·채도·색조 CPU 픽셀 패스(레이어 캐시 2단), 활성 레이어 슬라이더 UI | **완료 (2026-08-15)** |
| **D4** | 사진 참조 도구(복제 도장·블러 브러시) — **라이브 재생 모델**(보정 완료된 사진을 래스터라이즈 시점에 참조, acknowledge 결정). 힐링 브러시는 후속(콘텐츠 인식 알고리즘 필요) | **완료 (2026-08-15, 힐링 제외)** |

- Photoshop 의 선택 영역 고급 기능(마술봉·refine edge)·스마트 오브젝트·필터 갤러리는 **범위 외로 명시**한다. 필요해지면 별도 PRD.

## 3. D1 구현 계약 — **구현 완료 (2026-08-15)**

검증: tsc 0 · eslint 0 · bun test 33(래스터 헬퍼 4 케이스 포함) · cargo test(왕복·serde default·마스크 제외) · i18n 718키 diff 0 · WebGPU 패리티 19벡터 회귀 없음. 실기동 시각 검증은 사용자 재석 시.
알려진 v1 한계: 소프트 브러시(가장자리 페더) 미지원(D2 후보 — WKWebView ctx.filter 호환성 회피), 텍스트 폰트 시스템 sans 고정, l0 프리뷰 단계에서는 드로잉 미표시(풀 렌더 후 표시), 히스토그램은 드로잉 제외(의도).

- **렌더**: `DrawerCompositor`(shared)가 objects → OffscreenCanvas 래스터라이즈 → ImageBitmap. 뷰: `renderer.setDrawerLayer(bitmap | null)` 후 pass8 에서 sRGB→linear Rec.2020 변환·알파 합성. 익스포트: `prepare(..., drawer?)` 로 전달, orient 직전 합성 패스.
- **UI**: 편집 패널 "드로잉" 섹션(도구·색·크기·레이어 목록) + 뷰포트 DrawerOverlay(포인터 캡처 → uv 스트로크, projection 매핑 재사용). drawerEditMode 는 crop/scan 편집 모드와 상호 배타.
- **히스토리**: 스트로크 1회 = 1엔트리(coalesceKey), 레이어 조작은 개별 엔트리.
- **검증**: 래스터라이저 단위 테스트(결정적 도형), Rust serde/마스크 제외 테스트, tsc/eslint/bun test/cargo test/i18n diff, 패리티(드로잉 없는 상태 회귀 무변화 확인).
- CPU 폴백: 미지원(기존 SPEC-GAP 계열).

## 4. D2~D4 구현 기록 (2026-08-15)

- **D2**: 레이어 블렌드 셀렉트 + 이동 도구(뷰포트 드래그)·배치 슬라이더(X/Y/배율/회전, 이미지 중심 기준) + 올가미 선택(클릭 다각형, 시작점 근처 클릭으로 닫기, Escape 해제 — 선택 중 그린 오브젝트에 clip 폴리곤 영구 저장) + 채우기 도구(스캔라인 flood fill, 허용치 32/255, 선택 시 마스크 제한).
- **D3**: 레이어 픽셀 패스(색조 회전 행렬 → 채도 → 밝기 → 대비, 투명 픽셀 스킵). 캐시: objects 참조 → 원본 래스터, layer 참조 → 보정 적용본.
- **D4**: 복제 도장(첫 클릭 소스 지정·⌥클릭 재지정, 원형 스탬프 경로 재생) + 블러 브러시(1/8 다운스케일 재확대 블러 소스 스탬프). 사진 참조 = 라이브 재생(acknowledge 결정): 뷰 GL은 processed FBO 풀해상도, 뷰 WebGPU는 mirror(1024 캡), 익스포트는 GL prepare 내부 체인 출력 readback → 팩토리 콜백.
- 검증: tsc 0 · eslint 0 · bun test 42(flood fill·보정 패스·클립·스탬프 헬퍼 등 신규 9) · prettier · cargo test 338 · i18n 3개국 744키 diff 0 · 패리티 19벡터 ALL PASS 유지.

## 5. 미결(후속 결정 지점)

1. 힐링 브러시(콘텐츠 인식) — D4 범위에서 제외, 별도 알고리즘 검토 필요.
2. 소프트 브러시 페더(WKWebView ctx.filter 비호환 회피 방안), 텍스트 폰트 선택.
3. 스트로크 포인트 수 상한/단순화(Douglas-Peucker) 임계.
4. WebGPU renderExport 의 사진 팩토리 지원(현 SPEC-GAP — 프로덕션 익스포트는 GL 경로라 실영향 없음).
5. XMP 왕복 시 drawer 표현(현재 aether:state JSON에 포함되므로 자체 왕복은 됨 — crs 매핑은 없음).
