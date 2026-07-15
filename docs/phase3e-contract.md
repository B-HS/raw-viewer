# Phase 3e 계약 — 수용 기준 자동화 · 성능 실측 · 잔여 P1

> PRD §7.1(성능 목표), §8.2(수용 기준), FR-14.1(워터마크), FR-17.1(필름스트립 높이), FR-17.2(Y 나란히), FR-14.3(배치 실패 요약) 기준. ai-process §9.2에 따라 결과를 docs/quality-assurance/에 기록.

## QA (Rust/스크립트 — 성능 실측 + 수용 기준 자동화)
소유: `src-tauri/tests/perf.rs`(신규 통합테스트, #[ignore] 게이트), `scripts/run-acceptance.sh`, `docs/quality-assurance/phase3-acceptance.md`, 필요 시 decode/pipeline의 성능 관련 미세 수정(보고 후).
1. **성능 하니스**: `cargo test --release --test perf -- --ignored --nocapture` 로 tier1 전 픽스처의 L0(extract_thumb)/L1(decode_half)/L2(decode_full) 시간을 측정·표 출력(중앙값 3회). PRD §7.1 목표(P1 60ms/P2 250ms/P3 1.2s — 기준기는 M1 8GB, 현 하드웨어는 근사 참고)와 대비 표.
2. **X-Trans L1 성능 판정**: X-T5 L1이 release에서도 250ms 목표 대비 크게 초과하면 원인(단일 스레드 Markesteijn full-res) 정량화하고 **개선안 보고만**(예: LibRaw OpenMP 활성화 검토, X-Trans L1을 half_size+user_qual=0로 낮추는 트레이드오프) — 구현 변경은 하지 말 것.
3. **수용 기준 자동 점검(§8.2 중 자동화 가능분)**을 scripts/run-acceptance.sh로: 16기종 디코드 통과(cargo test 결과 인용) · 원본 mtime/해시 불변(테스트 존재 인용) · xmp 라운드트립 · cargo deny licenses ok · `nm -gU` AMaZE 심볼 부재 · dnglab --version · licenses html 존재 · fixtures 16개. 결과를 **docs/quality-assurance/phase3-acceptance.md**에 §8.2 항목별 체크박스(자동 통과/자동 실패/수동 확인 필요)로 정리 — 수동 항목(스크린 확인·Slack 붙여넣기·Dock 우클릭·LR 상호운용 등)은 확인 방법을 한 줄씩 기재.
4. cargo test(디버그) 기존 241 유지.

## P1 (프론트+미세 Rust — 잔여 P1 기능)
소유: 프론트 `src/components/**`(ExportDialog·Filmstrip·Viewport 비교·배치 UI), `src/gl/`(비교 나란히 필요분), Rust `src-tauri/src/export/watermark.rs`(신규)+finish 훅+types_export 워터마크 필드(additive), commands 배선.
1. **워터마크(FR-14.1)**: ExportDialog에 텍스트 워터마크(내용/크기 %/불투명도/9방향/여백) — 프론트가 출력 크기 기준 워터마크 레이어 PNG를 canvas2d로 생성 → `export_set_watermark(job_id, Request raw body=PNG)` 신규 커맨드 → Rust finish에서 인코딩 직전 알파 합성(OETF 후 8/16bit 공간). PNG 이미지 워터마크는 파일 선택으로 동일 경로. 설정은 export preset처럼 localStorage 유지.
2. **필름스트립 높이 드래그(FR-17.1)**: 60~200px 드래그 핸들, plugin-store 영속.
3. **Y 비교 나란히(FR-17.2)**: `Y` 키 — 캔버스 2분할(같은 엔진, Before|After 나란히 렌더 — pass8 이중 뷰포트 또는 스플릿 확장으로 구현 자유, 줌/팬 동기), `⇧Y` 기존 스플릿 유지.
4. **배치 실패 요약(FR-14.3)**: 배치 완료 후 실패 목록 다이얼로그 + 재시도 버튼(실패분만 재실행).
5. i18n ko/en 동시 추가, bun run build + prettier 검증.

## 공통
git 금지·스타일·동시작업 규칙 동일. QA와 P1은 병렬(파일 겹침 없음 — types_export는 P1만). 오케스트레이터가 통합·커밋·dev 푸시.
