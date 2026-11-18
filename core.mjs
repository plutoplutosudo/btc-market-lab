/* BTC Market Lab — pure, retrospective technical-analysis helpers.
   No order placement, account access, prediction market logic, or future forecasts. */
export const VERSION = '7.0.0';
export const DAY = 86400;
export function finite(v) { return typeof v === 'number' && Number.isFinite(v); }
export function parseCandle(c, source='Coinbase') {
  if (!c || typeof c !== 'object') return null;
  const t = Number(c.t), open = Number(c.open), high = Number(c.high),
        low = Number(c.low), close = Number(c.close), volume = Number(c.volume || 0);
  if (![t,open,high,low,close,volume].every(Number.isFinite) || t % 60 !== 0 ||
      t <= 0 || open <= 0 || close <= 0 || low <= 0 ||
      high < Math.max(open,close,low) || low > Math.min(open,close,high) || volume < 0) return null;
  return {t,open,high,low,close,volume,source:c.source || source};
}
export function fromCoinbaseRows(rows, nowSec=Date.now()/1000) {
  if (!Array.isArray(rows)) return [];
  const cutoff = Math.floor(nowSec/60)*60;
  return rows.map(r => Array.isArray(r) && r.length >= 6 ?
    parseCandle({t:Number(r[0])+60, low:Number(r[1]), high:Number(r[2]),
      open:Number(r[3]),close:Number(r[4]),volume:Number(r[5]),source:'Coinbase'}) : null)
    .filter(c=>c && c.t <= cutoff && c.t >= nowSec - 31*DAY)
    .sort((a,b)=>a.t-b.t);
}
export function mergeCandles(existing, incoming, nowSec=Date.now()/1000) {
  const cutoff = Math.floor(nowSec/60)*60, start = cutoff-30*DAY, map = new Map();
  for (const raw of existing.concat(incoming)) {
    const c=parseCandle(raw);
    if (!c || c.t < start || c.t > cutoff) continue;
    const old=map.get(c.t);
    // Prefer exchange-certified OHLC over sampled live trades when they overlap.
    if (!old || (old.source!=='Coinbase' && c.source==='Coinbase') || (old.source?.includes('sampled') && c.source==='Kraken')) map.set(c.t,c);
  }
  return [...map.values()].sort((a,b)=>a.t-b.t);
}
export function ema(values, period) {
  if (!values.length) return [];
  const alpha=2/(period+1);let x=values[0];
  return values.map((v,i)=>{if(i)x=alpha*v+(1-alpha)*x;return x;});
}
export function rsi(values, period=14) {
  if(values.length<period+2) return null;
  let gain=0,loss=0;
  for(let i=1;i<=period;i++){const d=values[i]-values[i-1];gain+=Math.max(d,0);loss+=Math.max(-d,0);}
  gain/=period;loss/=period;
  for(let i=period+1;i<values.length;i++){const d=values[i]-values[i-1];gain=(gain*(period-1)+Math.max(d,0))/period;loss=(loss*(period-1)+Math.max(-d,0))/period;}
  if(!gain&&!loss)return 50;
  if(!loss)return 100;
  return 100-100/(1+gain/loss);
}
export function stdev(xs) {
  if(xs.length<2)return 0;
  const avg=xs.reduce((a,b)=>a+b,0)/xs.length;
  return Math.sqrt(xs.reduce((a,b)=>a+(b-avg)**2,0)/(xs.length-1));
}
export function median(xs) {
  if(!xs.length)return 0;
  const a=[...xs].sort((a,b)=>a-b),k=Math.floor(a.length/2);
  return a.length%2?a[k]:(a[k-1]+a[k])/2;
}
export function windowsStats(candles){
  let up=0,down=0,flat=0,complete=0,change=[];
  let group=[],prev=null;
  function finish(){
    if(group.length!==15)return;
    const valid=group.every((c,i)=>i===0 || c.t-group[i-1].t===60);
    if(!valid)return;
    const first=group[0], last=group[14];
    // A 15m window contains exactly 15 one-minute candles, ending on UTC 00/15/30/45.
    if(last.t % 900!==0)return;
    const delta=100*(last.close/first.open-1);
    complete++;change.push(Math.abs(delta));
    if(delta>0.005)up++; else if(delta<-0.005)down++; else flat++;
  }
  for(const c of candles){const key=Math.floor((c.t-1)/900);
    if(key!==prev){finish();group=[];prev=key;}group.push(c);
  }
  finish();
  return {complete,up,down,flat,typical15m:median(change)};
}
export function analyze(candles, nowSec=Date.now()/1000) {
  const base={detail:'Collecting completed minute candles.',healthy:false,
    trend:{},rsi:null,ema9:null,ema21:null,
    volatility:null,threshold:null,lastCandle:null,gaps:0,typicalMove:null,
    sampleCount:candles.length,grade:'Collecting data',learningLevel:0,
    windows:windowsStats(candles)};
  if(!candles.length)return base;
  const recent=candles.slice(-Math.min(candles.length,1200)),closes=recent.map(x=>x.close),
        last=recent.at(-1), fresh=nowSec-last.t;
  base.lastCandle=last.t;
  if(recent.length<65){base.detail=`Need at least 65 completed minutes; saved ${recent.length}.`;return base;}
  const slice=recent.slice(-65),gaps=slice.slice(1).filter((c,i)=>c.t-slice[i].t!==60).length;
  base.gaps=gaps;
  if(gaps){base.detail=`${gaps} missing minute interval(s) in the most recent 65 candles.`;return base;}
  if(fresh < -5 || fresh > 135){base.detail='Latest confirmed candle is delayed; fresh indicators withheld.';return base;}
  const e9=ema(closes,9),e21=ema(closes,21),R=rsi(closes);
  const logs=[];
  // Only adjacent minutes are included in historical volatility estimation.
  const sampleStep=Math.max(1,Math.floor(candles.length/12000));
  for(let i=sampleStep;i<candles.length;i+=sampleStep){
    if(candles[i].t-candles[i-sampleStep].t===sampleStep*60){
      logs.push(Math.abs(100*Math.log(candles[i].close/candles[i-sampleStep].close))/Math.sqrt(sampleStep));
    }
  }
  const typical=median(logs);
  const recentR=[];
  for(let i=recent.length-30;i<recent.length;i++)
    if(i>0 && recent[i].t-recent[i-1].t===60)recentR.push(100*Math.log(closes[i]/closes[i-1]));
  const vol=stdev(recentR);
  const threshold=Math.max(.012,.35*vol,.52*typical);
  const m5=100*(closes.at(-1)/closes.at(-6)-1),
        m15=100*(closes.at(-1)/closes.at(-16)-1),
        m60=100*(closes.at(-1)/closes.at(-61)-1),
        spread=100*(e9.at(-1)/e21.at(-1)-1);
  const slow=ema(closes,26);
  const macd=ema(closes,12).map((v,i)=>v-slow[i]);
  const hist=100*(macd.at(-1)-ema(macd,9).at(-1))/closes.at(-1);
  const last20=closes.slice(-20),mid=last20.reduce((a,b)=>a+b,0)/20;
  const boll=(closes.at(-1)-mid)/(stdev(last20)||1);
  return {...base,healthy:true,
    detail:'Indicators calculated from a continuous series of completed one-minute candles.',
    rsi:R,ema9:e9.at(-1),ema21:e21.at(-1),macd:hist,boll,
    volatility:vol,threshold,typicalMove:typical,trend:{m5,m15,m60,spread},
    sampleCount:logs.length,grade:logs.length>=10000?'Extended baseline':logs.length>=1500?'Learning baseline': 'Early baseline',
    learningLevel:Math.min(100,Math.round(logs.length/10000*100)),
    ema9series:e9.slice(-200),ema21series:e21.slice(-200)};
}

