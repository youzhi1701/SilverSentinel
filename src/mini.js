const $=id=>document.getElementById(id);
const api=window.monitor;
const number=(value,p=3)=>Number.isFinite(Number(value))?Number(value).toFixed(p):'—';
const change=(value,rate)=>Number.isFinite(Number(value))?`${value>0?'▲ +':value<0?'▼ ':''}${number(value)}  ${value>0?'+':''}${Number(rate||0).toFixed(2)}%`:'—';
const color=value=>value>0?'#ff626b':value<0?'#1fe0ae':'#d7e2e9';
const selectedCode=()=>localStorage.getItem('primary-market')||'JZJ_ag';
let lastSignature='',pendingState=null,miniPrefs={},alertState={rules:[]};
function renderAlerts(value=alertState){alertState=value;const enabled=(value.rules||[]).filter(rule=>rule.enabled),ready=enabled.filter(rule=>rule.evaluation?.ready),near=enabled.find(rule=>rule.evaluation?.condition)||ready[0]||enabled[0];$('alert-count').textContent=String(enabled.length);$('alert-summary').textContent=!enabled.length?'暂无启用预警':near?`${near.evaluation?.condition?'接近触发':'监测中'} · ${near.name||'预警规则'}`:`${enabled.length}条规则等待行情`;document.body.dataset.hasAlerts=enabled.length?'true':'false'}
function render(state){
 try{
  if(document.hidden){pendingState=state;return}pendingState=null;
  const code=selectedCode(),quote=state.quotes?.find(item=>item.code===code)||{code},times=[quote.bidTime,quote.askTime].map(Number).filter(Number.isFinite),last=times.length?Math.max(...times):0,online=state.status==='connected'&&last&&Date.now()-last<50000,signature=JSON.stringify([code,state.status,state.message,quote.bid,quote.ask,quote.bidUpdown,quote.askUpdown,quote.bidHigh,quote.bidLow,quote.askHigh,quote.askLow,last]);
  if(signature===lastSignature)return;lastSignature=signature;
  $('mini-name').textContent=miniPrefs.miniCustomText||quote.name||quote.code||'融通金行情';
  $('dot').classList.toggle('online',online);$('status').textContent=online?'连接正常':state.message||'等待行情';
  $('bid').textContent=number(quote.bid,quote.precision);$('ask').textContent=number(quote.ask,quote.precision);
  $('bid-change').textContent=change(quote.bidUpdown,quote.bidUpdownRate);$('ask-change').textContent=change(quote.askUpdown,quote.askUpdownRate);
  $('bid').style.color=$('bid-change').style.color=color(Number(quote.bidUpdown));$('ask').style.color=$('ask-change').style.color=color(Number(quote.askUpdown));
  for(const [id,value] of [['bid-high',quote.bidHigh],['bid-low',quote.bidLow],['ask-high',quote.askHigh],['ask-low',quote.askLow]])$(id).textContent=number(value,quote.precision);
  $('freshness').textContent=online?'数据有效':'数据延迟';$('freshness').className=online?'good':'bad';$('time').textContent=last?new Date(last).toLocaleTimeString('zh-CN',{hour12:false}):'—';
 }catch(error){$('status').textContent='显示异常';$('freshness').textContent=String(error?.message||'数据渲染失败').slice(0,24);$('freshness').className='bad'}
}
async function refresh(){try{const [state,alertValue]=await Promise.all([api.status(),api.alerts()]);render(state);renderAlerts(alertValue)}catch(error){$('status').textContent='连接异常';$('freshness').textContent=String(error?.message||'请打开主面板检查').slice(0,24);$('freshness').className='bad'}}
function applyPrefs(value={}){miniPrefs=value;document.body.dataset.density=['strip','compact','standard','expanded'].includes(value.miniDensity)?value.miniDensity:'standard';$('mini-name').textContent=value.miniCustomText||'盛世白银'}
$('open').onclick=()=>api.showMain();$('close').onclick=()=>api.closeMini();api.appSettings().then(applyPrefs);api.onAppSettingsChanged(applyPrefs);api.onStatusChanged(render);api.onAlertsChanged(renderAlerts);document.addEventListener('visibilitychange',()=>{if(!document.hidden)pendingState?render(pendingState):refresh()});refresh();setInterval(()=>{if(!document.hidden)refresh()},5000);
