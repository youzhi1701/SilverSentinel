import { NewsFeed } from '../src/news-feed.mjs';
const feed=new NewsFeed('analysis/official-apk/news-probe-cache.json');
try{
  await feed.start();
  await new Promise(resolve=>setTimeout(resolve,2500));
  const result=feed.snapshot(5);
  if(!result.items.length)throw Error('没有读取到快讯');
  console.log(JSON.stringify({status:result.status,count:result.count,lastUpdate:result.lastUpdate,items:result.items},null,2));
}finally{feed.stop()}
