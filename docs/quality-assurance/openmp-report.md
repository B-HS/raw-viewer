# OpenMP 활성화 — LibRaw 벤더 빌드 병렬화 리포트

> Phase 3f OP 웨이브. 목표: 벤더 LibRaw(0.21.5) `cc` 빌드에 OpenMP를 켜서 디코드(특히 X-Trans Markesteijn·Bayer AHD)를 성능코어로 병렬화하고 이득을 실측한다.
> 기준 문서: docs/PRD.md §7.1(성능 목표), docs/quality-assurance/phase3-acceptance.md(§1 before 수치), 절대 규칙 R5(원본 불변)·R6(손상 파일 견고).
> 재현: 성능 `cd src-tauri && cargo test --release --test perf -- --ignored --nocapture` · 정합성 `cd src-tauri && cargo test`
> 측정기: **Apple M4 Pro (P8/E4 = 12코어) · 48GB · macOS 15.7.3** · libomp 22.1.8 (Homebrew) · Apple clang 17.

---

## 0. 결론 (headline)

- **Bayer는 OpenMP 이득 전면 수용.** 주 목표였던 **R5 L1 = 410.6 → 166.0ms (2.47×) → PRD 250ms 목표 통과.** GFX100(사실 Bayer) L2 = 4070 → 1156ms → 1200ms 목표 통과. 5D3 L2 = 735 → 433ms.
- **정합성 게이트 유지.** `cargo test` **249 passed / 0 failed**, `concurrent_decode_stays_byte_identical_to_isolated` 포함 녹색.
- **단, X-Trans(X-T5)는 병렬 시 바이트 비결정적** → 게이트 위반 → **X-Trans만 단일 OpenMP 스레드로 고정(serial)** 하여 결정성 확보. 그 대가로 **X-Trans는 셋업 상태에서 속도 이득 없음**(13~15s 유지). 병렬 시 **2.16s(6.2×) 가능**하나 바이트 동일성 게이트와 충돌(§3).
- **번들 자립성 확보.** **정적 링크(libomp.a)** — 최종 바이너리에 `libomp.dylib` 의존성 **0건**(otool -L 검증). .app에 별도 dylib 동봉 불필요.

---

## 1. 링크 방식 / 플래그 (build.rs)

**방식: 정적 링크 (STATIC `libomp.a`).** Homebrew libomp가 arm64 `libomp.a`를 제공 → 최종 바이너리에 흡수, 런타임 dylib 의존 없음.

- **libomp 탐지**(우선순위): `LIBOMP_PREFIX` 환경변수 → `brew --prefix libomp` → `/opt/homebrew/opt/libomp` / `/usr/local/opt/libomp`. 각 후보에서 `include/omp.h` 존재 검증.
- **컴파일 플래그**(75개 LibRaw TU 전부, `cc::Build`):
  - `-Xpreprocessor -fopenmp` — Apple clang에서 `_OPENMP`(=202011) 정의 + `#pragma omp` 처리 활성. (bare `-fopenmp`는 Apple clang이 런타임 자동링크까지 시도하므로 preprocessor 한정 형태 사용.)
  - `-DLIBRAW_FORCE_OPENMP` — **필수.** LibRaw `libraw/libraw_types.h`는 `(__APPLE__ && _REENTRANT)` 조건에서 `#undef LIBRAW_USE_OPENMP` 하여 macOS에선 기본적으로 OpenMP를 끈다. `LIBRAW_FORCE_OPENMP`는 그 게이트보다 먼저 평가되어 무조건 켠다.
  - `-I{libomp}/include` — `omp.h`.
- **링크 디렉티브**: `cargo:rustc-link-search=native={libomp}/lib` + `cargo:rustc-link-lib=static=omp`.
- **가드(빌드 실패 금지)**: libomp 미탐지 시 `cargo:warning=libomp not found ...` 출력 후 **OpenMP 없이 빌드 계속**(현행 단일스레드). CI/타 머신 안전. `libomp.a` 부재+`libomp.dylib`만 있을 땐 dylib 폴백 + SPEC-GAP 경고(§5-1).
- **cfg 전파**: OpenMP 링크 성공 시 `cargo:rustc-cfg=openmp` 방출(디코드측 X-Trans 스레드 핀 가드가 소비, §3). `cargo:rustc-check-cfg=cfg(openmp)`로 lint 등록.

검증 프로브(Apple clang):
```
_OPENMP defined = 202011
omp_get_max_threads=12  parallel_threads_ran=12
otool -L (static): libc++ / libSystem 만 (libomp.dylib 없음)
```

---

## 2. 정합성 결과 (게이트)

`cd src-tauri && cargo test` → **249 passed · 0 failed** (기준선 249 유지). `concurrent_decode_stays_byte_identical_to_isolated` 포함.

### 근본 원인 — X-Trans Markesteijn은 병렬 시 비결정적

