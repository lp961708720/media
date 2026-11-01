import {problem} from './gateway.js';
const endpoint='https://redfox.hk/story/api/gzh/search/hotArticleNew';
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json;charset=utf-8','cache-control':'no-store'}});
export async function redfoxRoutes(c){
 if(c.path[0]!=='redfox')return null;
 const service=()=>c.sql("SELECT id FROM records WHERE owner_id=? AND kind='settings' AND account_id IS NULL AND deleted=0 AND json_extract(data,'$.service_id')='redfox' ORDER BY created_at DESC LIMIT 1",c.owner).first();
 const stored=async()=>{const record=await service();return record?c.sql('SELECT ciphertext,mask FROM secrets WHERE id=? AND owner_id=?',record.id,c.owner).first():null;};
 if(c.path[1]==='config'){
  if(c.method==='GET'){const key=await stored();return json({configured:!!key&&!!c.env.CREDENTIAL_ENCRYPTION_KEY,mask:key?.mask||null,endpoint});}
  if(c.method!=='PUT')throw problem(405,'不支持此配置操作');
  const b=await c.body();if(typeof b.api_key!=='string'||!b.api_key.trim())throw problem(400,'请填写 Redfox API Key');
  if(!c.env.CREDENTIAL_ENCRYPTION_KEY)throw problem(503,'本机凭证库尚未连接，请稍后重试');
  const key=b.api_key.trim(),cipher=await c.crypt(key,c.env.CREDENTIAL_ENCRYPTION_KEY),config=await service()||await c.create('settings',null,{title:'Redfox 服务配置',service_id:'redfox'},'service.config'),keyId=config.id;
  await c.env.DB.batch([c.sql('INSERT INTO secrets VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext,mask=excluded.mask,updated_at=excluded.updated_at',keyId,c.owner,cipher,'••••'+key.slice(-4),new Date().toISOString()),c.log('redfox.key_saved',keyId)]);
  return json({configured:true,mask:'••••'+key.slice(-4)});
 }
 if(c.path[1]!=='search'||c.method!=='POST')throw problem(404,'Redfox 操作不存在');
 if(!c.aid)throw problem(400,'请选择保存素材的账号');const account=await c.account(c.aid);if(account.status!=='active')throw problem(400,'账号已停用');
 const b=await c.body();if(b.consume_points!==true)throw problem(400,'请明确确认本次查询可能消耗 Redfox 积分');
 if(b.content_id)await c.record(b.content_id,'content',c.aid);
 const keyword=typeof b.keyword==='string'?b.keyword.trim():'';
 if(!keyword||keyword.length>200||keyword.split(',').filter(x=>x.trim()).length>5)throw problem(400,'Redfox 接口要求：1–5 个英文逗号分隔关键词，总长度不超过 200 字符');
 const days=Number(b.days||7);if(![7,30].includes(days))throw problem(400,'请选择近 7 天或近 30 天');
 const key=await stored();if(!key||!c.env.CREDENTIAL_ENCRYPTION_KEY)throw problem(400,'请先配置 Redfox API Key');
 const secret=await c.crypt(key.ciphertext,c.env.CREDENTIAL_ENCRYPTION_KEY,true),date=new Date(),endDate=date.toISOString().slice(0,10),startDate=new Date(date.getTime()-days*86400000).toISOString().slice(0,10);
 let response;try{response=await(c.env.REDFOX_FETCH||c.env.SKILL_FETCH||fetch)(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{'content-type':'application/json','X-API-Key':secret},body:JSON.stringify({keyword,startDate,endDate,source:'公众号文案创作-GitHub'})});}catch{throw problem(502,'Redfox 查询连接失败或超时，本次未自动重试');}
 if(!response.ok)throw problem(response.status===401||response.status===403?401:502,'Redfox 接口返回 HTTP '+response.status+'，请检查密钥与账号状态');
 let result;try{result=await response.json()}catch{throw problem(502,'Redfox 没有返回有效 JSON');}
 if([3210,3201].includes(Number(result.code)))throw problem(402,'Redfox 积分不足。请在 Redfox 账户自行处理；软件不会自动充值、付款或重新查询。');
 if(Number(result.code)!==2000)throw problem(502,'Redfox 查询失败，返回代码 '+String(result.code||'未知'));
 if(!Array.isArray(result.data?.articles))throw problem(502,'Redfox 返回的文章列表格式无效');
 const seen=new Set(),articles=[];
 for(const value of result.data.articles){
  if(!value||typeof value!=='object')continue;
  const redact=value=>String(value).replaceAll(secret,'[已隐藏密钥]'),text=k=>typeof value[k]==='string'?redact(value[k]):'',identity=String(value.id||text('url')||JSON.stringify(value));if(seen.has(identity))continue;seen.add(identity);
  let url='';try{const u=new URL(text('url'));if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!u.href.includes(encodeURIComponent(secret))&&!u.href.includes(secret))url=u.href;}catch{}
  const article={id:redact(value.id||''),title:text('title'),author:text('author'),url,summary:text('summary'),publicTime:text('publicTime')};
  for(const key of ['clicksCount','watchCount','likeCount','commentsCount'])article[key]=typeof value[key]==='number'&&Number.isFinite(value[key])&&value[key]>=0?value[key]:typeof value[key]==='string'?redact(value[key]):null;
  articles.push(article);
 }
 const snapshot={source:'Redfox公众号爆款搜索接口',endpoint,keyword,startDate,endDate,fetched_at:new Date().toISOString(),articles,limitations:['接口只提供标题、摘要与互动快照，未读取完整正文、封面图片或评论区','数据是服务商返回的快照，不能据此推断因果、完读率或保证爆款效果']};
 const data={title:'Redfox 素材 · '+keyword,body:JSON.stringify(snapshot,null,2),asset_type:'text',url:'https://redfox.hk',license:'用户授权接口查询；按来源使用并核对',redfox_snapshot:snapshot};
 const asset=await c.create('asset',c.aid,data,'redfox.query');await c.log('redfox.search',asset.id,c.aid,{article_count:articles.length,days}).run();return json({asset,count:articles.length,snapshot});
}
