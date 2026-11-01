import {problem} from './gateway.js';
import {confirmedPostAnalysis} from './benchmarks.js';
export async function researchLinkRoutes(c){
 if(c.path[0]!=='topic-research'||c.method!=='GET')return null;
 if(!c.aid)throw problem(400,'请选择当前账号');
 const topic=await c.record(c.path[1],'topic',c.aid);let post=null,analysis=null;
 if(topic.data.post_id){post=await c.record(topic.data.post_id,'post',c.aid);analysis=await confirmedPostAnalysis(post);}
 return new Response(JSON.stringify({topic,post,analysis}),{headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store'}});
}