/** Retrospective pattern catalog. Every row is a fully completed UTC 15-minute block.
 * Thresholds are learned from *observed* volatility, never used to forecast the next block.
 */
export function quantile(values, q) {
  if (!values.length) return 0;
  const a=[...values].sort((x,y)=>x-y), i=Math.max(0,Math.min(a.length-1,(a.length-1)*q));
  const lo=Math.floor(i),hi=Math.ceil(i);
  return a[lo]+(a[hi]-a[lo])*(i-lo);
}
export function historicalPatterns(candles) {
  const entries=[], buckets=new Map();
  for(const c of candles){
    if(!parseCandle(c))continue;
    const slot=Math.floor((c.t-1)/900), group=buckets.get(slot)||[];
    group.push(c);buckets.set(slot,group);
  }
  for(const [slot, group] of buckets){
    if(group.length!==15 || group[0].t!==slot*900+60 || group[14].t!==(slot+1)*900 ||
      !group.every((c,i)=>!i || c.t-group[i-1].t===60))continue;
    const first=group[0],last=group[14],move=100*(last.close/first.open-1);
    const high=Math.max(...group.map(c=>c.high)),low=Math.min(...group.map(c=>c.low));
    const amplitude=100*(high-low)/first.open;
    const direction=move>.005?'HIGHER':move<-.005?'LOWER':'FLAT';
    entries.push({end:last.t,move,direction,amplitude,source:group.some(c=>c.source!=='Coinbase')?'sampled':'exchange'});
  }
  entries.sort((a,b)=>a.end-b.end);
  const sample=entries.map(x=>x.amplitude),q33=quantile(sample,.333),q67=quantile(sample,.667);
  const labelled=entries.map(x=>({...x,regime:entries.length<24?'GATHERING':
    x.amplitude<=q33?'CALM':x.amplitude>=q67?'ACTIVE':'NORMAL'}));
  const counts={CALM:0,NORMAL:0,ACTIVE:0,GATHERING:0};
  for(const x of labelled)counts[x.regime]++;
  let flips=0,comparable=0,streak=0;let previous=null;
  for(const x of labelled){
    if(x.direction==='FLAT')continue;
    if(previous){comparable++;if(x.direction!==previous)flips++;}
    previous=x.direction;
  }
  const last=labelled.at(-1);
  if(last&&last.direction!=='FLAT')for(let i=labelled.length-1;i>=0;i--){
    if(labelled[i].direction===last.direction)streak++;else break;
  }
  const first=candles[0]?.t, end=candles.at(-1)?.t;
  const expected=first&&end?Math.floor((end-first)/60)+1:0;
  return {
    observed:labelled.length,latest:last||null,history:labelled.slice(-9).reverse(),
    thresholds:{quiet:q33,active:q67},counts,flips,comparable,
    flipRate:comparable?flips/comparable:null,streak,
    coverage:expected?Math.min(1,candles.length/expected):0,
    level:labelled.length<24?'WARMING UP':labelled.length<96?'BASIC SAMPLE':labelled.length<480?'GROWING ARCHIVE':'EXTENDED ARCHIVE',
    milestone:labelled.length<24?24:labelled.length<96?96:labelled.length<480?480:960,
    nextSample:labelled.length<960?Math.min(960,Math.max(24,labelled.length<24?24:labelled.length<96?96:labelled.length<480?480:960)):960
  };
}
export function fromKrakenRows(rows, nowSec=Date.now()/1000) {
  if(!Array.isArray(rows))return [];
  const cutoff=Math.floor(nowSec/60)*60;
  return rows.map(r=>Array.isArray(r)&&r.length>=7?parseCandle({
    t:Number(r[0])+60,open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),
    close:Number(r[4]),volume:Number(r[6]),source:'Kraken'
  }):null).filter(c=>c&&c.t<=cutoff&&c.t>=nowSec-31*DAY).sort((a,b)=>a.t-b.t);
}


