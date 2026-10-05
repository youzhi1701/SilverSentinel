import { Feed } from './feed.mjs';
import { PriceStore } from './store.mjs';
import { aggregateCandles } from './candles.mjs';
import path from 'node:path';
import { NewsFeed } from './news-feed.mjs';

const channel=process.parentPort;
const send=message=>channel.postMessage(message);
let store,feed,newsFeed,timer,snapshotTimer,shutting=false,storageError=null;

try{
 store=await PriceStore.open(process.argv[2]);
 feed=new Feed();
 newsFeed=new NewsFeed(path.join(path.dirname(process.argv[2]),'news-cache.json'));
 feed.on('quote',point=>{try{store.append(point);storageError=null}catch{storageError='历史保存失败，请检查磁盘空间。'}});
 feed.on('status',()=>{});
 let count=0;const publishSnapshot=()=>{const news=newsFeed.snapshot(1);send({type:'snapshot',data:{...feed.snapshot(),count,storageError,newsStatus:news.status,newsMessage:news.message,newsCount:news.count,newsLastUpdate:news.lastUpdate}})};
 timer=setInterval(()=>{try{store.flush();count=store.count()}catch{storageError='历史保存失败，请检查磁盘空间。'}},5000);
 snapshotTimer=setInterval(publishSnapshot,100);
 channel.on('message',async({data:message})=>{
  try{
   if(message.type==='shutdown'){shutting=true;clearInterval(timer);clearInterval(snapshotTimer);feed.stop();newsFeed.stop();store.close();send({type:'stopped'});process.exit(0)}
   if(message.type==='reconnect')feed.reconnect();
   if(message.type==='candles'){
    if(!feed.quotes.some(item=>item.code===message.code)||!['bid','ask'].includes(message.side))throw Error('无效的 K 线查询');
    const data=await feed.history({code:message.code,side:message.side,period:message.interval,size:message.size,endTime:message.endTime});
    send({type:'reply',id:message.id,data});
   }
   if(message.type==='local-candles'){
    if(!feed.quotes.some(item=>item.code===message.code)||!['bid','ask'].includes(message.side)||!['5s','15s','30s'].includes(String(message.interval))||![0.25,0.5,1,6,24].includes(message.hours))throw Error('无效的本地 K 线查询');
    const points=store.history(message.code,message.side,message.hours);
    send({type:'reply',id:message.id,data:aggregateCandles(points,message.interval)});
   }
   if(message.type==='news')send({type:'reply',id:message.id,data:newsFeed.snapshot(message.limit)});
  }catch(error){send({type:'reply',id:message.id,error:error.message})}
 });
 feed.start();
 newsFeed.start();
}catch(error){send({type:'fatal',message:'监控启动失败：'+error.message});process.exitCode=1}

const failWorker=message=>{if(!shutting)send({type:'fatal',message});process.exit(1)};
process.on('uncaughtException',()=>failWorker('采集进程发生错误，请重新启动软件。'));
process.on('unhandledRejection',()=>failWorker('采集进程发生未处理的异步错误，请重新启动软件。'));
