
// api/naver.js - 실시간 가격 + 차트 데이터 통합 버전
// Price from polling API + Chart history from integration API = 둘 다 제공

export default async function handler(req, res) {
  const { code, chart } = req.query;
  
  if (!code) {
    return res.status(400).json({ error: "code required" });
  }

  try {
    // 1. 실시간 가격 (polling API) - 가장 정확
    let realtimePrice = null;
    let stockName = null;
    
    try {
      const pollRes = await fetch(`https://polling.finance.naver.com/api/realtime/domestic/stock/${code}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://finance.naver.com/'
        }
      });
      
      if (pollRes.ok) {
        const pollData = await pollRes.json();
        // polling 응답 구조 확인
        if (pollData.datas && pollData.datas[0]) {
          const d = pollData.datas[0];
          realtimePrice = Number(String(d.closePrice || d.currentPrice || d.price || '').replace(/,/g,''));
          stockName = d.stockName || d.itemName || d.name;
        } else if (pollData.closePrice) {
          realtimePrice = Number(String(pollData.closePrice).replace(/,/g,''));
          stockName = pollData.stockName;
        } else if (pollData.price) {
          realtimePrice = Number(String(pollData.price).replace(/,/g,''));
          stockName = pollData.stockName;
        }
        console.log(`[NAVER POLL] ${code} price=${realtimePrice} name=${stockName}`, JSON.stringify(pollData).slice(0,200));
      }
    } catch(e) {
      console.log(`[NAVER POLL] 실패 ${code}`, e.message);
    }

    // 2. 차트 히스토리 (integration API) - totalInfos
    let totalInfos = [];
    let integrationData = null;
    
    try {
      const integRes = await fetch(`https://m.stock.naver.com/api/stock/${code}/integration`, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': `https://m.stock.naver.com/domestic/stock/${code}/total`
        }
      });
      
      if (integRes.ok) {
        const integJson = await integRes.json();
        integrationData = integJson;
        if (integJson.totalInfos && Array.isArray(integJson.totalInfos)) {
          totalInfos = integJson.totalInfos;
          if (!stockName) stockName = integJson.stockName;
          if (!realtimePrice && totalInfos[0]) {
            realtimePrice = Number(String(totalInfos[0].closePrice || '').replace(/,/g,''));
          }
          console.log(`[NAVER INTEG] ${code} totalInfos=${totalInfos.length} name=${stockName}`);
        }
      }
    } catch(e) {
      console.log(`[NAVER INTEG] 실패 ${code}`, e.message);
    }

    // 3. Trend API 추가 시도 (90일용)
    if (totalInfos.length < 20) {
      try {
        const trendRes = await fetch(`https://m.stock.naver.com/api/stock/${code}/chart?periodType=day&lineCount=90`, {
          headers: {
            'User-Agent': 'Mozilla/5.0'
          }
        });
        if (trendRes.ok) {
          const trendJson = await trendRes.json();
          if (trendJson && trendJson.length > totalInfos.length) {
            // trend 형식 변환
            totalInfos = trendJson.map(t => ({
              localDate: t.dt || t.date,
              closePrice: t.closePrice || t.close || t.c,
              openPrice: t.openPrice || t.open || t.o,
              highPrice: t.highPrice || t.high || t.h,
              lowPrice: t.lowPrice || t.low || t.l,
              accumulatedTradingVolume: t.accumulatedTradingVolume || t.volume || t.v,
              ...t
            }));
            console.log(`[NAVER TREND] ${code} ${totalInfos.length}개`);
          }
        }
      } catch(e) {}
    }

    // 4. 최종 응답 - 가격 + 차트 둘 다
    const finalPrice = realtimePrice || (totalInfos[0] ? Number(String(totalInfos[0].closePrice).replace(/,/g,'')) : 0);
    
    const response = {
      price: finalPrice,
      closePrice: finalPrice,
      stockName: stockName || code,
      stockCode: code,
      totalInfos: totalInfos, // 차트용!
      _source: realtimePrice ? 'polling-domestic+integration' : 'integration',
      _debug: {
        hasRealtime: !!realtimePrice,
        totalInfosCount: totalInfos.length,
        stockName
      }
    };

    // 차트만 요청한 경우도 totalInfos 포함
    console.log(`[NAVER FINAL] ${code} price=${finalPrice} totalInfos=${totalInfos.length} name=${stockName}`);

    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=60');
    return res.status(200).json(response);

  } catch (err) {
    console.error(`[NAVER ERROR] ${code}`, err);
    return res.status(500).json({ 
      error: err.message, 
      code,
      price: 0,
      totalInfos: []
    });
  }
}
