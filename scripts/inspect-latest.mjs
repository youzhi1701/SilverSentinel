import {Feed} from '../src/feed.mjs';
const feed=new Feed();
const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('timeout')),20000);feed.on('status',s=>{if(s.status==='connected'){clearTimeout(timer);resolve()}})});
try{feed.start();await ready;await new Promise(r=>setTimeout(r,1500));const history=await feed.history({side:'ask',period:'1',size:5});console.log(JSON.stringify({quote:feed.snapshot().quotes[0],candles:history.candles},null,2))}finally{feed.stop()}
