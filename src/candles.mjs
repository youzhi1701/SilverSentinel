export function intervalMilliseconds(interval){const value=String(interval);if(/^\d+s$/.test(value))return Number(value.slice(0,-1))*1000;const minutes=Number(value);return Number.isFinite(minutes)&&minutes>0?minutes*60000:60000}
export function aggregateCandles(points,intervalMinutes){
 const width=intervalMilliseconds(intervalMinutes),buckets=new Map();
 for(const point of points){if(!Number.isFinite(point.time)||!Number.isFinite(point.price))continue;const time=Math.floor(point.time/width)*width;const found=buckets.get(time);if(found){found.high=Math.max(found.high,point.price);found.low=Math.min(found.low,point.price);found.close=point.price;found.count++}else buckets.set(time,{time,open:point.price,high:point.price,low:point.price,close:point.price,count:1,precision:point.precision??3,session:point.session})}
 return [...buckets.values()].sort((a,b)=>a.time-b.time)
}
