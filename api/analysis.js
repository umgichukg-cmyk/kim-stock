// api/analysis.js - 안정화 버전 (에러 절대 안 남)
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-cache');
  
  const finnhubKey = process.env.FINNHUB_API_KEY;
  
  // 기본 한국 종목 (Finnhub 실패해도 이건 뜸)
  const fallback = [
    { theme: 'AI 반도체', name: 'SK하이닉스', code: '000660', score: 95, usSource: 'AI' },
    { theme: '원전', name: '두산에너빌리티', code: '034020', score: 92, usSource: 'Nuclear' },
    { theme: '로봇', name: '레인보우로보틱스', code: '277810', score: 91, usSource: 'Robot' },
    { theme: '2차전지', name: 'LG에너지솔루션', code: '373220', score: 90, usSource: 'Battery' },
    { theme: '방산', name: '한화에어로스페이스', code: '012450', score: 89, usSource: 'Defense' },
    { theme: '조선', name: 'HD현대중공업', code: '329180', score: 88, usSource: 'Shipbuilding' },
    { theme: '전력', name: 'LS ELECTRIC', code: '010120', score: 86, usSource: 'Power' },
    { theme: '바이오', name: '삼성바이오로직스', code: '207940', score: 85, usSource: 'Bio' },
  ];

  try {
    if (!finnhubKey) {
      return res.status(200).json({
        date: new Date().toISOString().slice(0,10),
        source: 'fallback-no-key',
        usThemes: ['AI','Nuclear','Robot'],
        themes: fallback,
        message: 'FINNHUB 키 없음 - fallback 사용'
      });
    }

    // Finnhub 호출 (타임아웃 5초)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    let newsText = '';
    try {
      const r = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${finnhubKey}`, {
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (r.ok) {
        const data = await r.json();
        newsText = data.slice(0,20).map(n => n.headline).join(' ').toLowerCase();
      }
    } catch(e) {
      clearTimeout(timeout);
      console.log('finnhub fetch fail:', e.message);
    }

    // 미국 테마 감지 (키워드)
    const US_TO_KR = {
      'AI': { theme: 'AI 반도체', name: 'SK하이닉스', code: '000660' },
      'Nuclear': { theme: '원전', name: '두산에너빌리티', code: '034020' },
      'Robot': { theme: '로봇', name: '레인보우로보틱스', code: '277810' },
      'Battery': { theme: '2차전지', name: 'LG에너지솔루션', code: '373220' },
      'Defense': { theme: '방산', name: '한화에어로스페이스', code: '012450' },
      'Power': { theme: '전력', name: 'LS ELECTRIC', code: '010120' },
      'Bio': { theme: '바이오', name: '삼성바이오로직스', code: '207940' },
      'Chip': { theme: '반도체', name: '삼성전자', code: '005930' },
    };

    const detected = [];
    if (newsText.includes('ai') || newsText.includes('nvidia') || newsText.includes('chip')) detected.push('AI');
    if (newsText.includes('nuclear') || newsText.includes('uranium')) detected.push('Nuclear');
    if (newsText.includes('robot')) detected.push('Robot');
    if (newsText.includes('battery') || newsText.includes('tesla') || newsText.includes('lithium')) detected.push('Battery');
    if (newsText.includes('defense') || newsText.includes('military')) detected.push('Defense');
    if (newsText.includes('power') || newsText.includes('energy')) detected.push('Power');
    
    let usThemes = detected.length > 0 ? detected : ['AI','Nuclear','Robot','Battery','Defense'];
    usThemes = [...new Set(usThemes)].slice(0,8);

    // 매핑
    // themes 채우는 부분을 이걸로 교체
    let themes = [];
    const usedCodes = new Set();
    for (const t of usThemes) {
      const m = US_TO_KR[t] || US_TO_KR['AI'];
      if (!usedCodes.has(m.code)) {
        themes.push({ ...m, score: 95 - themes.length*2, usSource: t, rank: themes.length+1 });
        usedCodes.add(m.code);
      }
    }
    // 부족하면 fallback에서 중복 없이 채우기
    for (const f of fallback) {
      if (themes.length >= 8) break;
      if (!usedCodes.has(f.code)) {
        themes.push({ ...f, rank: themes.length+1 });
        usedCodes.add(f.code);
      }
    }

    // 8개 채우기
    while (themes.length < 8) themes.push(...fallback.slice(themes.length, themes.length+1));

    return res.status(200).json({
      date: new Date().toISOString().slice(0,10),
      source: newsText ? 'finnhub-live' : 'fallback-news-empty',
      usThemes,
      newsSample: newsText.slice(0,200),
      themes: themes.slice(0,8),
      trigger: !!req.query.trigger,
      message: `✅ ${usThemes.join(', ')} → 한국 ${themes[0].theme}`
    });

  } catch (err) {
    console.error('CRITICAL:', err);
    return res.status(200).json({
      date: new Date().toISOString().slice(0,10),
      source: 'fallback-error',
      usThemes: ['AI','Nuclear','Robot'],
      themes: fallback,
      error: err.message,
      message: '에러 발생 - fallback 반환'
    });
  }
}
