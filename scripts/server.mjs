import http from 'node:http';
import {readFileSync} from 'node:fs';
import {timingSafeEqual,randomBytes} from 'node:crypto';
import worker from '../worker/index.js';
import {openDatabase} from './database.mjs';
export async function startServer({dataDir,key,port=0,development=false}={}){
const {db,DB}=openDatabase(dataDir),token=randomBytes(32).toString('hex');
const env={DB,CREDENTIAL_ENCRYPTION_KEY:key};const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8').replace('/* APP_CSS */',()=>readFileSync(new URL('../public/style.css',import.meta.url),'utf8')).replace('/* APP_JS */',()=>readFileSync(new URL('../public/app.js',import.meta.url),'utf8'));
const server=http.createServer(async(req,res)=>{try{
const origin='http://127.0.0.1:'+server.address().port;const url=new URL(req.url,origin);
if(req.headers.host!=='127.0.0.1:'+server.address().port){res.writeHead(403);res.end('Invalid host');return}
if(req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end('Cross-origin access denied');return}
const cookies=Object.fromEntries((req.headers.cookie||'').split(';').filter(Boolean).map(x=>x.trim().split('=')));
if(development&&req.method==='GET'&&url.pathname==='/'){res.setHeader('Set-Cookie','ms_session='+token+'; HttpOnly; SameSite=Strict; Path=/')}
const candidate=cookies.ms_session||'';
if(!(candidate.length===token.length&&timingSafeEqual(Buffer.from(candidate),Buffer.from(token)))&&!(development&&req.method==='GET'&&url.pathname==='/')){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:'未授权的本机请求'}));return}
if(!url.pathname.startsWith('/api/')){res.writeHead(200,{'content-type':'text/html;charset=utf-8','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(html);return}
const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>8000000){res.writeHead(413);res.end('Request too large');return}chunks.push(chunk)}const headers=new Headers(req.headers);headers.set('oai-authenticated-user-id','local-owner');headers.set('oai-authenticated-user-email','local@media-studio.invalid');const body=Buffer.concat(chunks),request=new Request(url,{method:req.method,headers,body:body.length?body:undefined});const response=await worker.fetch(request,env,{});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
}catch(e){console.error('Local request error:',e.name,e.message);if(!res.headersSent)res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'本机服务暂时无法处理请求'}))}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
return {server,db,origin:'http://127.0.0.1:'+server.address().port,token,async close(){server.closeAllConnections();await new Promise(r=>server.close(r));db.close()}};
}
