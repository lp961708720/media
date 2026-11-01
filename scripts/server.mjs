import http from 'node:http';
import {readFileSync} from 'node:fs';
import {timingSafeEqual,randomBytes} from 'node:crypto';
import worker from '../worker/index.js';
import {secureFetch} from './network.mjs';
import {localServices} from './local-services.mjs';
import {openDatabase,backupSnapshot} from './database.mjs';
export async function startServer({dataDir,key,port=0,development=false,redfoxFetch=secureFetch,modelFetch=secureFetch}={}){
const {db,DB}=openDatabase(dataDir),token=randomBytes(32).toString('hex');
const env={DB,CREDENTIAL_ENCRYPTION_KEY:key,CREDENTIAL_STATE:key?'ready':'pending',MODEL_FETCH:modelFetch,SKILL_FETCH:secureFetch,REDFOX_FETCH:redfoxFetch,BACKUP_SNAPSHOT:owner=>backupSnapshot(db,owner)};const renderHTML=()=>readFileSync(new URL('../public/index.html',import.meta.url),'utf8').replace('/* APP_CSS */',()=>readFileSync(new URL('../public/style.css',import.meta.url),'utf8')).replace('/* APP_JS */',()=>readFileSync(new URL('../public/app.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../public/features.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../public/projects.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../public/benchmarks.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../public/text-diff.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../public/manuscripts.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../public/workspace.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../public/assistant.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../public/wechat-format.js',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../public/polish.js',import.meta.url),'utf8'));const html=development?null:renderHTML();
const services=localServices({db,env,worker,dataDir});
const server=http.createServer(async(req,res)=>{try{
const origin='http://127.0.0.1:'+server.address().port;const url=new URL(req.url,origin);
if(req.headers.host!=='127.0.0.1:'+server.address().port){res.writeHead(403);res.end('Invalid host');return}
if(req.headers.origin&&req.headers.origin!==origin||req.headers['sec-fetch-site']==='cross-site'){res.writeHead(403);res.end('Cross-origin access denied');return}
const cookies=Object.fromEntries((req.headers.cookie||'').split(';').filter(Boolean).map(x=>x.trim().split('=')));
if(development&&req.method==='GET'&&url.pathname==='/'){res.setHeader('Set-Cookie','ms_session='+token+'; HttpOnly; SameSite=Strict; Path=/')}
const candidate=cookies.ms_session||'';
if(!(candidate.length===token.length&&timingSafeEqual(Buffer.from(candidate),Buffer.from(token)))&&!(development&&req.method==='GET'&&url.pathname==='/')){res.writeHead(401,{'content-type':'application/json'});res.end(JSON.stringify({error:'未授权的本机请求'}));return}
if(!url.pathname.startsWith('/api/')){res.writeHead(200,{'content-type':'text/html;charset=utf-8','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(development?renderHTML():html);return}
const chunks=[];for await(const chunk of req)chunks.push(chunk);const headers=new Headers(req.headers);headers.set('oai-authenticated-user-id','local-owner');headers.set('oai-authenticated-user-email','local@media-studio.invalid');const body=Buffer.concat(chunks),request=new Request(url,{method:req.method,headers,body:body.length?body:undefined});const local=await services.authorize(request.clone());const response=local||await worker.fetch(request,env,{});res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body){for await(const chunk of response.body)res.write(Buffer.from(chunk));}res.end();
}catch(e){console.error('Local request error:',e.name,e.message);if(!res.headersSent)res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'本机服务暂时无法处理请求'}))}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
return {server,db,services,setCredentialKey(key){env.CREDENTIAL_ENCRYPTION_KEY=key;env.CREDENTIAL_STATE='ready'},setCredentialState(state){env.CREDENTIAL_STATE=state},origin:'http://127.0.0.1:'+server.address().port,token,async close(){services.close();server.closeAllConnections();await new Promise(r=>server.close(r));db.close()}};
}
