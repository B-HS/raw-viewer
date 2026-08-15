# 90도 회전(rotate90) 미동작 — 상태만 갱신되고 렌더에 미반영

## 증상
- 퀵 바 ↺↻·편집 패널·단축키로 90도 회전을 눌러도 화면이 회전하지 않음(사용자 발견, 2026-08-15).
- 히스토리에는 "회전" 엔트리가 쌓이고 편집됨 표시도 켜지므로 상태 저장은 정상.

## 원인
- `geometry.rotate90`는 상태·히스토리·시그니처(editDefaults)·프리셋 마스크에는 존재하지만 **소비처가 0곳**이었다.
- EXIF 방향은 `flip`(0/3/5/6, libraw 코드)으로 `dispDims`/`buildModelMatrix`/익스포트 orient 패스에 적용되는데, 사용자 회전을 이 `flip`과 합성하는 코드가 없었다.
- `buildGeometryWarp`(pass2 워프)도 rotate90 을 읽지 않음 — 설계상 90도 회전은 워프가 아니라 뷰/오리엔테이션 레벨이 맞다(가로세로 교환 필요).

## 해결
- `viewTransform.ts`에 `composeFlip(flip, rotate90)` 추가 — flip 코드를 CCW 쿼터턴(0→0, 5→1, 3→2, 6→3)으로 환산해 시계방향 rotate90 을 빼고 다시 flip 코드로 환원. 두 변환 모두 순수 회전이라 합성이 {0,3,5,6} 안에서 닫힘.
- 소비처 전부 합성 flip 으로 교체:
  - `gl/renderer.ts` getMetrics·drawOutput·drawSideBySide (`orientedFlip` 헬퍼)
  - `gl/webgpu/webgpuRenderer.ts` getMetrics·render 2곳·renderExport orient 패스
  - `gl/exportRenderer.ts` prepare(dispDims + orientModelMatrix)
  - `components/viewport/useRenderEngine.ts` currentProjection(샘플러 핀·톤 캡처 좌표 일관성)
  - `components/viewport/CropOverlay.tsx`·`store/crop.ts`(크롭 매핑·'원본' 비율)
- WGSL_ORIENT 는 flip 코드 분기(3/5/6)라 합성 코드가 그대로 동작. samplePixel 은 lastModel 재사용이라 자동 일관.

## 검증
- `src/gl/viewTransform.test.ts` 신규 5케이스(항등·CW 변환·EXIF 합성·4회 왕복·dispDims 교환).
- tsc 0 · eslint 0 · bun test 22 pass · prettier pass. 시각 확인은 사용자 재석 시(상시 지시).

## 교훈
- 상태 필드를 추가할 때 소비처(렌더 경로·익스포트·오버레이 좌표계) 연결까지가 기능의 완성이다. 시그니처/히스토리 연결만으로는 "동작"이 보장되지 않는다.
- 뷰 레벨 변환(flip)과 워프 레벨 변환(pass2)의 이중 구조에서는 새 기하 파라미터가 어느 레벨 소관인지 먼저 정하고, 그 레벨의 소비처 전수(뷰·비교 페인·프로젝션·크롭·익스포트 GL/WebGPU·클립보드)를 체크리스트로 돈다.

## CPU 폴백
- CPU 폴백은 기존 SPEC-GAP(기하 미지원)대로 rotate90 도 미적용 — 변경 없음.
