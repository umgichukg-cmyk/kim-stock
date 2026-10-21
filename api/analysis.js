export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-cache');
  const finnhubKey = process.env.FINNHUB_API_KEY;
  
  const allKR = [
    { theme: 'AI 반도체', name: 'SK하이닉스', code: '000660', us: 'AI' },
    { theme: '원전', name: '두산에너빌리티', code: '034020', us: 'Nuclear' },
    { theme: '로봇', name: '레인보우로보틱스', code: '277810', us: 'Robot' },
    { theme: '2차전지', name: 'LG에너지솔루션', code: '373220', us: 'Battery' },
    { theme: '방산', name: '한화에어로스페이스', code: '012450', us: 'Defense' },
    { theme: '조선', name: 'HD현대중공업', code: '329180', us: 'Shipbuilding' },
    { theme: '전력', name: 'LS ELECTRIC', code: '010120', us: 'Power' },
    { theme: '바이오', name: '삼성바이오로직스', code: '207940', us: 'Bio' },
    { theme: '반도체', name: '삼성전자', code: '005930', us: 'Chip' },
    { theme: '변압기', name: 'HD현대일렉트릭', code: '267260', us: 'Power' },
    { theme: 'HBM 장비', name: '한미반도체', code: '042700', us: 'AI' },
  ];

  try {
    let newsText = '';
    if (finnhubKey) {
      try {
        const controller = new AbortController();
        setTimeout(() => controller.abort(), 4000);
        const r = await fetch(`https://finnhub.io/api/v1/news?category=general&token=${finnhubKey}`, { signal: controller.signal });
        if (r.ok) {
          const data = await r.json();
          newsText = data.slice(0,20).map(n => n.headline).join(' ').toLowerCase();
        }
      } catch(e) {}
    }

    const detected = [];
    if (newsText.includes('ai') || newsText.includes('nvidia') || newsText.includes('chip') || newsText.includes('semiconductor')) detected.push('AI');
    if (newsText.includes('diesel') || newsText.includes('energy') || newsText.includes('power') || newsText.includes('oil')) detected.push('Power');
    if (newsText.includes('nuclear') || newsText.includes('uranium')) detected.push('Nuclear');
    if (newsText.includes('robot')) detected.push('Robot');
    if (newsText.includes('battery') || newsText.includes('tesla') || newsText.includes('lithium')) detected.push('Battery');
    if (newsText.includes('defense') || newsText.includes('military')) detected.push('Defense');
    if (newsText.includes('ship') || newsText.includes('lng')) detected.push('Shipbuilding');
    if (newsText.includes('bio') || newsText.includes('fda') || newsText.includes('pharma')) detected.push('Bio');

    let usThemes = [...new Set(detected)];
    if (usThemes.length === 0) usThemes = ['AI', 'Power'];

    // 중복 없이 매핑
    let themes = [];
    const used = new Set();
    const US_MAP = {
      'AI': ['000660','005930','042700'],
      'Power': ['010120','267260'],
      'Nuclear': ['034020'],
      'Robot': ['277810'],
      'Battery': ['373220'],
      'Defense': ['012450'],
      'Shipbuilding': ['329180'],
      'Bio': ['207940'],
      'Chip': ['005930']
    };

    for (const ut of usThemes) {
      const codes = US_MAP[ut] || ['000660'];
      for (const code of codes) {
        if (themes.length >= 8) break;
        const stock = allKR.find(s => s.code === code);
        if (stock && !used.has(code)) {
          themes.push({ ...stock, score: 95 - themes.length*2, usSource: ut, rank: themes.length+1 });
          used.add(code);
        }
      }
    }
    // 부족하면 채우기
    for (const s of allKR) {
      if (themes.length >= 8) break;
      if (!used.has(s.code)) {
        themes.push({ ...s, score: 95 - themes.length*2, rank: themes.length+1 });
        used.add(s.code);
      }
    }

    return res.status(200).json({
      date: new Date().toISOString().slice(0,10),
      source: newsText ? 'finnhub-live' : 'fallback',
      usThemes,
      newsSample: newsText.slice(0,200),
      themes: themes.slice(0,8),
      trigger: !!req.query.trigger
    });

  } catch (err) {
    return res.status(200).json({
      source: 'fallback-error',
      usThemes: ['AI','Power'],
      themes: allKR.slice(0,8),
      error: err.message
    });
  }
}
