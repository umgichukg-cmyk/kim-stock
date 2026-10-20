
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { symbol, resolution='D', from, to } = req.query;
  const API_KEY = process.env.FINNHUB_API_KEY || 'dbb3tf9r01qrv06o8togdbb3tf9r01qrv06o8tp0';
  try {
    const url = `https://finnhub.io/api/v1/candle?symbol=${symbol}&resolution=${resolution}&from=${from}&to=${to}&token=${API_KEY}`;
    const r = await fetch(url);
    const data = await r.json();
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
