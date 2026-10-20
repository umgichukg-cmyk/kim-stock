
# 김가네 주식 - 최종 배포 가이드 (한국 가격 정확 버전)

## 왜 GitHub 배포가 필요한가?
- 드래그 업로드: 정적 파일만 -> /api/naver.js 실행 안됨 -> 한국 가격 CORS 차단 -> Mock 가격
- GitHub Import: Vercel이 /api/*.js를 서버 함수로 실행 -> 네이버 우회 -> 실시간 정확

## 배포 방법 (5분)

### 1. GitHub에 업로드
1. github.com -> New repository -> 이름: kim-stock -> Public -> Create
2. Add file -> Upload files -> 이 폴더의 모든 파일 (index.html, vercel.json, api 폴더 전체) 드래그
3. Commit changes

### 2. Vercel에 연결
1. vercel.com -> Add New Project -> Import Git Repository -> kim-stock 선택
2. Framework Preset: Other
3. Environment Variables:
   - FINNHUB_API_KEY = dbb3tf9r01qrv06o8togdbb3tf9r01qrv06o8tp0
4. Deploy -> 1분 대기 -> 주소 생성

### 3. 확인
- https://your-project.vercel.app 접속
- F12 Console에서:
  [KR] /api/naver?code=123010 호출
  [KR] 응답: ... closePrice ...
  -> 성공 시 한국 가격 실시간 표시

- 미국 주식: [Finnhub] 실시간 ● SPY $766...

## 파일 설명
- index.html: 메인 앱 (전일 변동성 TOP 테마 기반 한국 종목 선정)
- api/naver.js: 네이버 금융 프록시 (한국 가격 정확)
- api/finnhub.js: 미국 주식 프록시
- vercel.json: 라우팅 설정
