export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const finnhubKey = process.env.FINNHUB_API_KEY;
  const today = new Date().toISOString().slice(0,10);
  const todayNum = parseInt(today.replace(/-/g,'')); // 날짜로 랜덤 시드

  // ===== 40개 풀 - 테마별 한국 종목 대량 풀 =====
  const POOLS = {
    'AI': [
      { theme: 'AI 반도체', name: 'SK하이닉스', code: '000660', etf: 'NVDA' },
      { theme: 'AI 반도체', name: '삼성전자', code: '005930', etf: 'SOXX' },
      { theme: 'HBM 장비', name: '한미반도체', code: '042700', etf: 'NVDA' },
      { theme: '반도체 소부장', name: 'ISC', code: '095340', etf: 'SOXX' },
      { theme: '반도체 기판', name: '이수페타시스', code: '007660', etf: 'NVDA' },
      { theme: '반도체 세정', name: '한양이엔지', code: '045100', etf: 'SOXX' },
      { theme: 'AI 서버', name: 'SKC', code: '011790', etf: 'SMCI' },
      { theme: 'AI 전력', name: '가온전선', code: '000500', etf: 'NVDA' },
    ],
    'Nuclear': [
      { theme: '원전 대장', name: '두산에너빌리티', code: '034020', etf: 'SMR' },
      { theme: '원전 기자재', name: '한전기술', code: '052690', etf: 'SMR' },
      { theme: 'SMR', name: '우리기술', code: '032820', etf: 'OKLO' },
      { theme: '원전 제어', name: '우진', code: '105840', etf: 'SMR' },
      { theme: '원자력', name: '보성파워텍', code: '006910', etf: 'SMR' },
      { theme: '원전 부품', name: '한신기계', code: '011700', etf: 'SMR' },
    ],
    'Power': [
      { theme: '전력 대장', name: 'LS ELECTRIC', code: '010120', etf: 'XLU' },
      { theme: '변압기', name: 'HD현대일렉트릭', code: '267260', etf: 'XLU' },
      { theme: '전선', name: '일진전기', code: '103590', etf: 'XLU' },
      { theme: '전력기기', name: '효성중공업', code: '298040', etf: 'XLU' },
      { theme: '변압기', name: '제룡전기', code: '033100', etf: 'XLU' },
      { theme: 'ESS', name: 'LS ELECTRIC', code: '010120', etf: 'XLU' },
    ],
    'Battery': [
      { theme: '2차전지', name: 'LG에너지솔루션', code: '373220', etf: 'TSLA' },
      { theme: '양극재', name: '에코프로비엠', code: '247540', etf: 'TSLA' },
      { theme: '동박', name: 'SKC', code: '011790', etf: 'TSLA' },
      { theme: '비트코인', name: '우리기술투자', code: '041190', etf: 'MARA' },
      { theme: '가상자산', name: '한화투자증권', code: '003530', etf: 'COIN' },
    ],
    'Defense': [
      { theme: '방산', name: '한화에어로스페이스', code: '012450', etf: 'ITA' },
      { theme: '방산', name: 'LIG넥스원', code: '079550', etf: 'ITA' },
      { theme: '방산', name: '현대로템', code: '064350', etf: 'ITA' },
    ],
    'Robot': [
      { theme: '로봇', name: '레인보우로보틱스', code: '277810', etf: 'BOTZ' },
      { theme: '로봇', name: '두산로보틱스', code: '454910', etf: 'BOTZ' },
      { theme: '협동로봇', name: '뉴로메카', code: '348340', etf: 'BOTZ' },
    ],
    'Shipbuilding': [
      { theme: '조선', name: 'HD현대중공업', code: '329180', etf: 'SHIP' },
      { theme: '조선', name: '한화오션', code: '042660', etf: 'SHIP' },
      { theme: '조선기자재', name: 'HD현대마린솔루션', code: '443060', etf: 'SHIP' },
    ],
    'Bio': [
      { theme: '바이오', name: '삼성바이오로직스', code: '207940', etf: 'XBI' },
      { theme: '바이오', name: '알테오젠', code: '196170', etf: 'XBI' },
      { theme: 'CDMO', name: 'SK바이오팜', code: '326030', etf: 'XBI' },
    ]
  };

  try {
    let newsText = '';
    let quotes = {};
    let debug = [];

    if (finnhubKey) {
      // 뉴스
      try {
        const r = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${finnhubKey}&_t=${Date.now()}`, { cache: 'no-store' });
        if (r.ok) {
          const data = await r.json();
          newsText = data.slice(0,30).map(n => n.headline).join(' ').toLowerCase();
          debug.push(`뉴스 ${data.length}개`);
        }
      } catch(e){}

      // 시세 (오늘 급등 확인)
      const tickers = ['SPY','QQQ','NVDA','SMR','OKLO','MARA','COIN','IONQ','XLU','TSLA'];
      for (const t of tickers) {
        try {
          const qr = await fetch(`https://finnhub.io/api/v1/quote?symbol=${t}&token=${finnhubKey}&_t=${Date.now()}`, { cache: 'no-store' });
          if (qr.ok) {
            const q = await qr.json();
            if (q.dp !== undefined) quotes[t] = q;
          }
        } catch(e){}
      }
    }

    // ===== 미국 테마 감지 (뉴스 + 급등률) =====
    let usThemes = [];
    
    // 1. 급등률 기준 (가장 정확)
    for (const [sym, q] of Object.entries(quotes)) {
      if (q.dp > 2) { // 2% 이상 급등
        if (['NVDA','SOXX','AVGO'].includes(sym)) usThemes.push('AI');
        if (['SMR','OKLO','NNE'].includes(sym)) usThemes.push('Nuclear');
        if (['MARA','COIN','MSTR'].includes(sym)) usThemes.push('Battery');
        if (['XLU'].includes(sym)) usThemes.push('Power');
        if (['ITA','LMT'].includes(sym)) usThemes.push('Defense');
      }
    }

    // 2. 뉴스 키워드
    if (newsText.includes('ai') || newsText.includes('nvidia') || newsText.includes('chip')) usThemes.push('AI');
    if (newsText.includes('nuclear') || newsText.includes('smr') || newsText.includes('oklo') || newsText.includes('uranium')) usThemes.push('Nuclear');
    if (newsText.includes('diesel') || newsText.includes('power') || newsText.includes('energy') || newsText.includes('electric')) usThemes.push('Power');
    if (newsText.includes('bitcoin') || newsText.includes('crypto') || newsText.includes('mara') || newsText.includes('coinbase')) usThemes.push('Battery');
    if (newsText.includes('defense') || newsText.includes('military') || newsText.includes('war')) usThemes.push('Defense');
    if (newsText.includes('robot') || newsText.includes('botz')) usThemes.push('Robot');
    if (newsText.includes('ship') || newsText.includes('lng')) usThemes.push('Shipbuilding');
    if (newsText.includes('bio') || newsText.includes('fda')) usThemes.push('Bio');

    usThemes = [...new Set(usThemes)];
    if (usThemes.length === 0) usThemes = ['AI','Power']; // 오늘 기본

    // ===== 매일 다른 8개 뽑기 (날짜 기반 셔플) =====
    let themes = [];
    const used = new Set();

    function shuffleByDate(arr, seed) {
      const a = [...arr];
      for (let i = a.length-1; i>0; i--) {
        const j = (seed + i * 9301) % (i+1);
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    // 감지된 테마에서 골고루 뽑기
    for (const ut of usThemes) {
      const pool = POOLS[ut] || [];
      const shuffled = shuffleByDate(pool, todayNum + ut.charCodeAt(0));
      for (const stock of shuffled) {
        if (themes.length >= 8) break;
        if (!used.has(stock.code)) {
          const q = quotes[stock.etf] || {};
          themes.push({
            ...stock,
            score: 95 - themes.length*2 + (q.dp || 0),
            usSource: ut,
            usChange: q.dp || 0,
            rank: themes.length+1
          });
          used.add(stock.code);
        }
      }
    }

    // 부족하면 다른 풀에서 채우기
    const allStocks = Object.values(POOLS).flat();
    const shuffledAll = shuffleByDate(allStocks, todayNum);
    for (const s of shuffledAll) {
      if (themes.length >= 8) break;
      if (!used.has(s.code)) {
        themes.push({ ...s, score: 80 - themes.length, rank: themes.length+1, usSource: 'Fill' });
        used.add(s.code);
      }
    }

    return res.status(200).json({
      date: today,
      timestamp: Date.now(),
      source: newsText ? 'finnhub-live-dynamic' : 'fallback-dynamic',
      usThemes,
      quotes,
      newsSample: newsText.slice(0,300),
      themes: themes.slice(0,8),
      debug,
      message: `✅ ${today} ${usThemes.join('+')} → 매일 다른 8종목`
    });

  } catch (err) {
    return res.status(200).json({
      date: today,
      source: 'error',
      usThemes: ['AI','Power'],
      themes: Object.values(POOLS).flat().slice(0,8),
      error: err.message,
      timestamp: Date.now()
    });
  }
}
