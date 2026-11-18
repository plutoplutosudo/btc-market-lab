import {VERSION,DAY,fromCoinbaseRows,fromKrakenRows,mergeCandles,analyze,historicalPatterns,observedStructure,structureAudit,pastChartLearning} from './core.mjs';
import {SECOND_RETENTION,MAX_SECOND_BARS,ingestSecondTrade,restoreSecondBars,plotSecondBars} from './secondbars.mjs';
const $=id=>document.getElementById(id);
const fmt=(n,d=2)=>Number.isFinite(n)?n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
const money=n=>Number.isFinite(n)?'$'+fmt(n):'$—';
const pct=n=>Number.isFinite(n)?(n>0?'+':'')+fmt(n,3)+'%':'—';
const time=t=>t?new Date(t*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'—';
const nowSec=()=>Date.now()/1000;
const MAX_BARS=43200;
const state={candles:[],seconds:[],ticks:[],spot:null,tickAt:0,ws:null,wsAttempts:0,
  range:120,chartMode:'candles',hover:null,frameAt:0,baseline:null,
  fetchedAt:0,sourceError:'',lastConfirmed:0,db:null,dbError:'',
  delayedPrice:false,liveSample:null,serverSource:false,installEvent:null,
  lastCalculatedCandle:0,stopped:false,showEMA:true,patterns:null,structure:null,audit:null,chartStudy:null,visits:0,lastOpened:null,
  fetchBusy:false,catchupStarted:false,historyNotice:'',lastSync:0,savedSecondUntil:0,secondsSaving:false,feedKind:'waiting'};

function openDB(){return new Promise((resolve,reject)=>{
  if(!('indexedDB' in window))return reject(new Error('IndexedDB unavailable'));
  const req=indexedDB.open('btc-market-lab-v2',3);
  req.onupgradeneeded=()=>{const db=req.result;
    if(!db.objectStoreNames.contains('candles'))db.createObjectStore('candles',{keyPath:'t'});
    if(!db.objectStoreNames.contains('prefs'))db.createObjectStore('prefs',{keyPath:'key'});
    if(!db.objectStoreNames.contains('seconds'))db.createObjectStore('seconds',{keyPath:'t'});};
  req.onerror=()=>reject(req.error);req.onsuccess=()=>resolve(req.result);
});}
function database(action,mode='readonly',table='candles'){
  return new Promise((resolve,reject)=>{if(!state.db)return reject(new Error('No database'));
    const tx=state.db.transaction(table,mode),store=tx.objectStore(table);
    let req;try{req=action(store)}catch(e){reject(e);return;}
    tx.oncomplete=()=>resolve(req?.result);
    tx.onerror=()=>reject(tx.error||new Error('Storage failed'));
    tx.onabort=()=>reject(tx.error||new Error('Storage interrupted'));
  });
}
async function loadSaved(){
  try{
    state.db=await openDB();
    const rows=await database(st=>st.getAll());
    state.candles=mergeCandles([],rows).slice(-MAX_BARS);
    state.seconds=restoreSecondBars(await database(st=>st.getAll(),'readonly','seconds'));
    state.savedSecondUntil=state.seconds.at(-1)?.t||0;
    const settings=await new Promise(resolve=>{try{const tx=state.db.transaction('prefs','readonly');
      const a=tx.objectStore('prefs').get('ui'),b=tx.objectStore('prefs').get('session');
      tx.oncomplete=()=>resolve({ui:a.result?.value||{},session:b.result?.value||{}});
      tx.onerror=()=>resolve({ui:{},session:{}});}catch(_){resolve({ui:{},session:{}});}});
    const ui=settings.ui;
    if([30,120,900].includes(ui.range))state.range=ui.range;
    if(['line','candles'].includes(ui.chartMode))state.chartMode=ui.chartMode;
    if(typeof ui.showEMA==='boolean')state.showEMA=ui.showEMA;
    state.visits=(Number(settings.session.visits)||0)+1;
    state.lastOpened=settings.session.lastOpened||null;
    await savePreference('session',{visits:state.visits,lastOpened:new Date().toISOString()});
    syncControls();
    $('storageStatus').textContent='Saved · '+state.seconds.length.toLocaleString()+' observed 1s bars · '+state.candles.length.toLocaleString()+' historic 1m bars';
  }catch(e){state.dbError=String(e.message||e);$('storageStatus').textContent='Local storage unavailable — history may not persist';}
  calculate();render();
}
async function savePreference(key,value){
  if(!state.db)return;
  try{await new Promise((resolve,reject)=>{
    const tx=state.db.transaction('prefs','readwrite');
    tx.objectStore('prefs').put({key,value});
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error||new Error('Preference write failed'));
    tx.onabort=()=>reject(tx.error||new Error('Preference write interrupted'));
  });}
  catch(e){state.dbError='Preferences could not be saved: '+String(e.message||e);}
}
// Flush only *closed* 1-second bars. iPhone may suspend the page; pagehide attempts a final flush.
async function flushSecondBars(){
  if(!state.db||state.secondsSaving)return;
  const end=Math.floor(Date.now()/1000)-1;
  const toSave=state.seconds.filter(b=>b.t>state.savedSecondUntil&&b.t<=end).map(b=>({...b}));
  if(!toSave.length)return;
  state.secondsSaving=true;
  try{
    await database(store=>{
      for(const b of toSave)store.put(b);
      const cutoff=Math.floor(Date.now()/1000)-SECOND_RETENTION;
      const keys=store.getAllKeys(IDBKeyRange.upperBound(cutoff,true));
      keys.onsuccess=()=>{for(const k of keys.result)store.delete(k);};
    },'readwrite','seconds');
    state.savedSecondUntil=Math.max(state.savedSecondUntil,toSave.at(-1).t);
  }catch(e){state.dbError='1s history save failed: '+String(e.message||e);}
  finally{state.secondsSaving=false;}
}
function saveUI(){return savePreference('ui',{range:state.range,chartMode:state.chartMode,showEMA:state.showEMA});}
function syncControls(){
  document.querySelectorAll('[data-span]').forEach(b=>b.classList.toggle('selected',Number(b.dataset.span)===state.range));
  document.querySelectorAll('[data-type]').forEach(b=>b.classList.toggle('selected',b.dataset.type===state.chartMode));
  $('emaToggle').checked=state.showEMA;
}
let saveChain=Promise.resolve();
async function saveBars(items){
  if(!items.length||!state.db)return;
  const bars=items.slice();
  saveChain=saveChain.catch(()=>{}).then(()=>database(store=>{
    for(const c of bars)store.put(c);
    // Remove aged records as history advances. Browsers may evict data under storage pressure.
    const cutoff=Math.floor(nowSec()/60)*60-30*DAY;
    const keys=store.getAllKeys(IDBKeyRange.upperBound(cutoff,true));
    keys.onsuccess=()=>{for(const k of keys.result)store.delete(k);};
  },'readwrite')).catch(e=>{state.dbError='Save failed: '+String(e.message||e);$('storageStatus').textContent=state.dbError;});
  return saveChain;
}
async function incorporate(incoming){
  const old=new Map(state.candles.map(c=>[c.t,c]));
  const next=mergeCandles(state.candles,incoming).slice(-MAX_BARS);
  state.candles=next;
  const changed=next.filter(c=>!old.has(c.t)||JSON.stringify(old.get(c.t))!==JSON.stringify(c));
  if(changed.length)await saveBars(changed);
  if(changed.length||state.lastCalculatedCandle!==next.at(-1)?.t){calculate();render();}
}
function calculate(){
  state.baseline=analyze(state.candles);
  state.patterns=historicalPatterns(state.candles);
  state.structure=observedStructure(state.candles,state.baseline);
  state.audit=structureAudit(state.candles);
  state.chartStudy=pastChartLearning(state.candles);
  state.lastCalculatedCandle=state.candles.at(-1)?.t||0;
}
function connectionStatus(){
  const age=(Date.now()-state.tickAt)/1000,
    online=Number.isFinite(state.spot)&&age<12,
    confirmed=state.baseline?.healthy;
  const el=$('connection');el.className='connection '+(online?'good':state.sourceError?'bad':'');
  $('feedLabel').textContent=online?'LIVE · COINBASE':state.sourceError?'DATA LIMITED':'CONNECTING';
  $('liveFlag').className='age '+(online?'live':'');
  $('liveFlag').textContent=online?'Updated '+Math.max(0,Math.round(age))+'s ago':
    (state.spot?'Last price is stale':'Awaiting live data');
  $('dataHealth').textContent=confirmed?(online?'Healthy':'History only'):'Limited';
  $('dataHealth').style.color=confirmed?'#5ce9bd':'#ffd08a';
  const latestSource=state.candles.at(-1)?.source;
  $('dataDetail').textContent=state.sourceError?state.sourceError.slice(0,75):
    confirmed?(latestSource==='Coinbase'?'Coinbase completed bars':latestSource==='Kraken'?'Kraken backup bars':'Sampled / historic bars'):
    state.baseline?.detail||'Waiting for candles';
  $('spot').textContent=money(state.spot||state.candles.at(-1)?.close);
  const n=state.seconds.length;
  $('secondCount').textContent=n.toLocaleString()+' observed 1s bars';
  $('secondFeed').textContent=online?(state.feedKind==='ws'?'Coinbase streaming · 1s OHLC':'REST price only · 1s paused'):
     'Waiting for live trades · gaps are not filled';
}
function render(){
  const a=state.baseline || analyze([]),c=state.candles,win=a.windows,patterns=state.patterns||historicalPatterns(c),
    recent=a.healthy?a.trend:{};
  const st=state.structure||observedStructure([]),aud=state.audit||structureAudit([]);
  $('structureCall').textContent=st.label;
  $('structureCall').className='structure-call '+st.tone;
  $('structureDetail').textContent=st.detail;
  $('upVotes').style.width=(st.up/(st.totalChecks||11)*100)+'%';
  $('downVotes').style.width=(st.down/(st.totalChecks||11)*100)+'%';
  $('upCount').textContent='Higher '+st.up+'/'+(st.totalChecks||11);
  $('downCount').textContent='Lower '+st.down+'/'+(st.totalChecks||11);
  $('supportValue').textContent=money(st.support);
  $('resistanceValue').textContent=money(st.resistance);
  $('evidenceSummary').textContent=st.checks.length?
    st.score+'/'+st.totalChecks+' aligned · '+st.families+' indicator groups':
    'Waiting for completed minute data';
  const gatesOK=(st.gates||[]).filter(g=>g.ok).length;
  $('dataGateSummary').textContent=st.gates.length?
    gatesOK+'/'+st.gates.length+' data checks passed':'Checking data quality…';
  const safe=t=>String(t).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  $('dataGates').innerHTML=(st.gates||[]).map(g=>
    '<div class="checkline"><span class="checkmark '+(g.ok?'ok':'fail')+'">'+(g.ok?'✓':'!')+'</span><span>'+safe(g.name)+'</span></div>').join('');
  $('trendChecks').innerHTML=(st.checks||[]).map(c=>
    '<div class="checkline"><span>'+safe(c.name)+'</span><strong class="'+(c.dir===1?'positive':c.dir===-1?'negative':'neutral')+'">'+c.direction+'</strong></div>').join('');
  $('structureReasons').textContent=st.checks.length?
    'Descriptions of completed price movement, not predictions. Expand the panel to inspect every check.':
    'Waiting for continuous confirmed exchange candles.';
  renderPastCharts(state.chartStudy||pastChartLearning([]));
  $('auditCount').textContent=aud.total+' audited windows';
  $('auditAgreement').textContent=aud.agreement==null?'—':(100*aud.agreement).toFixed(1)+'%';
  $('auditClassified').textContent=aud.classified.toLocaleString();
  $('auditHoldOff').textContent=aud.holdOff.toLocaleString();
  $('auditCoverage').textContent=aud.total?((aud.classified/aud.total)*100).toFixed(0)+'% labeled':'—';
  $('delta15').textContent=pct(recent.m15);
  $('delta15').style.color=recent.m15>0?'#55e6bd':recent.m15<0?'#ff788f':'#eff6ff';
  $('marketDelta').textContent=a.healthy?'15m '+pct(recent.m15)+' · 1h '+pct(recent.m60)+
     ' · 1-minute candles used for indicators':a.detail;
  $('lastSaved').textContent=c.length?time(c.at(-1).t):'—';
  $('lastSavedDesc').textContent=c.length?'Latest completed 1m candle':'Local to this device';
  const progress=Math.min(100,Math.round(patterns.observed/patterns.nextSample*100));
  $('learningPercent').textContent=progress+'%';
  $('learningFill').style.width=progress+'%';
  $('phaseChip').textContent=patterns.level;
  $('barsSaved').textContent=c.length.toLocaleString();
  $('windowsSaved').textContent=win.complete.toLocaleString();
  $('daysSaved').textContent=c.length?fmt((c.at(-1).t-c[0].t)/DAY,1)+' days':'—';
  $('typical1m').textContent=a.typicalMove==null?'—':fmt(a.typicalMove,4)+'%';
  $('windowsChip').textContent=win.complete+' windows';
  $('windowUp').textContent=win.up.toLocaleString();
  $('windowDown').textContent=win.down.toLocaleString();
  $('windowFlat').textContent=win.flat.toLocaleString();
  $('median15').textContent=win.complete?fmt(win.typical15m,3)+'%':'—';
  $('noiseThreshold').textContent=a.threshold!=null?fmt(a.threshold,4)+'%':'—';
  $('missingMinutes').textContent=c.length>=65?a.gaps:'—';
  $('historyCoverage').textContent=c.length?(patterns.coverage*100).toFixed(1)+'%':'—';
  $('historicalFlips').textContent=patterns.flipRate==null?'—':(patterns.flipRate*100).toFixed(1)+'% of transitions';
  renderPatterns(patterns);
  const div=win.complete||1;
  $('barUp').style.width=win.up/div*100+'%';
  $('barDown').style.width=win.down/div*100+'%';
  $('barFlat').style.width=win.flat/div*100+'%';
  const metric=(name,value,sub)=>`<div class="indicator"><span>${name}</span><b>${value}</b><small>${sub}</small></div>`;
  $('indicators').innerHTML=a.healthy?[
    metric('EMA 9',money(a.ema9),'Shorter-term average'),
    metric('EMA 21',money(a.ema21),'Longer-term average'),
    metric('RSI 14',fmt(a.rsi,1),'0–100 oscillator'),
    metric('MACD histogram',fmt(a.macd,4)+'%','Observed momentum difference'),
    metric('Bollinger position',fmt(a.boll,2)+'σ','Relative to the latest 20 closes'),
    metric('1m realized volatility',fmt(a.volatility,4)+'%','30-minute sample')].join(''):
    `<div class="empty">${a.detail.replaceAll('<','&lt;')}</div>`;
  $('storageStatus').textContent=state.dbError?'Storage issue: '+state.dbError:
    'Locally saved · '+c.length.toLocaleString()+' 1m history candles · '+state.seconds.length.toLocaleString()+' observed 1s bars · browser-owned data';
  connectionStatus();
}
// All sparkline values come from saved, completed exchange candles (never live ticks).
function sparkPath(values){
  const w=170,h=54,xpad=6,ypad=7;
  const lo=Math.min(...values,-.1),hi=Math.max(...values,.1),span=Math.max(.25,hi-lo);
  return values.map((v,i)=>`${i?'L':'M'}${(xpad+i*(w-2*xpad)/(values.length-1)).toFixed(1)},${(ypad+(hi-v)/span*(h-2*ypad)).toFixed(1)}`).join(' ');
}
function sparkMarkup(values,color){
  const path=sparkPath(values);
  return `<svg class="shape-spark" viewBox="0 0 170 54" aria-label="Normalized historic chart outline" role="img"><path d="${path}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
function renderPastCharts(study){
  $('chartStudyCount').textContent=study.studied.toLocaleString();
  $('chartStudyPhase').textContent=study.quality;
  $('chartStudyFamily').textContent=study.latest?.family||'—';
  $('chartStudyDrift').textContent=study.stability===null?'—':(study.stability*100).toFixed(0)+' percentage points';
  $('chartStudyDesc').textContent=study.detail;
  const latest=$('latestShape');latest.replaceChildren();
  if(study.latest){
    latest.innerHTML=sparkMarkup(study.latest.path,'#7ebdff');
  }else latest.textContent='Waiting for completed exchange charts';
  const list=$('pastMatches');list.replaceChildren();
  if(!study.matches.length){
    const p=document.createElement('p');p.className='empty';
    p.textContent=study.ready?'No sufficiently separated earlier matches yet.':
      'Build the chart library by collecting completed 15-minute windows.';
    list.append(p);return;
  }
  for(const w of study.matches){
    const card=document.createElement('article');card.className='shape-match';
    const visual=document.createElement('div');visual.innerHTML=sparkMarkup(w.path,'#6ce4c1');
    const content=document.createElement('div');
    const title=document.createElement('strong');title.textContent=w.family+' · '+new Date(w.end*1000).toLocaleString();
    const note=document.createElement('small');
    note.textContent=`Shape resemblance index ${w.resemblance}/100 · historical move ${pct(w.move)}`;
    content.append(title,note);card.append(visual,content);list.append(card);
  }
}
function renderPatterns(p){
  const last=p.latest;
  const status=last?.regime||'GATHERING';
  $('regimeChip').textContent=p.level;
  $('regimeValue').textContent=status==='GATHERING'?'Gathering':status.toLowerCase().replace(/^./,x=>x.toUpperCase());
  $('recentWindowMove').textContent=last?pct(last.move):'—';
  $('recentWindowRange').textContent=last?fmt(last.amplitude,3)+'%':'—';
  $('recentWindowDirection').textContent=last?last.direction.toLowerCase():'—';
  $('recentWindowMove').className=last?.move>0?'positive':last?.move<0?'negative':'neutral';
  const resumed=state.lastOpened?new Date(state.lastOpened).toLocaleString():'This is your first saved session';
  $('resumeHeadline').textContent=state.dbError?'Browser storage unavailable':state.visits+' saved session'+(state.visits===1?'':'s');
  $('resumeDetail').textContent=state.dbError?'Enable storage or use a supported browser. Export backups when available.':
    'Last session: '+resumed+(state.historyNotice?' · '+state.historyNotice:'');
  const log=$('patternJournal');log.replaceChildren();
  if(!p.history.length){const v=document.createElement('p');v.className='empty';v.textContent='Collecting completed 15-minute windows…';log.append(v);return;}
  for(const w of p.history){
    const row=document.createElement('div');row.className='journal-row';
    const a=document.createElement('span');a.className='when';a.textContent=new Date(w.end*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    const b=document.createElement('strong');b.className=w.direction==='HIGHER'?'positive':w.direction==='LOWER'?'negative':'neutral';b.textContent=w.direction;
    const c=document.createElement('span');c.className='move '+(w.move>0?'positive':w.move<0?'negative':'neutral');c.textContent=pct(w.move);
    const d=document.createElement('span');d.className='regime';d.textContent=w.regime;
    row.append(a,b,c,d);log.append(row);
  }
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function exchangeCandles(start,end){
  const query=new URLSearchParams({granularity:'60',start:new Date(start*1000).toISOString(),end:new Date(end*1000).toISOString()});
  const urls=['./api/candles?'+query,'https://api.exchange.coinbase.com/products/BTC-USD/candles?'+query];
  let error='';
  for(let i=0;i<urls.length;i++){
    const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),9000);
    try{const response=await fetch(urls[i],{signal:ctrl.signal,cache:'no-store'});
      if(!response.ok)throw Error('HTTP '+response.status);
      const data=await response.json(),bars=fromCoinbaseRows(data);
      if(bars.length<2)throw Error('Empty minute-candle history');
      if(i===0)state.serverSource=true;
      return bars;
    }catch(e){error=String(e.message||e);}finally{clearTimeout(timer);}
  }
  throw Error(error||'Coinbase candle feed unavailable');
}
async function fallbackKraken(){
  const urls=['./api/kraken','https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1'];
  let error='';
  for(const url of urls){const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),8500);
    try{const r=await fetch(url,{signal:ctrl.signal,cache:'no-store'});
      if(!r.ok)throw Error('HTTP '+r.status);
      const data=await r.json();if(data.error?.length)throw Error('Kraken returned an API error');
      const rows=Object.entries(data.result||{}).find(([k])=>k!=='last')?.[1];
      const bars=fromKrakenRows(rows);
      if(bars.length<5)throw Error('Empty Kraken candle history');
      await incorporate(bars);state.fetchedAt=Date.now();
      state.historyNotice='Using Kraken backup candles';state.sourceError='';return true;
    }catch(e){error=String(e.message||e);}finally{clearTimeout(timer);}
  }
  state.sourceError='Historical feeds unavailable ('+error+').';return false;
}
async function loadHistory(){
  if(state.fetchBusy)return;
  state.fetchBusy=true;
  const end=Math.floor(nowSec()/60)*60, previousEnd=state.candles.at(-1)?.t||0;
  let loadedCoinbase=false;
  try{
    try{const bars=await exchangeCandles(end-235*60,end);
      await incorporate(bars);state.sourceError='';state.fetchedAt=Date.now();loadedCoinbase=true;
    }catch(e){await fallbackKraken();}
    if(loadedCoinbase&&!state.catchupStarted){
      state.catchupStarted=true;
      // Recover missing data from a prior session, up to 48 hours, or initially collect 12 hours.
      const earliest=previousEnd?Math.max(previousEnd-60,end-2*DAY):end-12*3600;
      let count=0;
      for(let cursor=end-235*60;cursor>earliest;cursor-=235*60){
        if(count++>=13)break;
        const left=Math.max(earliest,cursor-235*60);
        try{const bars=await exchangeCandles(left,cursor);
          await incorporate(bars);state.historyNotice='Restored '+state.candles.length.toLocaleString()+' saved minutes';
        }catch(_){state.historyNotice='Partial historical recovery';break;}
        await sleep(230);
      }
      render();
    }
  }finally{state.fetchBusy=false;connectionStatus();}
}
let reconnectHandle=null;
function connectStream(){
  if(state.stopped)return;
  try{
    const ws=new WebSocket('wss://ws-feed.exchange.coinbase.com');state.ws=ws;
    ws.onopen=()=>{state.wsAttempts=0;ws.send(JSON.stringify({type:'subscribe',product_ids:['BTC-USD'],channels:['ticker']}));};
    ws.onmessage=e=>{try{
      const m=JSON.parse(e.data);
      if(m.type!=='ticker'||m.product_id!=='BTC-USD')return;
      const p=Number(m.price),ts=Date.parse(m.time||'');
      if(!Number.isFinite(p)||p<=0||!Number.isFinite(ts)||Math.abs(Date.now()-ts)>30000)return;
      ingestTrade(ts,p,'ws');
    }catch(_){}};
    ws.onerror=()=>{state.sourceError='WebSocket connection interrupted';};
    ws.onclose=()=>{if(state.stopped)return;state.wsAttempts++;
      const delay=Math.min(30000,2000*Math.pow(1.6,Math.min(9,state.wsAttempts)));
      reconnectHandle=setTimeout(connectStream,delay);
    };
  }catch(e){state.sourceError=String(e);reconnectHandle=setTimeout(connectStream,8000);}
}
function ingestTrade(ts,p,source='ws'){
  if(ts < state.tickAt-120000 || ts>Date.now()+4000)return;
  if(ts >= state.tickAt){state.spot=p;state.tickAt=ts;state.feedKind=source;}
  state.sourceError='';
  if(source!=='ws'){connectionStatus();return;} // REST ticker checks cannot form full 1s OHLC.
  ingestSecondTrade(state.seconds,ts,p);
  if(!state.ticks.length||ts>state.ticks.at(-1)[0])state.ticks.push([ts,p]);
  if(state.ticks.length>1000)state.ticks.splice(0,state.ticks.length-1000);
  const minute=Math.floor(ts/60000),s=state.liveSample;
  if(s && minute!==s.minute){
    // Only save observed-trade approximations with nearly continuous coverage.
    if(minute===s.minute+1 && s.count>=5 && s.first-s.minute*60000<16000 &&
       (s.minute+1)*60000-s.last<20000 && s.maxGap<35000){
      incorporate([{t:(s.minute+1)*60,open:s.open,high:s.high,low:s.low,
        close:s.close,volume:0,source:'Coinbase sampled trades'}]).catch(()=>{});
    }
    state.liveSample=null;
  }
  if(!state.liveSample){state.liveSample={minute,first:ts,last:ts,open:p,high:p,low:p,close:p,count:1,maxGap:0};}
  else if(minute===state.liveSample.minute){const a=state.liveSample;
    a.count++;a.high=Math.max(a.high,p);a.low=Math.min(a.low,p);
    a.close=p;a.maxGap=Math.max(a.maxGap,ts-a.last);a.last=ts;
  }
  connectionStatus();
}
async function pollFallback(){
  if(Date.now()-state.tickAt<12000)return;
  for(const url of ['./api/ticker','https://api.exchange.coinbase.com/products/BTC-USD/ticker']){
    try{const r=await fetch(url,{cache:'no-store'});if(!r.ok)continue;
      const m=await r.json(),p=Number(m.price),t=Date.parse(m.time);
      if(Number.isFinite(p)&&Number.isFinite(t)&&Math.abs(Date.now()-t)<25000){ingestTrade(t,p,'rest');break;}
    }catch(_){}
  }
}
function updateClock(){
  const d=new Date();$('localClock').textContent=d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const sec=Date.now()/1000,elapsed=((sec%900)+900)%900,remaining=Math.ceil(900-elapsed),
    end=Math.ceil(sec/900)*900,start=Math.floor(sec/900)*900;
  $('timer').textContent=String(Math.floor(remaining/60)).padStart(2,'0')+':'+String(remaining%60).padStart(2,'0');
  $('timerFill').style.width=(elapsed/900*100)+'%';
  const u=t=>new Date(t*1000).toLocaleTimeString('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit',hour12:false})+' UTC';
  $('startWindow').textContent='Start '+u(start);$('endWindow').textContent='End '+u(end);
  connectionStatus();
}

/* Live 1-second chart from observed Coinbase WebSocket ticker trades only.
 * Candle OHLC uses trade timestamps, not artificially interpolated second intervals.
 * Historical analytics intentionally stay on Coinbase/Kraken completed 1m bars.
 */
const canvas=$('chart'),cx=canvas.getContext('2d');
function resizeChart(){const rect=canvas.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);
  canvas.width=Math.max(1,Math.floor(rect.width*d));canvas.height=Math.max(1,Math.floor(rect.height*d));
  cx.setTransform(d,0,0,d,0,0);
}
function drawChart(){
  const W=canvas.clientWidth,H=canvas.clientHeight;if(!W||!H)return;
  const L=16,R=W<500?78:96,T=19,B=34,P=W-L-R,PH=H-T-B;
  cx.clearRect(0,0,W,H);if(P<40||PH<45)return;
  const now=Date.now(),end=now+2000,begin=end-state.range*1000;
  const bars=state.seconds.filter(b=>b.t*1000>=begin-1000 && b.t*1000<=end);
  const fresh=state.feedKind==='ws' && Number.isFinite(state.spot) && now-state.tickAt<12000;
  if(!bars.length){cx.fillStyle='#94aac5';cx.font='13px system-ui';cx.textAlign='left';
    cx.fillText('Waiting for real 1-second trade candles…',18,43);
    cx.fillStyle='#7193af';cx.font='11px system-ui';
    cx.fillText('No synthetic candles. New bars appear after live trades arrive.',18,65);return;}
  const vals=bars.flatMap(b=>[b.high,b.low]);
  let low=Math.min(...vals),high=Math.max(...vals),pad=Math.max((high-low)*.2,low*.00002);
  low-=pad;high+=pad;if(high===low)high=low+1;
  const x=t=>L+(t-begin)/(end-begin)*P,y=v=>T+(high-v)/(high-low)*PH;
  cx.lineWidth=1;cx.font='11px system-ui';cx.textBaseline='middle';
  for(let i=0;i<5;i++){
    const value=low+(high-low)*i/4,yy=y(value);
    cx.strokeStyle='#24354d';cx.beginPath();cx.moveTo(L,yy);cx.lineTo(W-R,yy);cx.stroke();
    cx.textAlign='left';cx.fillStyle='#9bb0c9';cx.fillText('$'+fmt(value,high-low<20?2:0),W-R+9,yy);
  }
  const tickEvery=state.range<=30?5:state.range<=120?20:120;
  for(let t=Math.ceil(begin/(tickEvery*1000))*tickEvery*1000;t<=end;t+=tickEvery*1000){
    const xx=x(t);cx.strokeStyle='#1e2d40';cx.beginPath();cx.moveTo(xx,T);cx.lineTo(xx,H-B);cx.stroke();
    cx.textAlign='center';cx.fillStyle='#9daec4';cx.fillText(new Date(t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:state.range<=120?'2-digit':undefined}),xx,H-13);
  }
  const line=(pairs,color,width=2,dash=[],gapsMs=3000)=>{
    if(pairs.length<2)return;
    cx.lineWidth=width;cx.strokeStyle=color;cx.lineJoin='round';cx.setLineDash(dash);cx.beginPath();
    pairs.forEach((p,i)=>i&&p[0]-pairs[i-1][0]<=gapsMs?cx.lineTo(x(p[0]),y(p[1])):cx.moveTo(x(p[0]),y(p[1])));
    cx.stroke();cx.setLineDash([]);
  };
  const struct=state.structure;
  if(struct){for(const [label,v,color] of [['HIST. LOW',struct.support,'#41b6a7a5'],['HIST. HIGH',struct.resistance,'#f0b876a5']]){
    if(!Number.isFinite(v)||v<low||v>high)continue;const yy=y(v);
    cx.strokeStyle=color;cx.setLineDash([2,6]);cx.beginPath();cx.moveTo(L,yy);cx.lineTo(W-R,yy);cx.stroke();cx.setLineDash([]);
    cx.fillStyle=color;cx.textAlign='left';cx.font='10px system-ui';cx.fillText(label,L+4,Math.max(T+9,yy-8));
  }}
  cx.save();cx.beginPath();cx.rect(L,T,P,PH);cx.clip();
  const plot=plotSecondBars(bars,x,W<500?3.2:2.5);
  if(state.chartMode==='line'){
    const closes=bars.map(b=>[b.t*1000,b.close]);
    line(closes,'#89bdff',2.3,[],2000);
  }else{
    const cw=Math.max(1.8,Math.min(8,P/state.range*.76));
    for(const bar of plot){
      const xx=x(bar.t*1000),color=bar.close>=bar.open?'#59e6bc':'#fa8098';
      cx.strokeStyle=color;cx.fillStyle=color;cx.lineWidth=1;
      cx.beginPath();cx.moveTo(xx,y(bar.high));cx.lineTo(xx,y(bar.low));cx.stroke();
      cx.fillRect(xx-cw/2,Math.min(y(bar.open),y(bar.close)),Math.max(cw,bar.n>1?2.6:cw),Math.max(1.5,Math.abs(y(bar.open)-y(bar.close))));
    }
  }
  if(state.showEMA&&state.seconds.length>=22){
    const e9=[],e21=[];let v9=null,v21=null,prevT=null;
    for(const b of state.seconds){
      if(prevT!=null&&b.t-prevT>3){v9=v21=null;} // don't interpolate gaps
      v9=v9==null?b.close:(.2*b.close+.8*v9);
      v21=v21==null?b.close:(2/22*b.close+20/22*v21);prevT=b.t;
      if(b.t*1000>=begin-1000){e9.push([b.t*1000,v9]);e21.push([b.t*1000,v21]);}
    }
    line(e21,'#c49dfd',1.45,[5,5]);line(e9,'#55e6bd',1.65);
  }
  const live=bars.at(-1),inProgress=live.t===Math.floor(now/1000);
  if(inProgress){const xx=x(live.t*1000),yy=y(live.close);cx.strokeStyle='#ffd08a';cx.lineWidth=1.7;
    cx.strokeRect(xx-4,Math.min(y(live.open),yy)-2,8,Math.max(4,Math.abs(y(live.open)-yy)+4));
    cx.fillStyle='#ffd08a';cx.beginPath();cx.arc(xx,yy,3.7,0,Math.PI*2);cx.fill();}
  cx.restore();
  const price=fresh?state.spot:live.close;
  if(Number.isFinite(price)){const yy=Math.min(H-B-13,Math.max(T+13,y(price)));
    cx.strokeStyle=fresh?'#d9e5ff77':'#7f92a17c';cx.setLineDash([4,5]);cx.beginPath();cx.moveTo(L,yy);cx.lineTo(W-R,yy);cx.stroke();cx.setLineDash([]);
    cx.fillStyle=fresh?'#304c6a':'#34404d';cx.fillRect(W-R+4,yy-13,R-8,26);cx.fillStyle='#eef6ff';cx.font='700 11px system-ui';
    cx.textAlign='center';cx.fillText('$'+fmt(price,2),W-R/2,yy+1);}
  // The crosshair reads the true individual 1s OHLC, even when distant bars are pixel-grouped.
  const h=state.hover,tip=$('chartTooltip');
  if(h&&h.x>=L&&h.x<=W-R&&h.y>=T&&h.y<=H-B){
    let nearest=null,dx=Infinity;
    for(const b of bars){const diff=Math.abs(x(b.t*1000)-h.x);if(diff<dx){nearest=b;dx=diff;}}
    if(nearest){const xx=x(nearest.t*1000),yy=y(nearest.close);cx.strokeStyle='#d8e7ff88';cx.lineWidth=1;cx.setLineDash([3,5]);
      cx.beginPath();cx.moveTo(xx,T);cx.lineTo(xx,H-B);cx.moveTo(L,yy);cx.lineTo(W-R,yy);cx.stroke();cx.setLineDash([]);
      tip.hidden=false;
      const title=nearest.t>=Math.floor(now/1000)?'Forming 1s bar':'Observed 1s bar';
      tip.innerHTML='<small>'+title+' · '+new Date(nearest.t*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'})+'</small>'+
        '<strong>O '+money(nearest.open)+' · H '+money(nearest.high)+'</strong><strong>L '+money(nearest.low)+' · C '+money(nearest.close)+'</strong>';
      tip.style.left=Math.max(4,Math.min(W-tip.offsetWidth-4,xx+12))+'px';
      tip.style.top=Math.max(3,Math.min(H-tip.offsetHeight-3,yy-tip.offsetHeight-12))+'px';
    }else tip.hidden=true;
  }else tip.hidden=true;
}
function animation(t){if(t-state.frameAt>55){drawChart();state.frameAt=t;}requestAnimationFrame(animation);}
canvas.addEventListener('pointermove',e=>{const b=canvas.getBoundingClientRect();state.hover={x:e.clientX-b.left,y:e.clientY-b.top};});
canvas.addEventListener('pointerleave',()=>{state.hover=null;$('chartTooltip').hidden=true;});
canvas.addEventListener('pointercancel',()=>{state.hover=null;$('chartTooltip').hidden=true;});
for(const b of document.querySelectorAll('[data-span]'))b.addEventListener('click',()=>{
  state.range=Number(b.dataset.span);document.querySelectorAll('[data-span]').forEach(x=>x.classList.toggle('selected',x===b));saveUI();
});
for(const b of document.querySelectorAll('[data-type]'))b.addEventListener('click',()=>{
  state.chartMode=b.dataset.type;document.querySelectorAll('[data-type]').forEach(x=>x.classList.toggle('selected',x===b));saveUI();
});
$('emaToggle').addEventListener('change',e=>{state.showEMA=e.target.checked;saveUI();});
window.addEventListener('resize',resizeChart);
let tvLoaded=false;
$('toggleTV').addEventListener('click',()=>{
  const region=$('tvArea'),open=region.hidden;region.hidden=!open;
  $('toggleTV').textContent=open?'Hide chart':'Show chart';$('toggleTV').setAttribute('aria-expanded',open?'true':'false');
  if(open&&!tvLoaded){tvLoaded=true;const div=$('tvWidget'),inner=document.createElement('div');
    inner.className='tradingview-widget-container';inner.style.cssText='width:100%;height:100%';
    const child=document.createElement('div');child.className='tradingview-widget-container__widget';child.style.cssText='width:100%;height:100%';inner.append(child);div.append(inner);
    const sc=document.createElement('script');sc.async=true;sc.type='text/javascript';sc.src='https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    sc.textContent=JSON.stringify({autosize:true,symbol:'COINBASE:BTCUSD',interval:'15',timezone:'Etc/UTC',theme:'dark',style:'1',locale:'en',enable_publishing:false,allow_symbol_change:false,calendar:false,hide_top_toolbar:false,hide_legend:false,save_image:false,backgroundColor:'#090f1d',gridColor:'#1d2c3e'});
    inner.append(sc);
  }
});

const dialog=$('backupDialog');$('backupBtn').addEventListener('click',()=>dialog.showModal());
$('closeDialog').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
$('exportBtn').addEventListener('click',()=>{
  const payload={app:'BTC Market Lab',version:VERSION,exportedAt:new Date().toISOString(),
    candles:state.candles,seconds:state.seconds.filter(b=>b.t<Math.floor(Date.now()/1000)),settings:{range:state.range,chartMode:state.chartMode,showEMA:state.showEMA},
    sessions:{visits:state.visits,lastOpened:state.lastOpened}};
  const blob=new Blob([JSON.stringify(payload)],{type:'application/json'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='btc-market-lab-backup-'+new Date().toISOString().slice(0,10)+'.json';
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  $('backupMessage').textContent='Backup prepared. Keep the file in a safe place.';
});
$('importFile').addEventListener('change',async e=>{
  try{const file=e.target.files?.[0];if(!file)return;if(file.size>18000000)throw Error('Backup file is too large.');
    const data=JSON.parse(await file.text());
    if(data.app!=='BTC Market Lab'||!Array.isArray(data.candles)||data.candles.length>MAX_BARS*2)throw Error('Not a valid BTC Market Lab backup.');
    const incoming=mergeCandles([],data.candles);
    if(data.candles.length && !incoming.length)throw Error('No usable completed candles were found.');
    await incorporate(incoming);
    if(Array.isArray(data.seconds)&&data.seconds.length<=MAX_SECOND_BARS*2){
      const restored=restoreSecondBars(data.seconds);
      const merged=restoreSecondBars(state.seconds.concat(restored));
      state.seconds=merged;
      state.savedSecondUntil=0; // import may replace previously persisted observations
      await flushSecondBars();
    }
    if(data.settings){if([30,120,900].includes(data.settings.range))state.range=data.settings.range;
      if(['line','candles'].includes(data.settings.chartMode))state.chartMode=data.settings.chartMode;
      if(typeof data.settings.showEMA==='boolean')state.showEMA=data.settings.showEMA;
      syncControls();await saveUI();}
    $('backupMessage').textContent='Imported '+incoming.length.toLocaleString()+' minute bars and '+state.seconds.length.toLocaleString()+' second bars.';
  }catch(err){$('backupMessage').textContent='Import failed: '+String(err.message||err);}
  e.target.value='';
});
$('persistBtn').addEventListener('click',async()=>{
  if(!navigator.storage?.persist){$('backupMessage').textContent='Persistent storage request is not supported by this browser.';return;}
  const granted=await navigator.storage.persist();
  $('backupMessage').textContent=granted?'Browser granted persistent storage.':'Browser did not grant persistent storage; export backups regularly.';
});
let installPrompt=null;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;$('installBtn').hidden=false;});
$('installBtn').addEventListener('click',async()=>{
  if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$('installBtn').hidden=true;
});
window.addEventListener('appinstalled',()=>{$('installBtn').hidden=true;});
if('serviceWorker' in navigator && (location.protocol==='https:'||location.hostname==='localhost'||location.hostname==='127.0.0.1')){
  navigator.serviceWorker.register('./sw.js').catch(()=>{});
}
window.addEventListener('pagehide',()=>{flushSecondBars();state.stopped=true;state.ws?.close();if(reconnectHandle)clearTimeout(reconnectHandle);});
window.addEventListener('pageshow',()=>{if(state.stopped){state.stopped=false;connectStream();loadHistory();}});
async function start(){
  await loadSaved();resizeChart();connectStream();
  setInterval(loadHistory,30000);setInterval(pollFallback,5500);setInterval(updateClock,250);
  setInterval(flushSecondBars,5000);
  setInterval(()=>{calculate();render();},20000);
  updateClock();requestAnimationFrame(animation);
  loadHistory().catch(e=>{state.sourceError=String(e.message||e);connectionStatus();});
}
start().catch(e=>{state.sourceError=String(e.message||e);render();});
