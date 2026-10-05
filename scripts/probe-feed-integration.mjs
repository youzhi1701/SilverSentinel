import { Feed } from '../src/feed.mjs';
const feed=new Feed();
const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('行情连接超时')),25000);feed.on('status',state=>{if(state.status==='connected'){clearTimeout(timer);resolve()}})});
try{
  feed.start();await ready;
  const results=[];
  for(const side of ['ask','bid'])for(const period of ['5s','15s','30s','1','5','15','30','60','120','240','day','week','month']){
    const size=period==='1'&&side==='ask'?1000:120;
    const value=await feed.history({side,period,size});
    if(value.candles.length<20)throw Error(`${side}/${period} 返回数量不足`);
    if(value.candles.some((row,index)=>index&&row.time<=value.candles[index-1].time))throw Error(`${side}/${period} 时间未升序`);
    results.push({side,period,requested:size,received:value.candles.length,first:value.candles[0].time,last:value.candles.at(-1).time});
  }
  console.log(JSON.stringify(results,null,2));
}finally{feed.stop()}