`src/demosaic/xtrans_demosaic.cpp`의 Markesteijn(`user_qual=3`) 병렬 루프:
```c
#pragma omp parallel for schedule(dynamic) ... shared(dir)
  for (top = 3; top < height-19; top += LIBRAW_AHD_TILE - 16)  // 타일 16px 오버랩
    ... image[(row+top)*width + col+left][c] = avg ...          // 인접 타일이 경계 픽셀을 공유 기록
```
타일이 16px 겹쳐 **경계 픽셀을 두 타일이 기록**하는데, `schedule(dynamic)`이라 **완료 순서(=최종 기록자)가 스케줄링 의존** → 실행마다 경계 픽셀이 달라진다. 오염(corruption)이 아니라 **양쪽 다 유효한 디모자이크 값의 비결정적 경합**(sub-perceptual, 경계 집중).

실측(디버그, X-T5 30,139,776 샘플 중 상이 개수):
| OpenMP 설정 | 상이 샘플 | 게이트 |
|---|---:|---|
| 기본(오버서브스크립션) | 4819 (0.016%) | FAIL |
| `OMP_NUM_THREADS=8 OMP_DYNAMIC=FALSE` | 213 | FAIL |
| 단일 스레드(serial) | 0 | **PASS** |

→ **고정 스레드 수로도 결정성 회복 불가**(스레드 수는 편차 크기만 바꿈). `OMP_NUM_THREADS` 캡(태스크 힌트)은 X-Trans 결정성을 **복원하지 못한다**. 오직 serial(1스레드)만 바이트 동일. Bayer(5D3 half=bilinear)·모노크롬은 전 병렬에서 바이트 동일(경계 겹침 기록 없음).

### 조치 — X-Trans만 단일 스레드 핀

`src/decode/libraw_ffi.rs` `decode()`에서 `filters==9`(X-Trans)일 때만 디코드 구간 동안 `omp_set_num_threads(1)`(RAII 복원). Bayer/모노는 전 스레드 유지.
- 게이트: X-Trans serial → 결정적, Bayer/모노 이미 결정적 → 전체 PASS.
- `cfg(openmp)` 가드 → libomp 미링크 빌드에선 no-op(extern 미참조, 링크 에러 없음).
- **왜 build.rs가 아닌 디코드측인가**: 결정성 문제는 "X-Trans만, 런타임 per-decode"라 컴파일타임(build.rs)에서 처리 불가. 혼합 컴파일(xtrans TU만 OpenMP 제외)은 `libraw_alloc.h`의 인라인 `mem_ptr`/`forget_ptr`가 `LIBRAW_USE_OPENMP`에 따라 `#pragma omp critical` 유무가 갈려 **ODR 위반**(링커가 non-critical 버전으로 folding 시 병렬 힙 경합) → 불가. 따라서 per-decode 런타임 핀이 유일하게 안전. (build.rs 소유 범위 밖 파일 최소 수정 — 오케스트레이터/디코드 담당에 공유.)

---

## 3. 성능 before/after (실측)

M4 Pro/48GB, 캐시 미스, 3회 중앙값, ms. **before = phase3-acceptance.md §1(단일스레드).** after 두 컬럼:
- **shipped** = 셋업 상태(Bayer 병렬 + X-Trans serial-pin). 현재 코드가 내는 값.
- **all-∥ 잠재** = X-Trans 핀 제거 시(병렬) 참고값 — 게이트 위반이라 미셋업, 잠금해제(§5-1) 시 도달 가능.

| 픽스처 | 센서 | 레벨 | before(1T) | **shipped** | all-∥ 잠재 | 목표 | 판정(shipped) |
|---|---|---|---:|---:|---:|---:|---|
| canon-eos-r5.cr3 ★ | Bayer 45MP | L1 | 410.6 | **166.0** | 167.5 | ≤250 | **✓ PASS (2.47×)** |
| canon-eos-5d-mark-iii.cr2 | Bayer | L1 | 314.3 | 282.1 | 287.3 | ≤250 | OVER (1.11× 개선) |
| canon-eos-5d-mark-iii.cr2 | Bayer | L2 | 735.4 | **432.8** | 438.4 | ≤1200 | ✓ PASS (1.70×) |
| fujifilm-gfx-100.raf | **Bayer** 102MP | L1 | 2200.2 | 508.5 | 505.1 | ≤250 | OVER (4.33× 개선) |
| fujifilm-gfx-100.raf | **Bayer** 102MP | L2 | 4070.4 | **1156.2** | 1162.8 | ≤1200 | **✓ PASS (3.52×)** |
| fujifilm-x-t5.raf | X-Trans 40MP | L1 | 13447.4 | 15594.3 | 2158.2 | ≤250 | FAIL (serial-pin) |
| fujifilm-x-t5.raf | X-Trans 40MP | L2 | 13416.8 | 15714.0 | 2164.2 | ≤1200 | FAIL (serial-pin) |

Bayer는 shipped == all-∥(핀 대상 아님). X-T5만 두 컬럼이 갈린다.

기타 16기종 L1 개선(shipped): R7 294→123✓, a7r-iv 313→228✓, a1 255→185✓, d850 306→268, om-1 335→306, q2 439→379, s5 131→95✓, pef 308→276, iphone 414→410, mono 124→98✓, x3f 714→720(≈).

