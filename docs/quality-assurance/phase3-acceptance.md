# Phase 3 수용 기준 — 자동 점검 + 성능 실측

> Phase 3e 계약 QA 항목 1~4의 결과. 기준: PRD §7.1(성능 목표) · §8.2(수용 기준). ai-process §9.2에 따른 검증 체크리스트(했는지/안 했는지 체크박스).
> 재현: 성능 = `cd src-tauri && cargo test --release --test perf -- --ignored --nocapture` · 수용 = `scripts/run-acceptance.sh`

## 측정 환경

| 항목 | 값 |
|------|-----|
| 측정기 | **Apple M4 Pro (12코어: P8/E4) · 48GB · macOS 15.7.3 (24G419)** |
| PRD 기준기 | **MacBook Air M1 (8코어 CPU/7코어 GPU) · 8GB · macOS 14+** |
| 빌드 | `cargo test --release`(optimized), LibRaw 벤더 소스 `cc` 직접 컴파일, 단일 스레드(OpenMP 미링크) |
| 방법 | 픽스처별 L0/L1/L2 각 **3회 중앙값**, **캐시 미스**(decode 모듈 직접 호출 — 디스크/픽셀 캐시 미경유) |

> **하드웨어 주의**: 측정기(M4 Pro/48GB)는 PRD 기준기(M1/8GB)보다 **상당히 빠르다**. 따라서 아래에서 목표를 초과(OVER)한 항목은 **기준기에서는 더 나쁘다**고 봐야 한다. 반대로 여유(ok)인 항목도 기준기 마진은 더 좁다. 목표값은 원래 **Canon R5 CR3 / M1 8GB 단일 기준**으로 정의된 것이라, 픽스처별 OVER는 정식 스펙 위반이 아니라 **참고 대비**다(기준 파일 R5 제외).

---

## 1. 성능 실측 (PRD §7.1 대비)

L0 = `extract_thumb`(내장 JPEG 추출) · L1 = `decode_half`(half_size) · L2 = `decode_full`(풀 디코드+데모자이킹). 단위 ms, 3회 중앙값. **L2는 계약대로 4기종 부분집합만**(5D3·X-T5·iPhone·GFX100), L0/L1은 16기종 전부.

| 픽스처 | 센서/포맷 | L0 (목표 ≤60) | L1 (목표 ≤250) | L2 (목표 ≤1200) |
|--------|-----------|---------------:|----------------:|-----------------:|
| canon-eos-r5.cr3 ★기준 | Bayer / CR3 45MP | **0.6** ok | **410.6** OVER | — |
| canon-eos-5d-mark-iii.cr2 | Bayer / CR2 | 0.5 ok | 314.3 OVER | **735.4** ok |
| canon-eos-r7.cr3 | Bayer / CR3 크롭 | 0.4 ok | 294.0 OVER | — |
| sony-a7r-iv.arw | Bayer / ARW 61MP | 0.3 ok | 313.1 OVER | — |
| sony-a1.arw | Bayer / ARW | 2.0 ok | 255.0 OVER | — |
| nikon-z8.nef | Bayer / NEF 고효율 | 1.0 ok | 361.1 OVER ⚠ | — |
| nikon-d850.nef | Bayer / NEF | 0.3 ok | 306.0 OVER | — |
| **fujifilm-x-t5.raf** | **X-Trans / RAF 40MP** | 0.6 ok | **13447.4** OVER ★ | **13416.8** OVER ★ |
| **fujifilm-gfx-100.raf** | **X-Trans / RAF 102MP** | 0.6 ok | **2200.2** OVER ★ | **4070.4** OVER |
| panasonic-s5.rw2 | Bayer / RW2 | 0.3 ok | 131.2 ok | — |
| om-system-om-1.orf | Bayer / ORF | 0.6 ok | 334.5 OVER | — |
| leica-q2.dng | Bayer / DNG | 0.7 ok | 438.9 OVER | — |
| apple-iphone-12-pro.dng | linear DNG(ProRAW) | 1.5 ok | 414.3 OVER | 415.9 ok |
| pentax-k-3-mark-iii.pef | Bayer / PEF | 0.5 ok | 307.5 OVER | — |
| leica-m-monochrom.dng | 모노크롬 / DNG | **n/a**(썸네일 없음) | 123.6 ok | — |
| sigma-sd-quattro.x3f | Foveon / X3F | 2.0 ok | 713.8 OVER | — |

