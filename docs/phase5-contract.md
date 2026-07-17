# Phase 5 계약 — 뷰어 완성도 · 엔지니어링 건전성 · 고도화

> 2026-07-18 객관 평가(사용자 지시)에서 도출된 전 작업의 구현 계약. **어떤 세션에서 이어받아도 이 문서만으로 구현 가능**하도록 요구사항·설계·대상 파일·수용 기준을 명시한다.
> 진행 상태는 [PROCESS.md](./PROCESS.md) Phase 5 체크리스트가 단일 출처. 여기는 사양만 둔다.
> 공통 규칙: 기존 계약(DecodedRaw = linear Rec.2020 f16 + cam_to_rec2020 행렬, AETH 직렬화, LevelReadyPayload)은 절대 불변. 프론트 컨벤션은 `~/.claude/convention/*.md`.

## A. 정확성 결함 (최우선)

### A1. 비-RAW 임베디드 ICC 처리
- **문제**: `decode/common.rs`의 image-크레이트 경로가 ICC를 무시하고 sRGB를 가정 → Display P3 JPEG 과포화. (HEIC/AVIF는 ImageIO가 sRGB로 변환하므로 정상)
- **설계**:
  1. `image::ImageReader`로 디코더를 직접 열어 `ImageDecoder::icc_profile()`(image 0.25, `io/decoder.rs:22`)로 ICC 바이트 취득. `load_from_memory` 대신 `ImageReader::with_format(...).into_decoder()` 경로 사용.
  2. ICC가 없으면 현행 유지(sRGB LUT → linear + sRGB→Rec2020 행렬).
  3. ICC가 있으면 lcms2로 변환. 기존 패턴은 `src-tauri/src/color/display_lut.rs`(ICC → lcms2 Profile → Transform) 참조. 두 전략:
     - **행렬 프로파일**(대부분의 P3/AdobeRGB): lcms2로 프라이머리·TRC 읽어 `RGB→XYZ(D50→D65 Bradford)→Rec2020` 행렬 합성 → 기존 `cam_to_rec2020` 슬롯에 실음. TRC는 픽셀 선형화 시 적용(포인트 샘플 curve eval).
     - **범용(LUT 프로파일 포함) 폴백**: lcms2 Transform(소스 ICC → Rec2020 linear(자체 프로파일 생성: `Profile::new_rgb` D65/Rec2020 프라이머리 + linear TRC))을 픽셀 버퍼에 직접 적용하고 `cam_to_rec2020 = None`(identity) 대신 **행렬을 identity로 Some** 처리(has_color_profile 유지).
     - 구현 단순화를 위해 **범용 폴백 하나로 통일해도 된다**(행렬 경로는 최적화). 단 Transform은 u8/u16 입력 → f32 출력(`PixelFormat::RGB_8`→`RGB_FLT`)로 1회 통과.
  4. sRGB ICC(디스크립션 "sRGB" 또는 프라이머리가 sRGB와 1e-3 이내)면 기존 고속 경로 사용.
- **대상**: `src-tauri/src/decode/common.rs`, `src-tauri/src/color/mod.rs`(필요 시 헬퍼), 테스트 동일 파일.
- **수용 기준**: P3 ICC를 임베드한 PNG/JPEG 픽스처(테스트에서 lcms2로 P3 프로파일 생성·임베드 가능 — PNG iCCP 청크 주입)를 디코드하면 순색 R(255,0,0)의 Rec2020 좌표가 sRGB 가정 대비 P3 프라이머리 기준으로 나와야 함(기대값 수치 비교 1e-2). sRGB/무태그 이미지는 기존 테스트 유지.
- **검증**: `cargo test common::` + 기존 스위트.

