// /api/naver.js - 90일 일봉 진짜 차트 데이터 (네이버 fchart)
export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: "code required" });
  const cleanCode = String(code).replace(/[^0-9]/g, "").padStart(6, "0").slice(0, 6);

  try {
    // 네이버 차트 API - 일봉
    const url = `https://api.stock.naver.com/chart/domestic/item/${cleanCode}/day?isRealtime=false`;
    const r = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://finance.naver.com/",
      },
    });
    if (!r.ok) throw new Error(`Naver chart HTTP ${r.status}`);
    const j = await r.json();

    // 응답 파싱: { result: { priceInfos, ... } } 또는 배열
    // 다양한 포맷 지원
    let priceInfos = [];
    let stockName = "";
    
    if (j.result && j.result.priceInfos) priceInfos = j.result.priceInfos;
    else if (j.priceInfos) priceInfos = j.priceInfos;
    else if (Array.isArray(j)) priceInfos = j;
    else if (j.result && Array.isArray(j.result)) priceInfos = j.result;

    // totalInfos 형태로 변환 (Q2가 기대하는 포맷)
    // Q2 expects: [{ closePrice, openPrice, highPrice, lowPrice, accumulatedTradingVolume, localDate }]
    const totalInfos = priceInfos.map((x) => {
      // Naver API format: { dt, nv, ov, hv, lv, aq, ... } 또는 다른 포맷
      // dt: 20241019 (YYYYMMDD), nv: 종가, ov: 시가, hv: 고가, lv: 저가, aq: 거래량
      const dt = x.dt || x.localDate || x.date || x.tradingDate || "";
      const closePrice = x.nv || x.closePrice || x.close || x.c || 0;
      const openPrice = x.ov || x.openPrice || x.open || 0;
      const highPrice = x.hv || x.highPrice || x.high || 0;
      const lowPrice = x.lv || x.lowPrice || x.low || 0;
      const volume = x.aq || x.accumulatedTradingVolume || x.volume || 0;
      
      // dt가 number일 수 있음
      const localDate = String(dt).replace(/-/g, "");
      
      return {
        localDate,
        date: localDate,
        closePrice: Number(closePrice),
        openPrice: Number(openPrice),
        highPrice: Number(highPrice),
        lowPrice: Number(lowPrice),
        accumulatedTradingVolume: Number(volume),
        tradingVolume: Number(volume),
      };
    }).filter(x => x.closePrice > 0);

    // 최신 90개만
    const sliced = totalInfos.slice(-90);

    // 현재가
    const last = sliced[sliced.length - 1];
    const price = last ? last.closePrice : 0;

    // 폴백: 만약 totalInfos가 비어있으면 polling API 시도
    if (sliced.length === 0) {
      try {
        const pollUrl = `https://polling.finance.naver.com/api/realtime/domestic/stock/${cleanCode}`;
        const pr = await fetch(pollUrl, {
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        if (pr.ok) {
          const pj = await pr.json();
          const datas = pj.result?.areas?.[0]?.datas || pj.datas || [];
          if (datas.length > 0) {
            const d = datas[0];
            const fakeInfos = [{
              localDate: new Date().toISOString().slice(0, 10).replace(/-/g, ""),
              closePrice: Number(d.nv || d.closePrice || 0),
              openPrice: Number(d.ov || d.openPrice || 0),
              highPrice: Number(d.hv || d.highPrice || 0),
              lowPrice: Number(d.lv || d.lowPrice || 0),
              accumulatedTradingVolume: Number(d.aq || 0),
            }];
            return res.json({
              price: fakeInfos[0].closePrice,
              totalInfos: fakeInfos,
              stockName: d.nm || "",
              _source: "polling",
            });
          }
        }
      } catch {}
    }

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.json({
      price,
      totalInfos: sliced,
      stockName,
      _source: "api.stock.naver.com/chart/domestic/item",
      count: sliced.length,
    });

  } catch (e) {
    console.error("[naver] error", e);
    return res.status(500).json({ error: String(e), code: cleanCode, totalInfos: [] });
  }
}