### 판정 요약 (headline)

- **L0: 전 기종 ≤ 2.0ms (목표 60ms) — 여유 있게 통과.** 기준 R5 = 0.6ms. 예외: 모노크롬 DNG(leica-m-monochrom)는 내장 JPEG 썸네일이 없어 L0 부재 → **L1(123ms)로 첫 표시**(PRD/PROCESS에 기록된 알려진 동작).
- **L1: 250ms 목표를 광범위하게 초과.** 측정기(M4 Pro, 기준기보다 빠름)에서도 **기준 파일 R5 CR3 = 410ms(목표의 1.6배)**. Bayer 대부분 255~440ms. 통과는 panasonic-s5(131ms)·모노크롬(123ms)뿐. → **기준기(M1 8GB)에서는 P2 250ms 목표 미달이 확실**. 일반 파이프라인 성능 갭으로 보고(수정은 계약 범위 밖 — 보고만).
- **X-Trans L1 심각**: X-T5 = **13.4초**(목표의 ~54배), GFX100 = 2.2초(~9배). → §2 정량 분석.
- **L2 부분집합**: 5D3(735ms)·iPhone(416ms) 통과 / GFX100(4.07s)·X-T5(13.4s) 초과. iPhone은 linear DNG(이미 디모자이킹됨)라 풀 디코드가 저렴.

> **하니스 해석 주의**: 이 수치는 Rust `decode_*` 호출의 순수 디코드 벽시계(단일 스레드)다. PRD의 P2는 `open_path → level-ready(l1) → rAF paint` **전체 스팬**으로 정의되지만, 그 스팬을 디코드가 지배하므로 갭은 유효하다. 또한 L0(≤60ms)가 충족되어 **사용자는 즉시 이미지를 본다**; L1은 "편집 가능" 업그레이드 단계다.

---

## 2. X-Trans L1 성능 판정 (계약 QA 항목 2 — 보고 전용, 디코드 변경 없음)

### 정량

| | L1 (half) | L2 (full) | L1/L2 |
|---|---:|---:|---:|
| fujifilm-x-t5 (40MP) | 13447ms | 13417ms | **≈ 1.00** |
| fujifilm-gfx-100 (102MP) | 2200ms | 4070ms | 0.54 |

- **X-T5는 L1 ≈ L2 (둘 다 13.4초).** → `half_size`가 X-Trans(X-T5)에서 **디코드 시간을 전혀 줄이지 못함**. `decode_half`가 `decode_full`과 **동일한 풀해상도 단일 스레드 Markesteijn 디모자이킹**을 돈다. 이것이 P2 250ms 초과의 근본 원인.
- 근거(메커니즘): LibRaw의 `half_size` 단축(2×2 CFA 블록 → 1픽셀)은 **Bayer 전용 최적화**다. X-Trans(6×6 CFA, `filters==9`)는 이 경로를 타지 않고 `xtrans_interpolate`(Markesteijn)를 **풀해상도·단일 스레드**로 수행한다(현 빌드는 OpenMP 미링크; 3b에서 `LIBRAW_NOTHREADS`는 제거했으나 OpenMP는 추가하지 않음). 따라서 X-Trans L1은 풀 Markesteijn 비용을 그대로 지불.
- GFX100은 L1(2.2s) < L2(4.07s)로 half_size가 ~1.85배 줄이긴 하나, 둘 다 예산을 크게 초과(102MP Markesteijn).
- PROCESS 이월기록(디버그·단일 스레드 44s)과 정합: release로 44s→13.4s로 내려왔으나 여전히 목표의 ~54배.

### 개선안 (구현 변경은 하지 않음 — 계약 지시)

