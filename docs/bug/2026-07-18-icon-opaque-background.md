# Dock 아이콘 흰 배경 — qlmanage SVG 렌더의 알파 미보존

## 증상
Dock·앱 전환기에서 앱 아이콘의 둥근 사각형 바깥이 투명이 아니라 **흰색 사각형**으로 보임. v0.5.2 아이콘(커밋 0a0979f)부터 존재, 사용자 발견.

## 원인
아이콘 파이프라인의 1024px 래스터화에 `qlmanage -t -s 1024`를 사용했는데, qlmanage 썸네일 렌더는 **SVG의 투명 배경을 흰색으로 합성**한다(모서리 픽셀 RGBA 255,255,255,255 확인). 그 PNG를 `tauri icon`에 넣어 전체 세트(icns 포함)에 흰 배경이 구워졌다.

## 해결
래스터화를 headless Chrome으로 교체 — 투명 배경 플래그가 핵심:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --no-first-run --user-data-dir=<임시 프로필> \
  --default-background-color=00000000 --window-size=1024,1024 \
  --screenshot=<out.png> "file://<icon.svg>"
bun run tauri icon <out.png>
```

소스 SVG는 docs/assets/app-icon.svg (같은 수정에서 선 두께 30→50·배경 대비 상향 — 소형 크기 가독성).

## 검증
CoreGraphics 픽셀 검사(스크래치 pixel.swift): 최종 `icons/128x128.png`·`icon.png`·`icon.icns`(iconutil 추출) 모두 모서리·엣지 RGBA (0,0,0,0), 중앙 주황 (247,153,40,255). dev 실기동 Dock 아이콘 확인.

## 교훈
- 아이콘·이미지 파이프라인은 산출물의 **알파 채널을 픽셀 단위로 검증**한 뒤 커밋한다. 뷰어 눈검사는 흰 배경 위 합성이라 구분 불가.
- qlmanage는 "미리보기 생성기"라 렌더 충실도(알파·색)를 보장하지 않는다 — 래스터화 도구로 쓰지 않는다.
