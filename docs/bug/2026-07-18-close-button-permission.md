# 창 닫기 버튼 무반응 — window 권한 부재

## 증상
macOS에서 창의 닫기(빨간) 버튼을 눌러도 창이 닫히지 않음. Dock 우클릭 종료로만 종료 가능. (v0.4.0에서 수정)

## 원인
tauri v2는 JS에서 `onCloseRequested` 리스너를 등록하면 네이티브 닫기를 코어가 가로채(`prevent_close`) JS에 위임한다. 위임받은 JS의 `close()`/`destroy()`는 IPC라서 `core:window:allow-close`/`allow-destroy` 권한이 필요한데, capabilities에 없어 **모든 닫기 호출이 권한 거부**됐다. `core:default`의 window 셋은 getter 전용이라 close/destroy를 포함하지 않는다(tauri build.rs의 PLUGINS 정의). 첫 시도에서 `close()`가 reject된 뒤 `closingRef` 가드가 true로 남아 flush 재시도도 막혔다.

## 해결 (커밋: "feat: 커스텀 타이틀바 ... + 창 닫기 버그 수정")
1. `src-tauri/capabilities/default.json`에 `core:window:allow-close`·`allow-destroy`(+타이틀바용 minimize/toggle-maximize/is-maximized/start-dragging) 추가.
2. `src/App.tsx` onCloseRequested: flush 후 `destroy()` 1회 호출(CloseRequested 재왕복 제거), 실패 시 `closingRef` 복구.

## 교훈
- tauri v2에서 JS 쪽 창 조작(setter 계열)은 전부 개별 permission이 필요하다. `core:default`는 getter만 준다.
- `onCloseRequested` 핸들러가 throw하면 @tauri-apps/api 래퍼의 후속 `destroy()` 분기도 건너뛴다 — 닫기 경로의 예외는 반드시 잡아야 한다.
