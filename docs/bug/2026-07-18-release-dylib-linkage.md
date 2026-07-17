# v0.1.1 릴리스 앱 실행 즉시 크래시 — Homebrew lcms2 동적 링크

## 증상
v0.1.1 릴리스 DMG로 설치한 앱이 실행 즉시 크래시. macOS 다이얼로그 "raw-viewer cannot be opened because of a problem."

## 원인
크래시 리포트(`~/Library/Logs/DiagnosticReports/raw-viewer-2026-07-18-003301.ips`)의 dyld 종료 사유:

```
Library not loaded: /opt/homebrew/opt/little-cms2/lib/liblcms2.2.dylib
```

`lcms2-sys` 크레이트의 기본 피처가 `dynamic`(pkg-config 탐지) + `static-fallback`이다. 로컬에는 lcms2가 미설치라 static-fallback으로 소스 정적 빌드가 되어 문제가 없었지만, **GitHub macOS 러너에는 lcms2(little-cms2)가 사전 설치**되어 있어 링커가 Homebrew dylib을 동적 링크했고, 번들이 자기완결적이지 않게 배포됐다. 서명·공증은 이를 잡지 못한다.

## 해결
1. `src-tauri/Cargo.toml`: `lcms2 = { version = "6", features = ["static"] }` — `static` 피처는 pkg-config를 우회하고 vendored 소스를 항상 정적 빌드한다 (`lcms2-sys/src/build.rs`의 `requires_static_only` 확인).
2. 재발 방지 가드: release 워크플로에 "Verify bundle is self-contained" 스텝 추가 — 번들 내 실행 파일의 `otool -L`에 `/opt/homebrew`·`/usr/local` 경로가 나오면 릴리스를 실패시킨다.

## 교훈
- 러너 사전 설치 패키지는 로컬에 없는 동적 링크를 만들어낼 수 있다. sys 크레이트는 배포 빌드에서 정적 링크를 명시해야 한다 (libomp를 정적 .a로 강제한 build.rs와 같은 원칙).
- 배포 산출물의 자기완결성은 CI에서 기계 검증한다 (otool 가드).
