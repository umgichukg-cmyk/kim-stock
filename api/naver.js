// api/naver.js - v4 - OHLC 매핑 수정 + 안정화
export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: "code required" });

  try {
    let realtimePrice = null;
    let stockName = null;
    let totalInfos = [];

    // 1. 실시간 가격
    try {
      const pollRes = await fetch(`https://polling.finance.naver.com/api/realtime/domestic/stock/${code}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://finance.naver.com/',
          'Accept': 'application/json'
        }
      });
      if (pollRes.ok) {
        const text = await pollRes.text();
        let json = null;
        try { json = JSON.parse(text); } catch {
          const m = text.match(/\{[\s\S]*\}/);
          if (m) try { json = JSON.parse(m[0]); } catch {}
        }
        if (json) {
          const d = json.datas?.[0] || json;
          realtimePrice = Number(String(d.closePrice || d.currentPrice || d.nv || '').replace(/[^0-9]/g,''));
          stockName = d.stockName || d.itemName || d.nm || null;
        }
      }
    } catch(e) { console.log('poll fail', e.message); }

    // 2. 차트 - siseJson
    try {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 120);
      const fmt = (d) => d.toISOString().slice(0,10).replace(/-/g,'');
      
      const chartUrl = `https://fchart.stock.naver.com/siseJson.naver?symbol=${code}&requestType=1&startTime=${fmt(start)}&endTime=${fmt(end)}&timeframe=day`;
      const chartRes = await fetch(chartUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.naver.com/' }
      });
      
      if (chartRes.ok) {
        const text = await chartRes.text();
        // 예: [['20241020','324000','326000','322000','325000','1234567'],...] 또는 [[20241020,324000,326000,322000,325000,1234567],...]
        let data = null;
        try {
          // single quote -> double quote, 그리고 평가
          const jsonText = text.replace(/'/g, '"').trim();
          // siseJson은 끝에 세미콜론 있을 수 있음
          const cleaned = jsonText.replace(/;\s*$/, '');
          data = JSON.parse(cleaned);
        } catch {
          // 수동 파싱 fallback
          const matches = [...text.matchAll(/\[["']?(\d{8})["']?,\s*["']?(\d+)["']?,\s*["']?(\d+)["']?,\s*["']?(\d+)["']?,\s*["']?(\d+)["']?,\s*["']?(\d+)["']?\]/g)];
          data = matches.map(m => [m[1], m[2], m[3], m[4], m[5], m[6]]);
        }

        if (Array.isArray(data)) {
          const arr = data.filter(Array.isArray);
          // siseJson 포맷: [날짜, 시가, 고가, 저가, 종가, 거래량]
          totalInfos = arr.map(a => ({
            localDate: String(a[0]),
            openPrice: String(a[1]),
            highPrice: String(a[2]),
            lowPrice: String(a[3]),
            closePrice: String(a[4]),
            accumulatedTradingVolume: String(a[5]),
            // 호환
            date: String(a[0]),
            close: String(a[4])
          })).filter(x => x.localDate && x.localDate.length === 8);

          // 오래된순 -> 최신순으로 정렬 (프론트는 최신이 0번째여야 함)
          totalInfos = totalInfos.sort((a,b) => String(b.localDate).localeCompare(String(a.localDate)));
          console.log(`fchart ${code} ${totalInfos.length}개 OK`);
        }
      }
    } catch(e) { console.log('fchart fail', e.message); }

    const finalPrice = realtimePrice || (totalInfos[0] ? Number(String(totalInfos[0].closePrice).replace(/[^0-9]/g,'')) : 0);

    return res.status(200).json({
      price: finalPrice,
      closePrice: finalPrice,
      stockName: stockName || code,
      stockCode: code,
      totalInfos: totalInfos,
      _source: totalInfos.length ? `polling+fchart(${totalInfos.length})` : 'polling',
      _debug: { hasRealtime: !!realtimePrice, totalInfosCount: totalInfos.length }
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message, price: 0, totalInfos: [] });
  }
}