1. **LibRaw OpenMP 활성화**: `build.rs`의 `cc` 빌드에 `-fopenmp` + `-DLIBRAW_USE_OPENMP`(및 `libomp` 링크). `xtrans_interpolate`/`ahd_interpolate`가 M 시리즈 성능 코어(측정기 P코어 8개)로 병렬화됨 — Markesteijn은 타일 단위로 병렬성이 높아 X-Trans 수초대를 ~4~8배 단축 가능. 단 ① `libomp` 런타임/번들 크기(§7.5 40MB 예산) 영향, ② 3b에서 LibRaw 비트리더 상태를 인스턴스 TLS로 옮겼으므로 단일 디코드 내부 OpenMP는 그와 직교하나 **공유 static 회귀 없음 재검증 필요**.
2. **X-Trans L1 프록시 품질 하향(트레이드오프)**: `filters==9`일 때 L1을 `half_size=1` + **`user_qual=0`(bilinear)** 로 디코드 — 기본 Markesteijn 대신. 편집 인터랙션용 프록시 품질만 낮추고 **L2/Export는 풀 Markesteijn 유지**. P2 250ms 예산을 직접 겨냥. 트레이드오프: 편집 중 X-Trans 프리뷰가 거칠어짐(100%/Export는 L2가 대체하므로 수용 가능).
3. **조합**: (2)로 P2 즉시 완화 + (1)로 L2(GFX100 4s·X-T5 13s)도 P3 1.2s 쪽으로.

> 이는 **Fuji X-Trans 한정** 판정이다. Bayer L1의 일반 미달(~300~440ms)은 별개의 작은 갭으로, half 경로가 이미 2×2 bin이라 디모자이킹 바운드가 아니라 언팩+컬러+복사 오버헤드 성격 — OpenMP 레버는 도움되나 우선순위는 X-Trans가 높다.

---

## 3. 수용 기준 §8.2 체크리스트

표기: `- [x]` = 자동 점검으로 녹색 확인 · `- [ ]` = 자동 미확인(수동 필요 또는 자동 실패). 각 항목 끝에 **[자동-통과] / [자동-실패] / [수동 필요: 방법]**.

### ◆ 기능

