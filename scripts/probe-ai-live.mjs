import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Feed} from '../src/feed.mjs';
import {NewsFeed} from '../src/news-feed.mjs';
import {analyzeSilver} from '../src/ai.mjs';

const data=path.join(process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming'),'gold-monitor-desktop');
const settings=JSON.parse(fs.readFileSync(path.join(data,'ai-settings.json'),'utf8'));
const feed=new Feed(),newsFeed=new NewsFeed(path.join(data,'news-cache.json'));
const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('行情连接超时')),20000);feed.on('status',state=>{if(state.status==='connected'){clearTimeout(timer);resolve()}})});
try{
  feed.start();await Promise.all([ready,newsFeed.start()]);await new Promise(resolve=>setTimeout(resolve,1200));
  const result=await analyzeSilver(settings,feed.snapshot(),{news:newsFeed.snapshot(120).items,previousResult:settings.lastResult});
  console.log(JSON.stringify({ok:true,model:result.model,reused:!!result.reused,horizons:result.horizons?.length,news:result.news?.length,summaryLength:result.summary?.length},null,2));
}finally{feed.stop();newsFeed.stop()}
