# Phase 3a 계약 — 워크플로우 1차 (메타데이터 · 등급 · 필름스트립 · 파일관리)

> PRD FR-1.7, FR-15(부분), FR-16, FR-17.1/17.3, §5.2 기준. Phase 1·2 코드/계약 위에 증축.
> 이미 배선됨(오케스트레이터): tauri-plugin-dialog·opener (Rust init + capabilities + JS 패키지), kamadak-exif/trash/notify 의존성, @tanstack/react-virtual·leaflet.

## 담당

### M (Rust — 메타데이터 · 등급 · 휴지통 · 감시)
소유: `src-tauri/src/types_meta.rs`(신규, ts-rs export — types.rs는 계속 동결), `src-tauri/src/meta/**`(신규), `src-tauri/src/organize/**`(신규), `src-tauri/src/watch/**`(신규), `xmp/`(rating/flag/label 확장), `catalog/`(migration 002), `decode/`(probe_metadata 신설 한정), `commands.rs`·`lib.rs`(추가 배선), `scan/`(watcher 연동 한정).

1. **types_meta.rs**: `ImageMetadata` — PRD §5.2 구조를 camelCase로 (file/camera/lens/exposure/dates/gps/raw/warnings 전 섹션. 셔터는 {num,den}). `OrganizeEntry { imageId, rating: u8, flag: Option<String('pick'|'reject')>, label: Option<String> }`. `FsChangedPayload { kind: 'created'|'removed'|'modified', paths: Vec<PathBuf> }`.
2. **meta/**: `get_metadata(image_id) -> ImageMetadata`. 소스 병합: kamadak-exif(1차: EXIF/GPS/날짜/렌즈) + `decode::probe_metadata`(LibRaw idata/other/sizes: make/model/iso/셔터/조리개/초점거리/센서타입 bayer|xtrans|mono|foveon/CFA/flip/black·white level/cam_matrix 유무) + fs 메타(크기/생성/수정). RAW가 아니면 LibRaw 스킵. 값 없으면 None. 셔터 분수 표기용 num/den 보존. GPS는 소수도(f64) + 고도/방위/속도/타임스탬프. 경고: no-color-profile / unsupported-sensor / corrupt-exif.
3. **organize/**: catalog migration `002_organize.sql` — images에 rating INTEGER DEFAULT 0, flag TEXT, label TEXT 추가. 커맨드 `set_rating(image_ids, rating)`, `set_flag(image_ids, flag: Option<String>)`, `set_label(image_ids, label: Option<String>)`, `get_organize(image_ids) -> Vec<OrganizeEntry>`. 변경 시 catalog 즉시 + xmp 디바운스(EditService 타이머 재사용 또는 동일 패턴) — xmp에 `xmp:Rating`, `xmp:Label`, `aether:Flag` 기록(기존 EditState xmp와 같은 파일에 병합 — xmp/ 모듈이 rating/label/flag 필드를 읽고 쓰도록 확장, aether:state와 공존).
4. **휴지통(FR-15.3)**: `move_to_trash(image_ids) -> Vec<String>`(성공한 id 목록). trash 크레이트. `.xmp` 사이드카 동반 이동. `fs::remove_file` 금지. 복원은 trash 크레이트 API 조사 후 가능하면 `restore_from_trash`, 불가면 커맨드 생략+보고(macOS 제약 명시). 삭제된 항목 registry/스토어/캐시 정리.
5. **watch/**: `watch_directory(dir)` 커맨드 — notify 기반, 200ms 디바운스, 새 디렉토리 감시 시 기존 감시 해제(단일 dir). 지원 확장자만. `fs:changed` 이벤트 emit. modified면 해당 키 디스크캐시·픽셀스토어 무효화.
6. 검증: cargo test (metadata 픽스처 스냅샷 일부 — 5D3의 iso/셔터/조리개 실값, organize CRUD+xmp 병합 라운드트립, watcher는 tempdir 통합테스트).

### V (프론트 — 필름스트립 · 등급 UI · 메타패널 · 컨텍스트메뉴)
소유: `src/components/filmstrip/**`, `src/components/panels/MetaPanel/**`, `src/components/ContextMenu.tsx`, `src/components/StatusBar.tsx`, `src/store/`(organize·filter·meta 스토어 신규, playlist 확장), `src/ipc/`(신규 커맨드 래퍼·이벤트), `App.tsx`, `keymap.ts`. `src/gl/**`·`panels/EditPanel 계열`·`Viewport.tsx` 불가침(레이아웃 배치는 App.tsx에서).

1. **필름스트립(FR-17.1)**: 하단, `⇧Tab` 토글(⌥F도), @tanstack/react-virtual 가로 가상화. 셀 = L0 썸네일 `<img src={aetherUrl('pixels/{id}/l0')}>`(lazy, 로드 실패 시 파일명 박스) + 파일명 + 배지(RAW/편집됨●) + 별점 + 라벨 색 테두리 + 플래그 아이콘. 현재 항목 하이라이트 + 자동 스크롤 센터링. 다중 선택 ⇧클릭(범위)/⌘클릭(토글). 높이 96px 고정(드래그 조절은 후속).
2. **등급(FR-17.3)**: `0`~`5` 별점, `P`/`X`/`U` 플래그, `⌘1`~`⌘5` 라벨(Red/Yellow/Green/Blue/Purple), `⌘0` 해제, `⇧`+키 = 적용 후 다음 이미지. 다중 선택 시 선택 전체 적용. organize 스토어(스캔 후 get_organize 일괄 로드, 변경 시 낙관적 갱신+커맨드).
3. **필터 바**(필름스트립 상단): ★≥N / 플래그 / 라벨 / 편집됨 / RAW만 / 파일명 검색. 필터는 표시 목록만 제한(navigate 대상도 필터 결과 기준).
4. **메타 패널(FR-16)**: `I` 토글(우측, EditPanel과 탭 전환 방식으로 공존 — App 레이아웃에서 패널 스위처). get_metadata 호출(이미지 전환 시). §FR-16.2 섹션 전부(값 없으면 행 숨김), 셔터 `1/250s` 분수 표기, 크기 자동 단위. 행 우클릭 → 값 복사. **GPS 섹션**: 좌표 6자리+DMS 병기, Leaflet 미니맵(높이 200px, 줌 14, 마커, OSM 타일 + `© OpenStreetMap contributors` attribution 필수, GPS 없으면 섹션 숨김, 로드 실패 시 좌표 텍스트만), `좌표 복사`·`Google Maps에서 열기`(opener openUrl)·`Apple 지도에서 열기` 버튼. Leaflet은 dynamic import(코드 스플릿).
5. **컨텍스트 메뉴(FR-15 부분)**: 뷰포트·필름스트립 우클릭 커스텀 DOM 메뉴 — 경로 복사(navigator.clipboard) / Finder에서 보기(`revealItemInDir`) / 편집 설정 복사·붙여넣기(메모리 보관, ⌘⇧C/⌘⇧V — 체크박스 다이얼로그는 후속, 전체 복사) / 편집 초기화 / 별점·라벨 서브메뉴 / 휴지통으로 이동(⌫, 확인 다이얼로그 plugin-dialog `confirm`, 삭제 후 다음 이미지 이동, 필름스트립 목록 제거). 이미지 픽셀 복사(⌘C)는 후속(플랫폼 페이스트보드 필요).
6. **⌘O 파일 열기**: plugin-dialog `open`(파일+디렉토리 허용) → handleOpen. **파일 감시**: 폴더 열 때 watch_directory 호출, `fs:changed` 수신 → created: 정렬 위치에 삽입 / removed: 제거(현재면 다음으로) / modified: 해당 이미지 재디코드 트리거(navigate 재호출).
7. **상태바**: `12/340 · 8192×5464 · 52.3MB · f/2.8 1/250s ISO400` (메타 로드분만).
8. 검증: bun run build + prettier. TS 컨벤션 동일(arrow only·주석 금지·enum 금지 등).

## 공통
- Rust 주석 금지(SPEC-GAP 제외)·unwrap 금지. 다른 에이전트와 동시 작업 — 타 소유 파일 컴파일 에러는 보고만.
- M의 types_meta.rs ts-rs export → V는 생성된 `src/types/*.ts` 사용(직접 수정 금지). V는 M보다 먼저 UI 골격을 잡되 타입 미생성 구간은 M 완료 후 연결(워크플로가 M 보고를 V에 전달).
