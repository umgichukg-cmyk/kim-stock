// /api/kiwoom-investor.js - 키움 REST API로 외국인/기관/개인 실시간 수급 조회
// Docs: https://api.kiwoom.com - POST /api/dostk/frgnistt
// ka10009 주식기관요청: orgn_daly_nettrde (기관일별순매매), frgnr_daly_nettrde (외국인일별순매매)
// ka10008 주식외국인종목별매매동향: 외국인 보유수량 등
// 필요 env: KIWOOM_APP_KEY, KIWOOM_APP_SECRET

let cachedToken = null;
let tokenExpiry = 0;

async function getKiwoomToken() {
  const appKey = process.env.KIWOOM_APP_KEY || process.env.KIWOOM_APPKEY;
  const secretKey = process.env.KIWOOM_SECRET_KEY || process.env.KIWOOM_APP_SECRET || process.env.KIWOOM_SECRET;
  
  if (!appKey || !secretKey) {
    throw new Error("KIWOOM_APP_KEY / KIWOOM_APP_SECRET 환경변수가 Vercel에 등록되지 않았습니다");
  }

  // 토큰 캐시 (23시간 유효)
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  const res = await fetch("https://api.kiwoom.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: appKey,
      secretkey: secretKey,
    }),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`키움 토큰 발급 실패 ${res.status}: ${txt}`);
  }

  const data = await res.json();
  // 응답: { token, expires_dt, ... } 또는 { access_token }
  const token = data.token || data.access_token || data.accessToken;
  if (!token) throw new Error(`토큰 파싱 실패: ${JSON.stringify(data)}`);

  cachedToken = token;
  tokenExpiry = Date.now() + 23 * 60 * 60 * 1000; // 23시간 후 만료로 가정
  return token;
}

