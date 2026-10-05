import { Feed } from '../src/feed.mjs';
import { NewsFeed } from '../src/news-feed.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const feed=new Feed();
const news=new NewsFeed(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'rtj-verify-')),'news.json'));
const timeout=setTimeout(()=>finish(1,'官方数据验证超时'),45000);
let finished=false;
async function finish(code,message){if(finished)return;finished=true;clearTimeout(timeout);feed.stop();news.stop();if(message)console.error(message);process.exitCode=code}
feed.once('metadata',async()=>{
  try{
    const products=feed.quotes.map(item=>({code:item.code,name:item.name}));
    const checks=[];
    for(const product of products){
      for(const side of ['ask','bid']){
        try{const result=await feed.history({code:product.code,side,period:'1',size:120});checks.push({code:product.code,side,contract:result.contract,candles:result.candles.length,valid:result.candles.every(c=>[c.open,c.high,c.low,c.close,c.time].every(Number.isFinite))})}catch(error){checks.push({code:product.code,side,error:error.message})}
      }
    }
    news.start();await new Promise(resolve=>setTimeout(resolve,5000));const flash=news.snapshot(300);
    console.log(JSON.stringify({products,checks,news:{status:flash.status,count:flash.count,returned:flash.items.length,source:flash.items[0]?.source}},null,2));
    const valid=products.length>=7&&checks.some(item=>item.candles>0&&item.valid)&&flash.items.length>0;finish(valid?0:1,valid?'':'官方K线或快讯验证失败');
  }catch(error){finish(1,error.message)}
});
feed.start();
