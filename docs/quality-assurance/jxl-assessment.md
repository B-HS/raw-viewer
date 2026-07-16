# JPEG XL Export 평가 (FR-14.1 P2)

> 평가일: 2026-07-16 · 대상: RAW 뷰어 Export 엔진에 JPEG XL(.jxl) 출력 포맷 추가 가능 여부.
> 결론: **보류(SPEC-GAP).** 현재(2026-07) 프로젝트 라이선스·빌드 정책을 만족하면서 8/16-bit lossless+lossy를 신뢰성 있게 지원하는 순수 Rust 인코더가 없다.

## 배경

- Export 엔진(`src-tauri/src/export/encode.rs`)은 `image` 크레이트로 JPEG/PNG/WebP/TIFF 4포맷을 인코딩하고 각 포맷에 ICC를 임베드한다. 새 포맷은 `RasterFormat` enum + `encode()` 분기 + UI(`ExportDialog`) + 파일명 확장자 + 테스트로 추가하는 확립된 패턴이 있다.
- 제약 (프로젝트 절대 규칙):
  - **R4 / deny.toml**: GPL/AGPL/LGPL 라이선스 크레이트 **불허**. permissive(MIT/BSD/Apache/Zlib 등)만 허용.
  - **벤더 정책 (결정 로그 4)**: C/C++ 의존은 `cc` 크레이트로 소스 직접 컴파일, `configure`/`make`/CMake **미사용**. libjpeg조차 링크하지 않음.

## 후보 평가 (1차 출처 확인)

| 크레이트 | 순수 Rust | 라이선스 | lossless | lossy(VarDCT) | 성숙도 | 판정 |
|---|---|---|---|---|---|---|
| **jxl-encoder** (imazen) 0.3.1 | 예 (`forbid(unsafe_code)`) | **AGPL-3.0-or-later / 상용** | 예(8/16-bit) | 예(8/16-bit+HDR) | 2026-05 초판, AI 보조 개발, "critical paths 리뷰 후 프로덕션 권장" | **불가** — AGPL이 deny.toml/R4 위반 |
| **zune-jpegxl** | 예 | permissive(MIT/Apache/Zlib) | 예(8/16-bit, Gray/RGB(A)) | **아니오(POC)** | POC 인코더 | **부족** — lossy 미지원 |
| **jpegxl-rs** 0.14 (+libjxl 0.11) | 아니오 (libjxl C++ FFI) | 래퍼 permissive / libjxl BSD-3 | 예 | 예 | 성숙(reference) | **보류** — CMake+Clang libjxl C++ 빌드 필요 → 벤더 정책 위반 |
| **jxl-rs** (libjxl 공식 Rust) | 예 | BSD-3-Clause | 디코더 전용 | 디코더 전용 | WIP, **인코더 없음** | **불가** — 인코더 미제공 |

출처:
- jxl-encoder: https://github.com/imazen/jxl-encoder (AGPL-3.0-or-later OR commercial, 순수 Rust, lossless+lossy, 8/16-bit+HDR, v0.3.1 2026-05-02, AI 보조·프로덕션 전 리뷰 권장)
- zune-jpegxl: https://crates.io/crates/zune-jpegxl (lossless-only POC 인코더, 8/16-bit Gray/RGB(A))
- jpegxl-rs: https://crates.io/crates/jpegxl-rs (libjxl 래퍼, vendored 빌드 시 CMake + GCC/Clang 필요, libjxl BSD-3)
- jxl-rs: https://github.com/libjxl/jxl-rs (JPEG XL **디코더** 재구현 WIP, BSD-3, 인코더 없음)

## 결론 — 보류 (SPEC-GAP)

세 가지 필터(순수 Rust · MIT/BSD permissive · 8/16-bit lossless+lossy 신뢰성)를 **동시에** 통과하는 크레이트가 없다.

- lossy+lossless를 모두 갖춘 유일한 순수 Rust 인코더(`jxl-encoder`)는 **AGPL**이라 R4/deny.toml에서 원천 차단된다.
- permissive한 순수 Rust `zune-jpegxl`은 **lossless-only POC**라 "lossless+lossy 신뢰성" 기준 미달.
- 성숙한 `jpegxl-rs`는 **C++ libjxl(CMake) 빌드**를 요구해 프로젝트의 cc-only 벤더 정책과 충돌하고, libjpeg조차 링크하지 않는 현 빌드 철학에 대한 큰 의존성 확대다.

따라서 이번 웨이브에서는 **wire하지 않고 보류**한다. encode.rs 패턴은 준비되어 있으므로 인코더 백엔드 제약만 해소되면 소규모 추가로 탑승 가능하다.

## 재평가 트리거

1. `zune-jpegxl`이 VarDCT lossy를 추가하고 안정화 → permissive라 즉시 `RasterFormat::Jxl`로 탑승(우선 lossless, 이후 lossy). ICC 임베드 경로 확인 필요.
2. permissive(MIT/BSD/Apache) 순수 Rust lossy+lossless 인코더 등장(예: `jxl-encoder` 재라이선스, 또는 `jxl-rs` 인코더 추가).
3. **사용자 승인 하에** C++ libjxl(BSD-3) 벤더 빌드를 수용하기로 정책 변경 → `jpegxl-rs` 또는 libjxl 직접 `cc`/CMake 통합. 벤더 정책·deny.toml 갱신이 수반되는 아키텍처 결정이라 단독 진행하지 않는다.

## 탑승 시 작업 범위(참고)

- `types_export.rs` `RasterFormat`에 `Jxl` 추가(ts-rs 재생성).
- `encode.rs`에 분기 추가 + ICC 임베드(JXL은 ICC 박스 지원).
- `ExportDialog`/파일명 템플릿 확장자·품질 UI, i18n ko/en 문자열.
- 인코딩 라운드트립·ICC 임베드 유닛테스트(encode.rs 기존 패턴).