### A2. 오류 삼킴 선별 정리
- **문제**: `.catch(() => undefined)` 39곳+, `catch {}` 10곳. 대부분 의도적(fire-and-forget IPC, localStorage)이나 무통보로 사라지면 안 되는 지점 존재.
- **설계**: 전수 조사 후 3분류 — (a) 의도적 무시(주석 불가이므로 그대로), (b) 사용자 통보 필요 → `useToast` 연결, (c) 개발 진단 필요 → `console.error` 대신 tracing 이벤트(IPC로 백엔드 로그) 또는 최소 toast. 최소 수정 대상: `CpuFallbackView.tsx`의 프레임 draw 실패, export 관련 실패 경로, `editStore` 저장 충돌 외 실패.
- **수용 기준**: (b)(c) 지점 목록을 이 문서 하단 부록에 기록하고 각각 처리. 새 스위트 통과.

## B. 빠진 기능 (스펙 명시분)

### B1. 정렬 기준 선택 (FR-1.4)
- **현황**: `src/store/playlist.ts:10` `sortEntries`가 파일명 자연 정렬(Intl.Collator numeric) 고정.
- **설계**:
  1. `SortKey = 'name' | 'captureDate' | 'modifiedDate' | 'fileSize' | 'rating'`, `SortOrder = 'asc' | 'desc'`. settings store에 저장(persist).
  2. 촬영일시·수정일·크기는 백엔드 제공 필요: `ImageEntry`에 `modifiedMs: number | null`, `fileSize: number | null`, `captureMs: number | null` 추가(ts-rs 재생성). `scan::make_entry`에서 fs metadata로 modified/size 채움. captureMs는 스캔 시 EXIF 파싱 비용이 크므로 **지연 로딩**: 정렬 키가 captureDate로 바뀔 때 `probe_capture_ms` 커맨드(kamadak-exif, 배치)로 채워 넣고 playlist에 병합. rating은 organize store에서 조인.
  3. `sortEntries(entries, key, order, ratings)` 순수 함수로 분리(`src/lib/sortEntries.ts` — bun:test 대상). tie-break는 파일명 자연 정렬.
  4. UI: 설정 다이얼로그(또는 필터바)에 정렬 셀렉트 + 방향 토글. 변경 시 currentImageId 유지(인덱스 재계산).
- **수용 기준**: 각 키·방향 정렬 유닛 테스트. `IMG_2 < IMG_10` 유지. 정렬 변경 후 현재 이미지 유지.

### B2. 플래그 내비게이션 ⌘←/⌘→ (FR-1.5)
- **설계**: keymap에 `nav.previousFlagged`/`nav.nextFlagged`(`ArrowLeft/Right` + meta) 추가, App.tsx 키 핸들러에서 organize store의 flag==='pick' 항목 인덱스 목록으로 이동. 필터 목록(activeFilteredList) 범위 내에서 동작. 순환 없음.
- **수용 기준**: 단축키 설정 UI에 자동 노출(SHORTCUT_ACTIONS 기반이므로 추가만으로 됨), i18n 라벨(ko/en) 추가.

### B3. RAW+JPEG 페어 토글 ⌥J (FR-1.6)
- **현황**: `scan/pairing.rs`가 페어 식별, `usePairs.jpegByRaw`(rawId→jpegPath), 필름스트립 배지 존재. 스택 모드에서 보조 JPEG는 리스트에서 숨김.
- **설계**: `view.togglePairJpeg`(`KeyJ` + alt) 단축키. 토글 시 현재 항목이 페어드 RAW면 **JPEG 파일을 임시 표시**: 별도 항목 삽입이 아니라 viewer 소스만 교체 — jpegPath를 `open_path`가 아닌 `registry`에 등록하는 커맨드(`resolve_pair_jpeg(raw_id) -> ImageEntry`)로 imageId를 얻고, uiStore에 `pairOverride: Record<rawId, jpegId | null>` 저장, navigate 시 override된 id로 디코드 요청. 배지 `RAW+JPEG` → `JPEG` 상태 표시. 다시 ⌥J면 RAW 복귀.
- **수용 기준**: 토글 시 L1이 JPEG 디코드로 바뀜(비-RAW 경로 — B 완료로 이미 동작), 편집 상태는 RAW의 것과 분리(imageId가 다르므로 자동 분리), 필름스트립 항목 수 불변.

