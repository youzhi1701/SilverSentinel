import { Feed } from '../src/feed.mjs';
import fs from 'node:fs';
const feed=new Feed();let observations=0;const samples=[];
feed.on('metadata',m=>console.log('METADATA',JSON.stringify(m)));
feed.on('quote',p=>{observations++;if(samples.length<20)samples.push(p);if(observations>=2)finish(true)});
feed.on('status',s=>{if(s.status!=='connected')console.log('STATUS',s.status,s.message)});
let done=false;const timeout=setTimeout(()=>finish(observations>0),45000);
function finish(success){if(done)return;done=true;clearTimeout(timeout);console.log('RESULT',JSON.stringify({success,observations,samples,snapshot:feed.snapshot()}));if(process.env.PROBE_OUTPUT)fs.writeFileSync(process.env.PROBE_OUTPUT,JSON.stringify({samples,snapshot:feed.snapshot()},null,2));feed.stop();process.exitCode=success?0:1}
feed.start();

