const $=id=>document.getElementById(id);
const api=window.monitor;
const selectedCode=()=>localStorage.getItem('primary-market')||'JZJ_ag';
const number=(value,precision=3)=>Number.isFinite(Number(value))?Number(value).toFixed(precision):'—';
let lastSignature='';
function render(value={}){
  const quote=value.quotes?.find(item=>item.code===selectedCode())||value.quotes?.find(item=>/ag|silver/i.test(item.code||''))||{};
  const times=[quote.bidTime,quote.askTime].map(Number).filter(Number.isFinite);
  const updated=times.length?Math.max(...times):0;
  const age=updated?Date.now()-updated:Infinity;
  const state=value.status!=='connected'?'error':age>50000?'delayed':'online';
  const signature=[quote.bid,quote.ask,quote.precision,state].join('|');
  if(signature===lastSignature)return;
  lastSignature=signature;
  $('bid').textContent=number(quote.bid,quote.precision);
  $('ask').textContent=number(quote.ask,quote.precision);
  document.body.dataset.state=state;
  $('ticker').setAttribute('aria-label',`白银，回购 ${$('bid').textContent}，销售 ${$('ask').textContent}`);
}
async function refresh(){try{render(await api.status())}catch{document.body.dataset.state='error'}}
$('ticker').addEventListener('click',()=>api.showMain('market'));
api.onStatusChanged(render);
refresh();
setInterval(refresh,5000);
