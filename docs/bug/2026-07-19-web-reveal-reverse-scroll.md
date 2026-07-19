# 랜딩 페이지 역스크롤 시 reveal 애니메이션 미동작

## 증상
web/index.html 에서 아래로 스크롤 후 위로 되돌아오면, 재진입한 섹션의 `[data-reveal]` 요소가 opacity 0 으로 남아 아무것도 보이지 않는다. 정방향 첫 통과는 정상.

## 원인
hide 가 motion 라이브러리를 우회해 `el.style.opacity = '0'` 인라인 스타일을 직접 썼다. motion 은 요소별 마지막 애니메이션 값(opacity 1)을 내부 캐시로 유지하는데, 실제 DOM(0)과 어긋난 상태에서 재진입 시 `animate(..., { opacity: 1 })` 를 호출하면 "이미 1" 로 판단해 no-op 이 된다. 콘솔 에러 없이 조용히 실패한다.

계측 근거: initScript 로 페이지 IntersectionObserver 를 래핑해 확인 — 역방향에서도 ratio 0.45 이상 엔트리가 정상 전달되어 reveal 분기는 실행됐고, 같은 모듈 인스턴스로 수동 `animate()` 를 호출해도 no-op 임을 재현했다.

## 해결
hide 도 motion 으로 수행해 캐시를 항상 실제 값과 동기화한다.

```js
const hide = (els) => animate(els, { opacity: 0, transform: `translateY(${REVEAL_DISTANCE_PX}px)` }, { duration: 0 })
```

검증: 정방향·역방향 전 구간 reveal 정상, reveal 도중 방향 반전(300ms·250ms 인터럽트) 케이스 정상.

## 교훈
- 애니메이션 라이브러리가 관리하는 속성을 인라인 스타일로 직접 덮지 않는다. 상태를 가진 라이브러리는 우회 쓰기 시점부터 캐시와 DOM 이 어긋나며, 실패가 조용하다.
- headless Chrome `--screenshot` 은 fragment(#section) 로드 시 검은 캡처를 내는 아티팩트가 있어 이런 류 검증에 부적합 — chrome-devtools CLI 의 evaluate_script 로 computed style 을 직접 샘플링하는 편이 결정적이다.
