# Phase 2 계약 — 편집 엔진 (모듈 소유권 · API)

> Phase 2 병렬 구현의 단일 계약. PRD §3.4, §3.5, §5.1, §5.4, FR-3~7, FR-9~11, FR-13(일부), FR-17.2 기준.
> EditState 타입은 `src-tauri/src/types.rs`에 동결 완료(§5.1과 1:1) → `src/types/*.ts` 생성됨. **양쪽 모두 직접 수정 금지.**

## 기본값 (DEFAULT_EDIT_STATE — P가 Rust에, U가 TS에 동일하게 정의. 단위 테스트로 JSON 동등성 검증)
- version=2 · wb: mode='as-shot', temp=6500, tint=0, tempShift=null
- lens: autoProfile=true, profileId=null, distortion/tca/vignette=100, manual*=0
- geometry: 전부 0/false, scale=100 · crop=null
- tone: 전부 0 · baseCurve='standard' · curves: 각 채널 [(0,0),(1,1)]
- color: vibrance/saturation=0, hsl: 8밴드 전부 {hue:0,sat:0,lum:0}, bw=false
- detail: sharpenAmount=25, sharpenRadius=1.0, sharpenDetail=25, sharpenMasking=0, nr*=0 (nrColor=25, nrLumaDetail=50, nrColorDetail=50), hotPixelRemoval=true
- effects: 전부 0 (vignetteMidpoint=50, vignetteRoundness=0, vignetteFeather=50)
- meta: appliedPreset=null, modifiedAt=0
- `isDefault(state)` = meta 제외 전 필드가 DEFAULT와 동일.

## 담당

