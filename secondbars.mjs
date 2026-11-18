/** Real 1-second OHLC bars built from individual Coinbase WebSocket ticker trades.
 * Gaps stay gaps: no empty second is manufactured; REST price checks don't become OHLC.
 */
export const SECOND_RETENTION = 6 * 3600; // six hours of observed seconds on this device
export const MAX_SECOND_BARS = SECOND_RETENTION;
export function ingestSecondTrade(bars, timestampMs, price, retain=MAX_SECOND_BARS) {
  const t=Math.floor(timestampMs/1000);
  if(!Number.isFinite(t)||!Number.isFinite(price)||price<=0 || !Number.isFinite(timestampMs))return false;
  if(bars.length&&t<bars.at(-1).t-2)return false; // reject belated packets rather than repaint history
  let i=bars.length-1;
  while(i>=0&&bars[i].t>t)i--;
  if(i>=0&&bars[i].t===t){
    const b=bars[i];
    b.high=Math.max(b.high,price);b.low=Math.min(b.low,price);
    b.count=(b.count||1)+1;
    if(timestampMs<(b.firstMs??b.t*1000)){b.firstMs=timestampMs;b.open=price;}
    if(timestampMs>=(b.lastMs??b.t*1000)){b.lastMs=timestampMs;b.close=price;}
  }else{
    const bar={t,open:price,high:price,low:price,close:price,count:1,firstMs:timestampMs,lastMs:timestampMs};
    bars.splice(i+1,0,bar);
  }
  const cutoff=t-SECOND_RETENTION;
  while(bars.length&&(bars[0].t<cutoff||bars.length>retain))bars.shift();
  return true;
}
export function restoreSecondBars(rows, now=Math.floor(Date.now()/1000)) {
  const bySecond=new Map();
  if(!Array.isArray(rows))return [];
  const earliest=now-SECOND_RETENTION;
  for(const row of rows){
    if(!row||!Number.isInteger(row.t)||row.t<earliest||row.t>now)continue;
    const {open,high,low,close}=row;
    if(![open,high,low,close].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0))continue;
    if(high<Math.max(open,close,low)||low>Math.min(open,close,high))continue;
    const firstMs=Number.isFinite(row.firstMs)?row.firstMs:row.t*1000;
    const lastMs=Number.isFinite(row.lastMs)?row.lastMs:firstMs;
    if(firstMs<row.t*1000||firstMs>=(row.t+1)*1000||lastMs<firstMs||lastMs>=(row.t+1)*1000)continue;
    bySecond.set(row.t,{t:row.t,open,high,low,close,count:Math.max(1,Math.floor(row.count||1)),firstMs,lastMs});
  }
  return [...bySecond.values()].sort((a,b)=>a.t-b.t).slice(-MAX_SECOND_BARS);
}
export function plotSecondBars(bars, x, pixels=2.5) {
  const out=[];
  for(const b of bars){
    const bucket=Math.floor(x(b.t*1000)/pixels);
    const last=out.at(-1);
    if(last&&last.bucket===bucket){
      last.high=Math.max(last.high,b.high);last.low=Math.min(last.low,b.low);
      last.close=b.close;last.end=b.t;last.n++;
    }else out.push({bucket,t:b.t,end:b.t,open:b.open,high:b.high,low:b.low,close:b.close,n:1});
  }
  return out;
}