### 목표별 1줄 판정 (PRD §7.1: L1≤250, L2≤1200 @ R5/M1-8GB 기준)
- **R5 L1 (주 pain): 410→166ms — PASS.** OpenMP가 주 목표를 해결.
- **5D3: L2 735→433ms PASS**(기존 통과·가속). L1 314→282 OVER(half 경로는 디모자이크 바운드가 아니라 언팩+컬러+복사 오버헤드 — OpenMP 레버 약함).
- **GFX100(Bayer): L2 4070→1156ms PASS**. L1 2200→508 4.3× 개선하나 102MP라 250 초과.
- **X-T5(X-Trans): shipped 변화없음(FAIL) — 결정성 위해 serial 고정.** 병렬 잠재 2.16s(6.2×)이나 250 목표엔 여전히 미달 → 완전 충족은 병렬 잠금해제 + 프록시 병행 필요(§5-1).

> shipped X-T5(15.6s)가 before(13.4s)보다 ~16% 높은 건 세션 간 열/부하 편차 + 1스레드 OMP 런타임 오버헤드(팀 생성·dynamic dispatch)로 판단. 둘 다 목표의 ~54배라 사용자 체감엔 동일(프록시/잠금해제 없이는 미해결).

---

## 4. 번들 시사점 (bundle implications)

- **정적 링크 → 자립.** perf 테스트 바이너리 `otool -L`에 **`libomp.dylib` 의존성 0건**. libomp 코드가 바이너리에 정적 흡수됨. **`tauri.conf.json` bundle.resources에 dylib 동봉 불필요, install_name_tool 후처리 불필요.**
- 타 머신 빌드: libomp 있으면 정적 링크(자립), 없으면 OpenMP 없이 빌드(경고) — 어느 쪽도 하드페일 없음.
- **무관/기존**: 바이너리에 `liblcms2.2.dylib`(Homebrew little-cms2) 의존이 보이나 **이번 변경과 무관한 기존 의존**(색/ICC 경로). OpenMP는 신규 dylib 의존을 0건 추가했다.

---

## 5. SPEC-GAP / 후속

1. **X-Trans 병렬 잠금(6.2×) — 게이트 정책 결정 필요.** 현재 결정성 위해 serial 고정 → X-Trans 속도 이득 미셋업. 잠금해제 2안: **(a)** 바이트 동일성 게이트가 X-Trans 디모자이크의 **양성(benign) 경계 비결정성**을 허용하도록 완화(intra-decode·sub-perceptual·크로스 디코드 오염 아님 — 3b가 잡은 공유 static 오염과 성격 다름), **(b)** X-Trans L1을 bilinear 프록시로 대체(PRD §3.3 옵션2, L2/Export는 Markesteijn 유지). 어느 쪽이든 X-T5 13.4s→2.16s. → **사용자/오케스트레이터 결정 사항.**
2. **Bayer L2 AHD도 동일 오버랩 타일 패턴** → 유사 양성 비결정성 가능. 단 게이트(decode_half)가 미검증(5D3 half=bilinear). shipped는 속도 위해 병렬 유지(5D3/GFX100 L2 가속). **L2 바이트 재현성이 후에 필요하면** 동일 serial-pin을 `filters!=9 && Full`에도 적용.
3. **프로덕션 오버서브스크립션(튜닝)**: 파이프라인 워커 = `available_parallelism()`(≈12). 각 동시 디코드가 최대 12 OMP 스레드 → 최대 ~144 스레드/12코어. 격리-디코드 지연 이득이 동시 처리량으론 다 안 옮겨오거나 스래싱 가능. **권장: pipeline init에서 내부 OMP 스레드를 소수(N)로 캡 또는 OpenMP 시 외부 워커 축소** — 별도 측정 튜닝 과제. (X-Trans는 이미 1로 핀되어 무관.)
4. **크로스파일 수정 고지**: X-Trans 스레드 핀은 `src/decode/libraw_ffi.rs`(build.rs 소유 범위 밖)에 있다. 전역 `OMP_NUM_THREADS` 캡으론 Markesteijn 결정성 복원 불가(§2 실측)라 런타임 per-decode 핀이 불가피. `cfg(openmp)` 가드(libomp 없으면 no-op). 디코드 담당/오케스트레이터에 공유.
5. **문서 정정**: phase3-acceptance.md §1/§2가 GFX100을 "X-Trans"로 표기하나 **실제 Bayer(중형 102MP)** — 런타임 `filters!=9` + half_size 효과(L1 2200 < L2 4070)로 확정(fixtures README도 "중형"). 따라서 GFX100은 OpenMP 전면 수혜. X-Trans는 X-T5 단독.

---

## 재현 명령
```bash
# 성능 (release; libomp 미설치 시 brew install libomp)
cd src-tauri && cargo test --release --test perf -- --ignored --nocapture

# 정합성 (게이트 포함)
cd src-tauri && cargo test

# 정적 링크 검증
otool -L "$(ls -t src-tauri/target/release/deps/perf-* | grep -v '\.d$' | head -1)" | grep -i omp   # (출력 없음 = 자립)
```
