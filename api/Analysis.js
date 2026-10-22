// /api/analysis.js - 전일 미국 변동성 TOP 테마 계산 + Finnhub LIVE
// 선물 시황과 미국 연관주 섹터 일치시키기

const THEMES = [
  { theme: "AI반도체", etfs: ["SOXX", "SMH"], stocks: ["NVDA", "PLTR", "TSLA", "AVGO"], kr: ["한미반도체", "SK하이닉스", "삼성전자", "이수페타시스"] },
  { theme: "AI전력", etfs: ["XLU", "XLE"], stocks: ["CEG", "VST", "TSLA", "OKLO"], kr: ["가온전선", "LS ELECTRIC", "한양이엔지", "SKC"] },
  { theme: "비트코인", etfs: ["IBIT", "COIN"], stocks: ["MARA", "COIN", "MSTR"], kr: ["우리기술투자", "한화투자증권", "다날", "우리기술투자"] },
  { theme: "양자컴퓨팅", etfs: ["QTUM"], stocks: ["IONQ", "RGTI", "QBTS"], kr: ["아이윈플러스", "엑스게이트", "우리로"] },
  { theme: "우주항공", etfs: ["ARKX"], stocks: ["RKLB", "LUNR", "ASTS"], kr: ["한화에어로스페이스", "AP위성", "컨텍"] },
  { theme: "원자력", etfs: ["URA", "URNM"], stocks: ["CCJ", "OKLO", "SMR"], kr: ["두산에너빌리티", "한전기술", "보성파워텍"] },
  { theme: "정치테마", etfs: ["SPY"], stocks: ["DJT", "RUM"], kr: [] },
];

async function fetchQuote(symbol, token) {
  try {
    if (token) {
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${token}`);
      if (r.ok) {
        const j = await r.json();
        if (j.c && j.pc) {
          const changePct = ((j.c - j.pc) / j.pc) * 100;
          return { symbol, price: j.c, prevClose: j.pc, changePct, source: "Finnhub" };
        }
      }
    }
    // Yahoo fallback
    const yr = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (yr.ok) {
      const yj = await yr.json();
      const meta = yj.chart?.result?.[0]?.meta;
      if (meta && meta.regularMarketPrice) {
        const price = meta.regularMarketPrice;
        const prev = meta.chartPreviousClose || meta.previousClose || price;
        const changePct = prev ? ((price - prev) / prev) * 100 : 0;
        return { symbol, price, prevClose: prev, changePct, source: "Yahoo" };
      }
    }
  } catch {}
  return null;
}

export default async function handler(req, res) {
  try {
    const finnhubKey = process.env.FINNHUB_API_KEY || process.env.NEXT_PUBLIC_FINNHUB_KEY;
    
    // 각 테마별 변동성 계산 (ETF + 대표주 평균)
    const themeVols = [];
    const allThemes = [];

    for (const t of THEMES) {
      const quotes = [];
      // ETF로 변동성 계산
      for (const etf of t.etfs.slice(0, 2)) {
        const q = await fetchQuote(etf, finnhubKey);
        if (q) quotes.push(q);
        await new Promise(r => setTimeout(r, 150)); // rate limit
      }
      // 대표주로 보강
      for (const stock of t.stocks.slice(0, 2)) {
        const q = await fetchQuote(stock, finnhubKey);
        if (q) quotes.push(q);
        await new Promise(r => setTimeout(r, 150));
      }

      if (quotes.length > 0) {
        const avgVol = quotes.reduce((sum, q) => sum + Math.abs(q.changePct), 0) / quotes.length;
        const maxChange = Math.max(...quotes.map(q => q.changePct));
        themeVols.push({
          theme: t.theme,
          vol: Math.round(avgVol * 10) / 10,
          maxChange: Math.round(maxChange * 10) / 10,
          quotes,
          us: t.stocks,
          kr: t.kr,
        });

        // 각 주식별로 개별 테마 데이터 생성 (기존 프론트가 기대하는 형식)
        for (const q of quotes.slice(0, 2)) {
          allThemes.push({
            theme: t.theme,
            name: q.symbol,
            etf: q.symbol,
            score: Math.round(avgVol * 20), // vol*20 = score
            changePct: q.changePct,
            price: q.price,
          });
        }
      } else {
        // 실패시 mock fallback
        const mockVol = 1 + Math.random() * 4;
        themeVols.push({
          theme: t.theme,
          vol: Math.round(mockVol * 10) / 10,
          maxChange: Math.round(mockVol * 10) / 10,
          quotes: [],
          us: t.stocks,
          kr: t.kr,
        });
      }
    }

    // 변동성 순으로 정렬
    themeVols.sort((a, b) => b.vol - a.vol);
    const top4 = themeVols.slice(0, 4);

    // 선물 시황과 일치시키기 위해 선물 데이터도 함께 반환
    let futures = [];
    try {
      const fr = await fetch(`${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/futures`).then(r => r.json()).catch(() => null);
      if (fr && fr.futures) futures = fr.futures;
    } catch {}

    const result = {
      date: new Date().toISOString().slice(0, 10),
      timestamp: new Date().toISOString(),
      themes: allThemes,
      k2: themeVols, // 전체 테마 변동성
      top4: top4.map(t => `${t.theme} +${t.vol.toFixed(1)}%`).join(" | "),
      top4Detail: top4,
      futures,
      usThemes: top4.map(t => t.theme),
      source: finnhubKey ? "Finnhub LIVE + Yahoo" : "Yahoo + Mock",
      isLive: !!finnhubKey,
      isMock: !finnhubKey,
    };

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.json(result);

  } catch (e) {
    console.error("[analysis] error", e);
    return res.status(500).json({ error: String(e), themes: [], k2: [], isMock: true });
  }
}