- [x] Tier 1 16기종 열림 + L0/L1(전부)·L2(부분집합) 디코드 — **[자동-통과]** 통합테스트 `tier1_corpus_thumb_and_half_decode`(cargo test) + 본 성능 하니스가 16기종 전부 L0/L1 디코드(§1 표). *"순서대로 표시"의 UI 표현은 수동.*
- [ ] X-Trans(X-T5·GFX100) 격자 아티팩트 없음 — **[수동 필요]** X-T5/GFX100을 100% 줌으로 열어 미로/격자 육안(디코드는 성공, §4 참조).
- [ ] 모노크롬 DNG 흑백(컬러 노이즈 없음) — **[수동 필요]** leica-m-monochrom.dng 열어 육안(디코드 L1 123ms 성공, L0 없음).
- [ ] Foveon X3F 크래시 없이 "미지원 센서" 배지 + L0 — **[수동 필요]** sigma-sd-quattro.x3f 열어 배지+L0 확인. *디코드 측: L0 2ms·L1 714ms 크래시 없이 성공(자동 확인분).*
- [ ] 손상 CR2 패닉 없이 에러 UI + ←→ 탐색 — **[수동 필요]** tier2 truncated 픽스처(`make-tier2-fixtures.sh`) 열어 에러 UI+방향키. *`catch_unwind`+precancelled 테스트는 자동분.*
- [ ] 편집 → 다음 → 복귀 시 편집값 유지 — **[수동 필요]** UI 왕복. *catalog/sidecar 영속은 `flush_all_persists_to_catalog_and_sidecar` 등 테스트-백드.*
- [ ] 편집 → 종료 → 재시작 유지 — **[수동 필요]** 앱 재시작 후 슬라이더 값 확인. *영속 테스트-백드.*
- [x] 원본 RAW mtime + blake3 해시 불변 (★R5) — **[자동-통과]** 편집은 `.xmp` 사이드카에만 기록, 원본 덮어쓰기 거부(`sidecar_path_targets_stem_xmp_not_original`, `write_sidecar_refuses_to_overwrite_matching_path`). *바이트 단위 사전/사후 해시 비교는 필요 시 수동 스팟체크(`blake3sum`).*
- [ ] ⌘Z가 슬라이더 드래그 1회=1단계 — **[수동 필요]** 슬라이더 1드래그 후 ⌘Z 1회 관찰(historyStore 코얼레싱).
- [ ] 휴지통 → ⌘Z 복원 + 원위치 — **[수동 필요/알려진 제약]** macOS `trash` 크레이트가 복원 API 미지원(3a SPEC-GAP) → ⌘Z 복원 불가, Finder "되돌려 놓기" 안내로 대체. **현재 미충족 가능성** — 확인 후 판단 필요.
- [ ] 이미지 복사 → Slack ⌘V 편집본 — **[수동 필요]** 우클릭 이미지복사 후 Slack 붙여넣기.
- [ ] 파일 복사 → Finder ⌘V 원본 — **[수동 필요]** 우클릭 파일복사 후 Finder 붙여넣기.
- [ ] Dock 우클릭 최근 10 + 현재 ● — **[수동 필요]** Dock 아이콘 우클릭.
- [ ] Dock 항목 클릭 → 포커스+이동 — **[수동 필요]** Dock 메뉴 항목 클릭.
- [ ] Finder 우클릭 "다음으로 열기"(앱 미실행) — **[수동 필요]** Finder에서 CR2 우클릭.
- [ ] 실행 중 Finder 더블클릭 → 기존 창 갱신 — **[수동 필요]** 싱글인스턴스 동작 관찰. *single-instance 플러그인+테스트는 자동분.*
- [ ] GPS 사진 미니맵 마커 — **[수동 필요]** GPS 포함 5D3/iPhone 픽스처로 미니맵 확인.
- [ ] GPS 없는 사진 미니맵 숨김 — **[수동 필요]** GPS 없는 파일로 섹션 숨김 확인.
- [ ] DNG mosaic Export → Lightroom 근사 적용 — **[수동 필요]** LR에서 열기. *tag700 aether:state 주입/재파싱은 `dnglab_dng_injection_round_trip` 자동-통과.*
- [ ] DNG 미지원 기종 폴백 다이얼로그 — **[수동 필요]** 미지원 기종 Export 시도.
- [ ] .xmp Lightroom 별점 일치 — **[수동 필요]** LR에서 xmp:Rating 확인.
- [x] .xmp 재읽기 EditState 100% (aether:state 라운드트립) — **[자동-통과]** `round_trip_preserves_full_state` + `round_trip_via_files`(src/xmp/mod.rs).
- [ ] RAW+JPEG 페어 stack 1항목 표시 — **[수동 필요]** 페어 폴더 stack 모드. *`get_pairs` 자동분.*

### ◆ 색상

- [ ] AsShot WB vs L0 ΔE00 < 5 (24패치) — **[수동 필요]** 컬러체커 픽스처+ΔE 측정(별도 코퍼스 필요).
- [ ] 컬러매트릭스 없는 기종 "⚠ 프로파일 없음" 배지 — **[수동 필요]** 매트릭스 없는 파일. *`cam_to_rec2020` None 감지 + mainstream 매트릭스 존재 assert는 자동분.*
- [ ] P3 디스플레이 sRGB 과채도 없음 — **[수동 필요]** Preview.app 대조.
- [x] Export JPEG ICC 임베드 — **[자동-통과]** `every_space_produces_a_valid_icc_profile`(5색공간)+`embed_icc`(JPEG/PNG). *스팟체크: `exiftool -icc_profile:all out.jpg`(이 머신 exiftool 미설치).*
- [ ] 노출 +2EV 쉐도우 밴딩 없음 (16F) — **[수동 필요]** 노출 +2 후 육안.
- [ ] iPhone ProRAW OpcodeList 왜곡/비네팅 보정 — **[수동 필요/알려진 제약]** DNG OpcodeList(FR-8) 미구현(3d SPEC-GAP) → 현재 미적용 가능성.

### ◆ 성능 (기준기 M1 8GB; 본 측정은 M4 Pro — §1 하드웨어 주의)

