# 배포 파이프라인

> 2026-07-16 도입. GitHub Actions 기반, macOS Apple Silicon 단일 타깃.

## 구조

| 워크플로 | 트리거 | 동작 |
|----------|--------|------|
| `.github/workflows/ci.yml` | dev/prod 대상 PR, 수동 실행 | prettier → tsc → clippy(-D warnings) → cargo test → 프론트 빌드 |
| `.github/workflows/release.yml` | `v*` 태그 푸시, 수동 실행 | 태그=버전 일치 검증 → `cargo test --release`(빌드와 release 프로필 컴파일 공유 — debug 중복 컴파일 제거) → `tauri build` → **자기완결성 가드**(번들 실행 파일에 `/opt/homebrew`·`/usr/local` dylib 링크가 있으면 실패) → DMG + SHA256SUMS를 **draft 릴리스**로 업로드 |

비공개 저장소라 macOS 러너 분당 과금 가중치(10배)가 있어 CI는 push마다 돌리지 않고 PR·수동으로 한정했다. 릴리스 워크플로가 자체적으로 검증을 다시 수행하므로 태그 릴리스는 단독으로 안전하다. clippy는 lint(정확성 아님)라 PR CI에만 두고 릴리스에서는 생략한다. 테스트를 release 프로필로 돌리는 이유: 뒤따르는 `tauri build`(release)와 의존성·LibRaw 컴파일을 공유해 전체 시간을 줄이고, 배포되는 것과 동일한 프로필을 검증하기 위함. 잡은 하나로 유지한다 — 분리하면 러너 셋업·캐시 복원을 이중 지불하고 테스트(debug)·빌드(release) 간 공유 산출물도 없다.

## 릴리스 절차

1. `src-tauri/tauri.conf.json`과 `package.json`의 `version`을 올린다 (예: `0.2.0`).
2. dev에서 검증 후 커밋, prod 병합(사용자 승인 절차 준수).
3. 태그 푸시: `git tag v0.2.0 && git push origin v0.2.0`.
4. Actions 완료 후 GitHub Releases의 **draft**를 확인·게시한다.

태그와 `tauri.conf.json` 버전이 다르면 워크플로가 즉시 실패한다.

## 시크릿 (GitHub Settings → Secrets and variables → Actions)

### 지금 당장 필요한 키: 없음

시크릿 없이도 파이프라인은 동작한다 — 서명·공증만 생략된 DMG가 나온다(사용자는 최초 실행 시 `xattr -cr` 필요). 릴리스 업로드는 자동 `GITHUB_TOKEN`을 쓴다.

### 코드 서명 + 공증 (Gatekeeper 경고 제거 — Apple Developer Program 연 $99 필요)

| 시크릿 | 값 | 얻는 방법 |
|--------|-----|-----------|
| `MACOS_CERTIFICATE_P12` | Developer ID Application 인증서 .p12의 base64 (한 줄) | Xcode/개발자 사이트에서 "Developer ID Application" 인증서 발급 → 키체인에서 .p12 내보내기 → `base64 -i cert.p12 \| pbcopy` |
| `MACOS_CERTIFICATE_PASSWORD` | .p12 내보낼 때 지정한 암호 | 직접 지정 |
| `APPLE_ID` | Apple ID 이메일 | — |
| `APPLE_APP_SPECIFIC_PASSWORD` | **앱 암호** (계정 비밀번호 아님) | appleid.apple.com → 로그인 및 보안 → 앱 암호 생성 |
| `APPLE_TEAM_ID` | 10자리 팀 ID (예: `SN98P5V7J4` 형식) | developer.apple.com → Membership |
| `APPLE_SIGNING_IDENTITY` | (선택) `Developer ID Application: 이름 (팀ID)` 전체 문자열 | 미등록 시 워크플로가 .p12에서 **자동 추출**한다. 수동 지정으로 덮어쓸 때만 등록 |

`MACOS_CERTIFICATE_P12`가 있으면 서명, `APPLE_ID`+`APPLE_APP_SPECIFIC_PASSWORD`+`APPLE_TEAM_ID`가 모두 있으면 공증이 자동 활성화된다(워크플로가 시크릿 존재 여부로 분기 — 빈 값이면 건너뜀).

주의: `APPLE_TEAM_ID`(10자리 코드)와 SIGNING_IDENTITY(인증서 이름 문자열)는 다른 값이다 — 팀 ID는 IDENTITY 문자열의 괄호 안에 포함될 뿐이다. 인증서는 반드시 **"Developer ID Application"** 타입이어야 한다("Apple Development" 타입은 배포 서명·공증 불가).

등록 예: `gh secret set APPLE_TEAM_ID --repo B-HS/raw-viewer` (또는 웹 UI).

## 로컬 재현

```sh
bash scripts/sync-vendor.sh && bash scripts/sync-lensfun.sh && bash scripts/fetch-dnglab.sh
bun install && bun run tauri build
```

## 자동 업데이트 (2026-07-18 도입)

- 플러그인: `tauri-plugin-updater` + `tauri-plugin-process`. 엔드포인트 = `https://github.com/B-HS/raw-viewer/releases/latest/download/latest.json`, 공개키는 tauri.conf.json에 커밋됨.
- **서명 개인키**: `~/raw-viewer-updater.key` (이 머신, 비밀번호 없음 — **잃어버리면 기존 사용자에게 업데이트 배포 불가**이므로 안전한 곳에 백업할 것). 활성화하려면 시크릿 2개 등록: `TAURI_SIGNING_PRIVATE_KEY`(키 파일 내용), `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`(빈 값). 시크릿이 없으면 릴리스는 updater 자산 없이 기존과 동일하게 성공한다.
- 릴리스 워크플로가 `.app.tar.gz` + `.sig` + `latest.json`을 생성·첨부한다.
- **주의(차단 요소)**: 저장소가 **비공개**인 동안에는 릴리스 자산 URL에 인증이 필요해 **앱의 자동 업데이트 확인이 실패한다**(조용히 무시됨). 저장소 공개 또는 별도 공개 배포 채널 전까지는 수동 DMG 설치가 실질 경로다.
- 로컬 릴리스 빌드는 키 env가 없으면 `bun run tauri build --config '{"bundle":{"createUpdaterArtifacts":false}}'`로 실행한다.

## 미도입 (추후 결정)
- **Intel(x86_64)·유니버설 빌드**: dnglab x86_64 바이너리 확보와 매트릭스 빌드 필요.
- **cargo deny** 라이선스 게이트: PROCESS.md 결정 로그 2번 참조.
