// api/naver.js - 진짜 네이버 실시간 API
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'code required' });

  const tryFetch = async (url) => {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://finance.naver.com/',
          'Accept': 'application/json, text/plain, */*'
        }
      });
      if (!r.ok) return null;
      const text = await r.text();
      try { return JSON.parse(text); } catch { return null; }
    } catch { return null; }
  };

  // 1순위: 진짜 실시간 polling API - 네이버 금융 메인 페이지가 쓰는 API
  // 이 API가 4215원 같은 실시간 가격 줌
  let data = await tryFetch(`https://polling.finance.naver.com/api/realtime/domestic/stock/${code}`);
  if (data) {
    // 파싱해서 통일된 형식으로 반환
    let price = null, name = null;
    if (data.result?.areas) {
      for (let area of data.result.areas) {
        for (let d of area.datas || []) {
          if (d.nv) {
            price = d.nv;
            name = d.nm;
            break;
          }
        }
      }
    }
    if (data.datas?.[0]) {
      price = price || data.datas[0].closePrice || data.datas[0].nv;
      name = name || data.datas[0].stockName;
    }
    if (price) {
      return res.status(200).json({ 
        price: Number(String(price).replace(/,/g,'')),
        name,
        closePrice: price,
        stockName: name,
        _source: 'polling-domestic',
        raw: data
      });
    }
  }

  // 2순위: query 방식
  data = await tryFetch(`https://polling.finance.naver.com/api/realtime?query=SERVICE_ITEM:${code}`);
  if (data?.result?.areas) {
    for (let area of data.result.areas) {
      for (let d of area.datas || []) {
        if (d.nv) {
          return res.status(200).json({
            price: d.nv,
            name: d.nm,
            closePrice: d.nv,
            stockName: d.nm,
            _source: 'polling-query',
            raw: data
          });
        }
      }
    }
  }

  // 3순위: 기본 API
  data = await tryFetch(`https://api.stock.naver.com/stock/${code}/basic`);
  if (data?.closePrice) {
    return res.status(200).json({
      price: data.closePrice,
      closePrice: data.closePrice,
      stockName: data.stockName,
      _source: 'basic',
      raw: data
    });
  }

  // 4순위: integration (어제 종가)
  data = await tryFetch(`https://m.stock.naver.com/api/stock/${code}/integration`);
  if (data) {
    return res.status(200).json({ ...data, _source: 'integration' });
  }

  return res.status(404).json({ error: 'not found', code });
}
