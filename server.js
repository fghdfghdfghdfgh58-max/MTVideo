'use strict';
// MTVideo server — zero dependencies. Requires Node.js 22.13+ (uses built-in node:sqlite).
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pipeline}=require('node:stream/promises'),{Transform}=require('node:stream');
const {DatabaseSync}=require('node:sqlite');
const PORT=+process.env.PORT||3000,DATA=process.env.DATA_DIR||path.join(__dirname,'data'),UP=path.join(DATA,'uploads');
const MAX=(+process.env.MAX_UPLOAD_MB||500)*1048576,SECURE=process.env.COOKIE_SECURE==='1',PROXY=process.env.TRUST_PROXY==='1';
const INDEX=path.join(__dirname,'public','index.html');
fs.mkdirSync(UP,{recursive:true});
const db=new DatabaseSync(path.join(DATA,'mtv.db'));
db.exec(`PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT UNIQUE NOT NULL,salt TEXT,hash TEXT,ts INTEGER);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT,ts INTEGER);
CREATE TABLE IF NOT EXISTS channels(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL COLLATE NOCASE,owner TEXT,ts INTEGER);
CREATE TABLE IF NOT EXISTS videos(id TEXT PRIMARY KEY,title TEXT,type TEXT,chId TEXT,owner TEXT,file TEXT,dur INTEGER,ts INTEGER);
CREATE TABLE IF NOT EXISTS reacts(video_id TEXT,user_id TEXT,val INTEGER,PRIMARY KEY(video_id,user_id));
CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY,video_id TEXT,user_id TEXT,name TEXT,text TEXT,ts INTEGER);
CREATE TABLE IF NOT EXISTS subs(channel_id TEXT,user_id TEXT,PRIMARY KEY(channel_id,user_id));
CREATE TABLE IF NOT EXISTS live(user_id TEXT PRIMARY KEY,title TEXT,chId TEXT,ts INTEGER);
CREATE TABLE IF NOT EXISTS chat(id TEXT PRIMARY KEY,live_id TEXT,name TEXT,text TEXT,ts INTEGER);`);
const all=(s,...a)=>db.prepare(s).all(...a),one=(s,...a)=>db.prepare(s).get(...a),run=(s,...a)=>db.prepare(s).run(...a);
const sha=s=>crypto.createHash('sha256').update(s).digest('hex'),uuid=()=>crypto.randomUUID();
const EXT={'video/mp4':'.mp4','video/webm':'.webm','video/quicktime':'.mov'},MIME={'.mp4':'video/mp4','.webm':'video/webm','.mov':'video/quicktime'};
const CSP="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; media-src 'self' blob:; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'";
const json=(res,o,c=200)=>{res.writeHead(c,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(o))};
const err=(res,c,m)=>{if(res.headersSent||res.writableEnded){res.destroy();return}json(res,{error:m},c)};
const body=req=>new Promise((ok,no)=>{let s='';req.on('data',c=>{s+=c;if(s.length>1e5){no(new Error('big'));req.destroy()}});req.on('end',()=>{try{ok(s?JSON.parse(s):{})}catch(e){no(e)}});req.on('error',no)});
const hits=new Map();
function limited(req){const ip=(PROXY&&(req.headers['x-forwarded-for']||'').split(',')[0].trim())||req.socket.remoteAddress,now=Date.now();let h=hits.get(ip);if(!h||now-h.t>9e5)h={n:0,t:now};h.n++;hits.set(ip,h);return h.n>15}
const tokenOf=req=>{const m=/(?:^|;\s*)mtv=([a-f0-9]{64})/.exec(req.headers.cookie||'');return m&&m[1]};
const userOf=req=>{const t=tokenOf(req);return t?one('SELECT u.id,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.ts>?',sha(t),Date.now()-30*864e5)||null:null};
const cookie=(t,age)=>`mtv=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${SECURE?'; Secure':''}`;
function session(res,uid,out){const t=crypto.randomBytes(32).toString('hex');run('INSERT INTO sessions VALUES(?,?,?)',sha(t),uid,Date.now());res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':cookie(t,2592000),'Cache-Control':'no-store'});res.end(JSON.stringify(out))}
const hashPw=(pw,salt)=>crypto.scryptSync(pw,salt,64).toString('hex');
function state(){const now=Date.now();return{
 channels:all('SELECT id,name,owner,ts FROM channels'),
 videos:all("SELECT id,title,type,chId,owner,'/media/'||file AS url,dur,ts FROM videos ORDER BY ts DESC LIMIT 500"),
 reacts:all('SELECT video_id AS v,user_id AS uid,val FROM reacts'),
 comments:all('SELECT id,video_id AS v,user_id AS uid,name,text,ts FROM comments ORDER BY ts DESC LIMIT 1000'),
 subs:all("SELECT channel_id||'_'||user_id AS id,channel_id AS ch,user_id AS uid FROM subs"),
 live:all('SELECT l.user_id AS id,l.title,l.chId,c.name AS chName,l.ts FROM live l JOIN channels c ON c.id=l.chId WHERE l.ts>?',now-150000),
 chat:all('SELECT id,live_id AS live,name,text,ts FROM chat WHERE ts>? ORDER BY ts DESC LIMIT 300',now-6*36e5)}}
const ownCh=(id,u)=>one('SELECT * FROM channels WHERE id=? AND owner=?',String(id),u.id);
async function upload(req,res,u,p){
 const ch=ownCh(p.get('channel'),u);if(!ch)return err(res,403,'Not your channel');
 const type=p.get('type')==='short'?'short':'video',dur=Math.max(0,Math.min(86400,Math.round(+p.get('dur')||0)));
 if(type==='short'&&dur>180)return err(res,400,'Shorts must be 3 minutes or less');
 const ext=EXT[(req.headers['content-type']||'').split(';')[0]];if(!ext)return err(res,415,'Use an MP4, WebM or MOV file');
 const len=+req.headers['content-length'];if(!len||len>MAX)return err(res,413,'File too large (max '+Math.round(MAX/1048576)+' MB)');
 const id=uuid(),file=id+ext,fp=path.join(UP,file);let n=0;
 try{await pipeline(req,new Transform({transform(c,e,cb){n+=c.length;n>MAX?cb(new Error('big')):cb(null,c)}}),fs.createWriteStream(fp))}catch(e){fs.rm(fp,()=>{});return err(res,400,'Upload failed')}
 run('INSERT INTO videos VALUES(?,?,?,?,?,?,?,?)',id,String(p.get('title')||'Untitled').trim().slice(0,80)||'Untitled',type,ch.id,u.id,file,dur,Date.now());json(res,{id})}
function media(req,res,name){
 if(!/^[\w-]+\.(mp4|webm|mov)$/.test(name))return err(res,404,'Not found');const fp=path.join(UP,name);
 fs.stat(fp,(e,s)=>{if(e)return err(res,404,'Not found');let a=0,b=s.size-1,code=200;
  const h={'Content-Type':MIME[path.extname(name)],'Accept-Ranges':'bytes','Cache-Control':'private, max-age=3600'};
  const m=/bytes=(\d*)-(\d*)/.exec(req.headers.range||'');
  if(m){if(m[1]==='')a=Math.max(0,s.size-+m[2]);else{a=+m[1];if(m[2])b=Math.min(+m[2],b)}
   if(a>b||a>=s.size){res.writeHead(416,{'Content-Range':'bytes */'+s.size});return res.end()}code=206;h['Content-Range']=`bytes ${a}-${b}/${s.size}`}
  h['Content-Length']=b-a+1;res.writeHead(code,h);fs.createReadStream(fp,{start:a,end:b}).pipe(res)})}
http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://x'),p=url.pathname,m=req.method;
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','same-origin');
 if(m==='GET'&&p==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':CSP,'Cache-Control':'no-cache'});return res.end(fs.readFileSync(INDEX))}
 if(p==='/favicon.ico'){res.writeHead(204);return res.end()}
 if(!p.startsWith('/api/')&&!p.startsWith('/media/'))return err(res,404,'Not found');
 if(m!=='GET'&&req.headers['x-mtv']!=='1')return err(res,403,'Bad request');
 if(m==='POST'&&(p==='/api/signup'||p==='/api/login')){
  if(limited(req))return err(res,429,'Too many attempts. Try again later.');
  const b=await body(req),email=String(b.email||'').trim().toLowerCase(),pw=String(b.password||'');
  if(p==='/api/signup'){
   if(!/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(email))return err(res,400,'Enter a valid email');
   if(pw.length<8||pw.length>200)return err(res,400,'Password must be 8+ characters');
   if(one('SELECT 1 FROM users WHERE email=?',email))return err(res,409,'That email is already registered');
   const id=uuid(),salt=crypto.randomBytes(16).toString('hex');run('INSERT INTO users VALUES(?,?,?,?,?)',id,email,salt,hashPw(pw,salt),Date.now());return session(res,id,{ok:1})}
  const r=one('SELECT * FROM users WHERE email=?',email);
  if(!r||!crypto.timingSafeEqual(Buffer.from(hashPw(pw,r.salt)),Buffer.from(r.hash)))return err(res,401,'Wrong email or password');return session(res,r.id,{ok:1})}
 if(m==='POST'&&p==='/api/logout'){const t=tokenOf(req);if(t)run('DELETE FROM sessions WHERE token=?',sha(t));res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':cookie('',0)});return res.end('{}')}
 const u=userOf(req);
 if(m==='GET'&&p==='/api/me')return json(res,{user:u});
 if(!u)return err(res,401,'Please log in');
 if(m==='GET'&&p==='/api/state')return json(res,state());
 let mm;if(m==='GET'&&(mm=/^\/media\/([^/]+)$/.exec(p)))return media(req,res,mm[1]);
 if(m==='POST'&&p==='/api/upload')return upload(req,res,u,url.searchParams);
 const b=m==='GET'?{}:await body(req);
 if(m==='POST'&&p==='/api/channels'){const n=String(b.name||'').trim();
  if(n.length<2||n.length>24)return err(res,400,'Name must be 2–24 characters');
  if(one('SELECT COUNT(*) c FROM channels WHERE owner=?',u.id).c>=2)return err(res,403,'Limit reached: 2 channels per email');
  if(one('SELECT 1 FROM channels WHERE name=?',n))return err(res,409,'That name is taken');
  const id=uuid();run('INSERT INTO channels VALUES(?,?,?,?)',id,n,u.id,Date.now());return json(res,{id})}
 if(m==='DELETE'&&(mm=/^\/api\/videos\/([\w-]+)$/.exec(p))){const v=one('SELECT * FROM videos WHERE id=? AND owner=?',mm[1],u.id);if(!v)return err(res,404,'Not found');
  run('DELETE FROM videos WHERE id=?',v.id);run('DELETE FROM reacts WHERE video_id=?',v.id);run('DELETE FROM comments WHERE video_id=?',v.id);fs.rm(path.join(UP,v.file),()=>{});return json(res,{})}
 if(m==='POST'&&p==='/api/react'){const v=one('SELECT 1 FROM videos WHERE id=?',String(b.video));if(!v)return err(res,404,'Not found');
  if(b.val===1||b.val===-1)run('INSERT OR REPLACE INTO reacts VALUES(?,?,?)',String(b.video),u.id,b.val);else run('DELETE FROM reacts WHERE video_id=? AND user_id=?',String(b.video),u.id);return json(res,{})}
 if(m==='POST'&&p==='/api/comment'){const ch=ownCh(b.channel,u),t=String(b.text||'').trim().slice(0,500);
  if(!ch)return err(res,403,'Create a channel to comment');if(!t||!one('SELECT 1 FROM videos WHERE id=?',String(b.video)))return err(res,400,'Invalid comment');
  run('INSERT INTO comments VALUES(?,?,?,?,?,?)',uuid(),String(b.video),u.id,ch.name,t,Date.now());return json(res,{})}
 if(m==='POST'&&p==='/api/sub'){const c=one('SELECT * FROM channels WHERE id=?',String(b.channel));if(!c||c.owner===u.id)return err(res,400,'Cannot subscribe');
  if(one('SELECT 1 FROM subs WHERE channel_id=? AND user_id=?',c.id,u.id))run('DELETE FROM subs WHERE channel_id=? AND user_id=?',c.id,u.id);else run('INSERT INTO subs VALUES(?,?)',c.id,u.id);return json(res,{})}
 if(m==='POST'&&p==='/api/live'){const ch=ownCh(b.channel,u);if(!ch)return err(res,403,'Not your channel');
  run('INSERT OR REPLACE INTO live VALUES(?,?,?,?)',u.id,String(b.title||'Live now').slice(0,80),ch.id,Date.now());return json(res,{})}
 if(m==='POST'&&p==='/api/live/ping'){run('UPDATE live SET ts=? WHERE user_id=?',Date.now(),u.id);return json(res,{})}
 if(m==='DELETE'&&p==='/api/live'){run('DELETE FROM live WHERE user_id=?',u.id);run('DELETE FROM chat WHERE live_id=?',u.id);return json(res,{})}
 if(m==='POST'&&p==='/api/chat'){const ch=ownCh(b.channel,u),t=String(b.text||'').trim().slice(0,300);if(!ch||!t||!one('SELECT 1 FROM live WHERE user_id=?',String(b.live)))return err(res,400,'Cannot send');
  run('INSERT INTO chat VALUES(?,?,?,?,?)',uuid(),String(b.live),ch.name,t,Date.now());return json(res,{})}
 err(res,404,'Not found');
}catch(e){console.error(e);err(res,500,'Server error')}}).listen(PORT,()=>console.log('MTVideo running on http://localhost:'+PORT));
