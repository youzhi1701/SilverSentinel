import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

const LIST_URL='https://59dce26c11704fc293c6607e3fa7dad4.z3c.jin10.com/api/flash';
const SOCKET_URL='wss://rtgold.oem.jin10.com/flash';
export const NEWS_SOURCE_URL='https://oem.jin10.com/rongtonggold/index.html';

const clean=(value,max=1200)=>String(value??'').trim().slice(0,max);
function textOnly(value){return clean(value,6000).replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/[ \t]+/g,' ').replace(/\n\s+/g,'\n').trim()}
function beijingStamp(value){const raw=clean(value,60);if(!raw)return 0;const normalized=/[zZ]|[+-]\d\d:\d\d$/.test(raw)?raw:raw.replace(' ','T')+'+08:00';const stamp=Date.parse(normalized);return Number.isFinite(stamp)?stamp:0}
function titleFrom(content){const plain=textOnly(content);const bracket=plain.match(/^【([^】]{4,100})】/);if(bracket)return bracket[1];const colon=plain.indexOf('：');return colon>3&&colon<80?plain.slice(0,colon):plain.slice(0,80)}

export function normalizeNews(item){
 if(!item||!item.id)return null;
 const data=item.data&&typeof item.data==='object'?item.data:{};
 const economic=['1','3'].includes(String(item.type));
 const detail=economic?[clean(data.country,30),textOnly(data.content),data.previous!=null?`前值 ${clean(data.previous,40)}`:'',data.consensus!=null?`预期 ${clean(data.consensus,40)}`:'',data.actual!=null?`实际 ${clean(data.actual,40)}`:'',data.evaluate?`影响 ${clean(data.evaluate,40)}`:''].filter(Boolean).join('；'):textOnly(data.content);
 const title=clean(data.title,180)||titleFrom(detail)||'财经快讯';
 const publishedAt=beijingStamp(item.time||data.pub_time?.replace);
 return{
  id:clean(item.id,40),type:economic?'economic':'news',publishedAt,timeText:clean(item.time,40),title,content:clean(detail,1800),
  source:clean(data.source,80)||'金十数据',url:/^https:\/\//i.test(data.source_link||'')?clean(data.source_link,600):NEWS_SOURCE_URL,
  imageUrl:/^https:\/\/flash-scdn\.jin10\.com\//i.test(data.pic||'')?clean(data.pic,600):'',
  important:!!item.important||Number(data.star)>=3,tags:Array.isArray(item.tags)?item.tags.slice(0,30).map(value=>clean(value,30)):[],
  classify:Array.isArray(item.classify)?item.classify.slice(0,30).map(value=>clean(value,30)):[],updatedAt:Date.now(),
 };
}

export class NewsFeed {
 constructor(cacheFile,options={}){this.cacheFile=cacheFile;this.fetchImpl=options.fetchImpl||globalThis.fetch;this.socketFactory=options.socketFactory||((url,opts)=>new WebSocket(url,opts));this.items=[];this.socket=null;this.retry=null;this.writeTimer=null;this.stopped=true;this.attempt=0;this.state={status:'stopped',message:'尚未连接快讯',lastUpdate:0};this.load()}
 load(){try{const value=JSON.parse(fs.readFileSync(this.cacheFile,'utf8'));this.items=(Array.isArray(value.items)?value.items:[]).filter(item=>item?.id).slice(0,500)}catch{this.items=[]}}
 persist(){try{fs.mkdirSync(path.dirname(this.cacheFile),{recursive:true});const temporary=this.cacheFile+'.tmp';fs.writeFileSync(temporary,JSON.stringify({savedAt:Date.now(),items:this.items.slice(0,500)},null,2));fs.renameSync(temporary,this.cacheFile)}catch{}}
 save(){clearTimeout(this.writeTimer);this.writeTimer=setTimeout(()=>this.persist(),300)}
 merge(raw,action='create'){const item=normalizeNews(raw);if(!item)return;if(action==='delete'){this.items=this.items.filter(row=>row.id!==item.id);this.save();return}const index=this.items.findIndex(row=>row.id===item.id);if(index>=0)this.items[index]={...this.items[index],...item};else this.items.unshift(item);this.items.sort((a,b)=>(b.publishedAt||0)-(a.publishedAt||0));this.items=this.items.slice(0,500);this.state.lastUpdate=Date.now();this.save()}
 async page(lastId){const url=new URL(LIST_URL);if(lastId)url.searchParams.set('last_id',lastId);const response=await this.fetchImpl(url,{headers:{'x-version':'1.0.0','x-app-id':'Im9Tk9qH0FFyq8yh',Origin:'https://oem.jin10.com',Referer:NEWS_SOURCE_URL},signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error(`快讯列表请求失败（${response.status}）`);const body=await response.json();if(Number(body?.status)!==200||!Array.isArray(body?.data))throw Error(clean(body?.message,120)||'快讯列表格式异常');return body.data}
 async refresh(pageCount=1){this.state={...this.state,status:'connecting',message:'正在读取快讯'};let lastId='';for(let page=0;page<pageCount;page++){const rows=await this.page(lastId);if(!rows.length)break;for(const row of rows)this.merge(row,'create');this.state={...this.state,status:'connected',message:'快讯已连接',lastUpdate:Date.now()};lastId=clean(rows.at(-1)?.id,40);if(rows.length<20)break}return this.snapshot()}
 connect(){if(this.stopped)return;clearTimeout(this.retry);let socket;try{socket=this.socket=this.socketFactory(SOCKET_URL,{origin:'https://oem.jin10.com',handshakeTimeout:15000})}catch{return this.schedule()};socket.on('open',()=>{if(socket!==this.socket)return;this.attempt=0;this.state={...this.state,status:'connected',message:'快讯实时推送正常'}});socket.on('message',bytes=>{if(socket!==this.socket)return;try{const message=JSON.parse(String(bytes));if(['create','update','delete'].includes(message?.event))this.merge(message.data,message.event);this.state={...this.state,status:'connected',message:'快讯实时推送正常',lastUpdate:Date.now()}}catch{}});socket.on('error',()=>{this.state={...this.state,status:'reconnecting',message:'快讯连接中断，正在重试'}});socket.on('close',()=>{if(socket!==this.socket||this.stopped)return;this.state={...this.state,status:'reconnecting',message:'快讯连接中断，正在重试'};this.schedule()})}
 schedule(){if(this.stopped)return;const delay=Math.min(30000,2000*2**Math.min(this.attempt++,4));clearTimeout(this.retry);this.retry=setTimeout(async()=>{try{await this.refresh()}catch{}this.connect()},delay)}
 async start(){if(!this.stopped)return;this.stopped=false;try{await this.refresh(1)}catch(error){this.state={...this.state,status:this.items.length?'cached':'reconnecting',message:error.message||'快讯读取失败'}}this.connect();this.refresh(3).catch(()=>{})}
 stop(){this.stopped=true;clearTimeout(this.retry);clearTimeout(this.writeTimer);this.persist();try{this.socket?.close()}catch{}this.state={...this.state,status:'stopped',message:'快讯已停止'}}
 snapshot(limit=100){return{...this.state,source:'融通金·金十7×24快讯',sourceUrl:NEWS_SOURCE_URL,count:this.items.length,items:this.items.slice(0,Math.min(300,Math.max(1,Number(limit)||100))).map(item=>({...item}))}}
}
