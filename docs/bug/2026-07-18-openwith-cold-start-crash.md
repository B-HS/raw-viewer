# Open With 콜드 스타트 SIGABRT — Opened가 setup보다 먼저 도착

## 증상
Finder에서 사진 우클릭 → Open With → raw-viewer 선택 시(앱이 꺼져 있을 때) 즉시 크래시. 앱이 이미 실행 중일 때의 Open With는 정상. (v0.4.0에서 수정)

## 원인
크래시 리포트: tao 0.35.3 `application_open_urls`(extern "C" ObjC 델리게이트) 프레임에서 `panic_cannot_unwind` → abort.

macOS는 파일 열기 AppleEvent(odoc)를 `applicationDidFinishLaunching` **이전**에 배달할 수 있고, tauri의 `RunEvent::Opened`는 `Ready`(= setup 실행 시점)보다 먼저 온다. 우리 `Opened` 핸들러(`platform::handle_open`)가 `app.state::<OpenQueue>()`를 호출했는데 OpenQueue는 setup에서야 `manage`되므로 **"state() called before manage()" 패닉** → tao가 app delegate 경계에 catch_unwind를 두지 않아 abort.

OpenQueue의 버퍼링 설계(`accept()`가 ready 전이면 큐잉, `frontend_ready`가 drain)는 애초에 이 시나리오용으로 존재했고, **manage 등록 시점만 틀려 있었다.**

## 해결 (커밋: "fix: Open With 콜드 스타트 크래시")
1. `src-tauri/src/lib.rs` — `tauri::Builder::default().manage(platform::OpenQueue::new())`로 이동(빌드 시점 등록 = 이벤트 루프 시작 전). setup의 중복 manage 제거.
2. `src-tauri/src/platform/mod.rs` `handle_open` — `try_state`로 방어(None이면 warn 로그 후 무시), 향후 회귀에도 패닉이 extern "C" 경계에 닿지 않게.

## 검증
디버그 번들을 `open -a raw-viewer.app 사진.jpg`로 콜드 스타트 → 앱 생존, 신규 크래시 리포트 0, 파일 정상 오픈.

## 교훈
- macOS 이벤트 순서: **Opened → Ready(setup) → Window**. Opened 핸들러가 접근하는 상태는 반드시 `Builder::manage`로 등록한다.
- tao/tauri의 ObjC 콜백 경로에서 패닉은 무조건 abort다. 이벤트 핸들러에서는 `state()` 대신 `try_state()` 같은 비패닉 API를 쓴다.
