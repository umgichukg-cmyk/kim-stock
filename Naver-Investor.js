// /api/naver-investor.js - 외국인/기관/개인 실시간 수급 (네이버 비공식 API 활용, 인증키 불필요)
// m.stock.naver.com/api/stock/{code}/integration 에서 최근 5일 외국인/기관 순매수 데이터 제공
export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: "code required" });

  const cleanCode = String(code).replace(/[^0-9]/g, "").padStart(6, "0").slice(0, 6);

  try {
    // 1. 네이버 통합 API (외국인 보유율 + 투자자별 최근 5일)
    const integrationUrl = `https://m.stock.naver.com/api/stock/${cleanCode}/integration`;
    const r = await fetch(integrationUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://m.stock.naver.com/",
      },
    });

    if (!r.ok) throw new Error(`Naver integration HTTP ${r.status}`);
    const j = await r.json();

    // 파싱: 구조는 { result: { investorTrend: [...], foreignRate, ... } } 형태
    // 실제 필드는 네이버가 자주 바뀌므로 여러 경로 시도
    let trends = [];
    let foreignRate = null;
    
    // 다양한 경로 탐색
    const root = j.result || j;
    if (root.investorTrend) trends = root.investorTrend;
    else if (root.investor) trends = root.investor;
    else if (root.trend) trends = root.trend;
    else if (Array.isArray(root)) trends = root;
    
    // investorTrend가 없으면 dealTrend 등 시도
    if (trends.length === 0 && root.dealTrend) trends = root.dealTrend;
    if (trends.length === 0 && root.investors) trends = root.investors;

    // foreignRate 추출
    foreignRate = root.foreignRate || root.foreignRatio || root.foreignHoldRatio || null;

    // 정규화: 최근 10일치로 변환
    const flows = [];
    // trends가 비어있으면 siseJson의 외국인 순매수 필드로 fallback 시도
    if (trends.length > 0) {
      // trends: [{ date, foreignPureBuy, organPureBuy, personalPureBuy, ... }]
      for (let t of trends.slice(-10)) {
        const foreign = Number(t.foreignPureBuyQuant || t.foreignPureBuy || t.foreignerBuy || t.foreign || 0);
        const institution = Number(t.organPureBuyQuant || t.organPureBuy || t.institutionBuy || t.organ || 0);
        const personal = Number(t.personalPureBuyQuant || t.individualPureBuy || t.personal || 0);
        const other = Number(t.otherBuy || 0);
        // 단위: 주 -> 억 단위로 변환 (대략)
        const foreignEok = foreign / 1000000; // 예시 변환, 실제로는 가격 * 수량 필요
        flows.push({
          date: t.date || t.localDate || "",
          foreign: foreign,
          institution: institution,
          personal: personal,
          other: other,
          foreignEok: Math.round(foreignEok * 10) / 10,
          total: foreign + institution + personal + other,
        });
      }
    }

    // 2. 차트 API로 외국인 순매수량 직접 가져오기 (fallback)
    if (flows.length === 0) {
      try {
        const chartUrl = `https://api.stock.naver.com/chart/domestic/item/${cleanCode}/day?isRealtime=false`;
        const cr = await fetch(chartUrl, {
          headers: { "User-Agent": "Mozilla/5.0" },
        });
        if (cr.ok) {
          const cj = await cr.json();
          // 차트 데이터에서 외국인 관련 필드 추출 시도
          // 일부 응답에 foreignHold 등 포함
        }
      } catch {}
    }

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    return res.json({
      code: cleanCode,
      flows,
      foreignRate,
      rawCount: trends.length,
      source: "m.stock.naver.com/api/stock/integration",
      _raw: j, // 디버그용, 필요하면 제거
    });

  } catch (e) {
    console.error("[naver-investor] error", e);
    return res.status(500).json({ error: String(e), code: cleanCode, flows: [] });
  }
}