### B4. 줌 배율 표시
- **설계**: `useViewportProjection`의 model에서 percent 계산(이미 L2 zoom 게이트에서 쓰는 `Math.hypot(model[0]*clientW, ...) / best.width` 로직 재사용 — `src/App.tsx` L2_ZOOM 근처). StatusBar에 `{percent}%` 표시, 클릭 시 100%/fit 토글. 계산 로직은 `shared` 성 유틸로 추출해 App과 StatusBar가 공유.
- **수용 기준**: fit·100%·2x에서 표시값이 각각 fit비율·100·200(±1)이 됨.

### B5. 전체화면
- **설계**: `window.set_fullscreen` IPC 커맨드(`toggle_fullscreen`) + `view.fullscreen`(`KeyF`) 단축키. 전체화면에서 패널·필름스트립 자동 숨김(uiStore에 `isFullscreen`, tauri 이벤트 `onResized`/fullscreen 상태 조회로 동기화), Esc로 해제(macOS 기본).
- **수용 기준**: F 토글 동작, 전체화면 시 뷰포트 외 UI 숨김, 해제 시 이전 레이아웃 복원.

### B6. 배치 Export (FR-14.3)
- **현황**: export 엔진은 단일 이미지(job 단위: begin/tile/finish). ExportDialog는 현재 이미지 대상.
- **설계**:
  1. 프론트 오케스트레이션(엔진 변경 없음): 선택된 imageId 목록을 순차 처리 — exportStore에 `runBatch(imageIds, settings)` 추가, 각 항목당 기존 단일 플로(ensureAethSource→begin→tile→finish) 재사용. `{seq}` 파일명 토큰은 항목 인덱스로 증가.
  2. 진행 UI: ExportDialog에 "선택 N장 내보내기" 모드(선택>1일 때), 항목 x/N + 항목 내 진행률, 취소는 현재 항목 export_cancel 후 잔여 중단.
  3. DNG 배치도 동일 루프(export_dng 반복).
- **수용 기준**: 3장 선택 배치 시 3개 파일 생성·파일명 seq 증가·중간 취소 시 이후 항목 미생성. GPS 미기록 정책 유지.

### B7. 슬라이드쇼
- **설계**: `view.slideshow`(`Digit5`+meta 등 미충돌 키) 또는 메뉴에서 시작. uiStore `slideshow: { intervalMs, active }`, setInterval로 advanceToNextFiltered, 끝 도달 시 정지(순환 없음 정책 유지). 전체화면 연동(B5). 키 입력 시 해제.
- **수용 기준**: 시작/정지, 간격 설정(설정 다이얼로그, 기본 3000ms), 마지막 장에서 자동 정지.

### B8. 파일 조작 (이름 변경·이동·복사)
- **설계**:
  1. 백엔드 커맨드 3종(`rename_image`, `move_images`, `copy_images`) — registry 경로 해석, `std::fs::rename`/copy, 충돌 시 에러 반환(덮어쓰기 금지), 성공 시 registry·catalog 경로 갱신 + `fs:changed` 재사용으로 프론트 리스트 갱신. 사이드카(XMP)·캐시 키(image_id가 경로 해시라면 재계산 — `scan::image_id` 확인 필수: 경로 기반이면 이동=신규 id, 편집 상태 이관 필요 → **catalog에서 old_id→new_id 이관 API 포함**).
  2. 프론트: 컨텍스트 메뉴에 이름 변경(인라인 다이얼로그)·폴더로 이동/복사(tauri dialog 폴더 선택). 다중 선택 지원.
- **수용 기준**: 이름 변경 후 편집 상태·별점 유지(id 이관 검증 테스트 — Rust 단위). 이동 후 원본 폴더 리스트에서 제거.
- **주의**: image_id 정의(blake3 of path?)를 먼저 확인하고 이관 설계를 확정할 것. 편집·organize·history 스토어가 imageId 키다.

