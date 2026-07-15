# Phase 3d 계약 — 렌즈 보정 · DNG XMP 주입 · 프리셋 IO · 외부 편집기 인도

> PRD FR-8(Lensfun), FR-14.2(DNG XMP tag700), FR-12(프리셋 import/export), FR-15.4(편집 적용본 TIFF 전달) 기준. quick-xml 의존성 준비됨.

## LN (Rust — Lensfun DB + 매칭)
소유: `src-tauri/src/lens/**`, `scripts/sync-lensfun.sh`, `src-tauri/lensfun.pin`, `catalog/migrations/005_lens_overrides.sql`, commands.rs·lib.rs 배선(additive), NOTICE.md Lensfun 절 갱신, `types_lens.rs`(ts-rs).
1. **DB 확보(§10 준수 — C 라이브러리 링크 금지, XML만)**: lensfun 공식 저장소(github.com/lensfun/lensfun) 특정 태그/커밋의 `data/db/*.xml`을 `scripts/sync-lensfun.sh`(libraw sync-vendor.sh 패턴: 버전+sha256 pin, `src-tauri/resources/lensfun/`에 전개, gitignore + pin 커밋)로 재현 가능하게. NOTICE에 CC-BY-SA-3.0 저작자 표시("Lens profiles from the Lensfun project").
2. **파싱(quick-xml)**: camera(maker/model/mount/cropfactor), lens(maker/model/mount/focal/aperture/`<calibration>`의 distortion(poly3|poly5|ptlens)/tca(linear|poly3)/vignetting(pa)) — lazy 로드 + 메모리 인덱스.
3. **매칭**: `find_lens_profile(image_id) -> Option<LensProfileMatch>` — meta의 make/model/lensModel/focal/fNumber로 카메라(crop 정규화)→렌즈 조회, focal/aperture 보간된 계수 반환. `LensProfileMatch { profileId, lensName, distortion: {model, coeffs[]}, tca: {model, coeffs[]}, vignetting: {coeffs[]} | null }`(ts-rs). `list_lens_profiles(query) -> Vec<{id, name}>`(수동 선택용), `set_lens_override(lens_key, profile_id)`(005 테이블).
4. 단위테스트: 파싱(대표 XML 스니펫 픽스처), 보간, 매칭(5D3 + 표준 렌즈 시나리오 — DB에 있는 조합으로).

## DX (Rust — DNG XMP 주입 · 프리셋 IO · 편집본 인도)
소유: `src-tauri/src/export/dng_xmp.rs`(신규)·`export/handoff.rs`(신규), `preset/io.rs`(신규), commands.rs·lib.rs 배선(additive).
1. **DNG XMP tag700 주입(FR-14.2)**: dnglab 산출 DNG(TIFF 컨테이너)의 IFD0에 XMP 패킷(기존 xmp 모듈의 crs+aether 직렬화 재사용) 삽입 — tag 700 존재 시 교체, 없으면 IFD 엔트리 추가(오프셋 보정 필수: 안전한 방식 = 파일 끝에 패킷 append + IFD 재작성). 주입 후 원본 DNG 구조 유효성 검증(우리 meta 파서로 재오픈 + dims 일치). `export_dng` 흐름에 통합(현재 이미지의 EditState 사용). 실패 시 주입 없는 DNG 유지 + 경고 반환.
2. **프리셋 import/export(FR-12)**: `export_preset(preset_id, path)` — 프리셋을 .xmp 파일로(기존 사이드카 writer 재사용, RawFileName 없이) / `import_preset(path) -> PresetInfo` — aether:state 우선, 없으면 crs 근사(source='lr-import').
3. **편집 적용본 인도(FR-15.4)**: `open_with_edited(image_id, app_path)` — 기존 export 파이프라인(16-bit TIFF, sRGB… 아니 ProPhoto? FR-15.4는 TIFF 16-bit만 명시 → **Rec2020 대신 sRGB 16-bit + ICC**로 시작, SPEC-GAP 기록)으로 `{원본폴더}/{name}-Edit.tif` 생성 후 platform.open_with_app 전달. **주의: export 렌더는 프론트 GL 경유이므로**, 이 커맨드는 프론트가 export 파이프라인으로 TIFF를 만든 뒤 호출하는 **2단계 프로토콜**로 설계: `open_with_edited(path, app_path)`(단순 전달)로 축소하고 렌더 오케스트레이션은 FL이.
4. 단위테스트: tag700 주입 라운드트립(dnglab으로 만든 실제 DNG 픽스처 — 테스트에서 5D3를 dnglab convert로 생성), preset io 라운드트립.

## FL (프론트 — 렌즈 UI + gl 패스② 렌즈 보정 + IO UI)
소유: `src/gl/**`(pass② 렌즈 확장), `src/components/panels/LensSection.tsx`(신규), PresetPanel(가져오기/내보내기 버튼), ContextMenu('다음에서 열기' 편집본 옵션), ipc 래퍼, App/keymap 배선.
1. **gl pass② 렌즈 보정(FR-8 표)**: LensProfileMatch 계수를 uniform으로 — distortion 역방향 매핑(poly3/poly5/ptlens) + **bicubic 샘플링**, TCA 채널별 UV 스케일(linear/poly3), vignetting pa 게인(선형 공간 곱). EditState.lens의 distortion/tca/vignette 강도(0~200%)와 autoProfile/profileId 연동. 프로파일 없으면 manualVignette/manualDistortion만.
2. **LensSection**: 자동 프로파일 토글(매칭 결과 렌즈명 표시), 매칭 실패 시 수동 드롭다운(list_lens_profiles 검색) + '기억하기'(set_lens_override), 항목별 토글+강도 슬라이더.
3. **프리셋 IO UI**: PresetPanel에 가져오기(파일 다이얼로그)/내보내기(저장 다이얼로그) — ◈ 아이콘(lr-import).
4. **편집본으로 열기**: ContextMenu '다음에서 열기' → 앱 선택(파일 다이얼로그로 .app 선택, 최근 앱 store 기억) → export 파이프라인으로 {name}-Edit.tif 생성(exportStore 재사용) → open_with_edited 호출.
5. 검증: bun run build + prettier.

## 공통
스타일·동시작업·git 금지 규칙 동일(phase1~3c 계약 참조). LN·DX 병렬 → FL 후속(두 보고 전달). i18n: 신규 문자열은 t() 키로 ko/en 둘 다 추가.