/** Five-step description of PAST market structure, not a forecast.
 * Eleven (correlated!) price-action observations across five indicator families.
 * All evaluation uses closed, exchange-certified 1m candles. Safety gates take
 * precedence over any directional vote. No trade entry/exit advice.
 */
export function observedStructure(candles, a=analyze(candles), nowSec=Date.now()/1000) {
  const blank={label:'HOLD OFF',tone:'neutral',tier:'none',score:0,up:0,down:0,
    neutral:0,totalChecks:11,checks:[],gates:[],families:0,
    reasons:[],detail:'Waiting for reliable completed candles.',
    support:null,resistance:null,range:null,asOf:candles.at(-1)?.t||null};
  const recent=candles.slice(-120),last=recent.at(-1);
  // The safety gate list is visible in the dashboard, including failures.
  const age=last?nowSec-last.t:Infinity;
  const hasHistory=recent.length===120 && a.healthy;
  const continuous=recent.length===120 && recent.every((c,i)=>!i||c.t-recent[i-1].t===60);
  const certified=recent.length===120 && recent.every(c=>['Coinbase','Kraken'].includes(c.source));
  const oneSource=certified && new Set(recent.map(c=>c.source)).size===1;
  const validOHLC=recent.length===120 && recent.every(c=>Boolean(parseCandle(c)));
  const fresh=age>=-5 && age<=135;
  const moves=[];
  for(let i=1;i<recent.length;i++)if(recent[i].t-recent[i-1].t===60)
    moves.push(Math.abs(100*Math.log(recent[i].close/recent[i-1].close)));
  const priorMove=median(moves.slice(0,-10)); // exclude the latest 10m to avoid spike-inflated thresholds
  const recentShock=moves.slice(-10).some(x=>x>Math.max(.55,8*Math.max(.015,priorMove)));
  const shockFree=recent.length===120 && !recentShock;
  const gateChecks=[
    ['120 confirmed minutes',hasHistory],
    ['No missing minute intervals',continuous],
    ['Exchange-certified OHLC',certified],
    ['Consistent exchange source',oneSource],
    ['Valid candle values',validOHLC],
    ['Recent completed candle',fresh],
    ['No extreme recent 1m spike',shockFree],
  ];
  const gates=gateChecks.map(([name,ok])=>({name,ok:Boolean(ok)}));
  const reference=recent.length>=40?recent.slice(0,-3):[];
  const support=reference.length?Math.min(...reference.map(c=>c.low)):null;
  const resistance=reference.length?Math.max(...reference.map(c=>c.high)):null;
  const shared={...blank,gates,support,resistance,
    range:support==null?null:resistance-support,asOf:last?.t||null};
  if(gates.some(g=>!g.ok)) {
    const bad=gates.filter(g=>!g.ok).map(g=>g.name);
    return {...shared,detail:'HOLD OFF · Data safety checks failed: '+bad.join(', ')+'.'};
  }
  const closes=recent.map(c=>c.close);
  const threshold=Math.max(.012,a.threshold||.012);
  const t=a.trend,ema9s=ema(closes,9);
  const emaSlope=100*(ema9s.at(-1)/ema9s.at(-6)-1);
  const last15=recent.slice(-15),prior15=recent.slice(-30,-15);
  const upCloses=last15.slice(1).filter((c,i)=>c.close>last15[i].close).length;
  const downCloses=last15.slice(1).filter((c,i)=>c.close<last15[i].close).length;
  const highNow=Math.max(...last15.map(c=>c.high)),lowNow=Math.min(...last15.map(c=>c.low));
  const highPrev=Math.max(...prior15.map(c=>c.high)),lowPrev=Math.min(...prior15.map(c=>c.low));
  const swing=(highNow>highPrev*(1+threshold/100*.2) && lowNow>lowPrev*(1+threshold/100*.2))?1:
    (highNow<highPrev*(1-threshold/100*.2) && lowNow<lowPrev*(1-threshold/100*.2))?-1:0;
  const last30=recent.slice(-30),sumV=last30.reduce((n,c)=>n+c.volume,0);
  const vwap=sumV>0?last30.reduce((n,c)=>n+c.volume*(c.high+c.low+c.close)/3,0)/sumV:null;
  const vwapDist=vwap?100*(last.close/vwap-1):0;
  const breadth=upCloses-downCloses;
  const decide=(value,positive,negative=-positive)=>
    !Number.isFinite(value)?0:value>positive?1:value<negative?-1:0;
  const list=[
    {name:'5m momentum',group:'Momentum',dir:decide(t.m5,threshold*Math.sqrt(5)*.6)},
    {name:'15m momentum',group:'Momentum',dir:decide(t.m15,threshold*Math.sqrt(15)*.6)},
    {name:'60m momentum',group:'Momentum',dir:decide(t.m60,threshold*Math.sqrt(60)*.55)},
    {name:'EMA 9 / EMA 21',group:'Trend',dir:decide(t.spread,threshold*.28)},
    {name:'EMA 9 slope',group:'Trend',dir:decide(emaSlope,threshold*Math.sqrt(5)*.25)},
    {name:'MACD histogram',group:'Oscillators',dir:decide(a.macd,threshold*.07)},
    {name:'RSI 14',group:'Oscillators',dir:decide(a.rsi,54,46)},
    {name:'Bollinger position',group:'Oscillators',dir:decide(a.boll,.55)},
    {name:'Positive vs negative closes',group:'Structure',dir:decide(breadth,4)},
    {name:'15m swing highs / lows',group:'Structure',dir:swing},
    {name:'30m volume-weighted price',group:'Flow',dir:vwap===null?0:decide(vwapDist,threshold*.35)},
  ];
  const up=list.filter(x=>x.dir===1).length,down=list.filter(x=>x.dir===-1).length;
  const neutral=list.length-up-down;
  const primary=up>down?1:down>up?-1:0;
  const aligned=primary===1?up:primary===-1?down:0;
  const opposed=primary===1?down:primary===-1?up:0;
  const alignedFamilies=new Set(list.filter(x=>x.dir===primary&&primary).map(x=>x.group)).size;
  // Trend must agree with the completed 15m direction and EMA structure.
  // Sudden counter-moves / heavily divided indicators are classified as HOLD OFF.
  const essentials=list.filter(x=>['15m momentum','EMA 9 / EMA 21'].includes(x.name));
  const essentialsAgree=primary!==0&&essentials.every(x=>x.dir===primary);
  const shortReversal=primary && list[0].dir===-primary;
  const oscillatorConflict=primary && list.filter(x=>x.group==='Oscillators'&&x.dir===-primary).length>=2;
  const overextended=(primary===1&&a.rsi>=82)||(primary===-1&&a.rsi<=18);
  const strong=aligned>=9&&opposed===0&&alignedFamilies>=4&&essentialsAgree&&!overextended;
  const light=aligned>=7&&opposed<=1&&alignedFamilies>=3&&essentialsAgree&&!shortReversal&&!oscillatorConflict;
  let label='HOLD OFF',tier='none';
  if(strong){label=primary===1?'STRONG UP':'STRONG DOWN';tier='strong';}
  else if(light){label=primary===1?'LIGHT UP':'LIGHT DOWN';tier='light';}
  const tone=primary===1&&label!=='HOLD OFF'?'positive':primary===-1&&label!=='HOLD OFF'?'negative':'neutral';
  const suffix=overextended?' · RSI is stretched; strength downgraded.':'';
  const detail=label==='HOLD OFF'?
    `Unclear/contradictory structure: ${up} higher, ${down} lower, ${neutral} mixed of ${list.length} checks.`:
    `${aligned}/${list.length} aligned checks across ${alignedFamilies} indicator families · ${opposed} opposing.${suffix}`;
  const checks=list.map(x=>({name:x.name,group:x.group,
    direction:x.dir===1?'Higher':x.dir===-1?'Lower':'Mixed',dir:x.dir}));
  return {...shared,label,tier,tone,up,down,neutral,totalChecks:list.length,score:aligned,
    families:alignedFamilies,detail,checks,
    reasons:checks.map(x=>x.name+': '+x.direction.toLowerCase())};
}

