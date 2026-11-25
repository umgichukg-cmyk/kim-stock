# 김가네 주식 v2 — 세션 안내

로얄서번트(대표 김효성=젠틀맨) 프로젝트. 먼저 `~/.claude/CLAUDE.md`, `D:\ai\golf_weather\docs\policy\direction-2026-11.md`, `D:\ai\golf_weather\docs\standards\README.md` 를 읽는다. 보고는 김실장(`local_3a2fdd94-ad40-4ead-ac38-fb9a62310a23`)에게 한국어로 짧게.

## 무엇
- 가족(젠틀맨 가족 4명)만 쓰는 한국 주식 분석 웹앱. 전날 미국 테마 → 한국 종목을 실제 지표로 100점 점수화.
- 탭: 한국 장중 흐름(첫 화면), 미국 테마 브리핑, 상위 30, 상한가·하한가, 조건 검색(거래량 급증+골든크로스+외국인·기관 순매수), 공모주 청약, 미국·한국 시장 브리핑, 한국 테마, 관심 종목(+키움 계좌), 종목 상세(차트·점수 흐름·뉴스·재무·메모).
- 기능 설명·점수 기준·폴더 구조는 `README.md`에 자세히 있다(이 파일과 겹치게 쓰지 않음).
- 2026-11-26: 젠틀맨이 **판매를 검토** 중. 기능은 그대로, 디자인만 바꾸는 생각. 판매 전 법·자료 점검표는 `docs/sale-check.md`.

## 구조 (짧게)
- 화면: `index.html` + `assets/app.js`(약 2,500줄) + `assets/style.css` + `assets/account.js`(로그인·관심·메모·키움). 빌드 도구 없음, 순수 JS.
- 서버: Vercel 서버 함수 하나 `api/[route].js` → `api/_routes/*.js` (무료 요금제 함수 12개 제한 때문).
- 데이터: API 키 없이 네이버 증권(`m.stock.naver.com`, `api.stock.naver.com`, 뉴스) + Yahoo Finance(`query*.finance.yahoo.com`) 공개 주소를 서버에서 직접 읽음.
- 저녁 계산: GitHub Actions `.github/workflows/scan-market.yml`(평일 19:07·19:12·19:19 등) → `scripts/scan-market.js` → 결과를 `data` 브랜치에 덮어씀(top30·history·kr-briefing·kr-themes·조건 검색·점수 기록).
- 로그인: Supabase(공개용 키만 코드에, 새 가입 막음, 가족 계정 직접 추가, RLS로 본인 것만). 스키마 `supabase/schema.sql`.
- 키움: `kiwoom-relay/` 중계 서버(AWS Lightsail 서울 고정 IP, `kimga-stock.duckdns.org`). **조회 전용, 주문 기능 없음.** OWNER_EMAIL 한 계정만, 운영 주소 두 곳에서 온 요청만 받음.
- 로컬 실행: `npm run dev` → http://localhost:3000 (미리보기 도구 이름 `kim-stock`, `.claude/launch.json`).

## 주소·배포
- 운영: https://kim-stock-liart.vercel.app , https://kim-stock-kimga.vercel.app (둘 다 GitHub `main` 브랜치)
- 미리보기: https://kim-stock-git-rewrite-v2-kimga.vercel.app (`rewrite/v2` 브랜치)
- 작업 브랜치는 `rewrite/v2`. 커밋 → `git push origin rewrite/v2` 로 미리보기 반영.
- **운영 반영은 젠틀맨이 "운영 반영"이라고 말한 뒤에만** `git push origin rewrite/v2:main` 하고, 운영 주소 두 곳이 바뀐 것까지 확인한다. (로컬 `main`은 오래돼 있으니 쓰지 않음)
- 저장소: GitHub `umgichukg-cmyk/kim-stock` (`data` 브랜치는 저녁 계산 결과 전용).

## 가족 제한 방식 (지금)
- 사이트 자체는 **주소를 아는 사람은 누구나 열 수 있음**(로그인 벽 없음). 주소를 알리지 않는 방식 + 하단에 '가족 전용 프로그램' 문구.
- 로그인이 필요한 것: 관심 종목·메모(Supabase, 새 가입 막음).
- 키움 계좌: OWNER_EMAIL 한 계정 + 운영 주소 두 곳만. 미리보기·로컬에서는 연결 안 함(안내 문구만).
- 판매판을 만들면 이 방식은 그대로 쓸 수 없다(`docs/sale-check.md` 참고). **가족 제한을 푸는 것은 젠틀맨 허락 뒤.**

## 지켜 온 규칙
- 데이터를 못 받으면 가짜 값으로 채우지 않고 '불러오지 못함/계산 불가'. 무작위·고정 문구로 지어내지 않는다(v1의 가짜 데이터를 모두 지운 것이 v2의 출발점).
- 화면 문구는 쉬운 한국어, 친구 말투 브리핑은 실시간 숫자로만 자동 작성(AI 생성 아님).
- 점수에 증권사 목표주가·투자의견은 넣지 않고 참고로만 보여줌.
- '매수·매도 권유가 아니에요', '참고용' 안내를 유지. 투자 권유 문구를 새로 만들지 않는다.
- 실제 주식 매매·주문 기능은 만들지 않는다. 키움은 조회만.
- 비밀값(키움 앱키·시크릿, Supabase secret)은 코드·문서·대화에 적지 않는다(`.gitignore`에 키 파일 패턴 있음).
- 커밋 메시지는 한국어로, 무엇이 어떻게 바뀌었는지 한 줄(예: 최근 `git log`).
- Vercel 무료 요금제: 서버 함수 늘리지 말고 `_routes/`에 추가.
- 저녁 계산은 GitHub 혼잡으로 늦을 수 있음(새벽에 돌기도 함). 한 번만 성공해도 반영.

## 진행 현황
- 2026-10-30 시작(v1 Meta AI 번들을 읽을 수 있는 소스로 새로 작성) → 11/25까지 원래 세션 「주식 프로그램 고도화」(local_d83c7ee3…, 대화 약 3,000개)가 젠틀맨과 직접 기능을 키움. 마지막 운영 반영 커밋 `670ba2d`(조건 검색 빈 날 묶음 순서).
- 2026-11-26: 이 세션(판매 준비)이 이어받음. 순서: ① 이 문서 ② `docs/sale-check.md` 판매 전 점검표 ③ 디자인 시안(미리보기에서만, 김프로·유고문 의견은 김실장 경유, 젠틀맨 컨펌 전 운영 반영 안 함).
- 하지 말 것(젠틀맨 허락 전): 운영 배포, 가족 제한 풀기, 판매·소개 페이지 게시, 외부 메일·문의·가입·결제.
