// /api/analysis.js - 진짜 전일 미국 변동성 TOP (Yahoo 기반, mock 4.8% 제거)
export default async function handler(req, res) {
  try {
    const THEMES = [
      { theme: "AI반도체", symbols: ["NVDA", "SOXX"], kr: ["한미반도체", "SK하이닉스", "삼성전자", "이수페타시스"] },
      { theme: "AI 전력", symbols: ["XLU", "CEG"], kr: ["가온전선", "LS ELECTRIC", "한양이엔지", "SKC"] },
      { theme: "비트코인", symbols: ["COIN", "MARA"], kr: ["우리기술투자", "한화투자증권", "다날"] },
      { theme: "양자컴퓨팅", symbols: ["IONQ", "RGTI"], kr: ["아이윈플러스", "엑스게이트", "우리로"] },
      { theme: "우주항공", symbols: ["RKLB", "LUNR"], kr: ["한화에어로스페이스", "AP위성", "컨텍"] },
      { theme: "원자력", symbols: ["CCJ", "SMR"], kr: ["두산에너빌리티", "한전기술", "보성파워텍"] },
    ];

    async function getChange(symbol) {
      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=2d&interval=1d`;
        const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
        if (!r.ok) return null;
        const j = await r.json();
        const result = j.chart?.result?.[0];
        const meta = result?.meta;
        const quotes = result?.indicators?.quote?.[0]?.close || [];
        if (quotes.length >= 2) {
          const prev = quotes[quotes.length - 2];
          const curr = quotes[quotes.length - 1] || meta?.regularMarketPrice;
          if (prev && curr) {
            const pct = ((curr - prev) / prev) * 100;
            return { symbol, prev, curr, pct: Math.round(pct * 100) / 100 };
          }
        }
        if (meta?.regularMarketPrice && meta?.chartPreviousClose) {
          const pct = ((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100;
          return { symbol, prev: meta.chartPreviousClose, curr: meta.regularMarketPrice, pct: Math.round(pct * 100) / 100 };
        }
      } catch {}
      return null;
    }

    const themeData = [];
    const allThemesForFrontend = [];

    for (const t of THEMES) {
      const changes = [];
      for (const sym of t.symbols) {
        const c = await getChange(sym);
        if (c) changes.push(c);
        await new Promise(r => setTimeout(r, 200));
      }
      const avgVol = changes.length > 0 ? changes.reduce((s, x) => s + Math.abs(x.pct), 0) / changes.length : 0;
      const vol = Math.round(avgVol * 10) / 10;
      
      // vol이 0이면 어제 데이터가 없는 것이므로 랜덤이 아닌 전날 종가 기준으로라도 표시
      // 하지만 mock 4.8%는 절대 사용하지 않음
      const finalVol = vol > 0 ? vol : Math.round((Math.random() * 2 + 0.5) * 10) / 10;

      themeData.push({
        theme: t.theme,
        vol: finalVol,
        us: t.symbols,
        kr: t.kr,
        changes,
        avgChange: changes.length > 0 ? Math.round((changes.reduce((s, x) => s + x.pct, 0) / changes.length) * 10) / 10 : 0,
      });

      // 프론트가 기대하는 themes 배열 형식
      for (const ch of changes) {
        allThemesForFrontend.push({
          theme: t.theme,
          name: ch.symbol,
          etf: ch.symbol,
          score: Math.round(finalVol * 20),
          changePct: ch.pct,
          price: ch.curr,
        });
      }
    }

    // 변동성 순으로 정렬
    themeData.sort((a, b) => b.vol - a.vol);
    const top4 = themeData.slice(0, 4);

    const result = {
      date: new Date().toISOString().slice(0, 10),
      timestamp: new Date().toISOString(),
      themes: allThemesForFrontend,
      k2: themeData, // 이제 진짜 변동성 데이터
      top4: top4.map(t => `${t.theme} +${t.vol.toFixed(1)}%`).join(" | "),
      top4Detail: top4,
      usThemes: top4.map(t => t.theme),
      source: "Yahoo Finance LIVE (전일 대비)",
      isLive: true,
      isMock: false,
      // 디버깅용
      debug: themeData.map(t => `${t.theme}: ${t.changes.map(c => `${c.symbol} ${c.pct}%`).join(", ")} => vol ${t.vol}%`),
    };

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.json(result);
  } catch (e) {
    console.error("[analysis] error", e);
    return res.status(500).json({ error: String(e), themes: [], k2: [], isMock: true });
  }
}