/** Retrospective quality audit of the label at each *closed* 15m window.
 * Same-window historical agreement, not a backtest of next-window predictions.
 * No future candles are used for each historical evaluation.
 */
export function structureAudit(candles, maxWindows=192){
  if(candles.length<120)return {total:0,classified:0,holdOff:0,agreed:0,agreement:null,rows:[]};
  const ends=[];
  for(let i=139;i<candles.length;i++)if(candles[i].t%900===0)ends.push(i);
  const rows=[];
  for(const i of ends.slice(-maxWindows)){
    const slice=candles.slice(i-139,i+1);
    if(slice.some((c,k)=>k && c.t-slice[k-1].t!==60))continue;
    const a=analyze(slice,candles[i].t+1),m=observedStructure(slice,a,candles[i].t+1);
    const first=slice.at(-15),last=slice.at(-1);
    if(!first||last.t-first.t!==14*60)continue;
    const delta=100*(last.close/first.open-1);
    const direction=delta>0.005?'UP':delta< -0.005?'DOWN':'FLAT';
    rows.push({end:last.t,label:m.label,direction,
      agree:m.label!=='HOLD OFF' && m.label.endsWith(direction)});
  }
  const classified=rows.filter(x=>x.label!=='HOLD OFF');
  const agreed=classified.filter(x=>x.agree).length;
  return {total:rows.length,classified:classified.length,holdOff:rows.length-classified.length,
    agreed,agreement:classified.length?agreed/classified.length:null,rows:rows.slice(-8).reverse()};
}


