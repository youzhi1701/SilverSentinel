import protobuf from 'protobufjs';
// Wire fields documented by the publicly delivered quoteh5 client (2026-09-08).
const schema=`syntax="proto2";
message AuthReq { optional string apptype=1; optional bytes token=2; }
message AuthResp { optional bytes serverInfo=1; }
message QueryCondition { optional int32 size=1; optional fixed32 begintime=2; optional fixed32 endtime=3; optional int32 infoDays=4; }
message Request { repeated string codes=1; repeated int32 freq=2 [packed=true]; optional QueryCondition queryCondition=3; optional int32 subscribeFlag=4; optional AuthReq auth=5; }
message Realtime { optional double last=1; repeated double askPrice=2 [packed=true]; repeated int64 askVol=3 [packed=true]; repeated double bidPrice=4 [packed=true]; repeated int64 bidVol=5 [packed=true]; optional int32 tag=6; optional double posiDelta=7; optional double highLimit=8; optional double lowLimit=9; optional int64 tickVolume=10; optional double updown=11; optional double updownRate=12; optional double average=13; optional int32 tradeday=14; optional int64 infoVolume=15; }
message Quote { optional string code=1; optional int32 freq=2; optional fixed64 quoteTime=3; optional int64 volume=4; optional int64 freqTime=5; optional double turnOver=6; optional Realtime rt=7; optional double open=8; optional double high=9; optional double low=10; optional double close=11; optional double posi=12; optional double preClose=13; optional double settle=14; }
message TradeStatus { optional int32 tradeStatus=1; repeated string codes=2; repeated string commodites=3; repeated string markets=4; optional int64 quotetime=5; }
message Response { repeated Quote quotation=1; optional int64 earliestfreq=2; optional sint32 errCode=3; optional AuthResp auth=5; optional TradeStatus tradeStatus=6; optional string msg=16; }
message Message { optional int32 msgid=1; optional sint32 seq=2; optional Request request=4; repeated Response response=5; optional string jsonReq=8; optional string jsonResp=9; optional string errMsg=17; }`;
export const Message=protobuf.parse(schema).root.lookupType('Message');
export function encode(value){const error=Message.verify(value);if(error)throw Error(error);return Message.encode(Message.create(value)).finish()}
export function decode(bytes){return Message.toObject(Message.decode(bytes),{longs:String})}
// Product groups are supplied by Rongtongjin metadata (message 66). This seed
// keeps the interface useful while the first metadata reply is in flight.
export const METALS=[['JZJ_ag','白银']];
export const OFFICIAL_PERIODS=Object.freeze({
 '5s':1,'15s':1,'30s':1,'1':3,'5':4,'15':5,'30':6,'60':7,'120':8,'240':9,'day':10,'week':11,'month':12,
});
export function validPrice(value){return typeof value==='number'&&Number.isFinite(value)&&value>=0.1&&value<=1000}
function validSourceTime(value){const stamp=Number(value);return Number.isSafeInteger(stamp)&&stamp>946684800000&&stamp<4102444800000?String(stamp):null}
export function mapQuote(q,metadata){
 const m=metadata.get(q.code);if(!m||!m.group||!['B','S'].includes(m.bsflag))return null;
 const price=q.rt?.last;if(!validPrice(price))return null;
 const precision=Number.isInteger(m.prcs)&&m.prcs>=0&&m.prcs<=4?m.prcs:3;
 const high=validPrice(q.high)?q.high:null,low=validPrice(q.low)?q.low:null;
 return {code:m.group,side:m.bsflag==='B'?'bid':'ask',price,precision,sourceTime:validSourceTime(q.quoteTime),open:validPrice(q.open)?q.open:null,high:high!=null&&low!=null&&high>=low?high:null,low:high!=null&&low!=null&&high>=low?low:null,preClose:validPrice(q.preClose)?q.preClose:null,updown:Number.isFinite(q.rt?.updown)?q.rt.updown:null,updownRate:Number.isFinite(q.rt?.updownRate)?q.rt.updownRate:null}
}

export function mapInformationQuotes(message, expectedCode){
 const points=[];
 for(const q of (message?.response||[]).flatMap(item=>item.quotation||[])){
  const time=Number(q.quoteTime),price=Number(q.rt?.last);
  if(q.code===expectedCode&&time>946684800000&&time<4102444800000&&validPrice(price))points.push({time,price,precision:3,session:'official'});
 }
 return points.sort((a,b)=>a.time-b.time);
}

export function mapHistoricalQuotes(message, expectedCode, expectedFreq) {
 const rows=(message?.response||[]).flatMap(item=>item.quotation||[]);
 const unique=new Map();
 for(const q of rows){
  if(q.code!==expectedCode||Number(q.freq)!==Number(expectedFreq))continue;
  const rawTime=Number(q.freqTime)||Math.floor(Number(q.quoteTime)/1000);
  const time=rawTime>946684800&&rawTime<4102444800?rawTime*1000:null;
  const open=Number(q.open),high=Number(q.high),low=Number(q.low),close=Number(q.close||q.rt?.last);
  if(!time||![open,high,low,close].every(validPrice)||high<low||high<Math.max(open,close)||low>Math.min(open,close))continue;
  unique.set(time,{time,open,high,low,close,volume:Number(q.volume)||0,count:Number(q.volume)||0,precision:3,source:'融通金官方历史行情'});
 }
 return [...unique.values()].sort((a,b)=>a.time-b.time);
}

