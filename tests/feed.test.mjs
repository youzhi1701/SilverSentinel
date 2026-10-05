import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';import {Feed} from '../src/feed.mjs';import {encode,decode} from '../src/protocol.mjs';
class FakeSocket extends EventEmitter{readyState=1;sent=[];send(b){this.sent.push(decode(b))}terminate(){this.readyState=3;this.emit('close')}}
test('feed discovers product groups, deduplicates prices and resubscribes after disconnect',()=>{const sockets=[],feed=new Feed(()=>{const socket=new FakeSocket();sockets.push(socket);return socket}),events=[];feed.on('quote',quote=>events.push(quote));try{feed.start();const first=sockets[0];first.emit('open');assert.equal(first.sent[0].msgid,32);first.emit('message',encode({msgid:32,response:[{auth:{}}]}));assert(first.sent.some(message=>message.msgid===66));const meta={codes:[{code:'JZJ_ag_PB',group:'JZJ_ag',name:'白银',bsflag:'B',prcs:3},{code:'JZJ_au_PB',group:'JZJ_au',name:'黄金',bsflag:'B',prcs:2}]};first.emit('message',encode({msgid:66,jsonResp:JSON.stringify(meta)}));assert.deepEqual(first.sent.find(message=>message.msgid===18).request.codes,['JZJ_ag_PB','JZJ_au_PB']);assert.equal(feed.quotes.length,2);first.emit('message',encode({msgid:0,response:[{quotation:[{code:'JZJ_au_PB',quoteTime:99,rt:{last:940}}]}]}));assert.equal(events.length,1);const silver=(price,time)=>encode({msgid:0,response:[{quotation:[{code:'JZJ_ag_PB',quoteTime:time,rt:{last:price}}]}]});first.emit('message',silver(14.4,100));first.emit('message',silver(14.4,101));first.emit('message',silver(14.3,99));first.emit('message',silver(14.5,102));assert.equal(events.length,3);assert.equal(feed.quotes.find(item=>item.code==='JZJ_ag').bid,14.5);const oldSession=events.at(-1).session;first.terminate();assert.equal(feed.state.status,'reconnecting');assert.equal(feed.quotes.find(item=>item.code==='JZJ_ag').bidCurrent,false);feed.connect();const second=sockets[1];second.emit('message',encode({msgid:66,jsonResp:JSON.stringify(meta)}));second.emit('message',silver(14.5,102));assert.equal(events.length,4);assert.notEqual(events.at(-1).session,oldSession);assert.equal(feed.quotes.find(item=>item.code==='JZJ_ag').bidCurrent,true)}finally{feed.stop()}});

test('feed does not allocate status snapshots when nobody subscribes to status events',()=>{
  const feed=new Feed(()=>new FakeSocket());
  let snapshots=0;
  const original=feed.snapshot.bind(feed);
  feed.snapshot=()=>{snapshots+=1;return original()};
  feed.publish('connecting','x');
  assert.equal(snapshots,0);
  feed.on('status',()=>{});
  feed.publish('connected','y');
  assert.equal(snapshots,1);
});

