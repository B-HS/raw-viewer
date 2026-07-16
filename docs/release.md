# 배포 파이프라인

> 2026-07-16 도입. GitHub Actions 기반, macOS Apple Silicon 단일 타깃.

## 구조

| 워크플로 | 트리거 | 동작 |
|----------|--------|------|
| `.github/workflows/ci.yml` | dev/prod 대상 PR, 수동 실행 | prettier → tsc → clippy(-D warnings) → cargo test → 프론트 빌드 |
| `.github/workflows/release.yml` | `v*` 태그 푸시, 수동 실행 | 태그=버전 일치 검증 → clippy·테스트 → `tauri build` → DMG + SHA256SUMS를 **draft 릴리스**로 업로드 |

비공개 저장소라 macOS 러너 분당 과금 가중치(10배)가 있어 CI는 push마다 돌리지 않고 PR·수동으로 한정했다. 릴리스 워크플로가 자체적으로 검증을 다시 수행하므로 태그 릴리스는 단독으로 안전하다.

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
| `APPLE_CERTIFICATE` | Developer ID Application 인증서 .p12의 base64 (한 줄) | Xcode/개발자 사이트에서 "Developer ID Application" 인증서 발급 → 키체인에서 .p12 내보내기 → `base64 -i cert.p12 \| pbcopy` |
| `APPLE_CERTIFICATE_PASSWORD` | .p12 내보낼 때 지정한 암호 | 직접 지정 |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: 이름 (팀ID)` | `security find-identity -v -p codesigning` 출력의 따옴표 안 문자열 |
| `APPLE_ID` | Apple ID 이메일 | — |
| `APPLE_PASSWORD` | **앱 암호** (계정 비밀번호 아님) | appleid.apple.com → 로그인 및 보안 → 앱 암호 생성 |
| `APPLE_TEAM_ID` | 10자리 팀 ID | developer.apple.com → Membership |

`APPLE_CERTIFICATE`가 있으면 서명, `APPLE_ID`까지 있으면 공증이 자동 활성화된다(워크플로가 시크릿 존재 여부로 분기 — 빈 값이면 건너뜀).

등록 예: `gh secret set APPLE_TEAM_ID --repo B-HS/raw-viewer` (또는 웹 UI).

## 로컬 재현

```sh
bash scripts/sync-vendor.sh && bash scripts/sync-lensfun.sh && bash scripts/fetch-dnglab.sh
bun install && bun run tauri build
```

## 미도입 (추후 결정)

- **자동 업데이트(tauri-plugin-updater)**: 플러그인 도입 + `TAURI_SIGNING_PRIVATE_KEY`/`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 시크릿 + `latest.json` 배포가 필요. 별도 지시 시 진행.
- **Intel(x86_64)·유니버설 빌드**: dnglab x86_64 바이너리 확보와 매트릭스 빌드 필요.
- **cargo deny** 라이선스 게이트: PROCESS.md 결정 로그 2번 참조.