- [x] 45MP CR3 오픈 L0 ≤ 60ms — **[자동-통과]** R5 CR3 L0 = 0.6ms(전 기종 ≤2ms). §1.
- [ ] L1 ≤ 250ms · L2 ≤ 1.2s — **[자동-실패(측정)]** R5 L1 = 410ms(초과), 대부분 Bayer L1 초과, X-Trans 심각 초과. L2는 5D3/iPhone 통과·X-Trans 초과. §1/§2. *디코드 변경은 계약 범위 밖 — 보고만.*
- [ ] 슬라이더 드래그 long-task 0 · 60fps — **[수동 필요]** DevTools PerformanceObserver longtask 0건.
- [ ] 100장 방향키 30s RSS ≤ 2.0GB 단조증가 없음 — **[수동 필요]** Instruments Allocations.
- [ ] 3회 왕복 RSS ≤ +10% — **[수동 필요]** Instruments Leaks/Allocations.
- [ ] 10,000장 폴더 첫그림 ≤60ms·스캔 ≤3s·필름스트립 60fps — **[수동 필요]** 합성 10k 폴더.

### ◆ 호환성 / 견고성

- [ ] MAX_TEXTURE_SIZE=8192 45MP 타일링 정상 — **[수동 필요]** 강제 8192 환경 렌더(GL).
- [ ] EXT_color_buffer_float 없음 → "저정밀 모드" 배지 — **[수동 필요]** 확장 비활성 환경.
- [ ] webglcontextlost 자동 복구 — **[수동 필요]** 컨텍스트 손실 강제.
- [ ] 세로 사진(Orientation 6) 세로 표시 — **[수동 필요]** iPhone 세로 픽스처 렌더. *flip 디코드는 fixtures_test가 출력(자동분).*
- [ ] 특수문자·이모지 파일명 정상 — **[수동 필요/부분 자동]** tier2 non-ASCII 픽스처+자연정렬 테스트.
- [ ] Export 중 방향키 60fps — **[수동 필요]** Export 동시 탐색.

### ◆ 라이선스 (★법적 리스크)

- [x] cargo tree에 GPL/AGPL 크레이트 0개 (★R4) — **[자동-통과]** `cargo deny check licenses`에서 GPL/AGPL **검출 0**. (별건: 아래 자동-실패는 permissive 라이선스 allow-list 누락일 뿐 GPL/AGPL 아님.)
- [x] LibRaw demosaic-pack 미링크 (AMaZE nm 부재) — **[자동-통과]** `nm -gU` 릴리스 아카이브: demosaic/xtrans 심볼 10+개 존재, **AMaZE 심볼 0**. about.hbs에도 "GPL demosaic-pack 미링크" 명시.
- [x] 정보>라이선스 화면 LibRaw(CDDL)·Lensfun(CC-BY-SA)·OSM(ODbL) 표시 — **[자동-통과]** about.hbs + licenses-rust.html에 3종 저작자 표시 존재.
- [x] 지도 "© OpenStreetMap contributors" — **[자동-통과]** GpsMap.tsx tileLayer attribution.

---

## 4. `scripts/run-acceptance.sh` 자동 점검 결과

```
SUMMARY  11 PASS  1 FAIL  (12 checks)
PASS  fixtures-16              16 tier1 RAW fixtures (arw cr2 cr3 dng nef orf pef raf rw2 x3f)
PASS  decode-corpus            tier1_corpus_thumb_and_half_decode (cargo test) + perf.rs L0/L1×16
PASS  original-immutable-R5    .xmp 사이드카 기록·원본 덮어쓰기 거부
PASS  xmp-roundtrip            aether:state round_trip_preserves_full_state + round_trip_via_files
PASS  dng-inject-roundtrip     dnglab_dng_injection_round_trip (tag700 재파싱)
FAIL  cargo-deny-licenses      rc=4 allow-list gap (NOT GPL/AGPL): jpeg-encoder-0.6.1 libfuzzer-sys-0.4.13
PASS  nm-amaze-absent          AMaZE 심볼 0 (demosaic/xtrans 10 존재)
PASS  dnglab-version           dnglab 0.7.2
PASS  licenses-html            resources/licenses-rust.html (325636 bytes)
PASS  license-attributions     about.hbs: LibRaw/CDDL, Lensfun/CC-BY-SA, OpenStreetMap/ODbL
PASS  osm-map-attribution      GpsMap.tsx '© OpenStreetMap contributors'
PASS  export-icc-embed         every_space_produces_a_valid_icc_profile + embed_icc
```