/** Past-chart pattern study. Looks only at FULLY COMPLETED 15m blocks of
 * consecutive, exchange-certified 1m OHLC data. Every chart has 16 points:
 * its opening price followed by the close of each of 15 completed bars.
 * Shapes are scaled by their own observed range; similarity does NOT measure
 * probability, signal accuracy, or the likely direction of a later window.
 *
 * This library is rebuilt from archived candles each time, so its learning
 * state persists as long as the underlying IndexedDB candle history persists.
 */
export const CHART_FAMILIES=['RISING','FALLING','REBOUND','REJECTION','RANGE'];
function chartFamily(path){
  const last=path.at(-1),minimum=Math.min(...path),maximum=Math.max(...path);
  const lowAt=path.indexOf(minimum),highAt=path.indexOf(maximum);
  const steps=path.slice(1).map((x,i)=>x-path[i]);
  const rising=steps.filter(x=>x>.015).length/steps.length;
  const falling=steps.filter(x=>x<-.015).length/steps.length;
  if(last>=.40 && rising>=.60) return 'RISING';
  if(last<=-.40 && falling>=.60) return 'FALLING';
  if(lowAt>=2 && lowAt<=12 && minimum<=-.3 && last-minimum>.42 && last>-.17)return 'REBOUND';
  if(highAt>=2 && highAt<=12 && maximum>=.3 && maximum-last>.42 && last<.17)return 'REJECTION';
  return 'RANGE';
}
export function archiveChartWindows(candles, nowSec=Date.now()/1000){
  if(!Array.isArray(candles)||!candles.length)return [];
  const cutoff=Math.floor(nowSec/60)*60;
  const ordered=candles.filter(c=>c?.t<=cutoff).sort((a,b)=>a.t-b.t);
  const out=[];let group=[],slot=null;
  function finish(){
    if(group.length!==15)return;
    const k=slot,first=group[0],last=group[14],exchange=first.source;
    if(!(exchange==='Coinbase'||exchange==='Kraken')||
      group.some((c,i)=>c.source!==exchange||!parseCandle(c)||c.t!==(k*900+(i+1)*60)))return;
    const hi=Math.max(...group.map(c=>c.high)),lo=Math.min(...group.map(c=>c.low));
    const width=hi-lo;
    if(!(width>0&&first.open>0))return;
    const price=[first.open,...group.map(c=>c.close)];
    const path=price.map(v=>(v-first.open)/width);
    const amplitude=100*width/first.open;
    out.push({end:last.t,begin:first.t-60,source:exchange,
      path,amplitude,move:100*(last.close/first.open-1),family:chartFamily(path)});
  }
  for(const c of ordered){
    if(!parseCandle(c))continue;
    const k=Math.floor((c.t-1)/900);
    if(slot!==k){finish();group=[];slot=k;}
    group.push(c);
  }
  finish();return out;
}
function chartDistance(a,b){
  let sum=0;
  for(let i=0;i<a.path.length;i++)sum+=(a.path[i]-b.path[i])**2;
  const shape=Math.sqrt(sum/a.path.length);
  // Range is a small secondary distinction; patterns are primarily shape-based.
  const rangePenalty=.06*Math.abs(Math.log(Math.max(.001,a.amplitude)/Math.max(.001,b.amplitude)));
  return shape+rangePenalty;
}
export function pastChartLearning(candles, maxMatches=3){
  const windows=archiveChartWindows(candles),latest=windows.at(-1)||null;
  const counts=Object.fromEntries(CHART_FAMILIES.map(k=>[k,0]));
  for(const w of windows)counts[w.family]++;
  const ready=windows.length>=24;
  if(!ready)return {ready:false,studied:windows.length,latest,counts,matches:[],
    stability:null,quality:'COLLECTING',need:Math.max(0,24-windows.length),
    detail:`Saved ${windows.length} complete exchange charts. Need ${Math.max(0,24-windows.length)} more for meaningful comparisons.`};
  // Earliest 70% vs latest 30%: a descriptive sample-drift check only.
  const split=Math.floor(windows.length*.7),early=windows.slice(0,split),late=windows.slice(split);
  let distributionShift=0;
  for(const kind of CHART_FAMILIES){
    const a=early.filter(w=>w.family===kind).length/early.length;
    const b=late.filter(w=>w.family===kind).length/late.length;
    distributionShift+=Math.abs(a-b)/2;
  }
  const options=windows.slice(0,-1).filter(w=>latest.end-w.end>=3600)
    .map(w=>({...w,distance:chartDistance(latest,w)}))
    .sort((a,b)=>a.distance-b.distance);
  const matches=[];
  for(const w of options){
    if(matches.some(m=>Math.abs(m.end-w.end)<3600))continue;
    matches.push({...w,resemblance:Math.max(0,Math.round(100*(1-w.distance/1.2)))});
    if(matches.length>=Math.max(1,Math.min(6,maxMatches)))break;
  }
  return {ready,studied:windows.length,latest,counts,matches,
    stability:distributionShift,quality:windows.length<96?'EARLY LIBRARY':
      windows.length<480?'GROWING LIBRARY':'EXTENDED LIBRARY',need:0,
    detail:'Compares the latest completed chart with earlier completed BTC charts. Resemblance is visual similarity, not predictive accuracy.'};
}
