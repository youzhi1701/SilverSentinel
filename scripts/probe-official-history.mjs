import fs from 'node:fs';
import WebSocket from 'ws';
import protobuf from 'protobufjs';
import { Blowfish } from 'egoroof-blowfish';

const schema = `syntax="proto2";
message AuthReq { optional string apptype=1; optional bytes token=2; }
message AuthResp { optional bytes serverInfo=1; }
message QueryCondition { optional int32 size=1; optional fixed32 begintime=2; optional fixed32 endtime=3; optional int32 infoDays=4; }
message Request { repeated string codes=1; repeated int32 freq=2 [packed=true]; optional QueryCondition queryCondition=3; optional int32 subscribeFlag=4; optional AuthReq auth=5; }
message Realtime { optional double last=1; repeated double askPrice=2 [packed=true]; repeated int64 askVol=3 [packed=true]; repeated double bidPrice=4 [packed=true]; repeated int64 bidVol=5 [packed=true]; optional int32 tag=6; optional double posiDelta=7; optional double highLimit=8; optional double lowLimit=9; optional int64 tickVolume=10; optional double updown=11; optional double updownRate=12; optional double average=13; optional int32 tradeday=14; optional int64 infoVolume=15; }
message Extra { optional double preSettle=1; optional int64 sequenceNo=2; optional double amplitude=3; optional double currDelta=4; optional double preDelta=5; optional string market=6; optional string exchangeId=7; optional double prePosi=8; optional string name=9; optional string commodityCode=10; optional int32 tradeStatus=11; optional int64 openTime=17; optional int64 closeTime=18; }
message Quote { optional string code=1; optional int32 freq=2; optional fixed64 quoteTime=3; optional int64 volume=4; optional int64 freqTime=5; optional double turnOver=6; optional Realtime rt=7; optional double open=8; optional double high=9; optional double low=10; optional double close=11; optional double posi=12; optional double preClose=13; optional double settle=14; optional Extra extra=15; }
message TradeStatus { optional int32 tradeStatus=1; repeated string codes=2; repeated string commodites=3; repeated string markets=4; optional int64 quotetime=5; }
message Response { repeated Quote quotation=1; optional int64 earliestfreq=2; optional sint32 errCode=3; optional AuthResp auth=5; optional TradeStatus tradeStatus=6; optional string msg=16; }
message Message { optional int32 msgid=1; optional sint32 seq=2; optional Request request=4; repeated Response response=5; optional string jsonReq=8; optional string jsonResp=9; optional string errMsg=17; }`;

const Message = protobuf.parse(schema).root.lookupType('Message');
const encode = (value) => Message.encode(Message.create(value)).finish();
const decode = (bytes) => Message.toObject(Message.decode(bytes), { longs: String });
const ws = new WebSocket('wss://rtjwbqt.ytj9999.com:8443/gateway', {
  origin: 'https://i.jzj9999.com',
  handshakeTimeout: 15000,
});

let seq = 0;
const waiting = new Map();
const result = { source: 'https://i.jzj9999.com/quoteh5', capturedAt: new Date().toISOString(), contracts: [], probes: [] };

function send(msgid, request = {}, json = null) {
  const current = seq++;
  ws.send(encode({ msgid, seq: current, request, ...(json ? { jsonReq: JSON.stringify(json) } : {}) }));
  return current;
}

function request(msgid, requestBody = {}, json = null, timeout = 12000) {
  return new Promise((resolve, reject) => {
    const current = send(msgid, requestBody, json);
    const key = msgid === 32 ? 0 : current;
    const timer = setTimeout(() => {
      waiting.delete(key);
      reject(new Error(`timeout msgid=${msgid} seq=${current}`));
    }, timeout);
    waiting.set(key, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
}

function normalizeQuote(q) {
  return {
    code: q.code,
    freq: q.freq,
    quoteTime: q.quoteTime,
    freqTime: q.freqTime,
    open: q.open,
    high: q.high,
    low: q.low,
    close: q.close,
    last: q.rt?.last,
    volume: q.volume,
  };
}

ws.on('message', (bytes) => {
  const message = decode(bytes);
  const key = message.msgid === 32 ? 0 : Math.abs(message.seq ?? 0);
  const handler = waiting.get(key);
  if (handler) {
    waiting.delete(key);
    handler(message);
  }
});

ws.on('open', async () => {
  try {
    const bf = new Blowfish('tdc5%y4yaU@xFi', Blowfish.MODE.CBC, Blowfish.PADDING.PKCS5);
    bf.setIv('5X4f$^hp');
    const auth = await request(32, { auth: { apptype: 'rtj', token: bf.encode(`plaintractrtj${Date.now()}`) } });
    if (!auth.response?.some((item) => item.auth)) throw new Error('authentication response missing');

    const info = await request(66, {}, {});
    const contracts = JSON.parse(info.jsonResp ?? '{}').codes ?? [];
    result.contracts = contracts
      .filter((item) => item.group === 'JZJ_ag' && ['B', 'S'].includes(item.bsflag))
      .map((item) => ({ code: item.code, group: item.group, side: item.bsflag, name: item.name, precision: item.prcs }));

    const frequencies = [
      ['INFO', 1, { infoDays: 0 }],
      ['INFO3D', 1, { infoDays: 3 }],
      ['MIN1', 3, { size: 12 }],
      ['MIN5', 4, { size: 12 }],
      ['MIN15', 5, { size: 12 }],
      ['MIN30', 6, { size: 12 }],
      ['MIN60', 7, { size: 12 }],
      ['MIN120', 8, { size: 12 }],
      ['MIN240', 9, { size: 12 }],
      ['DAY1', 10, { size: 12 }],
      ['WEEK1', 11, { size: 12 }],
      ['MONTH1', 12, { size: 12 }],
    ];

    for (const contract of result.contracts) {
      for (const [label, freq, queryCondition] of frequencies) {
        try {
          const reply = await request(20, { codes: [contract.code], freq: [freq], queryCondition });
          const errors = (reply.response ?? []).filter((item) => item.errCode).map((item) => ({ errCode: item.errCode, msg: item.msg }));
          const quotes = (reply.response ?? []).flatMap((item) => item.quotation ?? []).map(normalizeQuote);
          result.probes.push({
            code: contract.code,
            side: contract.side,
            label,
            requestedFreq: freq,
            responseCount: reply.response?.length ?? 0,
            quoteCount: quotes.length,
            errors,
            first: quotes[0] ?? null,
            last: quotes.at(-1) ?? null,
          });
        } catch (error) {
          result.probes.push({ code: contract.code, side: contract.side, label, requestedFreq: freq, error: error.message });
        }
      }
    }

    fs.writeFileSync('analysis/official-apk/official-history-probe.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    result.fatalError = error.message;
    fs.writeFileSync('analysis/official-apk/official-history-probe.json', JSON.stringify(result, null, 2));
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } finally {
    ws.close();
  }
});

ws.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
