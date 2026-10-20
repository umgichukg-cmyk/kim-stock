
// api/naver.js - v3 - polling + fchart siseJson - Vercel에서 동작 보장
export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: "code required" });

  try {
    let realtimePrice = null;
    let stockName = null;
    let totalInfos = [];

    // 1. 실시간 가격 - polling API (가장 안정적)
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
        try {
          const json = JSON.parse(text);
          const d = json.datas?.[0] || json;
          if (d) {
            realtimePrice = Number(String(d.closePrice || d.currentPrice || d.nv || '').replace(/,/g,''));
            stockName = d.stockName || d.itemName || d.nm || null;
          }
        } catch(e) {
          // polling sometimes returns JSONP
          const match = text.match(/\{.*\}/);
          if (match) {
            const json = JSON.parse(match[0]);
            const d = json.datas?.[0] || json;
            realtimePrice = Number(String(d.closePrice || d.nv || '').replace(/,/g,''));
            stockName = d.stockName || d.nm;
          }
        }
      }
    } catch(e) { console.log('poll fail', e.message); }

    // 2. 차트 데이터 - fchart siseJson (Vercel에서 가장 안정적, 인증 불필요)
    try {
      const end = new Date();
      const start = new Date();
      start.setDate(end.getDate() - 100); // 100일
      const fmt = (d) => d.toISOString().slice(0,10).replace(/-/g,'');
      
      const chartUrl = `https://fchart.stock.naver.com/siseJson.naver?symbol=${code}&requestType=1&startTime=${fmt(start)}&endTime=${fmt(end)}&timeframe=day`;
      const chartRes = await fetch(chartUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://finance.naver.com/'
        }
      });
      
      if (chartRes.ok) {
        const text = await chartRes.text();
        // 응답: [['20241020', '324000', '326000', '322000', '325000', '1234567'], ...]
        // 파싱
        const clean = text.replace(/'/g, '"').replace(/^\s*\[?\s*/, '[').replace(/,\s*\]?\s*$/, ']');
        try {
          // siseJson은 JSON이 아닌 JS 배열 형태
          const data = JSON.parse(text.replace(/'/g, '"'));
          // 또는 eval 대신 수동 파싱
          if (Array.isArray(data)) {
            totalInfos = data.filter(Array.isArray).map(arr => ({
              localDate: arr[0],
              closePrice: arr[1],
              openPrice: arr[2],
              highPrice: arr[3],
              lowPrice: arr[4],
              accumulatedTradingVolume: arr[5],
              // 호환 필드
              date: arr[0],
              close: arr[1]
            })).filter(x => x.localDate && x.localDate.length === 8);
            totalInfos = totalInfos.reverse(); // 최신이 마지막으로 오도록? siseJson은 오래된순?
            // siseJson은 오래된순으로 오므로 최신이 마지막. 우리는 최신이 첫번째여야 함
            totalInfos = totalInfos.slice().reverse();
            console.log(`fchart ${code} ${totalInfos.length}개`);
          }
        } catch(parseErr) {
          // 수동 파싱 시도
          const lines = text.split('\n');
          const parsed = [];
          for (const line of lines) {
            const m = line.match(/\[\"?(\d{8})\"?,\s*\"?(\d+)\"?,\s*\"?(\d+)\"?,\s*\"?(\d+)\"?,\s*\"?(\d+)\"?,\s*\"?(\d+)\"?\]/);
            if (m) {
              parsed.push({
                localDate: m[1],
                closePrice: m[2],
                openPrice: m[3],
                highPrice: m[4],
                lowPrice: m[5],
                accumulatedTradingVolume: m[6]
              });
            }
          }
          if (parsed.length > 0) {
            totalInfos = parsed.reverse(); // 최신 먼저
            console.log(`fchart manual ${code} ${totalInfos.length}개`);
          } else {
            console.log(`fchart parse fail ${code}: ${text.slice(0,200)}`);
          }
        }
      }
    } catch(e) { console.log('fchart fail', e.message); }

    // 3. integration API 추가 시도 (가능하면)
    if (totalInfos.length === 0) {
      try {
        const integRes = await fetch(`https://m.stock.naver.com/api/stock/${code}/integration`, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (integRes.ok) {
          const j = await integRes.json();
          if (j.totalInfos?.length) {
            totalInfos = j.totalInfos;
            if (!stockName) stockName = j.stockName;
            if (!realtimePrice) realtimePrice = Number(String(j.totalInfos[0]?.closePrice || '').replace(/,/g,''));
          }
        }
      } catch(e) {}
    }

    const finalPrice = realtimePrice || (totalInfos[0] ? Number(String(totalInfos[0].closePrice).replace(/,/g,'')) : 0);

    const response = {
      price: finalPrice,
      closePrice: finalPrice,
      stockName: stockName || code,
      stockCode: code,
      totalInfos: totalInfos,
      _source: totalInfos.length ? `polling+fchart(${totalInfos.length})` : 'polling',
      _debug: {
        hasRealtime: !!realtimePrice,
        totalInfosCount: totalInfos.length
      }
    };

    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=60');
    return res.status(200).json(response);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message, price: 0, totalInfos: [] });
  }
}
