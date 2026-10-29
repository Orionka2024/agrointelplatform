/** Local-first deployment. Production must provide authentication at the reverse proxy
 * and a matching server-side bearer token. Do not expose this token in a public bundle. */
import { timingSafeEqual } from 'node:crypto';
const calls=new Map();
export function allowRequest(req,res,{costly=false}={}) {
  if(req.method==='OPTIONS') return true;
  const headers=req.headers||{};
  if(headers.origin && headers.host) {
    try {if(new URL(headers.origin).host!==headers.host) {res.status(403).json({message:'Cross-origin access denied'});return false;}}
    catch {res.status(403).json({message:'Invalid origin'});return false;}
  }
  if(process.env.AGRO_REQUIRE_AUTH==='true') {
    const expected=process.env.AGRO_API_TOKEN;
    const supplied=(headers.authorization||'').replace(/^Bearer /,'');
    if(!expected) {res.status(503).json({message:'Configure authenticated persistent hosting before deployment'});return false;}
    const a=Buffer.from(expected),b=Buffer.from(supplied);
    if(a.length!==b.length||!timingSafeEqual(a,b)){res.status(401).json({message:'Authentication required'});return false;}
  }
  if(costly && process.env.AGRO_TEST!=='1') {
    const now=Date.now(),key=req.socket?.remoteAddress||'local';
    if(calls.size>1000) for(const [k,v] of calls) if(now-v.start>60000) calls.delete(k);
    const item=calls.get(key)||{start:now,n:0};
    if(now-item.start>60000){item.start=now;item.n=0;}
    item.n++;calls.set(key,item);
    if(item.n>20){res.status(429).json({message:'Too many requests; retry in one minute'});return false;}
  }
  return true;
}
