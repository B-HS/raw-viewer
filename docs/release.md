# 배포 파이프라인

> 2026-07-16 도입, 2026-07-18 현행화. GitHub Actions 기반, macOS Apple Silicon 단일 타깃. 저장소는 **공개**(2026-07-17 전환, MIT).

## 현재 상태 스냅샷 (2026-07-18)

- 최신 태그: **v0.5.3** (UX 고도화 8건·파일명 "Raw Viewer" 전환) — **publish 완료(2026-07-18, 첫 published 릴리스)**. 이후 릴리스도 draft 생성 → 사용자가 직접 publish. v0.1.1~v0.5.2 draft는 의도적 유지. 워밍 적중 실측: Verify 228s + 번들 빌드 240s.
- **파일명 전환(v0.5.3부터)**: productName="Raw Viewer" — 번들은 `Raw Viewer.app`, DMG 로컬명은 `Raw Viewer_<ver>_aarch64.dmg`. GitHub 자산명은 공백을 점으로 치환하므로 워크플로가 **업로드 전에 선제 리네임**(`Raw.Viewer_*`)해 latest.json URL·SHA256SUMS와 서빙 자산명을 일치시킨다(v0.5.3 draft에서 URL 일치 실검증 완료). 자기완결성 가드는 `.app` 글롭(+부재 시 실패)으로 교정. 기설치본의 구 `raw-viewer.app`은 새 DMG 설치 시 수동 삭제 필요.
- v0.3.1부터 updater 자산(`latest.json`·`.app.tar.gz`·`.sig`) 포함 — 서명 시크릿 등록 완료 상태.
- 자동 업데이트는 **published 릴리스 중 최신**(`releases/latest`)을 본다 — draft만 있으면 업데이트 확인이 실패(무해)하므로, 배포하려면 최신 릴리스를 publish해야 한다. **현재 v0.5.3 publish로 latest.json이 정상 서빙 중(자동 업데이트 활성).**
- 등록된 시크릿 (총 6): `MACOS_CERTIFICATE_P12`, `MACOS_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `TAURI_SIGNING_PRIVATE_KEY`.

## 구조

| 워크플로 | 트리거 | 동작 |
|----------|--------|------|
| `.github/workflows/ci.yml` | dev/prod 대상 PR, 수동 실행 | prettier → tsc → eslint → bun test → clippy(-D warnings) → cargo test(픽스처 포함) → E2E 디코드 스모크(`scripts/e2e-decode.sh`) → 프론트 빌드 |
| `.github/workflows/release.yml` | `v*` 태그 푸시, 수동 실행 | 태그=버전 일치 검증 → bun test → `cargo test --release`(빌드와 컴파일 공유) → Apple 서명 구성(시크릿 조건부, IDENTITY는 .p12에서 자동 추출) → updater 서명 구성(조건부) → `tauri build` → **자기완결성 가드**(번들이 `/opt/homebrew`·`/usr/local` dylib 링크 시 실패) → DMG·SHA256SUMS·updater 자산·latest.json을 **draft 릴리스**로 업로드 |

설계 근거: CI를 push마다 돌리지 않는 것은 비공개 시절 과금 때문이었으나, 릴리스가 자체 검증을 수행해 태그 릴리스가 단독으로 안전하므로 공개 후에도 유지. clippy는 lint라 PR CI 전용. 릴리스 테스트를 release 프로필로 돌리는 이유는 `tauri build`와 의존성·LibRaw 컴파일을 공유하고 배포와 동일 프로필을 검증하기 위함. 잡은 하나 — 분리하면 러너 셋업·캐시 복원 이중 지불에 테스트(debug)·빌드(release) 간 공유 산출물도 없다.

### 캐시 전략 (2026-07-18 도입 — 릴리스 시간 단축)

- **문제**: 태그로 트리거된 실행은 GitHub Actions 캐시를 **기본 브랜치(prod)에서만** fallback 복원하는데, prod에는 어떤 워크플로도 돌지 않아 캐시가 생긴 적이 없었다 → 매 릴리스가 콜드 빌드(v0.5.0 실측: cargo test --release 440s + tauri build 282s + vendor·fixtures 재다운로드 57s ≈ 총 14.5분).
- **해결**: `warm-release-cache.yml` — **prod push 시** rust 릴리스 프로필 컴파일(`cargo test --release --no-run`)과 vendor·fixtures 캐시를 prod 스코프에 저장. release.yml의 rust-cache와 `shared-key: release`로 공유하고, 태그 실행에서는 저장 생략(`save-if` — 태그 스코프 저장은 이후 실행이 못 쓴다).
- **운영 주의**: prod push 직후 바로 태그를 푸시하면 워밍이 안 끝나 그 릴리스는 콜드다. **워밍 완료(Actions "Warm release cache" 그린) 후 태그를 푸시**하면 첫 릴리스부터 적중. 연속 릴리스는 이전 워밍 캐시로 자동 적중.

## 앱 아이콘 재생성

소스는 `docs/assets/app-icon.svg`. 래스터화는 **반드시 headless Chrome `--default-background-color=00000000`**(투명 배경)으로 1024px PNG를 만들고 `bun run tauri icon <png>` 실행 — qlmanage는 알파를 흰색으로 합성하므로 금지([bug/2026-07-18-icon-opaque-background.md](./bug/2026-07-18-icon-opaque-background.md)). 산출물 커밋 전 모서리 픽셀 알파 0 검증.

## 릴리스 절차 (확립된 흐름)

1. 버전 상향: `package.json` + `src-tauri/tauri.conf.json` + `src-tauri/Cargo.toml` 세 곳 (+ `cargo check`로 Cargo.lock 갱신).
2. dev 검증·커밋·push → prod 병합·push (`git merge dev -m "chore: merge dev into prod"` — diff 0 확인).
3. **prod push가 트리거한 "Warm release cache" 완료를 기다린 뒤** 태그: `git tag vX.Y.Z && git push origin vX.Y.Z` (태그≠버전이면 워크플로 즉시 실패).
4. Actions 완료(캐시 히트 시 9~12분 실측 — v0.5.1~v0.5.3, 콜드 시 ~15분+) 후 draft 확인 → **사용자가 Publish** → 배포된 앱들이 자동 업데이트 감지.

## 시크릿 상세

### Apple 서명·공증 (등록 완료)

| 시크릿 | 값 |
|--------|-----|
| `MACOS_CERTIFICATE_P12` | Developer ID Application .p12의 base64 한 줄 |
| `MACOS_CERTIFICATE_PASSWORD` | .p12 내보내기 암호 |
| `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` | 공증용 (앱 암호는 appleid.apple.com에서 생성, 팀 ID는 10자리) |
| `APPLE_SIGNING_IDENTITY` | 미등록 — 워크플로가 .p12를 임시 키체인에 넣고 자동 추출. 수동 덮어쓰기 시에만 등록 |

인증서는 반드시 "Developer ID Application" 타입("Apple Development"는 배포 불가). 시크릿이 빠지면 해당 단계만 건너뛰고 무서명 DMG가 나온다(사용자 `xattr -cr` 필요).

### 자동 업데이트 (등록 완료)

- 플러그인: `tauri-plugin-updater`+`tauri-plugin-process`. 엔드포인트 `https://github.com/B-HS/raw-viewer/releases/latest/download/latest.json`, 공개키는 tauri.conf.json 커밋.
- **개인키 = `~/environment/raw-viewer-updater.key`** (2026-07-18 `~/raw-viewer-updater.key`에서 이동 — 자격증명 폴더 통합, 비밀번호 없음). **재생성 금지** — 커밋된 공개키와 쌍이 깨지면 기존 설치 사용자 업데이트 불가. 같은 머신 내 이동이므로 **머신 외부 백업은 여전히 권장.** 시크릿 `TAURI_SIGNING_PRIVATE_KEY` = 파일 내용(비밀번호 시크릿은 불필요 — 워크플로가 빈 값 처리).
- 앱 동작: 시작 시 자동 확인(설정에서 끔 가능) → toast 알림 → 설정 > 업데이트 확인에서 설치·재시작.
- 로컬 릴리스 빌드는 키 env 없으면 `bun run tauri build --config '{"bundle":{"createUpdaterArtifacts":false}}'`.

## 로컬 재현

```sh
bash scripts/sync-vendor.sh && bash scripts/sync-lensfun.sh && bash scripts/fetch-dnglab.sh
bun install && bun run tauri build
```

## 미도입 (추후 결정)
- Intel(x86_64)·유니버설 빌드 — dnglab x86_64 확보 + 매트릭스 필요.
- 릴리스 노트 자동 생성, 릴리스 자동 publish.
