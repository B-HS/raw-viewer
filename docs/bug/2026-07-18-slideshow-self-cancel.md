# 슬라이드쇼가 켜자마자 조용히 꺼짐 — 정지 리스너가 트리거 키를 재수신

## 증상
S 키로 슬라이드쇼 시작 시 전체화면 진입은 되지만 간격(3s)이 지나도 다음 사진으로 넘어가지 않음. v0.5.0 실사용 검증(B11)에서 발견.

## 원인
슬라이드쇼 effect가 "아무 키 입력이면 정지"용 `window.addEventListener('keydown', stopOnKey)`를 등록한다. React 18의 discrete 이벤트(keydown)는 리스너 실행 중 상태가 동기 커밋·effect까지 플러시될 수 있어, **슬라이드쇼를 켠 그 S keydown의 버블 단계가 방금 등록된 stopOnKey에 도달** → `setSlideshow(false)`로 즉시 꺼졌다. 전체화면 토글 promise는 그 전에 발사되어 전체화면만 남는다. (App의 키 핸들러는 capture 단계라 전파 잔여가 존재.)

## 해결
정지 리스너 등록을 `setTimeout(..., 0)`으로 현재 이벤트 전파가 끝난 다음 태스크로 미룸(cleanup에서 타이머도 해제). S 키·팔레트 Enter 등 어떤 트리거 경로에도 동일하게 안전.

## 교훈
- "켜는 입력"과 "끄는 전역 리스너"가 같은 이벤트 타입이면, 리스너 arming을 트리거 이벤트 전파 종료 이후로 미뤄야 한다. React 18 discrete 이벤트는 커밋·effect가 리스너 안까지 들어올 수 있다.
