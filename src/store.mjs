import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
export const dayKey=time=>new Date(time).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
export function dayKeysBetween(start,end){const out=[];let cursor=new Date(`${dayKey(start)}T00:00:00+08:00`).getTime();const finish=new Date(`${dayKey(end)}T00:00:00+08:00`).getTime();for(;cursor<=finish;cursor+=86400000)out.push(dayKey(cursor));return out}
const columns=['id','code','side','price','precision','sourceTime','time','session'];
function rows(db,sql,params=[]){const stmt=db.prepare(sql);try{stmt.bind(params);const list=[];while(stmt.step())list.push(stmt.getAsObject());return list}finally{stmt.free()}}
export class PriceStore {
 static async open(folder){const SQL=await initSqlJs({locateFile:()=>require.resolve('sql.js/dist/sql-wasm.wasm')});return new PriceStore(SQL,folder)}
 constructor(SQL,folder){this.SQL=SQL;this.folder=folder;fs.mkdirSync(folder,{recursive:true});this.current=null;this.db=null;this.dirty=false;this.cleanupOldDays();this.switchDay(dayKey(Date.now()));}
 cleanupOldDays(){const today=dayKey(Date.now());for(const name of fs.readdirSync(this.folder)){if(!/^\d{4}-\d{2}-\d{2}\.sqlite(?:\..+)?$/.test(name)||name.startsWith(today+'.sqlite'))continue;try{fs.rmSync(path.join(this.folder,name),{force:true})}catch{}}}
 openDay(day){const file=path.join(this.folder,`${day}.sqlite`);let db;try{db=new this.SQL.Database(fs.existsSync(file)?fs.readFileSync(file):undefined)}catch{if(fs.existsSync(file))fs.renameSync(file,`${file}.corrupt-${Date.now()}`);db=new this.SQL.Database()}db.run('CREATE TABLE IF NOT EXISTS prices(id TEXT PRIMARY KEY,code TEXT NOT NULL,side TEXT NOT NULL,price REAL NOT NULL,precision INTEGER NOT NULL,sourceTime TEXT,time INTEGER NOT NULL,session TEXT NOT NULL); CREATE INDEX IF NOT EXISTS idx_prices_code_side_time ON prices(code,side,time); CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT OR REPLACE INTO metadata VALUES("schemaVersion","2");');const journal=file+'.pending';if(fs.existsSync(journal)){const lines=fs.readFileSync(journal,'utf8').split('\n');for(let i=0;i<lines.length;i++){if(!lines[i])continue;try{this.insert(db,JSON.parse(lines[i]))}catch{fs.appendFileSync(`${journal}.corrupt`,lines[i]+'\n')}}}return db}
 insert(db,p){db.run('INSERT OR IGNORE INTO prices VALUES(?,?,?,?,?,?,?,?)',columns.map(k=>p[k]??null))}
 switchDay(day){if(day===this.current)return;this.flush();this.db?.close();this.current=day;this.cleanupOldDays();this.file=path.join(this.folder,`${day}.sqlite`);this.db=this.openDay(day);this.dirty=true;this.flush()}
 append(p){if(!/^[A-Za-z0-9_]+$/.test(String(p?.code||''))||dayKey(p.time)!==dayKey(Date.now()))return false;this.switchDay(dayKey(p.time));fs.appendFileSync(this.file+'.pending',JSON.stringify(p)+'\n','utf8');this.insert(this.db,p);this.dirty=true;return true}
 flush(){if(!this.db||!this.dirty)return;const temp=this.file+'.tmp';fs.writeFileSync(temp,this.db.export(),{flush:true});fs.renameSync(temp,this.file);fs.writeFileSync(this.file+'.pending','',{flush:true});this.dirty=false}
 count(){this.switchDay(dayKey(Date.now()));return rows(this.db,'SELECT COUNT(*) AS n FROM prices')[0].n}
 history(code,side,hours,now=Date.now(),limit=50000){if(!/^[A-Za-z0-9_]+$/.test(String(code||''))||!['bid','ask'].includes(side))return[];const startOfDay=new Date(`${dayKey(now)}T00:00:00+08:00`).getTime();const start=Math.max(startOfDay,now-hours*3600000);const day=dayKey(now);if(day!==this.current&&!fs.existsSync(path.join(this.folder,day+'.sqlite')))return[];const db=day===this.current?this.db:this.openDay(day);try{return rows(db,'SELECT * FROM prices WHERE code=? AND side=? AND time>=? AND time<=? ORDER BY time LIMIT ?',[code,side,start,now,Math.min(50000,Math.max(1,limit))])}finally{if(db!==this.db)db.close()}}
 close(){this.flush();this.db?.close();this.db=null}
}

