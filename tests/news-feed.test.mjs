import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { NewsFeed, normalizeNews } from '../src/news-feed.mjs';

test('normalizes Rongtongjin Jin10 news without HTML or unsafe links',()=>{
  const row=normalizeNews({id:'9',time:'2026-09-11 18:00:01',important:true,data:{title:'重要快讯',content:'<b>白银</b>&nbsp;波动',source:'金十数据',source_link:'javascript:bad',pic:'https://flash-scdn.jin10.com/example.png'}});
  assert.equal(row.title,'重要快讯');assert.equal(row.content,'白银 波动');assert.equal(row.important,true);assert.match(row.url,/^https:\/\//);assert(Number.isFinite(row.publishedAt));
  assert.equal(row.imageUrl,'https://flash-scdn.jin10.com/example.png');
});

test('loads initial pages and applies realtime create update delete',async()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'silver-news-')),cache=path.join(folder,'news.json'),sockets=[];
  class Socket extends EventEmitter{close(){this.emit('close')}}
  const fetchImpl=async()=>({ok:true,json:async()=>({status:200,data:[{id:'1',time:'2026-09-11 17:00:00',data:{content:'第一条'}}]})});
  const feed=new NewsFeed(cache,{fetchImpl,socketFactory:()=>{const socket=new Socket();sockets.push(socket);return socket}});
  try{await feed.start();assert.equal(feed.snapshot().items[0].title,'第一条');sockets[0].emit('open');sockets[0].emit('message',JSON.stringify({event:'create',data:{id:'2',time:'2026-09-11 18:00:00',data:{content:'第二条'}}}));assert.equal(feed.snapshot().items[0].id,'2');sockets[0].emit('message',JSON.stringify({event:'delete',data:{id:'2'}}));assert.equal(feed.snapshot().items.some(x=>x.id==='2'),false)}finally{feed.stop();fs.rmSync(folder,{recursive:true,force:true})}
});

test('restores cached freshness metadata and updates it on deletion',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'silver-news-cache-')),cache=path.join(folder,'news.json');
  try{
    fs.writeFileSync(cache,JSON.stringify({savedAt:123456,items:[{id:'1',title:'缓存',publishedAt:1}]}));
    const feed=new NewsFeed(cache,{fetchImpl:async()=>{throw Error('offline')},socketFactory:()=>new EventEmitter()});
    assert.equal(feed.snapshot().lastUpdate,123456);
    feed.merge({id:'1'},'delete');
    assert.equal(feed.snapshot().items.length,0);
    assert.ok(feed.snapshot().lastUpdate>123456);
  }finally{fs.rmSync(folder,{recursive:true,force:true})}
});