### B9. 자동 업데이트 (tauri-plugin-updater)
- **설계**:
  1. `tauri-plugin-updater` + `tauri-plugin-process` 추가, capability에 updater 권한. `tauri.conf.json` `plugins.updater`: pubkey + endpoints(GitHub Releases `latest.json`).
  2. 서명키: `bun tauri signer generate` — **개인키는 사용자 보관 + GitHub Secrets(`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`)**, 공개키만 커밋.
  3. release 워크플로: 빌드 시 updater 산출물(.app.tar.gz + .sig) 생성(`bundle > createUpdaterArtifacts: true`), `latest.json` 생성·릴리스 자산 첨부(스크립트로 버전·서명·URL 조립).
  4. 프론트: 설정 다이얼로그 "업데이트 확인" + 시작 시 자동 확인(기본 on, 설정 가능), 다운로드→재시작 플로.
- **수용 기준**: 구버전 앱에서 신버전 릴리스 감지·설치 시나리오를 로컬 mock 서버(파일 서빙)로 검증. 시크릿 없으면 릴리스는 updater 자산 없이 기존과 동일하게 성공(조건부).
- **차단 요소**: 서명 개인키 생성·시크릿 등록은 사용자 확인 필요(비밀 보관 주체).

### B10. 애니메이션 GIF/WebP 재생
- **설계**: GL 파이프라인에 프레임 스트림을 넣는 대신 **원본 우회 경로**: `aether://localhost/original/{image_id}`(protocol.rs 라우트 추가 — registry 경로의 파일 바이트를 Content-Type과 함께 서빙, 확장자 화이트리스트 gif/webp/png/jpeg만). 프론트 Viewport에서 `entry`가 애니메이션 포맷(백엔드 probe: gif 항상, webp는 ANIM 청크 유무 — `ImageEntry.isAnimated` 필드 추가)이면 GL 캔버스 대신 `<img src=aether original>` 표시(브라우저 네이티브 재생). 편집 패널은 비활성(첫 프레임 편집은 기존 경로 유지 — 토글 제공).
- **수용 기준**: 애니메이션 GIF가 움직이며 표시, 정지 이미지 gif/webp는 기존 GL 경로 유지(isAnimated=false), aether original 라우트는 등록된 id + 화이트리스트 확장자만 서빙(보안 테스트).

## C. 엔지니어링 건전성

### C1. 프론트엔드 테스트 인프라 + 스토어 테스트
- **설계**: bun:test + happy-dom. `bunfig.toml` preload로 DOM 등록. 대상(로직 우선): `store/filter.ts`(matchesFilter), `lib/sortEntries.ts`(B1), `store/crop.ts`(sourceToDisplay/displayToSource/fitRectToRatio), `shortcuts/keymap.ts`(sanitizeOverrides·activeConflicts·serializeBinding), `store/layout.ts`(sanitizePersisted), `components/listSelection.ts`. Tauri IPC 의존 스토어는 ipc 모듈 mock(`mock.module`).
- **수용 기준**: `bun test` 스크립트가 package.json에 추가되고 CI에 편입. 30+ 어서션.

### C2. eslint 도입
- **설계**: eslint 9 flat config + typescript-eslint + react-hooks + react-compiler 플러그인. 컨벤션 자동화: no-restricted-syntax로 `function` 키워드·enum 금지, react-hooks rules. prettier 충돌 없게 eslint-config-prettier. `bun run lint` + CI 편입.
- **수용 기준**: 규칙 위반 0으로 통과(기존 코드 정리 포함), 결정 로그의 "eslint 미도입" 해제 기록.

### C3. E2E 스모크
- **설계**: WebDriver 기반 tauri-driver는 macOS 미지원. 대안: **런타임 스모크 하네스** — 디버그 빌드에 한해 `RAW_VIEWER_E2E=1` 환경변수 시 시작 직후 스크립트된 시나리오(픽스처 열기→navigate→export)를 백엔드에서 구동하고 결과를 exit code로 반환하는 `__e2e` 서브커맨드(기존 `__decode` 패턴). CI에서 실행.
- **수용 기준**: 픽스처 1장 open→L1 ready→raster export 1장 성공이 CI에서 검증됨.

### C4. PRD §11 체크리스트 정정
- **설계**: PROCESS.md 완료 기록과 대조해 PRD §11의 스테일 체크박스를 실제 상태로 갱신(문서만).

## D. 고도화