async function callKiwoom(apiId, body) {
  const token = await getKiwoomToken();
  
  const res = await fetch("https://api.kiwoom.com/api/dostk/frgnistt", {
    method: "POST",
    headers: {
      "Content-Type": "application/json;charset=UTF-8",
      "authorization": `Bearer ${token}`,
      "api-id": apiId,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Kiwoom ${apiId} 호출 실패 ${res.status}: ${txt}`);
  }

  const data = await res.json();
  if (data.return_code && data.return_code !== 0 && data.return_code !== "0") {
    // return_code가 0이 아니면 오류일 수 있음, 하지만 일부는 정상
    // console.warn
  }
  return data;
}

export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: "code required" });

  const cleanCode = String(code).replace(/[^0-9]/g, "").padStart(6, "0").slice(0, 6);

  try {
    // 1. ka10009 - 주식기관요청 (기관일별순매매 + 외국인일별순매매 + 외국인지분율)
    const instData = await callKiwoom("ka10009", { stk_cd: cleanCode });

    // 2. ka10008 - 외국인 종목별 매매동향 (보유주식수, 비중 등)
    let foreignDetail = null;
    try {
      foreignDetail = await callKiwoom("ka10008", { stk_cd: cleanCode });
    } catch (e) {
      // 선택적
      console.log("ka10008 failed", e.message);
    }

    // 파싱: ka10009 응답 예시
    // {
    //   date: "20241105",
    //   close_pric: "135300",
    //   pre: "0",
    //   orgn_dt_acc: "",
    //   orgn_daly_nettrde: "-12345" (기관일별순매매량 또는 금액),
    //   frgnr_daly_nettrde: "67890" (외국인일별순매매),
    //   frgnr_qota_rt: "26.1" (외국인지분율)
    // }
    // 또는 연속조회일 경우 리스트일 수도 있음
    let flows = [];
    let foreignRate = null;
    let closePrice = null;

    // 단일 객체인 경우 배열로 변환하여 1일치로 처리
    // 실제로는 연속조회로 여러 날짜를 가져와야 하지만, 우선 1일치 + 최근 추세는 계산
    // 연속 데이터가 필요하면 cont-yn 헤더 처리 필요 - 지금은 1일치 기반 + Mock 추세 아님
    
    // ka10009가 단일 날짜만 주는 경우, 추가로 기간별 조회를 위해 ka10131 등으로 보완 가능
    // 하지만 가장 정확한 일별 흐름은 ka10009를 날짜별로 여러 번 호출하거나, 다른 API 사용

    // 일단 단일 응답 파싱
    const parseNumber = (v) => {
      if (v == null || v === "") return 0;
      const n = Number(String(v).replace(/[^0-9\-]/g, ""));
      return isNaN(n) ? 0 : n;
    };

    // ka10009 응답이 객체 하나일 때
    if (instData.date || instData.close_pric) {
      const foreignNet = parseNumber(instData.frgnr_daly_nettrde);
      const instNet = parseNumber(instData.orgn_daly_nettrde);
      // 개인은 대략 반대: 외국인+기관 합계의 음수 (기타법인 제외 단순화)
      // 실제로는 개인 순매수 = -(외국인+기관+기타법인) 이지만, 여기서는 외국인+기관 반대로 추정
      const personalNet = -(foreignNet + instNet);
      
      flows = [
        {
          date: instData.date || new Date().toISOString().slice(0, 10).replace(/-/g, ""),
          foreign: foreignNet,
          institution: instNet,
          personal: personalNet,
          other: 0,
          total: foreignNet + instNet + personalNet,
          foreignRate: instData.frgnr_qota_rt || null,
          closePrice: instData.close_pric || null,
        },
      ];
      foreignRate = instData.frgnr_qota_rt;
      closePrice = instData.close_pric;
    }

    // ka10008 데이터가 있으면 보유수량 등으로 보강
    if (foreignDetail && foreignDetail.stk_frgnr && Array.isArray(foreignDetail.stk_frgnr)) {
      // 최근 데이터로 flows 업데이트 가능
      // stk_frgnr 배열: 일자별 보유주식수, chg_qty(변동수량) 등
      const recent = foreignDetail.stk_frgnr.slice(0, 10).map((x) => ({
        date: x.dt,
        foreignHold: parseNumber(x.poss_stkcnt),
        foreignChange: parseNumber(x.chg_qty),
        foreignRate: x.wght,
        closePrice: x.close_pric,
      }));
      // flows와 병합 - 최근 10일치로 재구성
      if (recent.length > 0) {
        flows = recent.map((r) => ({
          date: r.date,
          foreign: r.foreignChange, // 변동수량이 순매수 수량
          institution: 0, // 기관은 ka10009에서 가져와야 함, 여기서는 0으로 두고
          personal: -r.foreignChange, // 단순 반대
          other: 0,
          total: 0,
          foreignHold: r.foreignHold,
          foreignRate: r.foreignRate,
        }));
        // 기관 데이터가 있으면 첫 번째 flow에 병합
        if (instData.frgnr_daly_nettrde) {
          flows[0].institution = parseNumber(instData.orgn_daly_nettrde);
          flows[0].foreign = parseNumber(instData.frgnr_daly_nettrde);
          flows[0].personal = -(flows[0].foreign + flows[0].institution);
        }
      }
    }

    // 최종 정규화: 금액 단위로 변환 (수량 * 현재가로 대략 억 단위)
    const enrichedFlows = flows.map((f) => {
      const price = parseNumber(f.closePrice || closePrice || 0) || 50000; // 기본 5만원 가정
      const foreignAmt = (f.foreign * price) / 100000000; // 억 단위
      const instAmt = (f.institution * price) / 100000000;
      const personalAmt = (f.personal * price) / 100000000;
      return {
        ...f,
        foreignAmt: Math.round(foreignAmt * 10) / 10,
        institutionAmt: Math.round(instAmt * 10) / 10,
        personalAmt: Math.round(personalAmt * 10) / 10,
        foreignEok: Math.round(foreignAmt * 10) / 10,
      };
    });

    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    return res.json({
      code: cleanCode,
      flows: enrichedFlows,
      foreignRate,
      source: "Kiwoom REST API ka10009(기관외국인) + ka10008(외국인보유)",
      raw: {
        ka10009: instData,
        ka10008: foreignDetail,
      },
    });

  } catch (e) {
    console.error("[kiwoom-investor] error", e);
    return res.status(500).json({ 
      error: String(e.message || e), 
      code: cleanCode,
      hint: "Vercel 환경변수에 KIWOOM_APP_KEY, KIWOOM_APP_SECRET 등록 필요. 키움 OpenAPI 포털(https://openapi.kiwoom.com)에서 발급",
      flows: [] 
    });
  }
}
