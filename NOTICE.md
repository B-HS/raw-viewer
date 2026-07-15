# NOTICE — 서드파티 라이선스 고지

raw-viewer 본체는 **MIT 라이선스**로 배포된다. 아래는 번들되었거나 향후 번들될 서드파티 구성요소의 라이선스 고지다. (근거: `docs/PRD.md` §10, 절대 규칙 R4 — GPL/AGPL 코드 링크 금지)

## LibRaw — RAW 디코딩

- **라이선스: CDDL‑1.0 (선택).** LibRaw는 **LGPL‑2.1 / CDDL‑1.0 이중 라이선스**이며, 사용자는 둘 중 하나를 선택한다. raw-viewer는 **CDDL‑1.0을 선택**한다.
- **선택 이유:** CDDL은 **파일 단위(file‑level) copyleft**다. LibRaw 소스 파일을 **수정하지 않는 한**, 정적 링크하더라도 raw-viewer 본체는 MIT를 유지한다. (LGPL을 택하면 정적 링크 시 재링크 가능한 오브젝트 제공 의무가 생겨 배포가 복잡해진다.)
- **소스: `src-tauri/vendor/libraw/` 에 공식 릴리스를 무수정(UNMODIFIED)으로 벤더링**한다. 저작권 헤더를 유지하고 어떤 파일도 변경하지 않는다. 버전·sha256은 `src-tauri/libraw.pin`에 고정하고 `scripts/sync-vendor.sh`로 재현·업데이트한다.
- **라이선스 전문 위치:** 원본 라이선스 텍스트는 **벤더 트리 내부**(`src-tauri/vendor/libraw/` 의 `COPYRIGHT` / `LICENSE.CDDL` 등)에 포함된 원문을 따른다.
- **조건:** ① 소스 무수정, ② 특정 파일을 수정하는 경우 그 파일만 CDDL‑1.0으로 공개, ③ 저작권 표시 유지.
- **GPL demosaic‑pack(AMaZE·AFD·VCD·LMMSE 등)은 링크하지 않는다** (R4). 베이스 LibRaw 내장 알고리즘(AHD/DCB/DHT, X‑Trans용 Markesteijn)만 사용한다. 시스템 패키지(Homebrew/apt)의 libraw 대신 벤더 소스를 직접 빌드해 GPL pack 혼입을 차단한다.

## Lensfun 렌즈 데이터베이스 — 아직 번들되지 않음

- **라이선스: CC‑BY‑SA‑3.0** (XML 데이터베이스).
- Lensfun **C 라이브러리(LGPL‑3)는 링크하지 않는다.** XML DB만 읽고 보정 수식은 자체 구현한다. (PRD §FR‑8)
- 번들 시 다음을 추가한다: 앱 "정보 > 라이선스" 화면과 본 NOTICE에 **저작자 표시** — `Lens profiles from the Lensfun project (CC BY-SA 3.0)`. DB를 수정해 배포하면 **동일 조건(ShareAlike)** 으로 공개한다.

## OpenStreetMap 타일 — 아직 번들되지 않음

- **데이터 라이선스: ODbL (© OpenStreetMap contributors).** GPS/지도 표시에 렌더된 타일을 사용할 경우 **저작자 표시 의무**가 발생한다.
- 번들/사용 시 다음을 준수한다: 지도 UI와 본 NOTICE에 `© OpenStreetMap contributors` 명시, 사용하는 타일 제공자의 이용약관(사용량·표기 요건) 동시 준수.

## dnglab sidecar — 번들됨 (v0.7.2)

- **라이선스: LGPL‑2.1.**
- **번들 바이너리:** `src-tauri/binaries/dnglab-aarch64-apple-darwin` (dnglab **0.7.2**, macOS arm64). `tauri.conf.json`의 `bundle.externalBin: ["binaries/dnglab"]`로 등록.
- **업스트림 소스/획득 방법:** https://github.com/dnglab/dnglab — 릴리스 자산 `dnglab-macos-arm64_v0.7.2.zip` (https://github.com/dnglab/dnglab/releases/tag/v0.7.2). 소스는 동일 저장소에서 취득 가능.
- 정적 링크가 아니라 **프로세스 격리(sidecar)** 로 사용한다: `dnglab convert -f <IN> <OUT>` (기본값 = mosaic/CFA 보존, lossless 압축, embed‑raw, preview)를 별도 프로세스(`std::process::Command`, `src-tauri/src/export/dng.rs`)로 실행한다. **프로세스 실행 = 링크 아님 → LGPL 전파 없음.** (PRD §10.2)
- 무수정(UNMODIFIED) 번들이므로 추가 의무는 없다. XMP tag700 주입(보정값 임베드)은 Phase 3c (SPEC‑GAP).