### D1. 비-RAW L0 고속화
- **설계**: JPEG는 임베디드 EXIF 썸네일(kamadak-exif IFD1) 우선 사용(≥256px일 때), 아니면 zune-jpeg의 다운스케일 없는 현행 유지. HEIC/AVIF는 이미 ImageIO max_pixel_size로 고속. 대형 PNG/TIFF는 현행 유지(빈도 낮음).
- **수용 기준**: EXIF 썸네일 보유 JPEG의 L0 경로가 풀 디코드를 우회(테스트: 썸네일 주입 픽스처).

### D2. 필름스트립 아틀라스 (PRD §1936)
- **설계**: 현행 FilmstripCell이 개별 `<img>`(aether l0) — 가상화로 동시 표시 수십 장 수준이면 병목 아님. **착수 전 측정 필수**: 5천 장 폴더에서 스크롤 프레임 타임 측정 후 문제일 때만 아틀라스(`atlas/{dir_hash}/{page}` WebP 스프라이트) 진행. 측정 결과 기록.

### D3. WebGPU 백엔드 (장기)
- **범위**: compute 히스토그램·NR. wgpu 크레이트 or WebGPU via webview? PRD는 네이티브 compute. **별도 phase 계약 문서 필요**(이 계약 범위 밖, 설계 조사 항목만): wgpu 도입 시 GL 파이프라인과 패리티 전략, f16 스토리지, macOS Metal 백엔드. 이번 phase에서는 조사 문서(docs/webgpu-assessment.md) 작성까지.

### D4. 로컬 보정 (장기, PRD §12.2)
- **범위**: 마스크(브러시/그라디언트/래디얼) + 마스크별 보정 파라미터. EditState 스키마 확장·히스토리·GL 패스 추가 — **별도 phase 계약 필요**. 이번 phase에서는 스키마 초안(docs/local-adjustments-draft.md)까지.

### D5. Windows/Linux (차단)
- 하드웨어 부재로 착수 불가. 계약만 유지(PRD §9.3, platform 트레이트 준비됨). CI 매트릭스에 향후 windows-latest 추가 여지 기록.

## 부록 A. 오류 삼킴 조사 결과 (2026-07-18 조사·조치 완료)

전수: `catch {}` 12곳 · `.catch(() => undefined)` 45곳. 분류:

- **(b) 사용자 통보로 전환 (조치함)**
  - `CpuFallbackView.draw` — CPU 프레임 fetch/디코드 실패가 무통보였음 → 이미지당 1회 toast(`toast.cpuFrameFailed`, failedIdRef 가드)
  - `editStore.resetAll` — 초기화 실패 무통보 → `toast.resetFailed`
  - `editStore.applyServerState` — 프리셋/붙여넣기 후 상태 재적용 실패 무통보 → `toast.applyStateFailed`
- **(a) 의도적 무시 (유지 — 사유)**
  - localStorage/스토어 persist 계열(`settings.persist`, `meta/layout/exportStore` 저장) — 저장 실패는 UX 차단 사유 아님, 다음 기동 시 기본값 복구
  - fire-and-forget IPC(`noteRecent`, `watchDirectory`, `revealItemInDir`, opener 계열, `flushOrganize` 종료 경로) — 부가 기능, 실패해도 주 흐름 유지
  - `glContext` 확장 프로브, `App` 종료 직전 flush(닫힘을 막지 않기 위해 best-effort), `editStore.doSave`의 conflict 재로드(이미 conflict 처리 흐름 내부)
  - 조회 실패 UI가 별도로 있는 곳(메타 패널 `loadFailed`, viewport 에러 UI) — catch는 상태 전이만 담당
- **(c) 진단 로그**: 프론트 공용 로거 부재로 이번 범위에서는 도입하지 않음(도입 시 tracing IPC 브리지 설계 필요 — 후속 결정 사항)

## 부록 B. 검증 공통
- 모든 항목: `cargo test`(+ 신규 유닛) → `bun test`(C1 이후) → `bunx tsc --noEmit` → prettier → 실행 스모크(`__decode`/`__e2e`/수동 절차 명시) 통과 후 체크.
- 커밋: 항목 단위 Conventional Commits, dev 푸시. prod 병합·태그는 웨이브 종료 시.