### P (Rust 영속성 + 파이프라인 정비)
소유: `src-tauri/src/catalog/**`(신규), `src-tauri/src/xmp/**`(신규), `src-tauri/src/edit/**`(신규: 기본값·초기상태), `commands.rs`(커맨드 추가), `lib.rs`(배선 추가), `pipeline/mod.rs`(버그픽스 한정), `decode/`(probe 함수 1개 추가 한정).
1. **catalog/**: rusqlite(bundled), WAL. 위치 `~/Library/Application Support/app.raw-viewer/catalog.sqlite` (dirs::data_dir). 스키마 = PRD §5.4 중 Phase 2 부분집합: `images(id, path UNIQUE, content_key, edit_state TEXT NULL, edit_version INTEGER DEFAULT 0, sidecar_mtime_ns INTEGER NULL, updated_at)` + `schema_version`. 마이그레이션 구조(NNN 순차 적용)만 갖춤.
2. **xmp/**: 사이드카 `{stem}.xmp` (원본 옆). 쓰기: 이중 네임스페이스 — `aether:version="2"`, `aether:engine="rec2020-linear"`, `aether:state="base64(zstd(json(EditState)))"` + crs: 근사(§5.3 표의 wb/tone/clarity/dehaze/vibrance/saturation/sharpen/nr — ToneCurve·crop·HSL은 Phase 3) + `crs:ProcessVersion="11.0"`, `crs:HasSettings="True"`, `crs:RawFileName`. 읽기: aether:state 우선(완전 복원), 없으면 crs: 근사 임포트. round-trip 단위테스트(state→xmp→state 100% 동일) 필수. **원본 파일에는 절대 쓰지 않는다(R5).**
3. **커맨드**: `get_edit_state(image_id) -> EditStateEnvelope` (catalog → 없으면 .xmp → 없으면 초기 기본값. 초기값은 RAW면 sharpenAmount=25 + ISO 자동 NR(FR-7.2 공식), 비RAW면 sharpen 0 — ISO는 `decode::probe_iso(path)` 신설(LibRaw open만 하고 iso_speed 읽기, guarded)), `set_edit_state(image_id, state, edit_version) -> u32` (버전 불일치 → AppError::Conflict), `reset_edit_state(image_id) -> EditStateEnvelope`, `flush_edits() -> ()` (전부 즉시 flush).
4. **영속 타이밍(FR-10)**: set_edit_state는 메모리 즉시 + catalog 2초 디바운스 + xmp 10초 디바운스. `navigate` 호출 시(이미지 전환) 직전 이미지 dirty면 즉시 flush. 윈도우 CloseRequested에서 동기 flush (lib.rs on_window_event). 읽기 시 xmp mtime > catalog 기록이면 xmp 우선 + catalog 갱신.
5. **pipeline 버그픽스**: in-flight/queued 중복 job 제거 — 같은 (image_id, level)이 큐/실행 중이면 재enqueue 스킵 (현재 L1이 3회 중복 디코드됨. 완료 전 재요청도 1회만 실행되게 pending set 관리).

### G (프론트 GL 엔진 확장)
소유: `src/gl/**`, `src/components/viewport/useRenderEngine.ts`.
1. **전체 패스 ①~⑧** (PRD §3.4 순서·공식 준수, FR-3 공식 표 그대로):
   - ① 기존 매트릭스 + `uWbGain vec3` (아래 WB 모델)
   - ② 기하: rotate90/flipH/flipV/straighten(+자동 크롭 없이 회전만)/perspective(4x4 호모그래피)/crop — 정점·UV 변환으로 (픽셀 리샘플 최소화). crop은 편집 모드가 아닐 때 표시 영역 제한, 크롭 편집 모드에서는 전체 + 60% 딤.
   - ③ 톤: exposure(`rgb *= exp2(ev)`), highlights/shadows(smoothstep 휘도 마스크), whites/blacks, contrast(0.18 피벗 `k=exp2(c/100)`), highlightRecovery는 Phase 2에서 슬라이더만(효과는 clamp 완화 근사) — SPEC-GAP 기록.
   - ④ BaseCurve(기존) + ToneCurve: RGB/R/G/B 4커브 → 1024×1 RGBA16F LUT 1장 팩, 입력 공간 = OETF 인코딩 후 커브 적용 후 EOTF (FR-4).
   - ⑤ HSL 8밴드(raised-cosine 가중, 중심 hue 0/30/60/120/180/240/280/320) + vibrance(스킨톤 보호) + saturation(Rec2020 휘도 보존) + bw.
   - ⑥ NR(à trous wavelet 3레벨 luma soft-threshold + chroma blur) → 샤프닝(unsharp, radius/amount/detail/masking, 휘도만). **NR이 먼저.**
   - ⑦ clarity(σ≈40px 언샵, 휘도) + dehaze(dark-channel 근사) + 창작 비네팅(midpoint/roundness/feather, 크롭 후 프레임 기준) + grain.
   - ⑧ 출력(기존) + 클리핑 오버레이(하이라이트 빨강 ≥1.0 / 쉐도우 파랑 ≤0.0, gamut 압축 이전 판정) + Before/After 스플릿(uSplit).
2. **더티 트래킹 + 패스 스킵**: 섹션이 기본값이면 해당 패스 생략(기본 상태 = ①④⑧만). 파라미터 변경 시 그 패스 이후만 재실행(중간 FBO 캐시).
3. **편집 해상도 = 화면 해상도(§3.5.1)**: 소스 텍스처 → screen-fit 다운샘플 버퍼(≤캔버스 크기) 생성 후 패스는 그 버퍼에서. 100% 줌은 가시 영역만. **타일링(§3.5.2)**: MAX_TEXTURE_SIZE 초과 소스(GFX100 L2 등)는 2048 타일 + 32px 오버랩(⑥ 커널 seam 방지). 8192 강제 테스트 경로(설정 가능한 상한 override) 포함.
4. **엔진 API (`src/gl/engineApi.ts` — U가 소비, 시그니처 동결)**:
```ts
export type ClippingMode = 'none' | 'both' | 'highlight' | 'shadow'
export type CompareSplit = { axis: 'x' | 'y'; position: number } | null
export type EngineApi = {
    setEditState: (state: EditState | null) => void
    setClipping: (mode: ClippingMode) => void
    setCompare: (split: CompareSplit) => void
    setCropEditMode: (on: boolean) => void
    onHistogram: (cb: (hist: { r: Uint32Array; g: Uint32Array; b: Uint32Array; luma: Uint32Array }) => void) => () => void
    samplePixel: (canvasX: number, canvasY: number) => { r: number; g: number; b: number } | null
    wbGainsFromState: (wb: WbState) => [number, number, number]
    tempTintFromGains: (gains: [number, number, number]) => { temp: number; tint: number }
}
```
   setEditState(null) = 원본(기본값) 표시(\ 키 Before).
5. **WB 모델 (SPEC-GAP — Q3 Planckian 역산은 Phase 3)**: AsShot=(6500,0) 기준 상대 모델. temp 2000..50000 로그 스케일 → R/B 게인 곡선(6500에서 1.0), tint → G 게인 `2^(-tint/150*0.5)`. 스포이드: samplePixel(5×5 평균, linear Rec2020) → gains = lum/채널 → tempTintFromGains 역산 → wb 갱신은 U가.
6. **히스토그램(FR-9.1)**: 패스 ⑧ 직전 버퍼 1/8 다운샘플 readPixels → Web Worker 256bin 집계, 150ms 스로틀.

### U (프론트 UI + 상태)
소유: `src/store/**`(playlist 제외 신규), `src/components/panels/**`, `src/components/viewport/Viewport.tsx`·`CropOverlay.tsx`·`ClippingOverlay 관련 UI`, `src/components/Histogram.tsx`, `src/App.tsx`, `src/shortcuts/keymap.ts`, `src/ipc/commands.ts`(편집 커맨드 래퍼 추가).
1. **editStore**: 현재 이미지 EditState (zustand + immer `produceWithPatches`). 변경 → G.setEditState 즉시 + set_edit_state 500ms 디바운스(edit_version 관리, Conflict 시 재로드). 이미지 전환 시 get_edit_state 로드.
2. **historyStore(FR-11)**: patches/inversePatches 스택, 이미지당 최대 100, 슬라이더 드래그 pointerdown~up 코얼레싱(드래그 중 스택 미적재), 같은 coalesceKey 500ms 병합, ⌘Z/⌘⇧Z. 세션 비영속.
3. **우측 패널**: 히스토그램(클릭 모드 순환 RGB/Luma/분리) → 기본(FR-3 슬라이더: WB temp/tint, exposure/contrast/highlights/shadows/whites/blacks, vibrance/saturation) → 톤 커브(FR-4: SVG 에디터, 4채널 탭, 클릭 추가/드래그/더블클릭 삭제, monotone cubic, 최대 16점, 배경 히스토그램) → HSL(8밴드×3, bw 토글) → 디테일(FR-7 샤프닝 4 + NR 5, 100% 줌 힌트) → 효과(clarity/dehaze/비네팅 4/grain 3) → 크롭·기하(회전 ⌘[ ⌘], 플립, straighten, 비율). `Tab` 패널 토글.
4. **슬라이더 공통**: 드래그 + 더블클릭 리셋 + 방향키 미세조정(⇧=10배) + 값 직접 입력. aria-label.
5. **크롭 UI(FR-6)**: `C` 진입/이탈, 8핸들, 3분할 그리드(`O` 순환: thirds/golden/diag/none), `⇧A` 비율 순환(original/free/1:1/4:3/3:2/16:9/5:4), `X` 가로세로 전환, 바깥 60% 딤.
6. **검사·비교**: `J`/`⇧J`/`⌥J` 클리핑(G.setClipping), `\` 누르는 동안 Before(G.setEditState(null)), `⇧Y` 좌우 스플릿(드래그 구분선, 더블클릭 50%), `W` WB 스포이드(커서 전환, 클릭 → G.samplePixel → gains → temp/tint 적용).
7. **초기화**: `⌘R` 전체(reset_edit_state), `⌘⌥R` 현재 섹션(기본값 대입).
8. TS 기본값 `DEFAULT_EDIT_STATE`/`isDefault` 를 `src/store/editDefaults.ts`에 (P의 Rust 정의와 JSON 동일해야 함 — P가 Rust쪽 테스트로 고정한 JSON을 docs/phase2-default-editstate.json 으로 내보내니 그것을 상수의 검증 기준으로 사용).

## 공통 규칙
- Rust: 주석 금지(SPEC-GAP 제외), unwrap/expect 금지(src/), thiserror, tracing.
- TS: arrow only·주석 금지·any/enum 금지·named export·FC<Props>·본문 순서(useRef→useState→함수→useEffect)·useCallback/useMemo 금지·한 줄 JSX inline·prettier 4/no-semi/single.
- 검증: P=cargo test(라운드트립·기본값 JSON 스냅샷·Conflict), G/U=bun run build + prettier. 통합·실기동은 오케스트레이터.
- 다른 에이전트가 트리를 동시 수정 중 — 타 소유 파일의 컴파일 에러는 수정하지 말고 재시도/보고.
