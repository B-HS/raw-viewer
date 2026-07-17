# 로컬 보정 스키마 초안 (D4, 2026-07-18)

> Phase 5 D4 산출물. PRD §12.2(보류 — 별도 논의) 대상이므로 **구현하지 않는다.** 논의용 스키마 초안만 둔다.

## 요구 범위 (PRD §11 Phase 4 항목)
마스크(브러시 / 선형 그라디언트 / 래디얼) + 마스크별 보정 파라미터.

## EditState 확장 초안

```typescript
type LocalAdjustment = {
    id: string
    name: string
    enabled: boolean
    mask: BrushMask | LinearGradientMask | RadialGradientMask
    invert: boolean
    tone: Partial<ToneState>
    color: Pick<ColorState, 'vibrance' | 'saturation'>
    detail: Pick<DetailState, 'sharpenAmount' | 'nrLuminance'>
    clarity: number
}

type LinearGradientMask = { kind: 'linear'; x0: number; y0: number; x1: number; y1: number }
type RadialGradientMask = { kind: 'radial'; cx: number; cy: number; rx: number; ry: number; feather: number; angle: number }
type BrushMask = { kind: 'brush'; strokes: BrushStroke[] }
type BrushStroke = { size: number; feather: number; flow: number; erase: boolean; points: [number, number][] }
```

- `EditState.locals: LocalAdjustment[]` (version 상향 + 마이그레이션 필요, XMP는 crs:MaskGroupBasedCorrections 근사 매핑).
- 좌표는 crop 이전 원본 정규화 좌표(0..1) — 기하 변형과 순서 결합 주의(렌더그래프에서 로컬 패스는 ②기하 이후 적용, 마스크 좌표는 기하 역변환으로 샘플).

## 렌더 통합 초안
- 브러시 마스크는 CPU에서 알파 텍스처로 래스터라이즈(R8) 후 업로드, 그라디언트는 셰이더 수식 평가(텍스처 불필요).
- 패스 위치: 전역 톤(③~⑤) 이후, 디테일(⑥) 이전에 로컬 패스 N회 누적 — 패스당 uniform 세트 + 마스크 텍스처 1장.
- 히스토리: 스트로크 단위 코얼레싱(드래그 1회 = 1 히스토리 엔트리) — 기존 coalesceKey 체계 재사용.

## 미결(논의 필요)
1. 마스크 개수 상한(성능) — 제안: 8개.
2. AI 마스크(피사체/하늘) 범위 밖 여부.
3. CPU 폴백 경로에서 로컬 보정 지원 여부(제안: v1 미지원 배지).
4. XMP 왕복 충실도 vs 자체 스키마(aether:locals) 우선.