### cargo-deny 자동-실패 상세 (R4 아님 — allow-list 정책 갭)

`cargo deny check licenses`가 rc=4로 실패한다. **GPL/AGPL은 0개**(R4 충족). 거부된 것은 **permissive 라이선스 2건이 deny.toml allow-list에 없어서**다:

| 크레이트 | 라이선스(SPDX) | 성격 | 트리 위치 |
|---|---|---|---|
| `jpeg-encoder 0.6.1` | `(MIT OR Apache-2.0) AND IJG` | IJG(Independent JPEG Group) — permissive(BSD류) | raw-viewer **직접 의존**(JPEG Export) |
| `libfuzzer-sys 0.4.13` | `(MIT OR Apache-2.0) AND NCSA` | NCSA(U. Illinois) — permissive(BSD/MIT류) | **팬텀 lock 엔트리**(`cargo tree -i` 비어 있음 — 실제 컴파일 안 됨) |

권장(정책 판단이라 QA가 임의 수정하지 않음 — 사용자/오케스트레이터 결정):
- `jpeg-encoder`/IJG: 실제 링크되는 permissive 라이선스 → `deny.toml [licenses] allow`에 `"IJG"` 추가.
- `libfuzzer-sys`/NCSA: 미컴파일 팬텀 → `"NCSA"` 추가 또는 `[licenses]` exception/exclude로 lock 엔트리 제외.
- (두 라이선스 모두 copyleft 아님 → R4 위반 아님. 단 **CI 게이트가 현재 red**라 릴리스 전 조치 필요.)

---

## 5. 기타 실측 발견 (보고)

- **nikon-z8.nef "data corrupted at 7245315"**: L1 디코드 중 LibRaw가 이 경고를 3회(3런) 출력하나 **크래시 없이 디코드 완료**(L1 361ms, 썸네일 정상). R6(손상 파일로 죽지 않음)는 유지되나, Z8 고효율(HE) 압축 NEF의 **디코드 정확성은 육안 검증 필요**(현 LibRaw 버전이 최신 Nikon HE를 부분만 해독할 가능성). fixtures README는 "정확"으로 표기 → **재검증 권장**.
- **leica-m-monochrom L0 부재**: 모노크롬 DNG는 내장 JPEG 썸네일이 없어 `extract_thumb` 실패(n/a) → L0 스킵, L1(123ms)로 첫 표시. PROCESS 이월기록과 일치, UI에서 "L0 없이 L1 첫 표시"가 허용되는지 확인 필요.
- **sigma-sd-quattro(X3F) L1 성공(714ms)**: `USE_X3FTOOLS` 정의 이후 Foveon도 L0·L1 디코드 성공(크래시 없음). "미지원 센서 배지"는 UI 정책이며 디코드 자체는 동작.

---

## 6. 계약 QA 항목 4 — 기존 테스트 유지

- `cargo test --lib`(디버그) 실측: **249 passed · 0 failed** (196s). 기준 241 전부 녹색 유지 + 병렬 작업이 추가한 8건도 녹색. 본 세션이 인용하는 테스트(`tier1_corpus_thumb_and_half_decode`, `round_trip_preserves_full_state`, `round_trip_via_files`, `sidecar_path_targets_stem_xmp_not_original`, `write_sidecar_refuses_to_overwrite_matching_path`, `dnglab_dng_injection_round_trip`)가 모두 이 실행에서 통과 — run-acceptance.sh 인용의 실증.
- 추가한 `src-tauri/tests/perf.rs`는 **전부 `#[ignore]`** 게이트라 일반 `cargo test`에서 무시(0 run) → **lib 유닛테스트 카운트에 영향 없음**. release 통합 빌드(`cargo test --release --test perf`)가 크레이트 전체+perf를 성공 컴파일 → lib 공개 API와 정합 확인.
- **주의**: 위 249는 병렬 편집 중 스냅샷이다. 통합 후 최종 카운트는 오케스트레이터가 `cargo test`로 재확인.

---

## 재현 명령

```bash
# 성능 실측 (release, 첫 빌드 수 분)
cd src-tauri && cargo test --release --test perf -- --ignored --nocapture

# 수용 자동 점검
scripts/run-acceptance.sh
```
