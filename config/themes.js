// 테마 설정 - 이 파일만 고치면 테마와 종목을 바꿀 수 있습니다.
//
// us: 테마의 움직임을 대표하는 미국 종목/ETF 티커 (Yahoo Finance 기준)
// kr: 그 테마에 연결된 한국 종목 { name: 종목명, code: 6자리 종목코드 }
//
// 종목코드는 네이버 금융 주소에서 확인할 수 있습니다.
// 예) https://finance.naver.com/item/main.naver?code=005930 → 005930

export const THEMES = [
  {
    id: "ai-semi",
    name: "AI반도체",
    us: ["NVDA", "SOXX", "MU"],
    kr: [
      { name: "SK하이닉스", code: "000660" },
      { name: "삼성전자", code: "005930" },
      { name: "한미반도체", code: "042700" },
      { name: "이수페타시스", code: "007660" },
    ],
  },
  {
    id: "ai-power",
    name: "AI 전력",
    us: ["CEG", "VST", "XLU"],
    kr: [
      { name: "LS ELECTRIC", code: "010120" },
      { name: "HD현대일렉트릭", code: "267260" },
      { name: "효성중공업", code: "298040" },
      { name: "가온전선", code: "000500" },
    ],
  },
  {
    id: "bitcoin",
    name: "비트코인",
    us: ["COIN", "MSTR", "MARA"],
    kr: [
      { name: "우리기술투자", code: "041190" },
      { name: "한화투자증권", code: "003530" },
      { name: "다날", code: "064260" },
    ],
  },
  {
    id: "quantum",
    name: "양자컴퓨팅",
    us: ["IONQ", "RGTI", "QBTS"],
    kr: [
      { name: "엑스게이트", code: "356680" },
      { name: "우리로", code: "046970" },
      { name: "MSDI", code: "123010" },
    ],
  },
  {
    id: "space",
    name: "우주항공",
    us: ["RKLB", "LUNR"],
    kr: [
      { name: "한화에어로스페이스", code: "012450" },
      { name: "AP위성", code: "211270" },
      { name: "컨텍", code: "451760" },
    ],
  },
  {
    id: "nuclear",
    name: "원자력",
    us: ["CCJ", "SMR", "OKLO"],
    kr: [
      { name: "두산에너빌리티", code: "034020" },
      { name: "한전기술", code: "052690" },
      { name: "보성파워텍", code: "006910" },
    ],
  },
  {
    id: "battery",
    name: "2차전지",
    us: ["TSLA", "ALB"],
    kr: [
      { name: "LG에너지솔루션", code: "373220" },
      { name: "삼성SDI", code: "006400" },
      { name: "에코프로비엠", code: "247540" },
      { name: "에코프로", code: "086520" },
    ],
  },
];

// 메인 화면에 보여줄 시장 지표 (Yahoo Finance 심볼)
export const MARKET = [
  // naver: 현재가·전일 대비는 네이버 값을 씀 (Yahoo는 한국 지수 전일 종가가 늦게 바뀔 때가 있음)
  { id: "kospi", name: "코스피", symbol: "^KS11", unit: "", naver: "KOSPI" },
  { id: "kosdaq", name: "코스닥", symbol: "^KQ11", unit: "", naver: "KOSDAQ" },
  { id: "usdkrw", name: "원/달러", symbol: "KRW=X", unit: "원" },
  { id: "btc", name: "비트코인", symbol: "BTC-USD", unit: "달러" },
  { id: "wti", name: "국제유가(WTI)", symbol: "CL=F", unit: "달러" },
  { id: "dow", name: "다우존스", symbol: "^DJI", unit: "" },
  { id: "ndx", name: "나스닥100", symbol: "^NDX", unit: "" },
  { id: "sox", name: "필라델피아 반도체", symbol: "^SOX", unit: "" },
  { id: "sp500f", name: "S&P500 선물", symbol: "ES=F", unit: "" },
  { id: "nasdaqf", name: "나스닥 선물", symbol: "NQ=F", unit: "" },
];

// "미국 시장 브리핑" 탭에 보여줄 항목 (Yahoo Finance 심볼)
export const BRIEFING = {
  indices: [
    { symbol: "^GSPC", name: "S&P500" },
    { symbol: "^IXIC", name: "나스닥" },
    { symbol: "^DJI", name: "다우존스" },
    { symbol: "^RUT", name: "러셀2000" },
    { symbol: "^SOX", name: "필라델피아 반도체" },
    { symbol: "^VIX", name: "VIX 공포지수" },
  ],
  macro: [
    { symbol: "^TNX", name: "미 10년물 금리", kind: "yield" },
    { symbol: "DX-Y.NYB", name: "달러인덱스" },
    { symbol: "CL=F", name: "WTI 유가", unit: "달러" },
    { symbol: "GC=F", name: "금", unit: "달러" },
  ],
  sectors: [
    { symbol: "XLK", name: "기술" },
    { symbol: "XLC", name: "커뮤니케이션" },
    { symbol: "XLY", name: "임의소비재" },
    { symbol: "XLF", name: "금융" },
    { symbol: "XLV", name: "헬스케어" },
    { symbol: "XLI", name: "산업재" },
    { symbol: "XLE", name: "에너지" },
    { symbol: "XLB", name: "소재" },
    { symbol: "XLP", name: "필수소비재" },
    { symbol: "XLU", name: "유틸리티" },
    { symbol: "XLRE", name: "부동산" },
  ],
  // news: 네이버 해외 종목 뉴스 코드
  megacaps: [
    { symbol: "NVDA", name: "엔비디아", news: "NVDA.O" },
    { symbol: "AAPL", name: "애플", news: "AAPL.O" },
    { symbol: "MSFT", name: "마이크로소프트", news: "MSFT.O" },
    { symbol: "GOOGL", name: "알파벳", news: "GOOGL.O" },
    { symbol: "AMZN", name: "아마존", news: "AMZN.O" },
    { symbol: "META", name: "메타", news: "META.O" },
    { symbol: "TSLA", name: "테슬라", news: "TSLA.O" },
    { symbol: "AVGO", name: "브로드컴", news: "AVGO.O" },
  ],
};

// 추천 종목을 뽑을 상위 테마 개수 (전일 상승한 테마 중에서만 고릅니다)
export const TOP_THEMES = 4;
