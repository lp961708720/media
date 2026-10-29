import https from 'node:https';import http from 'node:http';import {lookup} from 'node:dns/promises';import {isIP} from 'node:net';
export function privateIP(ip){
 if(isIP(ip)===4){const [a,b]=ip.split('.').map(Number);return a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0)||a===100&&b>=64&&b<=127||a>=224||a===198&&(b===18||b===19)}
 if(isIP(ip)===6){const x=ip.toLowerCase();if(x.startsWith('::ffff:'))return true;return x==='::'||x==='::1'||x.startsWith('fc')||x.startsWith('fd')||/^fe[89ab]/.test(x)||x.startsWith('ff')||x.startsWith('2001:db8')||x.startsWith('64:ff9b')}
 return true;
}
export async function secureFetch(url,options={}){
 const u=new URL(url),loopback=['localhost','127.0.0.1','[::1]'].includes(u.hostname);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.protocol==='http:'&&!(loopback&&options.allowLoopback))throw new Error('Unsafe model URL');
 const hostname=u.hostname.replace(/^\[|\]$/g,'');const addresses=await lookup(hostname,{all:true,verbatim:true});if(!addresses.length||addresses.some(a=>privateIP(a.address)&&!(loopback&&options.allowLoopback&&['127.0.0.1','::1'].includes(a.address))))throw new Error('Private network DNS rejected');
 const pinned=addresses[0];return new Promise((resolve,reject)=>{const transport=u.protocol==='https:'?https:http;const request=transport.request(u,{method:options.method||'GET',headers:options.headers,signal:options.signal,lookup:(host,opts,cb)=>{if(opts.all)cb(null,[pinned]);else cb(null,pinned.address,pinned.family)}},res=>{
 if(res.statusCode>=300&&res.statusCode<400){res.resume();reject(new Error('Model redirects are refused'));return}
 const headers=new Headers();for(const [k,v]of Object.entries(res.headers))if(v!==undefined)headers.set(k,Array.isArray(v)?v.join(','):v);
 const stream=new ReadableStream({start(controller){res.on('data',chunk=>controller.enqueue(new Uint8Array(chunk)));res.on('end',()=>controller.close());res.on('error',e=>controller.error(e))},cancel(){res.destroy()}});resolve(new Response(stream,{status:res.statusCode,headers}));});request.on('error',reject);if(options.body)request.write(options.body);request.end();});
}
