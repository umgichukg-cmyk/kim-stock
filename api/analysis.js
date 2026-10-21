
export default async function handler(req, res) {
  // 캐시 완전 비활성화 - 오늘 데이터 강제
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');

  const finnhubKey = process.env.FINNHUB_API_KEY;
  const nowKST = new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' });
  const today = new Date().toISOString().slice(0,10); // UTC today
  
  const allKR = [
    { theme: 'AI 반도체', name: 'SK하이닉스', code: '000660', us: 'AI', etf: 'NVDA' },
    { theme: '원전', name: '두산에너빌리티', code: '034020', us: 'Nuclear', etf: 'SMR' },
    { theme: '로봇', name: '레인보우로보틱스', code: '277810', us: 'Robot', etf: 'BOTZ' },
    { theme: '2차전지', name: 'LG에너지솔루션', code: '373220', us: 'Battery', etf: 'TSLA' },
    { theme: '방산', name: '한화에어로스페이스', code: '012450', us: 'Defense', etf: 'ITA' },
    { theme: '조선', name: 'HD현대중공업', code: '329180', us: 'Shipbuilding', etf: 'SHIP' },
    { theme: '전력', name: 'LS ELECTRIC', code: '010120', us: 'Power', etf: 'XLU' },
    { theme: '바이오', name: '삼성바이오로직스', code: '207940', us: 'Bio', etf: 'XBI' },
    { theme: '반도체', name: '삼성전자', code: '005930', us: 'Chip', etf: 'SOXX' },
    { theme: '변압기', name: 'HD현대일렉트릭', code: '267260', us: 'Power', etf: 'XLU' },
  ];

  try {
    let liveData = { newsText: '', quotes: {} };
    let debug = [];

    if (finnhubKey) {
      // 1. 뉴스 (최신)
      try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 4000);
        const r = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${finnhubKey}&_t=${Date.now()}`, { 
          signal: controller.signal,
          cache: 'no-store'
        });
        if (r.ok) {
          const data = await r.json();
          liveData.newsText = data.slice(0,30).map(n => n.headline + ' ' + new Date(n.datetime*1000).toISOString().slice(0,10)).join(' ').toLowerCase();
          debug.push(`뉴스 ${data.length}개`);
        }
      } catch(e) { debug.push(`뉴스실패: ${e.message}`); }

      // 2. 실시간 시세 - 이게 진짜 오늘 데이터!
      const tickers = ['SPY','QQQ','EWY','NVDA','SMR','MARA','IONQ'];
      for (const ticker of tickers) {
        try {
          const controller2 = new AbortController();
          setTimeout(() => controller2.abort(), 2000);
          const qr = await fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${finnhubKey}&_t=${Date.now()}`, {
            signal: controller2.signal,
            cache: 'no-store'
          });
          if (qr.ok) {
            const q = await qr.json();
            liveData.quotes[ticker] = q; // c: current, dp: percent change
          }
        } catch(e) {}
      }
      debug.push(`시세: ${Object.keys(liveData.quotes).join(',')}`);
    }

    // 오늘 급등한 미국 ETF 기준으로 테마 결정 (뉴스보다 정확)
    let usThemes = [];
    const quotes = liveData.quotes;
    
    // 급등 순으로 정렬
    const sorted = Object.entries(quotes)
      .filter(([k,v]) => v && v.dp !== undefined)
      .sort((a,b) => b[1].dp - a[1].dp);

    // 급등 종목 → 한국 테마
    for (const [symbol, data] of sorted) {
      if (data.dp > 1.5) { // 1.5% 이상 급등
        if (['NVDA','SOXX','SMCI'].includes(symbol)) usThemes.push('AI');
        if (['SMR','OKLO','NNE'].includes(symbol)) usThemes.push('Nuclear');
        if (['IONQ','QBTS','RGTI'].includes(symbol)) usThemes.push('AI');
        if (['MARA','COIN','RIOT'].includes(symbol)) usThemes.push('Battery');
      }
    }

    // 뉴스에서도 감지
    const nt = liveData.newsText;
    if (nt.includes('ai') || nt.includes('nvidia') || nt.includes('chip')) usThemes.push('AI');
    if (nt.includes('nuclear') || nt.includes('smr') || nt.includes('oklo')) usThemes.push('Nuclear');
    if (nt.includes('diesel') || nt.includes('power') || nt.includes('energy')) usThemes.push('Power');
    if (nt.includes('bitcoin') || nt.includes('crypto') || nt.includes('mara')) usThemes.push('Battery');

    usThemes = [...new Set(usThemes)];
    if (usThemes.length === 0) usThemes = ['AI', 'Power', 'Nuclear']; // 오늘 기본값

    // 중복 없이 8개
    let themes = [];
    const used = new Set();
    const US_MAP = {
      'AI': ['000660','005930'],
      'Power': ['010120','267260','034020'],
      'Nuclear': ['034020'],
      'Battery': ['373220'],
      'Robot': ['277810'],
      'Defense': ['012450'],
      'Shipbuilding': ['329180'],
      'Bio': ['207940'],
    };

    for (const ut of usThemes) {
      const codes = US_MAP[ut] || ['000660'];
      for (const code of codes) {
        if (themes.length >= 8) break;
        const stock = allKR.find(s => s.code === code);
        if (stock && !used.has(code)) {
          const q = quotes[stock.etf] || {};
          themes.push({ 
            ...stock, 
            score: 90 + (q.dp || 0), 
            usSource: ut, 
            usChange: q.dp || 0,
            rank: themes.length+1 
          });
          used.add(code);
        }
      }
    }
    for (const s of allKR) {
      if (themes.length >= 8) break;
      if (!used.has(s.code)) {
        themes.push({ ...s, score: 85 - themes.length, rank: themes.length+1 });
        used.add(s.code);
      }
    }

    return res.status(200).json({
      date: today,
      kst: nowKST,
      timestamp: Date.now(), // 캐시 방지용
      source: liveData.newsText ? 'finnhub-live-today' : 'fallback',
      usThemes,
      quotes: liveData.quotes, // 오늘 급등률 확인용
      newsSample: liveData.newsText.slice(0,300),
      themes: themes.slice(0,8),
      debug,
      message: `✅ ${today} 미국 발 ${usThemes.join(', ')}`
    });

  } catch (err) {
    return res.status(200).json({
      date: today,
      kst: nowKST,
      source: 'error',
      usThemes: ['AI','Power'],
      themes: allKR.slice(0,8),
      error: err.message,
      timestamp: Date.now()
    });
  }
}
