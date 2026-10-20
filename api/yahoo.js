
export default async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  const {symbol}=req.query;
  if(!symbol) return res.status(400).json({error:'symbol required'});
  try{
    const url=`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`;
    const r=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'}});
    const data=await r.json();
    res.json(data);
  }catch(e){res.status(500).json({error:String(e)})}
}
