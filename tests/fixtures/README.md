# 테스트 픽스처 (RAW 코퍼스)

AetherLens 디코딩/렌더 파이프라인 검증용 RAW 샘플이다. **파일 자체는 저장소에 커밋하지 않으며**, 스크립트로 내려받는다.

## 출처

- 전부 **[raw.pixls.us](https://raw.pixls.us/)** (PIXLS.US RAW 샘플 데이터베이스)에서 받는다.
- 다운로드 링크는 사이트의 정본 인덱스(`json/getrepository.php`)가 제공하는 `getfile.php/<id>/nice/<파일명>` 직링크를 사용한다.

## 라이선스

- **Tier‑1 16개 샘플은 모두 CC0 1.0 (퍼블릭 도메인 헌정)** 이다. raw.pixls.us의 기본 뷰가 CC0 세트이며(`?noncc0` 뷰만 비‑CC0), 아래 목록은 CC0만 선별했다.
- **예외: 없음.** 16개 전부 CC0로 확인되었다. 향후 CC0가 아닌 샘플을 추가할 경우 이 표에 라이선스를 개별 표기한다.

## 받는 법

```bash
scripts/fetch-fixtures.sh        # Tier-1 → tests/fixtures/tier1/
scripts/make-tier2-fixtures.sh   # Tier-1 로부터 Tier-2 엣지케이스 생성 → tests/fixtures/tier2/
```

- `fetch-fixtures.sh`: 순차 다운로드(raw.pixls.us 부하 배려), 이미 있으면 건너뜀, `curl -L --fail --retry 2`, User-Agent `AetherLens-fixtures/0.1 (dev)`.
- `make-tier2-fixtures.sh`: Tier‑1을 먼저 받은 뒤 실행한다. 잘린 파일(10/50/90%)·대소문자 확장자·비ASCII 파일명 케이스를 만든다.

## Tier‑1 목록 (16종)

| 슬러그 | 카메라 | 포맷 | 라이선스 | 상태 |
|--------|--------|------|----------|------|
| canon-eos-r5 | Canon EOS R5 | CR3 | CC0 | 정확 |
| canon-eos-5d-mark-iii | Canon EOS 5D Mark III | CR2 | CC0 | 정확 |
| canon-eos-r7 | Canon EOS R7 | CR3 | CC0 | 정확 |
| sony-a7r-iv | Sony A7R IV (ILCE‑7RM4) | ARW | CC0 | 정확 |
| sony-a1 | Sony A1 (ILCE‑1) | ARW | CC0 | 정확 |
| nikon-z8 | Nikon Z8 (Z 8) | NEF | CC0 | 정확 (고효율 압축 NEF) |
| nikon-d850 | Nikon D850 | NEF | CC0 | 정확 |
| fujifilm-x-t5 | Fujifilm X‑T5 | RAF | CC0 | 정확 (X‑Trans) |
| fujifilm-gfx-100 | Fujifilm GFX 100 | RAF | CC0 | 정확 (중형) |
| panasonic-s5 | Panasonic S5 (DC‑S5) | RW2 | CC0 | 정확 |
| om-system-om-1 | OM System OM‑1 | ORF | CC0 | 정확 |
| leica-q2 | Leica Q2 | DNG | CC0 | 정확 |
| apple-iphone-12-pro | Apple iPhone 12 Pro | DNG (ProRAW) | CC0 | **대체** |
| pentax-k-3-mark-iii | Pentax K‑3 Mark III | PEF | CC0 | 정확 |
| leica-m-monochrom | Leica M Monochrom | DNG | CC0 | 정확 (모노크롬 센서) |
| sigma-sd-quattro | Sigma sd Quattro | X3F | CC0 | 정확 (Foveon) |

### 대체 내역

- **iPhone 15 Pro → iPhone 12 Pro**: raw.pixls.us에 iPhone 15 Pro 샘플이 없다(수록 최신 = iPhone 12 Pro). iPhone 12 Pro는 **Apple ProRAW(DNG)를 최초로 지원한 기종**이라 포맷·특성(연산형 ProRAW DNG)이 동일하여 대체했다.

## 커밋하지 않는 이유

- **아직 git 저장소가 아니다.** (개인 규칙상 무단 `git init` 금지 — 사용자 지시 대기)
- RAW 원본은 대용량 바이너리다. git 도입 후에는 **git‑lfs**(또는 서브모듈/annex)로 관리할 예정이며, 그전까지는 위 fetch 스크립트로 각자 로컬에 확보한다. `tests/fixtures/tier1/`·`tier2/`는 `.gitignore`에 이미 등록돼 있다.
